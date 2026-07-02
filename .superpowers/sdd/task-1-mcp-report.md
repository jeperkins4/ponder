# Task 1: Scaffold the Ponder MCP server — Report

## Status
DONE. Commit hash: (verified via `git log --oneline -1` after commit — see below)

## PonderClient signature (for Tasks 2-3)

```ts
// src/mcp/client.ts
export class PonderClient {
  constructor(baseUrl?: string, fetchImpl?: typeof fetch);
  // baseUrl defaults to process.env.PONDER_BASE_URL ?? "http://localhost:3000"
  // fetchImpl defaults to global fetch; inject a fake in tests.

  getProjects(): Promise<ProjectWithStats[]>;                       // GET /api/projects
  getStories(projectId: string): Promise<StoryDTO[]>;               // GET /api/stories?projectId=<id>
  moveWorkUnit(id: string, column: Column, order?: number): Promise<WorkUnitDTO>;
    // POST /api/work-units/<id>/move  body {column, order}  (order defaults to 0)
  updateWorkUnit(id: string, patch: { title?: string; description?: string }): Promise<WorkUnitDTO>;
    // PATCH /api/work-units/<id>  body = patch as given (no defaulting)
}
```

- All non-2xx responses throw `new Error("Ponder API error: <status> <method> <path>")`.
- Success responses are parsed as JSON and returned typed per method.
- Types are imported from `@/lib/types` (`Column`, `ProjectWithStats`, `StoryDTO`, `WorkUnitDTO`) — no new types were introduced.

## MCP SDK API shape confirmed via Context7 (for Tasks 2-3 to follow)

Package: `@modelcontextprotocol/sdk` (npm latest at time of writing: **1.29.0**). Context7's first
hit for the bare library name returned docs for an **unpublished v2 alpha** (`@modelcontextprotocol/server`,
`serveStdio`, `inputSchema: z.object({...})`) — do NOT use that shape, it does not match the installed
package. Re-querying pinned to `/modelcontextprotocol/typescript-sdk/v1.29.0` gave the real API:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3"; // see "zod import" gotcha below

const server = new McpServer({ name: "ponder", version: "1.0.0" });

server.registerTool(
  "tool_name",
  {
    description: "...",
    inputSchema: {              // <-- ZodRawShape (plain object), NOT z.object({...})
      projectId: z.string(),
      column: z.string().optional(),
    },
  },
  async (args) => ({
    content: [{ type: "text", text: "..." }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

Key points for Tasks 2-3:
- `registerTool`'s `config.inputSchema` is a **`ZodRawShapeCompat`** (`Record<string, AnySchema>`), i.e. a
  plain object of zod schemas keyed by field name — confirmed by reading the installed
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`. Passing `z.object({...})` there is
  wrong for this version (that's the v2-alpha shape Context7 initially surfaced).
- Tool handlers return `{ content: [{ type: "text", text: "..." }], isError?: boolean }` (see
  `notImplemented()` helper in `server.ts` — reuse/extend this shape for real results and errors in
  Tasks 2-3; set `isError: true` for failure paths per SDK convention).
- **zod import gotcha**: `import { z } from "zod"` (root package) compiles but triggers
  `TS2589: Type instantiation is excessively deep and possibly infinite` when passed into
  `registerTool`'s `inputSchema`, because this project's `tsconfig.json` uses
  `"moduleResolution": "node"` (classic), which does not honor package.json `exports` conditions —
  so the root `zod` import and the SDK's internal `zod/v3` type import resolve to different
  declaration files (`index.d.cts` vs `v3/index.d.ts`) that TS treats as structurally near-identical
  but not identical, blowing the instantiation depth. **Fix: import zod tools from `"zod/v3"`, not
  `"zod"`,** in any file that calls `registerTool`/`registerResource`/etc. This was verified with an
  isolated repro (`tsc --noEmit` clean with `zod/v3`, TS2589 with `zod`).
- Server construction and stdio wiring: `new McpServer({name, version})`, register tools, then
  `await server.connect(new StdioServerTransport())`. No separate "start"/"listen" call needed.

## @modelcontextprotocol/sdk version added
`^1.29.0` (dependency), plus `zod@^3.25.0` (dependency, required peer for `inputSchema`) and
`tsx@^4.8.1` (devDependency — was only a transitive dep before; needed as a direct devDependency to
run `npm run mcp`).

## Files
- `src/mcp/client.ts` — `PonderClient`.
- `src/mcp/server.ts` — entry point; `createServer(client)` builds an `McpServer` with the six v1
  tools (`list_projects`, `list_stories`, `list_work_units`, `move_work_unit`, `mark_done`,
  `update_work_unit`) registered with real input schemas and placeholder ("not yet implemented")
  handlers. `main()` only auto-runs when the file is executed directly (`process.argv[1] ===
  fileURLToPath(import.meta.url)`), so importing `server.ts`/`createServer` from a test never spawns
  the stdio transport.
- `src/mcp/client.test.ts` — Vitest suite (7 tests) covering all `PonderClient` methods, error path,
  and custom `baseUrl`, with an injected fake `fetch`.
- `package.json` / `package-lock.json` — added `mcp` script, the three new packages above.

## Tests
- `src/mcp/client.test.ts`: 7/7 passing.
- Full suite (`vitest run --no-file-parallelism`): **339/339 passing** (baseline ~332 + 7 new = 339,
  all green, nothing broken).
- `npx tsc --noEmit`: clean (0 errors) — after the `zod/v3` import fix above.
- `npx tsx src/mcp/server.ts` (stdin closed / redirected from `/dev/null`): exits 0 with no stack
  trace or thrown error — confirms the server constructs and connects the stdio transport without
  throwing.

## Concerns
- The "not yet implemented" placeholder handlers return `{ content: [{ type: "text", text: "<tool>:
  not yet implemented" }] }` with no `isError` flag — Tasks 2-3 should decide whether to keep that
  convention for real error paths or use `isError: true` (the SDK supports it; recommended for
  genuine failures like `PonderClient` throwing).
- `PONDER_BASE_URL` is read once in `PonderClient`'s constructor via `process.env`; if Tasks 2-3 need
  it configurable per-call (e.g. multi-instance), that would require a constructor change — not
  needed for the current spec.
- Context7's un-pinned/default resolution for "@modelcontextprotocol/sdk" surfaced an unpublished v2
  alpha API on the first query. Always pin to `/modelcontextprotocol/typescript-sdk/v1.29.0` (or
  whatever version is actually installed) for any further Context7 lookups in Tasks 2-3, and verify
  against installed `.d.ts` files when anything looks the least bit off — that combination is what
  caught both the `inputSchema` shape and the `zod/v3` import issues here.
