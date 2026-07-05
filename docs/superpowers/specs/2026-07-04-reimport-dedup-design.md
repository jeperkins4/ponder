# Re-import De-duplication + Broadened Issue Types — Design

**Date:** 2026-07-04
**Status:** Approved
**Roadmap item:** "Re-import de-duplication, additional issue types and status mappings" (README)

## Problem

`POST /api/projects/[projectId]/import/process` upserts the `Story` row (keyed by
`jiraKey`) but **unconditionally creates a fresh set of work-unit cards** for every
item, every time. The import preview gives no indication that a story is already on
the board. Re-importing a story therefore duplicates its cards.

Separately, `buildProjectStoriesJql` restricts sync/import to
`issuetype in (Story, Task, Bug)`, so assigned issues of any other type (Sub-task,
Epic, etc.) never appear.

`syncStoriesFromJira` / `syncStoriesForProject` are NOT part of the problem: they
upsert stories by `jiraId`/`jiraKey` and never create cards.

## Decisions (with rationale)

1. **Flag + skip by default.** The preview marks already-imported stories and the
   UI unchecks them by default. Importing one anyway refreshes story fields but
   creates no cards. Chosen over "hard skip" (can't deliberately re-import) and
   "replace cards" (destructive to card progress/notes).
2. **Archived-only stories count as fresh.** Only active (`archivedAt: null`)
   cards make a story "already imported". A story reopened in JIRA after failing
   QA imports normally and gets new cards; its archived cards remain as history.
3. **Guard at both layers.** The preview flags (UX) and the process route
   independently re-checks against the DB (correctness). A stale preview or a
   direct API call cannot duplicate cards.
4. **Drop the issue-type filter entirely.** Any issue type assigned to the current
   user in an active status imports. ("All types" was chosen over adding just
   Sub-task/Epic.) Sub-tasks and epics arrive as ordinary board stories — no
   parent/child modeling.
5. **Status list unchanged.** `PROJECT_SYNC_STATUSES` stays
   To Do / In Progress / Code Revew / Code Review (including the typo-compat pair).

## Design

### 1. De-dup predicate (shared helper)

A story is **already imported** when a `Story` row with that `jiraKey` exists AND
it has ≥1 work unit with `archivedAt: null`.

- Lives in one module (e.g. `src/lib/importDedup.ts`).
- Batch-friendly shape: given a list of `jiraKey`s, returns the set of keys that
  are already imported, using one grouped Prisma query (stories by key, with
  active-work-unit counts) — no per-item N+1.
- Used by both the preview and process routes.

### 2. Preview route (`import/preview`)

- After fetching JIRA issues, call the predicate for all fetched keys.
- `ImportPreviewStory` gains `alreadyImported: boolean`.
- Import review UI: flagged rows render an "Already on board" badge and are
  **unchecked by default**; the user can still check one deliberately.

### 3. Process route (`import/process`)

- Before creating cards for an item, re-check the predicate against the DB
  (never trust the client's flag).
- If already imported: upsert story fields exactly as today, create **no** cards
  (skip the Claude breakdown call too), and count the item in a new
  `storiesSkipped` field on `ImportProcessResult`.
- Completion toast reports e.g. "3 imported, 2 already on board".
- Explicitly re-importing a flagged story therefore refreshes the story row only.
  Card replacement is out of scope.

### 4. JQL issue types

`buildProjectStoriesJql` drops the `issuetype in (Story, Task, Bug)` clause:

```
project = "KEY" AND assignee = currentUser() AND status in (...)
```

`buildAssignedStoriesJql` (env-based legacy path) already has no type filter and
is unchanged.

## Testing

- **Predicate unit tests:** no local story → fresh; story with ≥1 active card →
  already imported; story with only archived cards → fresh; mixed batch returns
  the right key set.
- **Preview route tests:** flagged vs unflagged rows in the response.
- **Process route tests:** already-imported item → story fields upserted, zero
  cards created, no breakdown call, counted in `storiesSkipped`; fresh item
  unchanged behavior.
- **JQL test:** updated expectation without the issuetype clause.
- Existing sync tests unchanged.

## Out of Scope

- Replacing/regenerating an already-imported story's cards.
- Status-mapping changes (statusCategory-based matching, Blocked/QA statuses).
- Parent/child modeling for sub-tasks and epics.
