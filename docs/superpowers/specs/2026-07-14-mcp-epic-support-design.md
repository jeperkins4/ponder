# MCP Support for Epics — Design

**Date:** 2026-07-14
**Status:** Approved

## Goal

Extend the Ponder MCP server so an agent can discover a project's JIRA epics, filter existing story/work-unit listings by epic, and trigger an epic-scoped import — all three capabilities the board UI already has (per-epic import, shipped on `feature/per-epic-jira-import`) but that MCP never exposed. Every MCP tool remains a thin wrapper over Ponder's existing REST API; no business logic is duplicated here.

## Dependency

Builds on `feature/per-epic-jira-import` (PR #38, not yet merged): `Story.epicKey`/`epicName`, `fetchEpicsForProject`, and `GET /api/projects/[projectId]/jira/epics` all come from that branch. This work branches from `feature/per-epic-jira-import` directly (stacked), not from `main`.

## Decisions

- **Three additions:** a `list_epics` tool, an optional `epicKey` filter on `list_stories`/`list_work_units`, and a one-shot `import_by_epic` tool.
- **`import_by_epic` is single-call, not preview-then-confirm.** It imports everything the epic-scoped preview returns (skipping already-imported stories, matching the UI's default with no "import anyway" override) with one `breakDown: boolean` applied uniformly to every story in the call — no per-story granularity, since MCP tools are single-shot actions, not interactive review sessions.
- **Filtering is client-side in the tool handler**, not a new REST query param. `list_stories`/`list_work_units` already share one `client.getStories(projectId)` call, and `list_work_units` already filters the fetched array client-side (by `column`, `pendingVerification`). Adding `epicKey` follows that exact pattern — no changes to `GET /api/stories`'s query interface.
- **`StoryDTO` gains `epicKey`/`epicName`** (both `string | null`, optional) — the one gap that blocks epic filtering: these columns are persisted on `Story` by the per-epic-import work but were never surfaced past the Prisma layer (explicitly deferred there as "no board UI yet").

## 1. `StoryDTO` and the stories serializer

- `src/lib/types.ts`: add `epicKey?: string | null; epicName?: string | null;` to the `StoryDTO` interface (`types.ts:50-65`), placed after `jiraStatus` to match the Prisma model's field order.
- `src/app/api/stories/route.ts`: the story→DTO mapping (`route.ts:42-52`) adds `epicKey: story.epicKey, epicName: story.epicName,`. This is the only serializer that needs to change — it's the sole endpoint `PonderClient.getStories()` calls, and thus the sole source for both `listStories` and `listWorkUnits`.

## 2. `PonderClient` additions

- `getEpics(projectId): Promise<{ key: string; name: string }[]>` — `GET /api/projects/{projectId}/jira/epics`, unwraps `.epics` from the response (mirrors `getStories`'s shape).
- `previewEpicImport(projectId, epicKey): Promise<{ stories: ImportPreviewStory[]; message?: string }>` — `POST /api/projects/{projectId}/import/preview` with `{ epicKey }`.
- `processEpicImport(projectId, items, epicKey, epicName?): Promise<{ storiesProcessed: number; storiesSkipped: number; workUnitsCreated: number }>` — `POST /api/projects/{projectId}/import/process` with `{ items, epicKey, epicName }`.

All three go through the existing private `request()` helper (no bespoke fetch code needed, unlike `addAttachment`'s multipart case).

## 3. `list_epics` tool

`src/mcp/tools.ts`: `listEpics(client, { projectId })` — calls `client.getEpics(projectId)`, returns a numbered `- <name> (<key>)` list, or `"No epics found for project <projectId>."` when empty. Mirrors `listProjects`'s exact style (`tools.ts:24-39`).

`src/mcp/server.ts`: `server.registerTool("list_epics", { description: "List a project's JIRA epics (key + name).", inputSchema: { projectId: z.string() } }, ...)`.

## 4. Epic filter on `list_stories` / `list_work_units`

- `listStories(client, { projectId, epicKey? })`: after fetching `client.getStories(projectId)`, filter to `story.epicKey === args.epicKey` when `epicKey` is provided, before building the output lines. Empty-after-filter message: `"No stories found for project <projectId> under epic <epicKey>."`.
- `listWorkUnits(client, { projectId, column?, pendingVerification?, epicKey? })`: same filter applied to the `stories` array before the existing per-work-unit loop (`tools.ts:97`), composing with the existing `column`/`pendingVerification` filters (all are AND'd together, matching the existing pattern where each filter is an independent `continue`/`if` check).
- `server.ts`: add `epicKey: z.string().optional()` to both tools' `inputSchema` and thread it through.

## 5. `import_by_epic` tool

`src/mcp/tools.ts`: `importByEpic(client, { projectId, epicKey, epicName?, breakDown? })`:

1. `const preview = await client.previewEpicImport(projectId, epicKey)`.
2. If `preview.stories.length === 0`: return `preview.message` as the text result if present, else `"No stories found for epic <epicKey>."`.
3. `const toImport = preview.stories.filter(s => !s.alreadyImported)`. If `toImport.length === 0` (all were already-imported): return `"<N> story(ies) found for epic <epicKey>, all already on the board."`.
4. Build `items` from `toImport`: `{ jiraKey, jiraId, summary, description, jiraStatus, jiraStatusCategory, breakDown: args.breakDown ?? false }` per story — same shape `ImportReview.tsx`'s `handleProcess` already builds.
5. `const result = await client.processEpicImport(projectId, items, epicKey, args.epicName)`.
6. Return a text summary: counts (`storiesProcessed`, `storiesSkipped`, `workUnitsCreated`) plus the list of imported `jiraKey`s.

`server.ts`: `server.registerTool("import_by_epic", { description: "Import all not-yet-imported issues under a JIRA epic into this project's board, skipping issues already on the board. Optional breakDown applies to every imported story (default false).", inputSchema: { projectId: z.string(), epicKey: z.string(), epicName: z.string().optional(), breakDown: z.boolean().optional() } }, ...)`.

## Testing

- `client.test.ts`: fetch-mock tests for `getEpics`, `previewEpicImport`, `processEpicImport` (request shape, response unwrapping) — same style as the existing `getStories`/`moveWorkUnit` tests.
- `tools.test.ts`: handler tests (mocked `PonderClient`) for `listEpics` (empty/non-empty), the new `epicKey` filter branch of `listStories`/`listWorkUnits` (composed with existing filters), and `importByEpic`'s four branches (not-linked/no-credentials message, no-stories-for-epic, all-already-imported, successful import with counts).
- `server.test.ts`: extend the expected tool-name list to 15 (`list_epics`, `import_by_epic` added).
- `src/app/api/stories/route.test.ts`: a case asserting `epicKey`/`epicName` pass through the serializer for a story that has them set, and stay `null` for one that doesn't.

All tests via `npm test` / `npm run test:ci` only.

## Out of scope

- Any change to `GET /api/stories`'s query parameters (filtering stays client-side in the MCP tool handlers).
- Per-story `breakDown` granularity in `import_by_epic` (one flag applies to the whole call).
- An "import anyway" override for already-imported stories via MCP (matches the UI's default-skip behavior with no override surfaced).
- Backfilling `README-mcp.md`'s pre-existing documentation gap for the other 6 undocumented tools — this change documents only what it adds/changes.
- Board UI display of epic data (still out of scope, unchanged from the per-epic-import design).
