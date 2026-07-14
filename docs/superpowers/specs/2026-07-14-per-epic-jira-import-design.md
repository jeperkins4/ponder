# Per-Epic JIRA Import — Design

**Date:** 2026-07-14
**Status:** Approved

## Goal

Let a user scope a JIRA import to a single epic instead of the whole project. The existing "Import from JIRA" flow (preview → review → process) gains an optional epic filter; with no epic selected, behavior is unchanged.

## Decisions

- **Scope location:** ad-hoc per import, not a persistent project setting. The epic filter lives in the existing `ImportReview` modal, not a new button or Settings field.
- **Epic selection:** a dropdown of live epics fetched from JIRA (`issuetype = Epic`), not free-text key entry.
- **Assignee filter:** dropped when an epic is selected (`assignee = currentUser()` is project-wide-import-only). The status allowlist (`Project.jiraSyncStatuses`) still applies.
- **Persistence:** `Story` gains nullable `epicKey`/`epicName` columns, stamped only by the epic-scoped import path (the epic is already known from the dropdown selection — no per-issue JIRA field parsing needed). The project-wide import/sync path does not populate these columns. No backfill for existing rows.
- **Board display:** out of scope. No badge, no board-side filtering — persistence only, for a future change to build on.
- **MCP exposure:** out of scope. Import/sync isn't exposed via MCP today; this change doesn't start that.

## 1. Schema

```prisma
model Story {
  ...
  epicKey   String?
  epicName  String?
}
```

Migration adds both columns, nullable, no default, no backfill.

## 2. Epic list fetch (for the dropdown)

- `buildEpicsJql(projectKey: string): string` in `src/lib/jira/jql.ts` — `project = "<key>" AND issuetype = Epic ORDER BY updated DESC`.
- `fetchEpicsForProject(projectKey, config): Promise<{ key: string; name: string }[]>` in `src/lib/jira/client.ts` — reuses `searchIssuesByJql`, requests `summary` only, maps `issue.fields.summary` to `name`.
- New route `GET /api/projects/[projectId]/jira/epics` — same auth/config-missing guards as `/import/preview` (project not JIRA-linked or missing credentials → `{ epics: [] }`, 200, not an error). Called by `ImportReview` on open, in parallel with the preview fetch.

## 3. Epic-scoped story JQL

JIRA represents epic membership differently by project type: team-managed projects use the system `parent` field; company-managed projects use a custom "Epic Link" field whose id varies per site. Detecting rather than guessing:

- `hasEpicLinkField(config): Promise<boolean>` in `src/lib/jira/client.ts` — one call to `/rest/api/3/field`, checks whether a field named `"Epic Link"` exists on this site. On request failure, returns `false` (fail toward the more broadly-compatible clause, not a hard error).
- `buildEpicStoriesJql(epicKey: string, syncStatuses: string[], hasEpicLinkField: boolean): string` in `src/lib/jira/jql.ts`. JQL accepts a custom field by its quoted display name directly (no need to resolve a numeric `customfield_NNNNN` id):
  - `hasEpicLinkField` true: `(parent = "<epicKey>" OR "Epic Link" = "<epicKey>") AND status IN (...)`
  - `hasEpicLinkField` false: `parent = "<epicKey>" AND status IN (...)`
  - No `assignee = currentUser()` clause.
  - Same quoting/escaping and empty-list-throws behavior as `buildProjectStoriesJql`.
- `fetchStoriesForEpic(epicKey, config, syncStatuses): Promise<StoryDTO[]>` in `client.ts` — checks for the Epic Link field, builds the JQL, delegates to `searchIssuesByJql`. Mirrors `fetchStoriesForProject`'s shape.

## 4. Preview & process routes

- `POST /import/preview` accepts optional JSON body `{ epicKey?: string }`. When present, calls `fetchStoriesForEpic` instead of `fetchStoriesForProject`; everything else (column mapping, dedup) is unchanged.
- `POST /import/process` accepts optional top-level `{ epicKey?: string; epicName?: string }` (one epic per review session, not per item). When present, every `Story.upsert` in the batch sets `epicKey`/`epicName`; when absent, those columns are left untouched (upsert `update` clause omits them, so existing values survive re-import).

## 5. UI (`ImportReview.tsx`)

- On open, fetch `/jira/epics` alongside the existing preview fetch.
- New `<select>` above the story list: `"All epics"` (default) + fetched epics by name. Changing selection re-triggers the preview fetch with the new `epicKey` and clears prior `breakDownByKey`/`importAnywayByKey` state (same reset the initial load already does).
- `handleProcess` includes the currently selected `epicKey`/`epicName` in the `/import/process` body.
- Epic list fetch failing is non-blocking: dropdown falls back to "All epics" only; project-wide import still works.

## 6. Testing

- `jql.test.ts`: `buildEpicsJql` query shape; `buildEpicStoriesJql` with/without an epic-link field id, quoting/escaping, empty-status-list throws, no assignee clause.
- `client.test.ts`: `fetchEpicsForProject` mapping; `hasEpicLinkField` found/not-found/request-failure; `fetchStoriesForEpic` JQL delegation.
- Route tests: `GET /jira/epics` (not-linked / missing-credentials / happy path, matching `/import/preview`'s guard style); `/import/preview` with `epicKey` present vs. absent; `/import/process` stamping `epicKey`/`epicName` when present, leaving them untouched when absent.
- Component test: epic dropdown selection re-fetches preview and resets breakdown/import-anyway state; process request includes the selected epic.

All tests via `npm test` / `npm run test:ci` only.

## Out of scope

- Backfilling `epicKey`/`epicName` on existing `Story` rows.
- Epic linkage for the project-wide import/sync path (only the epic-scoped path stamps these columns).
- Board UI: epic badges on cards, filtering the board by epic.
- MCP tool for epic-scoped import.
- A persistent per-project default epic setting.
