# statusCategory-Based JIRA Status Matching — Design

**Date:** 2026-07-09 (revised 2026-07-09 after PR #30 review hold)
**Status:** Approved (revision 2 — allowlist fetch)

## Goal

Custom or renamed JIRA statuses work without code changes: the sync fetch filter becomes a **per-project allowlist** ("Statuses to sync") editable in Settings instead of a hardcoded constant, and the board column mapping falls back to `statusCategory` when a status name isn't explicitly recognized.

## Revision 2 (2026-07-09)

The original design fetched `statusCategory != Done` minus a deny-list. Checking the real COM status universe showed "QA Approved" (In Progress category) would leak onto the board, and any future status defaults to *in* — the wrong bias for a curated workflow. John held PR #30; the fetch side is now an **allowlist**: `status IN (<per-project list>)`, unknown statuses default *out*. The category-based **column mapping** fallback and the client/import category threading are unchanged from revision 1.

## Decisions

- **Fetch scope:** `status IN (<per-project allowlist>)`. Default list: `To Do, In Progress, Code Revew, Code Review` (today's exact behavior). Unknown/future statuses default **out**.
- **Allowlist lives on the project:** a "Statuses to sync" settings field (comma-separated), stored on the Project row exactly like `githubRepos`.
- **Blank-input safety:** a null, empty, or all-blank setting falls back to the default list — misconfiguration can never mean "sync nothing" or "sync everything".
- **Column mapping** keeps explicit name overrides and gains a category fallback replacing the blanket-`todo` fallback (unchanged from revision 1).

## Behavior change summary

| Scenario | Before (hardcoded) | After (rev 2) |
|---|---|---|
| Custom active status (e.g. "Blocked") | Not imported | Imported once added to the project's "Statuses to sync" — no deploy needed |
| "QA Approved" (In Progress category) | Not imported | Still not imported (not on the default allowlist) |
| Status "QA" | Not imported | Still not imported |
| Allowlisted custom status's column | To Do (blanket fallback) | By category: new → To Do, indeterminate → In Progress, done → Done |
| Known names (To Do / In Progress / Review / Code Revew / Code Review) | Mapped by name | Unchanged — name overrides still win |

## 1. Schema & settings

- Replace revision 1's `jiraExcludedStatuses` with `Project.jiraSyncStatuses String? @default("To Do, In Progress, Code Revew, Code Review")`. On this unmerged branch that means a follow-up migration dropping `jiraExcludedStatuses` and adding `jiraSyncStatuses` (the old column carried deny-list semantics; no production data exists).
- Settings page: a "Statuses to sync" text input beside the other JIRA fields (placeholder `To Do, In Progress, Code Revew, Code Review`), plumbed identically to `githubRepos`: `Project` TS type, `projectToDTO`, PUT route update-when-provided (`!== undefined`), always-sent from the settings form.

## 2. JQL — `buildProjectStoriesJql(projectKey, syncStatuses: string[])`

- Query: `project = "<key>" AND assignee = currentUser() AND status IN ("To Do", ...)` — names quoted with embedded `"` and `\` escaped (`\"`, `\\`), trimmed, blanks dropped.
- The builder throws if the (cleaned) list is empty — callers must resolve defaults first; a pure function silently substituting policy hides bugs.
- `parseSyncStatuses(value: string | null | undefined): string[]` — null/undefined/empty/all-blank → the default four; else split on commas, trim, drop blanks. Exported alongside the builder; used by sync and the import preview route.
- `buildAssignedStoriesJql` (legacy multi-project path, `statusCategory != Done`) is untouched.

## 3. Client & DTO (unchanged from revision 1)

- `JiraIssue.fields.status.statusCategory?: { key: string }`; `issueToStoryDTO` maps it via `narrowStatusCategory` (unknown keys → `"new"`).
- `StoryDTO.jiraStatusCategory?: "new" | "indeterminate" | "done"` — optional, set only by the JIRA fetch path; not persisted on `Story`.
- `fetchStoriesForProject(projectKey, config, syncStatuses: string[] = DEFAULT_SYNC_STATUSES)` — the default constant lives in `jql.ts` and is exported for the client's parameter default.

## 4. Column mapping — `jiraStatusToColumn(status, category?)` (unchanged from revision 1)

- Name overrides win: `to do → todo`, `in progress → in_progress`, `review → in_progress`, `code revew → code_review`, `code review → code_review` (case-insensitive, trimmed).
- Category fallback: `new → todo`, `indeterminate → in_progress`, `done → done`; absent/undefined → `todo`.
- Import preview computes `targetColumn` with the category; ImportReview forwards it; the process route maps with it.

## 5. Testing

- **jql.test.ts:** allowlist clause with the default and custom lists; quoting/escaping of embedded quotes/backslashes; trimming and blank-dropping; empty cleaned list throws; `parseSyncStatuses` (null/undefined/empty/all-blank → default four; custom lists parse).
- **columns.test.ts:** unchanged from revision 1 (overrides beat category; three fallbacks; absent → todo).
- **client.test.ts:** category mapping and unknown-key narrowing (unchanged); default third argument produces the default allowlist JQL; explicit list passes through.
- **sync.test.ts:** project's `jiraSyncStatuses` reaches the fetch; null → default four; `""` → default four; custom list parses.
- **Preview route test:** same pass-through assertions as sync.
- **Settings/PUT tests:** store-when-provided, creation default, preserve-when-omitted, field renders/loads/submits.
- **Import process route test:** unchanged — an allowlisted story with an unrecognized name and `indeterminate` category lands in `in_progress`.

All tests via `npm test` / `npm run test:ci` only (vitest.setup guard).

## Out of scope

- Persisting `statusCategory` on `Story`.
- Per-project *column-mapping* configuration.
- Write-back changes — `transitions.ts` already navigates by `statusCategory`.
- Re-mapping existing cards' columns; only newly imported cards use the new mapping.
- The legacy `buildAssignedStoriesJql` path.
- A status *picker* UI (fetching available statuses from JIRA to populate a dropdown) — the free-text field ships first; a picker is a natural follow-up.
