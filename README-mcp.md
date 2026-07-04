# Ponder MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes Ponder's board
(projects, stories, work units) to Claude Code, so you can view and advance
your board from inside another repo without switching to the browser.
Moving a card to a working lane or Done fires Ponder's existing JIRA
status write-back automatically — the MCP tools don't reimplement that
logic, they just call Ponder's REST API.

## Prerequisites

The Ponder app must already be running and reachable at `PONDER_BASE_URL`
(defaults to `http://localhost:3000`). The MCP server is a thin client over
Ponder's existing REST API — it does not talk to the database directly and
does not start the app for you.

```bash
# in this repo
npm run dev
```

## Registration

Register the server with Claude Code using an **absolute path** to this
repo (stdio MCP servers are launched as subprocesses, so relative paths
won't resolve).

On this machine, the absolute path to this repo is:

```
/Users/john-perkins/Projects/Sphero/teamalliance/kanban
```

Run this once, from anywhere (it registers globally for Claude Code to pick
up when you're working in another repo):

```bash
claude mcp add ponder -- npx tsx /Users/john-perkins/Projects/Sphero/teamalliance/kanban/src/mcp/server.ts
```

Generic form, for use on any machine (substitute your own checkout path):

```bash
claude mcp add ponder -- npx tsx <path-to-ponder-repo>/src/mcp/server.ts
```

### If Ponder runs somewhere other than `localhost:3000`

Pass `PONDER_BASE_URL` as an environment variable with `-e`:

```bash
claude mcp add ponder -e PONDER_BASE_URL=http://localhost:3000 -- npx tsx <path-to-ponder-repo>/src/mcp/server.ts
```

### Verifying registration

```bash
claude mcp list
```

should show `ponder` in the list. Restart Claude Code (or start a new
session) after adding the server so it picks up the new connection.

## Tools reference

| Tool | Args | Description |
| --- | --- | --- |
| `list_projects` | _(none)_ | List all Ponder projects with story/work-unit stats. |
| `list_stories` | `projectId` | List stories (with a per-column work-unit breakdown) for a project. |
| `list_work_units` | `projectId`, `column?`, `pendingVerification?` | List work units for a project, optionally filtered to a single column (`todo`, `in_progress`, `code_review`, `done`), or to only those pending AI-agent verification. |
| `move_work_unit` | `workUnitId`, `column`, `order?` | Move a work unit to a column and optional position. |
| `mark_done` | `workUnitId` | Convenience wrapper over `move_work_unit` that moves a work unit straight to Done. |
| `update_work_unit` | `workUnitId`, `title?`, `description?` | Update a work unit's title and/or description (at least one required). |
| `report_verification` | `workUnitId`, `outcome` (`passed`\|`failed`), `summary`, `verificationSteps?` | Report the result of an AI-agent verification run requested via Ponder's Verify button. Attach the screenshot separately with `attach_image`. |

`move_work_unit` and `mark_done` may transition the linked JIRA issue as a
side effect of Ponder's existing server-side write-back: moving to a
working lane (`in_progress`/`code_review`) can drive the issue to **In
Progress**, and moving to `done` can drive it to **Code Revew** (sic — this
matches the real, misspelled JIRA status) plus a summary comment, once all
of a story's work units are Done. This happens automatically inside
Ponder's `/api/work-units/:id/move` endpoint; the MCP tools are unaware of
the write-back and just call the endpoint.

## Example prompts

Once connected, you can ask Claude Code things like:

- "List my Ponder projects."
- "Show the cards for project acme-web."
- "What's in the in_progress column for project acme-web?"
- "Move work unit ck123abc to code_review."
- "Mark work unit ck123abc done."
- "Update work unit ck123abc's title to 'Fix pagination bug'."
- "List work units pending verification for project acme-web, verify each one, attach a screenshot, and report the result."

## Troubleshooting

**Tool calls fail with a connection-refused / fetch error.**
The Ponder app isn't running, or `PONDER_BASE_URL` points at the wrong
host/port. Start the app (`npm run dev` in this repo) or re-register the
server with the correct `PONDER_BASE_URL` (see above).

**`claude mcp list` doesn't show `ponder`.**
Re-run the `claude mcp add` command above, double-checking the absolute
path to `src/mcp/server.ts`.

**Tool calls hang or error immediately on connect.**
Confirm `npx tsx <path>/src/mcp/server.ts` runs without error when invoked
directly from a terminal (it will block, listening on stdio — Ctrl-C to
stop). If it throws, the error will print to stderr before exit.
