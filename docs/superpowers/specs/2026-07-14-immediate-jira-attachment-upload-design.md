# Immediate JIRA Attachment Upload — Design

**Date:** 2026-07-14
**Status:** Approved

## Goal

Today, verification evidence (screenshots/videos attached to a work unit — via the board UI or the MCP `attach_image` tool) only reaches the original JIRA issue later, when the story auto-completes (`applyStoryStatusSync`) or a card is Moved to QA (`reportWorkUnitToQA`). This makes evidence reach the JIRA issue immediately when captured, while keeping the existing deferred paths as a safety net rather than removing them.

## Decisions

- **Timing:** upload to JIRA immediately, at attach time — not just deferred.
- **Scope:** applies to both attachment paths (board UI upload, MCP `attach_image`) since both already go through the same `POST /api/work-units/[id]/attachments` route.
- **Failure handling:** non-blocking. A JIRA upload failure never fails the attachment request; the Ponder-side attachment is kept regardless, matching the codebase's existing "a JIRA hiccup never breaks a local action" convention (`statusTrigger.ts`'s `applyStoryStatusSync`).
- **Dedup:** new `Attachment.jiraUploadedAt` column. Immediate upload sets it on success; the existing deferred-batch loops in `applyStoryStatusSync` and `reportWorkUnitToQA` skip any attachment that already has it set, so the same file is never uploaded to the JIRA issue twice. The deferred loops remain in place as a safety net for attachments where immediate upload failed (non-blocking → silent) or the project wasn't fully JIRA-configured yet at attach time.
- **Surfacing:** the JIRA-upload outcome is reported back — `AttachmentDTO.jiraUploadedAt` in the REST response, and one added sentence in `attach_image`'s MCP text result.
- **No backfill.** Attachments created before this change keep `jiraUploadedAt: null` and are picked up normally by the existing deferred paths when their story next completes or moves to QA — identical to today's behavior for them.

## 1. Schema

```prisma
model Attachment {
  ...
  jiraUploadedAt DateTime?
}
```
Nullable, no default. Additive migration only.

## 2. New orchestration function

New file `src/lib/attachmentJiraSync.ts`:

```ts
export async function syncAttachmentToJira(
  attachmentId: string,
  prisma: PrismaClient,
  deps: Pick<ApplyStoryStatusSyncDeps, "uploadAttachment" | "readAttachmentFile"> = defaultDeps
): Promise<{ uploaded: boolean; warning?: string }>
```

Fetches the attachment with `workUnit → story → project`. Reuses `hasJiraCredentials` (exported from `statusTrigger.ts`, not duplicated) to decide whether the project is fully JIRA-configured. Reads the just-written file via `readAttachmentFile`, calls the existing `uploadAttachment` (`src/lib/jira/writeback.ts` — already implements the JIRA attachments endpoint, multipart body, `X-Atlassian-Token` header). On success, sets `jiraUploadedAt`. Never throws: every failure (no credentials, JIRA API error, file-read error) is caught, logged via `console.warn`, and returned as `{ uploaded: false, warning }`.

## 3. Route wiring

`src/app/api/work-units/[id]/attachments/route.ts`'s `POST` calls `syncAttachmentToJira` immediately after `writeAttachmentFile` succeeds, `await`s it (no true fire-and-forget — this is a serverless-style route handler), and includes the result in the response. `AttachmentDTO` (`src/lib/types.ts:40-48`) gains `jiraUploadedAt: string | null` (ISO string or null, matching the file's existing date-serialization convention).

## 4. Preventing duplicate uploads in the existing batch paths

`src/lib/statusTrigger.ts`:
- `applyStoryStatusSync`'s attachment-upload loop (currently lines 229-245): skip when `attachment.jiraUploadedAt != null`; on a newly successful upload from this loop, set `jiraUploadedAt`.
- `reportWorkUnitToQA`'s attachment-upload loop (currently lines 418-425): same skip/set logic.

No other behavior in either function changes — `applyStoryStatusSync` stays non-blocking, `reportWorkUnitToQA` stays blocking/error-surfacing, comment-posting and transitions are untouched.

## 5. MCP surface

`PonderClient.addAttachment` (`src/mcp/client.ts`) already returns the route's JSON response as `AttachmentDTO`, so `jiraUploadedAt` flows through with no client change needed beyond the type. `attachImage` (`src/mcp/tools.ts`) appends one sentence to its text result based on the flag: uploaded, or not yet uploaded (with the warning reason when available).

## Testing

- New `src/lib/attachmentJiraSync.test.ts`: success path (sets `jiraUploadedAt`), no-JIRA-credentials skip, JIRA API failure (non-blocking, returns `{uploaded: false, warning}`, doesn't throw).
- `route.test.ts` additions: `jiraUploadedAt` present and correct in the response; a JIRA-upload failure still returns 201 with the Ponder-side attachment intact and `jiraUploadedAt: null`.
- `statusTrigger.test.ts` additions: both loops skip an attachment with `jiraUploadedAt` already set (asserting `uploadAttachment` is not called for it) and correctly upload+stamp one that doesn't.
- `tools.test.ts` additions: `attachImage`'s text result reflects both the uploaded and not-yet-uploaded cases.

All tests via `npm test` / `npm run test:ci` only.

## Out of scope

- Board UI indicator/badge for JIRA-upload status.
- Any retry mechanism beyond the existing deferred-batch safety net.
- Backfilling `jiraUploadedAt` for attachments created before this change.
- Changing `applyStoryStatusSync`'s non-blocking contract or `reportWorkUnitToQA`'s blocking contract.
