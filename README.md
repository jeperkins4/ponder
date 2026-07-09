# Ponder

**A JIRA-native work-decomposition board.** Ponder pulls the JIRA stories, tasks, and bugs assigned to *you* and lets you break each one into small, granular work units — locally — so you can plan and track detailed implementation work **without polluting the shared JIRA project**. Claude does the breakdown; JIRA stays in sync automatically.

JIRA remains the source of truth. Ponder is the planning layer on top of it.

---

## The problem — why not just use Trello?

Trello (and generic Kanban tools) are standalone boards. To run one alongside JIRA you end up:

- **Manually recreating every story** as a card — duplicated data that's stale the moment JIRA changes.
- **With no link back to JIRA** — a status you change on the board never reflects in JIRA.
- **Breaking work down by hand** — you type out every sub-task yourself.
- Forced to choose between **polluting JIRA** with dozens of granular sub-tasks (noise for the whole team) or keeping your detailed plan in a **silo JIRA never sees**.

Ponder closes exactly that gap:

| | Trello | Ponder |
|---|---|---|
| Get your work onto the board | Manual card-by-card | **Auto-imports** your assigned, active JIRA issues (JQL-filtered) |
| Break a story into sub-tasks | Type each one | **Claude decomposes** it — each sub-task gets acceptance criteria + verification |
| Where the sub-tasks live | A silo, or clutter in JIRA | **Local to Ponder** — JIRA stays clean |
| Status back to JIRA | None | **Bidirectional sync** — In Progress on start, Code Review + summary comment when done |
| Multiple JIRA projects | — | Per-project connection with its own credentials |

So: Trello gives you *a board*. Ponder gives you a **JIRA-native decomposition layer** — it imports your work, breaks it down with AI, and syncs the meaningful status changes back, holding the fine-grained detail that JIRA itself would be too noisy to carry.

---

## How it works

1. **Connect a project.** Create a project and link it to a JIRA project (site URL, email, API token) in **Settings** → **Test connection** to verify.
2. **Import.** Click **Import from JIRA** → review the incoming stories (each shows its target column) → toggle which ones to **break down into sub-tasks** → **Process**. Flagged stories are decomposed by Claude into cards with acceptance criteria and verification; the rest come in as a single card.
3. **Work the board.** Sync imports issues assigned to you whose JIRA status is on the project's **Statuses to sync** allowlist (default `To Do, In Progress, Code Revew, Code Review`); unknown or future statuses stay off the board until added to the list. Cards land in the column matching their status — named overrides (e.g. Code Review) first, falling back to their JIRA `statusCategory` (new → To Do, indeterminate → In Progress, done → Done) — so allowlisted custom or renamed statuses still land somewhere sensible.
4. **JIRA follows automatically.** As you move a story's cards, Ponder writes the meaningful transitions back — the issue goes to **In Progress** when work starts, and to **Code Review** (with a Claude-written summary comment listing what was done) once all of its cards reach **Done**. Non-blocking: a JIRA hiccup never breaks a local move, and the completion comment posts only once.

---

## Features

- **Auto-import** of your assigned, active JIRA issues (filtered by JQL).
- **AI-assisted breakdown** — optional per story, powered by `@anthropic-ai/sdk`.
- **Bidirectional JIRA status sync** — non-blocking and idempotent.
- **Multi-project** support with per-project JIRA credentials (API token stored write-only).
- **Ponder UI** — light/dark themes, keyboard-accessible, WCAG AA.
- **Local-first** — your data lives in your own Postgres; JIRA credentials never leave the server.

## Tech stack

Next.js 15 (App Router) · React 18 · TypeScript · Prisma 7 + PostgreSQL · Tailwind CSS · `@anthropic-ai/sdk` · Vitest.

## Getting started

**Prerequisites:** Node.js, Docker (for Postgres), a JIRA API token, and an Anthropic API key.

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env
#   Set DATABASE_URL and ANTHROPIC_API_KEY.
#   JIRA credentials are configured per-project in the app's Settings panel,
#   not in .env.

# 3. Start Postgres (Docker)
docker compose up -d

# 4. Apply the schema
npx prisma migrate dev

# 5. Run the app
npm run dev            # http://localhost:3000
```

Run the test suite with `npm test`. Lint with `npm run lint`, and check for unused code/deps with `npm run knip`. Every PR and push to `main` runs typecheck + lint + knip + tests in CI (GitHub Actions).

## MCP integration — drive Ponder from Claude Code

Ponder ships a **Model Context Protocol (MCP) server** so [Claude Code](https://claude.com/claude-code) can view and advance the board from the repository where you're actually writing code — moving a card fires the same JIRA status write-back as the UI. This is the intended workflow: initiate it from *where the code lives*, not by clicking through Ponder.

It's a thin client over Ponder's REST API (built on the official `@modelcontextprotocol/sdk`, stdio transport), so **the Ponder app must be running** for tool calls to return data.

**Setup:**

```bash
# 1. Start the Ponder app (the MCP server talks to it)
npm run dev            # http://localhost:3000

# 2. Register the server with Claude Code (from any repo)
claude mcp add ponder -- npx tsx /absolute/path/to/ponder/src/mcp/server.ts

#    If the app runs elsewhere, pass PONDER_BASE_URL:
#    claude mcp add ponder -e PONDER_BASE_URL=http://localhost:3000 -- npx tsx /abs/path/to/ponder/src/mcp/server.ts
```

**Tools:**

| Tool | Args | Description |
|---|---|---|
| `list_projects` | — | List projects with story/work-unit counts |
| `list_stories` | `projectId` | Stories with a per-column work-unit breakdown |
| `list_work_units` | `projectId`, `column?` | Flat card list (with ids), optionally filtered by column |
| `move_work_unit` | `workUnitId`, `column`, `order?` | Move a card — **may transition the JIRA issue** (In Progress / Code Revew + comment) |
| `mark_done` | `workUnitId` | Move a card to Done (drives the story to Code Revew + summary comment once all its cards are done) |
| `update_work_unit` | `workUnitId`, `title?`, `description?` | Edit a card's title/description |
| `regenerate_acceptance` | `workUnitId`, `codebaseContext?` | (Re)generate a card's acceptance criteria and verification with Claude |
| `attach_image` | `workUnitId`, `filePath`, `filename?` | Attach a local image (e.g. a screenshot) to a card as evidence |
| `report_verification` | `workUnitId`, `outcome`, `summary`, `verificationSteps?` | Report an AI-agent verification result for a Code Review card |
| `report_completed_work` | `projectId?`, `from?`, `to?` | Completed-work history grouped by story (archived cards included) |
| `report_throughput` | `projectId?`, `from?`, `to?` | Weekly throughput + cycle-time stats (created→completed) |
| `report_status_snapshot` | `projectId?` | Active cards per column per story, verification tallies |
| `report_jira_trail` | `projectId?`, `from?`, `to?` | Chronological trail of what was reported to JIRA and when |

Once connected, ask Claude Code things like *"list my Ponder projects"*, *"show the cards for project X"*, or *"mark work unit &lt;id&gt; done"*. See [`README-mcp.md`](./README-mcp.md) for the full reference and troubleshooting.

## Reports

The `/reports` page answers four questions, filterable by project and date range (7/30/90 days or all time): a current **status snapshot** (active cards per column, verification states), **throughput & cycle time** (weekly completions and created→completed cycle times, charted), **completed work** history grouped by story, and the **JIRA trail** (every Move-to-QA report, verification outcome, and completion comment, newest first). The same data is available to MCP clients via the four `report_*` tools. A **Trends** section adds time-series graphs — created vs completed, cumulative completed, WIP over time, and JIRA activity — bucketed daily for short ranges and weekly past ~5 weeks.

## PR-gated completion

Link a project to GitHub (Settings → "GitHub repositories", comma-separated `owner/repo`; one `GITHUB_TOKEN` in `.env` serves all repos) and Sync will also check GitHub: any **open or merged PR** whose branch name or title contains a story's JIRA key (word-boundary match — `COM-54` never matches `COM-540`) moves all of that story's active cards to Done, records a "Completed by PR #N" work note on each card, and fires the same JIRA write-back a manual drag does (story → Code Review + summary comment). Cards entering Done now also stamp `completedAt` (manual drags included), which feeds the throughput and completed-work reports.

## Roadmap

- **Scheduled report digest** — periodic summary built on the report layer (delivery channel TBD).
