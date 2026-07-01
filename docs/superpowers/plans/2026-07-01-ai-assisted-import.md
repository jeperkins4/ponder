# AI-Assisted JIRA Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Turn "Import from JIRA" into a guided flow: preview the assigned/active stories, optionally break each into subtasks with Claude, and drop the resulting cards into the board column matching each story's JIRA status.

**Architecture:** A new import *preview* endpoint returns candidate stories with a computed target column. An import *process* endpoint persists each story and creates work-unit cards — one card if not broken down, or N Claude-generated subtask cards if broken down. A review-list UI drives it. A new "Code Review" board column is added.

**Tech Stack:** Next.js 15, Prisma 7, React 18, TypeScript, Tailwind, `@anthropic-ai/sdk`.

## Global Constraints

- Columns are: `todo` · `in_progress` · `code_review` · `done` (4 columns, in this order). (An earlier In Review lane was added then removed — commit 45fb966.)
- Status→column map (import targets): `To Do`→todo; `In Progress`,`Review`→in_progress; `Code Revew`,`Code Review`→code_review; anything else→todo. `done` is a LOCAL-ONLY lane — no JIRA status imports into it; users drag cards there as work progresses.
- Anthropic key: global `ANTHROPIC_API_KEY` (server-side only; never sent to the browser).
- Default Claude model for breakdown: `claude-sonnet-5` (configurable via `ANTHROPIC_BREAKDOWN_MODEL`).
- Each generated subtask card's description contains: a short description of the unit of work, Acceptance Criteria, and Verification.
- A story NOT broken down becomes exactly one card (its summary/description) in its status column.
- Preserve existing per-project JIRA sync/creds behavior; reuse `fetchStoriesForProject`.
- TDD; full suite green; `tsc --noEmit` clean. Use Context7 for current `@anthropic-ai/sdk` usage.

---

## Task 1: Add the "Code Review" column + JIRA-status→column mapping

**Files:**
- Modify: `src/lib/types.ts` — extend the `Column` union with `"code_review"`.
- Create: `src/lib/columns.ts` — column list, labels, and `jiraStatusToColumn`.
- Create: `src/lib/columns.test.ts`.
- Modify: `src/components/KanbanBoard.tsx` — render 4 columns; keyboard nav across 4.
- Modify: `src/components/KanbanBoard.test.tsx`.

**Interfaces:**
- Produces: `type Column = "todo" | "in_progress" | "code_review" | "in_review" | "done"`.
- Produces: `COLUMNS: { key: Column; label: string }[]` in display order (To Do, In Progress, Code Review, In Review, Done).
- Produces: `jiraStatusToColumn(status: string): Column`.

**Key content:**
```ts
// src/lib/columns.ts
import type { Column } from "@/lib/types";

export const COLUMNS: { key: Column; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "code_review", label: "Code Review" },
  { key: "in_review", label: "In Review" },
  { key: "done", label: "Done" },
];

// Import target columns only. `in_review` and `done` are local-only lanes.
const STATUS_TO_COLUMN: Record<string, Column> = {
  "to do": "todo",
  "in progress": "in_progress",
  review: "in_progress",
  "code revew": "code_review",
  "code review": "code_review",
};

export function jiraStatusToColumn(status: string): Column {
  return STATUS_TO_COLUMN[status.trim().toLowerCase()] ?? "todo";
}
```
- KanbanBoard must derive its columns from `COLUMNS` (not a hardcoded 3), so the grid, headers, empty states, and arrow-key column navigation all cover all 5 columns. Keep existing card behavior. Update the grid to 5 columns (e.g. `grid-cols-5`); verify horizontal fit / responsive scroll.
- Tests: `jiraStatusToColumn` maps each status (case-insensitive) and falls back to `todo`; KanbanBoard renders all 5 column headers.

**Steps:** write column tests (fail) → implement `columns.ts` + `Column` union → make KanbanBoard consume `COLUMNS` and 4-column keyboard nav → update board tests → run → commit `"feat: add Code Review column and JIRA-status-to-column mapping"`.

---

## Task 2: Anthropic breakdown service

**Files:**
- Modify: `package.json` — add `@anthropic-ai/sdk`.
- Create: `src/lib/anthropic/client.ts` — singleton client from `ANTHROPIC_API_KEY`.
- Create: `src/lib/anthropic/breakdown.ts` — `breakDownStory(...)`.
- Create: `src/lib/anthropic/breakdown.test.ts`.

**Interfaces:**
- Produces:
```ts
export type SubtaskDraft = {
  title: string;            // short description of the unit of work
  acceptanceCriteria: string;
  verification: string;
};
export async function breakDownStory(
  story: { summary: string; description: string | null },
  client?: AnthropicLike            // injectable for tests
): Promise<SubtaskDraft[]>;
export function formatSubtaskDescription(d: SubtaskDraft): string;
```
- `formatSubtaskDescription` returns:
  ```
  {title}

  Acceptance Criteria:
  {acceptanceCriteria}

  Verification:
  {verification}
  ```

**Key content:**
- Use Context7 to confirm current `@anthropic-ai/sdk` message + tool-use API before writing.
- `breakDownStory` calls Claude (`process.env.ANTHROPIC_BREAKDOWN_MODEL ?? "claude-sonnet-5"`) with a system prompt instructing it to decompose the story into 2–6 implementable subtasks, each with a concise title, testable acceptance criteria, and a verification method. Force structured output via a tool/JSON schema (`{ subtasks: [{ title, acceptanceCriteria, verification }] }`) and return the parsed array.
- Inject the client (default to the singleton) so tests pass a fake returning a canned tool-use response — no network in tests.
- Throw a clear error if `ANTHROPIC_API_KEY` is unset when the real client is constructed.

**Steps:** add dep → write breakdown tests with a fake client (asserts parsing + `formatSubtaskDescription`) → implement client + breakdown → run → commit `"feat: add Claude story-breakdown service"`.

---

## Task 3: Import preview endpoint

**Files:**
- Create: `src/app/api/projects/[projectId]/import/preview/route.ts` (POST).
- Create: `.../import/preview/route.test.ts`.

**Interfaces:**
- Produces: `POST /api/projects/[projectId]/import/preview` →
  ```ts
  { stories: Array<{
      jiraKey: string; jiraId: string; summary: string;
      description: string | null; jiraStatus: string; targetColumn: Column;
  }> }
  ```
**Behavior:**
- Load project; if creds incomplete → `200 { stories: [] , message }` (same graceful pattern as sync). Reuse `fetchStoriesForProject(project.jiraProjectKey, config)`.
- Map each fetched StoryDTO to the preview shape, computing `targetColumn = jiraStatusToColumn(jiraStatus)`. Does NOT persist anything.
- Tests: mock the JIRA fetch boundary; assert target columns; incomplete creds returns empty + message.

**Steps:** test → implement → run → commit `"feat: add import preview endpoint"`.

---

## Task 4: Import process endpoint

**Files:**
- Create: `src/app/api/projects/[projectId]/import/process/route.ts` (POST).
- Create: `.../import/process/route.test.ts`.

**Interfaces:**
- Consumes body:
  ```ts
  { items: Array<{
      jiraKey: string; jiraId: string; summary: string;
      description: string | null; jiraStatus: string; breakDown: boolean;
  }> }
  ```
- Produces: `{ storiesProcessed: number; workUnitsCreated: number }`.

**Behavior (per item):**
- Upsert the `Story` (by `jiraKey`; set `projectId`, summary, description, `jiraStatus`, `projectKey`, `url`, `lastSyncedAt`). Reuse existing upsert shape from `syncStoriesForProject`.
- `column = jiraStatusToColumn(item.jiraStatus)`.
- If `breakDown`: `drafts = await breakDownStory({summary, description})`; create one WorkUnit per draft: `{ storyId, projectId, title: draft.title, description: formatSubtaskDescription(draft), column, order }` (order increments within the story).
- Else: create ONE WorkUnit `{ storyId, projectId, title: summary, description, column, order: 0 }`.
- Sum and return counts. Inject `breakDownStory` (default real) so tests use a fake.

**Steps:** test (breakdown item → N work units in mapped column; plain item → 1 work unit; correct columns) → implement → run → commit `"feat: add import process endpoint with optional Claude breakdown"`.

---

## Task 5: Import review UI ("review list, then process")

**Files:**
- Create: `src/components/ImportReview.tsx` — the review list + Process action.
- Create: `src/components/ImportReview.test.tsx`.
- Modify: `src/components/ImportFromJiraButton.tsx` — open the review flow instead of calling `/sync` directly.

**Behavior:**
- Clicking "Import from JIRA" POSTs to `/import/preview` and opens a panel/modal listing each candidate story: a "break down" checkbox, `jiraKey`, `summary`, and a badge showing its target column. A header shows the count and a **Process** button; a select-all/none affordance is nice-to-have.
- **Process** POSTs `{ items }` (each story + its checkbox state) to `/import/process`, showing a progress/disabled state ("Processing… this may take a moment" — Claude calls are slow), then on success closes and calls the board refresh (`onImported`) so new cards appear.
- Theme-aware (useTheme), WCAG AA (dialog role, labelled checkboxes, focus management), Ponder styling.
- Tests (mock fetch): preview renders rows with target-column badges + checkboxes; Process posts the selected breakDown flags and triggers refresh on success; empty-preview + error states.

**Steps:** test → implement ImportReview → wire ImportFromJiraButton → run → commit `"feat: add import review UI with per-story breakdown toggle"`.

---

## Task 6: Wire-up, env docs, and end-to-end verification

**Files:**
- Modify: `.env.example` (or create) — document `ANTHROPIC_API_KEY`, `ANTHROPIC_BREAKDOWN_MODEL`.
- Modify: any remaining references assuming 3 columns.

**Steps:**
- Full suite serially (`npx dotenv -e .env.test -- vitest run --no-file-parallelism`); `tsc --noEmit` clean.
- Confirm: 4 columns render; a plain import creates one card per story in the right column; a broken-down import creates multiple subtask cards (each description carries Acceptance Criteria + Verification) in the story's column; keyboard nav spans 4 columns.
- Commit `"test: verify AI-assisted import end to end"`.

---

## Task 7: Keep the JIRA item in step with the Ponder board (status write-back)

**Trigger:** after ANY work-unit move is persisted (the move endpoint already calls
the status trigger). Recompute the story's *desired* JIRA status from its cards and
sync JIRA to it. Generalize `checkAndUpdateStoryStatus` into this.

**Desired-status rule** — `computeDesiredJiraStatus(workUnits) => "In Progress" | "Code Revew" | null`:
- No work units → `null` (do nothing).
- ALL work units `column === "done"` → **"Code Revew"** (work complete → ready for review).
- ELSE any work unit in a working lane (`in_progress` | `code_review`; i.e.
  not `todo` and not `done`) → **"In Progress"** (work has started).
- ELSE (every card still `todo`) → `null` (leave the item alone).

**Actions (in JIRA, using the story's project creds), only when desired ≠ current:**
1. Transition the JIRA issue to the desired status (match the workflow transition whose
   target status NAME equals the desired name; accept "Code Review" as an alias of "Code Revew").
2. ONLY on the transition to **"Code Revew"**, post a comment: a **Claude-generated summary**
   of the completed work followed by a bullet list of the completed work-unit titles (see
   `summarizeCompletedWork`). The "In Progress" transition posts NO comment.

**Design (critical):**
- Put the write-back in ONE reusable service fn, e.g. `applyStoryStatusSync(storyId, prisma, deps)`,
  called from the move endpoint AFTER the local move has been persisted. A JIRA/Claude
  failure must NEVER block or roll back the local move — catch, log, and surface a
  non-blocking warning (matches the repo's existing "JIRA failure never blocks a local
  move" philosophy). Design it so a FUTURE MCP "move card" tool triggers the same path.
- **Idempotency / no redundant writes:** compute desired vs current; only transition when they
  differ AND a valid workflow transition to the desired status exists from the current status.
  Never post the completion comment twice (guard on current jiraStatus already being "Code Revew").
  Update local `story.jiraStatus` to the new status on success.
- New JIRA client fns (reuse Basic-auth construction): `getTransitions(issueKey, config)`,
  `transitionIssue(issueKey, transitionId, config)`, `addComment(issueKey, adfOrText, config)`.
  Reuse `pickTransition` but match by target status NAME, not just category; if no valid
  transition exists from the current status, warn (do not throw).
- `summarizeCompletedWork(story, workUnits)` lives in `src/lib/anthropic/` (reuses Task 2's client).

**Files:** `src/lib/jira/transitions.ts` (+name matching), new `src/lib/jira/writeback.ts` or
extend client, `src/lib/statusTrigger.ts` (call the service), `src/lib/anthropic/summarize.ts`,
`src/app/api/work-units/[id]/move/route.ts` (already calls the trigger), plus tests.

**Tests:** `computeDesiredJiraStatus` — all-todo→null, any-working→"In Progress", all-done→"Code Revew",
no-units→null. Service (mocked JIRA/Claude): first card leaves To Do → transitions to In Progress, NO
comment; all cards done → transitions to Code Revew WITH summary comment; already at target → no-op;
JIRA failure → local move still returns 200, warning logged.

**Depends on:** Task 2 (anthropic client). Commit: `"feat: transition JIRA to Code Revew and comment on story completion"`.

---

## Roadmap / follow-on (separate plan)

- **Expose Ponder to Claude Code via an MCP server.** A dedicated Model Context
  Protocol server that exposes Ponder operations as tools (list projects / stories /
  work units, move a card, mark done, add/break-down work units). Then Claude Code —
  while coding — can advance Ponder cards directly, and moving a card to Done there
  triggers the SAME `applyStoryCompletion` write-back as the UI. This is why Task 7's
  write-back must live in a reusable service, not inline in the HTTP handler. Needs its
  own plan (MCP server package, tool schemas, auth to the local API, config for
  `claude mcp add`). Not scoped here.

## Notes / open items
- Claude latency: breaking down N stories is N API calls; the process endpoint may run several seconds. Acceptable for v1 (surface a progress state). A future improvement could stream per-story progress.
- `Done` column receives no imports (those statuses are filtered out of sync); it remains the local-completion bucket.
