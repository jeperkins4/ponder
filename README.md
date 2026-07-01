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
3. **Work the board.** Cards land in the column matching their JIRA status: **To Do · In Progress · Code Review · Done**.
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

Run the test suite with `npm test`.

## Roadmap

- **MCP server** — expose Ponder to Claude Code so the board is driven from the actual code repository as you work. Moving a card to Done there fires the same JIRA write-back. The intent: the workflow is initiated from *where the code lives*, not clicked through Ponder's UI.
- **PR-gated completion** — a story advances to Code Review / Done when a pull request is opened, rather than on a manual board drag.
- Re-import de-duplication, additional issue types and status mappings.
