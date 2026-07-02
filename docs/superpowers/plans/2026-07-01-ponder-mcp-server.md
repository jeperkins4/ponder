# Ponder MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Expose Ponder to Claude Code via a Model Context Protocol server so that, while coding, Claude can view the board and advance cards — and moving a card automatically triggers the existing JIRA status write-back.

**Architecture:** A stdio MCP server (`@modelcontextprotocol/sdk`) that is a THIN CLIENT over Ponder's existing local REST API (`http://localhost:3000`). Every tool maps to an existing endpoint, so all behavior (moving a card → `applyStoryStatusSync` → JIRA transition/comment) is reused with zero duplication. Lives in-repo under `src/mcp/`, run via `tsx`, registered with `claude mcp add`.

**Tech Stack:** `@modelcontextprotocol/sdk`, TypeScript, `tsx`, Vitest. Reuses `@/lib/types`.

## Global Constraints

- The MCP server ONLY calls Ponder's existing HTTP API; it adds NO new Ponder endpoints and does NOT touch Prisma/schema/routes.
- Base URL from `PONDER_BASE_URL` (default `http://localhost:3000`). Requires the Ponder app running.
- v1 tool surface = **view + move/advance** only: `list_projects`, `list_stories`, `list_work_units`, `move_work_unit`, `mark_done`, `update_work_unit`. No import/breakdown/create/delete from MCP in v1.
- Verify current `@modelcontextprotocol/sdk` server + tool-registration API via Context7 before coding (SDK evolves).
- Tool handlers are unit-tested against a mocked Ponder HTTP client (no live server in unit tests). Transport is smoke-tested manually.
- TDD; `tsc --noEmit` clean; full existing suite stays green (this is additive).

## File Structure
- `src/mcp/client.ts` — `PonderClient`: typed `fetch` wrapper over `PONDER_BASE_URL` (getProjects, getStories, moveWorkUnit, updateWorkUnit).
- `src/mcp/tools.ts` — pure tool-handler functions `(client, args) => result`, one per tool, with input validation.
- `src/mcp/server.ts` — entry: constructs the real client, registers tools with the MCP `Server` over stdio transport.
- `src/mcp/*.test.ts` — unit tests for client (mock fetch) and tools (mock client).
- `README-mcp.md` — setup + `claude mcp add` instructions.

---

## Task 1: Scaffold — SDK, PonderClient, server entry, tool listing

**Files:** add dep `@modelcontextprotocol/sdk`; create `src/mcp/client.ts`, `src/mcp/server.ts`, `src/mcp/client.test.ts`.

**Interfaces:**
- Produces `PonderClient` with a configurable base URL:
  ```ts
  export class PonderClient {
    constructor(baseUrl?: string /* default process.env.PONDER_BASE_URL ?? "http://localhost:3000" */, fetchImpl?: typeof fetch);
    getProjects(): Promise<ProjectWithStats[]>;             // GET /api/projects
    getStories(projectId: string): Promise<StoryDTO[]>;      // GET /api/stories?projectId=
    moveWorkUnit(id: string, column: Column, order?: number): Promise<WorkUnitDTO>;  // POST /api/work-units/[id]/move
    updateWorkUnit(id: string, patch: { title?: string; description?: string }): Promise<WorkUnitDTO>; // PATCH /api/work-units/[id]
  }
  ```
  Inject `fetchImpl` for tests. Each method throws a clear error on non-2xx (`Ponder API error: <status> <path>`).

**Steps:**
- Use Context7 to confirm the current `@modelcontextprotocol/sdk` `Server`/`McpServer` + stdio transport + tool registration API.
- Write `client.test.ts` (inject a fake fetch): getProjects hits `/api/projects`; getStories appends `?projectId=`; moveWorkUnit POSTs `{column, order}` to `/api/work-units/<id>/move`; non-2xx throws.
- Implement `client.ts`.
- Implement `server.ts`: build the MCP `Server`, connect stdio transport, and register (empty-bodied for now, filled in Tasks 2–3) the six tools with names + input schemas so `tools/list` returns them. Add an npm script `"mcp": "tsx src/mcp/server.ts"`.
- Commit `"feat: scaffold Ponder MCP server (client + stdio entry)"`.

---

## Task 2: Read tools — list_projects, list_stories, list_work_units

**Files:** `src/mcp/tools.ts`, `src/mcp/tools.test.ts`; wire into `server.ts`.

**Interfaces (each handler `(client, args) => { content: [...] }`):**
- `list_projects()` → text summary of each project (id, name, type, jiraProjectKey, story/work-unit counts). Uses `client.getProjects()`.
- `list_stories({ projectId })` → for each story: jiraKey, summary, jiraStatus, and its work units grouped by column. Uses `client.getStories(projectId)`.
- `list_work_units({ projectId, column? })` → flat list of work units (id, title, column, parent jiraKey), optionally filtered to one `column`. Derived from `getStories`.

**Steps:** TDD each handler against a mocked `PonderClient` returning canned DTOs (assert the rendered text includes the key fields and that `column` filtering works). Register the three tools' real handlers in `server.ts`. Return results as MCP `content: [{ type: "text", text }]`. Commit `"feat: add Ponder MCP read tools"`.

---

## Task 3: Mutating tools — move_work_unit, mark_done, update_work_unit

**Files:** `src/mcp/tools.ts` (extend), `src/mcp/tools.test.ts` (extend); wire into `server.ts`.

**Interfaces:**
- `move_work_unit({ workUnitId, column, order? })` → `client.moveWorkUnit(...)`. Validate `column` ∈ `todo|in_progress|code_review|done` (import `Column` / `COLUMNS`). Return a confirmation incl. the new column. NOTE in the tool description that moving to a working lane or to `done` may update the linked JIRA issue (In Progress / Code Revew + comment) — this happens server-side; the tool just calls the endpoint.
- `mark_done({ workUnitId })` → convenience wrapper = `moveWorkUnit(workUnitId, "done")`.
- `update_work_unit({ workUnitId, title?, description? })` → `client.updateWorkUnit(...)`. Require at least one of title/description.

**Steps:** TDD each against the mocked client (assert it calls the right client method with the right args; invalid column → error result; update with no fields → error). Register handlers in `server.ts`. Commit `"feat: add Ponder MCP move/update tools"`.

---

## Task 4: Packaging, docs, and verification

**Files:** `README-mcp.md`; verify build/run.

**Steps:**
- Write `README-mcp.md`: prerequisites (Ponder app running on `PONDER_BASE_URL`), and the registration command:
  `claude mcp add ponder -- npx tsx <absolute-repo-path>/src/mcp/server.ts` (with `PONDER_BASE_URL` env note). Document the six tools + example prompts ("move COM-555's 'address form' card to done").
- Confirm `tsx src/mcp/server.ts` starts and responds to a `tools/list` (a scripted stdio smoke check, or documented manual `claude mcp add` + invoke).
- Run the full existing suite (`npx dotenv -e .env.test -- vitest run --no-file-parallelism`) — must stay green; `tsc --noEmit` clean.
- Commit `"docs: Ponder MCP setup + tool reference"`.

---

## Notes / follow-ons (not in v1)
- Auth: none in v1 (localhost, single user). If Ponder ever binds beyond localhost, add a shared token header on `PonderClient`.
- Later tools: `import_preview`/`import_process`/`break_down_story`, `create_work_unit`, `delete_work_unit`.
- A compiled build (`tsc`/bundling) instead of `tsx` for a faster/stable launch, if desired.
