# Task 3 — Return story to JIRA with screenshots + consolidated AC/verification

## Status: DONE

## Commit
`63e7cec` (verified with `git log --oneline -1` on `feature/jira-return-attachments`)

## What was built

1. **`uploadAttachment` — `src/lib/jira/writeback.ts`**
   `POST {siteUrl}/rest/api/3/issue/{issueKey}/attachments` with a
   `multipart/form-data` body (`FormData` + `File`) containing a single
   `file` field. Headers: `Authorization: Basic ...` (reused
   `basicAuthHeader`) and `X-Atlassian-Token: no-check`. `Content-Type` is
   left unset so `fetch` generates the multipart boundary. Throws
   `JIRA API error: <status>` on non-2xx, matching the existing writeback
   functions.

2. **`consolidateAcceptanceCriteria` — `src/lib/anthropic/consolidateAcceptanceCriteria.ts`**
   Mirrors `breakdown.ts`'s tool-forced-output pattern (a `record_consolidated_criteria`
   tool call) so the two output strings are always cleanly separated rather
   than parsed out of prose. Model: `process.env.ANTHROPIC_BREAKDOWN_MODEL ??
   "claude-sonnet-5"`, injectable `AnthropicLike` client. If none of the
   work units have any non-empty `acceptanceCriteria`/`verification`, it
   returns `{ acceptanceCriteria: "", verification: "" }` without calling
   Claude at all.

3. **Wired into `applyStoryStatusSync` — `src/lib/statusTrigger.ts`**
   - The `story.workUnits` query now includes `attachments`.
   - Inside the existing `desired === "Code Revew" && completionCommentPostedAt == null`
     guard (unchanged — still runs exactly once): calls
     `deps.consolidateAcceptanceCriteria`, wrapped in its own try/catch so a
     Claude failure degrades to the base summary/work-unit-list comment
     rather than aborting the transition. Appends an `Acceptance Criteria:`
     section and a `Verification:` section to the comment body, each
     omitted when its string is empty.
   - After posting the comment, loops over every done work unit's
     attachments, reads bytes via `deps.readAttachmentFile` (the existing
     `attachmentStorage.readAttachmentFile`), and uploads each via
     `deps.uploadAttachment`. Each attachment is wrapped in its own
     try/catch — a failed read or upload is `console.warn`'d and the loop
     continues; it can never throw out to the outer catch.
   - `ApplyStoryStatusSyncDeps` gained `uploadAttachment`,
     `consolidateAcceptanceCriteria`, and `readAttachmentFile`, all wired to
     the real implementations in `defaultDeps`.

## Confirmations

- **Completion comment now includes consolidated AC/verification**: verified
  by `statusTrigger.test.ts` — comment body contains an `Acceptance
  Criteria:` section and a `Verification:` section built from
  `consolidateAcceptanceCriteria`'s return value; sections are omitted when
  empty.
- **Attachments uploaded to the JIRA issue**: verified — `uploadAttachment`
  is called once per `Attachment` row across all done work units, with the
  correct filename/mimeType/bytes.
- **Both non-blocking**: a rejecting `uploadAttachment` (per-attachment) and
  a rejecting `consolidateAcceptanceCriteria` are each caught locally; the
  transition still happens, the comment is still posted, and
  `story.jiraStatus`/`completionCommentPostedAt` are still updated in
  Postgres. Neither can flip `applyStoryStatusSync`'s outer try/catch.
- **Idempotent**: reuses the existing `completionCommentPostedAt` guard — a
  second call with the guard already set calls neither
  `consolidateAcceptanceCriteria` nor `uploadAttachment`.
- **JIRA only ever sees the bare `story.jiraKey`**: `uploadAttachment` and
  `addComment` are both called with `story.jiraKey` only; no sub-number
  suffix is ever constructed or sent.

## Tests

- Full suite: **457 passed** (baseline 444 on main + 13 new: 3 in
  `writeback.test.ts` for `uploadAttachment`, 4 in
  `consolidateAcceptanceCriteria.test.ts`, 6 new integration cases in
  `statusTrigger.test.ts`).
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors (3 pre-existing warnings, unrelated files).
- `npm run knip`: clean.

## Concerns

- `summarizeCompletedWork` (the lead-in prose summary) is still unwrapped —
  a Claude failure there was already able to bubble to the outer catch
  before this change (pre-existing gap, out of scope for this task). The
  two *new* Claude/JIRA calls added here (`consolidateAcceptanceCriteria`,
  `uploadAttachment`) are both defensively wrapped so this task's global
  non-blocking constraint holds regardless.
- `addComment`'s own failure semantics are unchanged (pre-existing
  behavior: if it rejects, the whole completion branch's local update is
  skipped via the outer catch, same as before this change).
