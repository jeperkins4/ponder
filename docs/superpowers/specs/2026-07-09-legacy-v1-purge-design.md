# Legacy v1 Layer Purge — Design

**Date:** 2026-07-09
**Status:** Approved

## Context and purpose

Ponder's mission: extract the JIRA issues assigned to a developer, decompose
them locally into meaningful units of work, and sync status transitions,
comments, and attachments back to JIRA — **without ever modifying the original
issue's description or content**. Decomposition detail lives in Ponder; JIRA
receives only status changes and evidence of work.

A feature-by-feature review (2026-07-09) confirmed every current feature serves
that mission:

- Import pipeline with AI decomposition — core
- Bidirectional JIRA sync (write-back of transitions, comments, attachments) — core;
  the invariant is *never rewrite the original description*
- Sync-status allowlist (PR #30) — core
- Verification/QA gate (request/report-verification, move-to-qa) — core quality gate
- Reports suite — core; the outward-facing proof of order for management
- Multi-project support with per-project credentials — core; each developer
  runs their own instance ("me now, teammates later")
- MCP server — core; drives the board from Claude Code
- Acceptance-criteria generation — core

The only superfluous code is the **pre-multi-project v1 layer** left behind by
the multi-project refactor. This change deletes it.

## What gets removed

1. `src/app/api/sync/route.ts` (+ test) — legacy sync using env credentials
   (`JIRA_PROJECT_KEYS`, `JIRA_SITE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`).
   Superseded by `/api/projects/[projectId]/sync` with stored per-project
   credentials. These env vars appear nowhere else in `src/`.
2. `src/app/components/SyncButton.tsx` (+ test) and the now-empty
   `src/app/components/` directory — only consumer was the v1 home page.
3. `src/app/board/page.tsx` (+ test) and the "Board" link in
   `src/components/TopNav.tsx` — the un-scoped cross-project board is unused
   (confirmed with the user).
4. The no-`projectId` fallback paths:
   - `KanbanBoard`'s un-scoped mode (rendering without a `projectId`).
   - `GET /api/stories` without `?projectId=` — the parameter becomes
     required. MCP tools already always pass it.
5. `JIRA_*` env vars from `.env.example` and any documentation references.

## What changes

- `src/app/page.tsx` becomes a server-side `redirect("/projects")` with no UI
  of its own.
- `README.md`, `API.md`, `ARCHITECTURE.md` updated to drop v1 references.

## What is explicitly untouched

Everything listed as core in the Context section: import pipeline, JIRA
write-back sync, allowlist, verification flow, reports, multi-project
settings, MCP server, acceptance-criteria generation.

## Error handling

Un-scoped `GET /api/stories` returns **400** with a message naming the missing
`projectId` query param, so any stray caller fails loudly instead of silently
seeing an empty board.

## Testing

- Delete tests belonging to removed code.
- Update `src/app/page.test.tsx` (redirect), `TopNav.test.tsx` (no Board
  link), `KanbanBoard.test.tsx` (projectId required), and the stories route
  test (400 without projectId).
- Verification bar: `npm test` (never bare vitest), `npm run lint`,
  `npm run knip` — knip doubles as the detector for anything the deletion
  newly orphans.

## Out of scope

- Splitting large files (`WorkUnitDetailModal`, `KanbanBoard`,
  `statusTrigger`) — deferred until they cause pain.
- Deferred wishlist items (scheduled report digest, cancel/retry for stuck
  verifying requests, PR-note dedup, completedAt on done-category imports,
  dynamic status picker).
