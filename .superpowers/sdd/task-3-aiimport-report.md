# Task 3: Import preview endpoint

Status: DONE

## Summary

Added a read-only `POST /api/projects/[projectId]/import/preview` endpoint. It loads the
project, reuses the same graceful "not linked" / "incomplete creds" branching as
`syncStoriesForProject` (duplicated inline rather than calling into `sync.ts`, since that
function persists), calls `fetchStoriesForProject` for JIRA-linked projects with complete
creds, and maps each `StoryDTO` to a preview shape with a computed `targetColumn` via
`jiraStatusToColumn`. Nothing is written to the database — verified in tests with a
`prisma.story.findMany` check after the call.

## Response shape (for Task 4/5)

```ts
// POST /api/projects/[projectId]/import/preview
{
  stories: Array<{
    jiraKey: string;
    jiraId: string;
    summary: string;
    description: string | null;
    jiraStatus: string;
    targetColumn: Column; // "todo" | "in_progress" | "code_review" | "done"
  }>;
  message?: string; // present (with stories: []) when not JIRA-linked / creds incomplete
}
```

Status codes:
- `404 { error }` — project not found
- `200 { stories: [], message }` — STANDALONE project, JIRA-type project missing
  `jiraProjectKey`, or JIRA project missing any of `jiraSiteUrl`/`jiraEmail`/`jiraApiToken`
  (same two message strings as `sync.ts`, verbatim)
- `200 { stories: [...] }` — JIRA-linked project with complete creds; one entry per fetched
  story
- `500 { error }` — unexpected error (JIRA fetch failure, e.g. a 410, or any other thrown
  error)

Also exported for reuse by Task 4/5: `ImportPreviewStory` and `ImportPreviewResult` types
from `src/app/api/projects/[projectId]/import/preview/route.ts`.

## How the JIRA fetch was mocked in tests

Same module-boundary mock as `src/lib/sync.test.ts` and the sibling
`sync/route.test.ts`: `vi.mock("@/lib/jira/client")` at the top of the file, then
`vi.mocked(jiraClient.fetchStoriesForProject).mockResolvedValueOnce(...)` /
`mockRejectedValueOnce(...)` per test. Everything else (project creation/lookup, the
"nothing persisted" assertion) runs against the real test Postgres via the `prisma`
singleton, matching the sync route's integration-test style. Each test creates its own
project row (unique key/suffix) and cleans up in a `finally` block.

## Tests

- `npx dotenv -e .env.test -- vitest run "src/app/api/projects/[projectId]/import" --no-file-parallelism`:
  **5 passed** (1 file):
  - 404 for missing project (JIRA fetch not called)
  - STANDALONE project → `{ stories: [], message: "Project is not linked to JIRA" }`,
    JIRA fetch not called
  - JIRA project with incomplete creds → `{ stories: [], message: "JIRA credentials not
    configured. Add them in project settings." }`, JIRA fetch not called
  - JIRA project with complete creds → three stories mapped to `todo` / `in_progress` /
    `code_review` (including the misspelled "Code Revew" status), and a follow-up
    `prisma.story.findMany` confirms zero rows were persisted
  - JIRA fetch rejecting (simulating an old-style 410) → 500 with the error message
    surfaced
- Full suite serially: **291 passed** (baseline 286 + 5 new — exact match), 33 test files.
- `npx tsc --noEmit`: clean, no errors.

## Concerns

- None blocking. The "not linked" / "incomplete creds" branching logic is duplicated
  between `sync.ts` and this route rather than extracted into a shared helper, per the
  constraint not to change `sync.ts`. If Task 4 (process endpoint) needs the same
  branching again, it may be worth a future small refactor to a shared
  `resolveJiraConfigForProject` helper — flagging for reviewers, not doing it here since
  it wasn't asked for and touching `sync.ts` was explicitly out of scope.
