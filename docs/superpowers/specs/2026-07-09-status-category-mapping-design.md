# statusCategory-Based JIRA Status Matching — Design

**Date:** 2026-07-09
**Status:** Approved

## Goal

Custom or renamed JIRA statuses "just work" without code changes: the sync fetch filter moves from a hardcoded status-name list to JIRA's `statusCategory`, and the board column mapping falls back to category when a status name isn't explicitly recognized. Stories parked in QA-style statuses stay off the board via a per-project exclusion list.

## Decisions made during brainstorming

- **Fetch scope:** `statusCategory != Done`, minus a per-project exclusion list — preserving the July 4 decision that QA-parked stories don't import (default exclusion: `QA`).
- **Exclusions live on the project:** a "Statuses to exclude from sync" settings field (comma-separated), stored on the Project row exactly like `githubRepos`.
- **Approach:** category filter in JQL (not post-fetch filtering); column mapping keeps explicit name overrides and gains a category fallback replacing the blanket-`todo` fallback.

## Behavior change summary

| Scenario | Before | After |
|---|---|---|
| Custom active status (e.g. "Blocked") | Not imported | Imports; lands in In Progress (indeterminate category) |
| "Code Revew" renamed to anything | Stops importing | Keeps importing (category-based fetch) |
| Status "QA" | Not imported | Still not imported (default exclusion, editable per project) |
| Unknown status's column | To Do (blanket fallback) | By category: new → To Do, indeterminate → In Progress, done → Done |
| Known names (To Do / In Progress / Review / Code Revew / Code Review) | Mapped by name | Unchanged — name overrides still win |

## 1. Schema & settings

- `Project.jiraExcludedStatuses String? @default("QA")` — Postgres backfills existing rows with `'QA'` on migration; code defensively treats `null` as `"QA"` anyway. Comma-separated status names; **empty string means exclude nothing**.
- Settings page: a "Statuses to exclude from sync" text input beside the other JIRA fields (placeholder `QA, Blocked`), plumbed identically to `githubRepos`: `Project` TS type, `projectToDTO`, PUT route update-when-provided (`!== undefined`), always-sent from the settings form.

## 2. JQL — `buildProjectStoriesJql(projectKey, excludedStatuses: string[])`

- The `PROJECT_SYNC_STATUSES` constant is **deleted**.
- Query: `project = "<key>" AND assignee = currentUser() AND statusCategory != Done`, plus ` AND status NOT IN ("QA", ...)` only when `excludedStatuses` (after trimming and dropping blanks) is non-empty.
- Status names are wrapped in double quotes with embedded `"` and `\` escaped (`\"`, `\\`).
- `sync.ts` parses `project.jiraExcludedStatuses ?? "QA"` (split on commas, trim, drop blanks) and passes the array to `fetchStoriesForProject`, which passes it to the builder — the pure function receives data, never a Project row.
- `buildAssignedStoriesJql` (legacy multi-project path) already uses `statusCategory != Done`; it is untouched.

## 3. Client & DTO

- The enhanced-search request already includes `status` in `SEARCH_FIELDS`; the response's status object carries `statusCategory`. The client's `JiraIssue` type gains `fields.status.statusCategory: { key: string }`, and `issueToStoryDTO` maps it.
- `StoryDTO` gains `jiraStatusCategory: "new" | "indeterminate" | "done"` — JIRA's three fixed category keys. The client narrows: a key outside the three (never expected from JIRA) maps to `"new"`, so the union stays honest and unknown categories degrade to today's To Do behavior.
- **Not persisted**: `Story` has no new column. The category is consumed at import time (column mapping) and discarded — nothing downstream needs it.

## 4. Column mapping — `jiraStatusToColumn(status, category?)`

- Existing name-override map stays first and wins: `to do → todo`, `in progress → in_progress`, `review → in_progress`, `code revew → code_review`, `code review → code_review` (case-insensitive, trimmed).
- New optional second parameter `category?: "new" | "indeterminate" | "done"`. When the name isn't in the override map:
  - `new` → `todo`
  - `indeterminate` → `in_progress`
  - `done` → `done`
  - absent/undefined → `todo` (today's behavior; keeps every existing caller compiling and behaving identically)
- The import process route (and preview where it maps a display column, if it does) passes `story.jiraStatusCategory`.

## 5. Testing

- **jql.test.ts:** category clause present; exclusion clause with one and several names; quoting and escaping of embedded quotes/backslashes; trimming and blank-dropping; empty list omits the `NOT IN` clause entirely; `PROJECT_SYNC_STATUSES` assertions removed.
- **columns.test.ts:** every name override still wins even with a contradicting category; all three category fallbacks; absent category → todo; unknown name + unknown category → todo.
- **client.test.ts:** `issueToStoryDTO` maps `statusCategory.key`; unknown key handling.
- **sync.test.ts:** project's `jiraExcludedStatuses` setting reaches the fetch (mocked client asserts the passed array); null field → `["QA"]`; empty string → `[]`.
- **Settings/PUT tests:** store-when-provided, preserve-when-omitted, field renders/loads/submits (mirroring the `githubRepos` cases).
- **Import process route test:** a story with an unrecognized status name and `indeterminate` category creates its card in `in_progress`.

All tests via `npm test` / `npm run test:ci` only (vitest.setup guard).

## Out of scope

- Persisting `statusCategory` on `Story`.
- Per-project *column-mapping* configuration.
- Write-back changes — `transitions.ts` already navigates by `statusCategory`.
- Re-mapping existing cards' columns; only newly imported cards use the new mapping.
- The legacy `buildAssignedStoriesJql` path (already category-based).
