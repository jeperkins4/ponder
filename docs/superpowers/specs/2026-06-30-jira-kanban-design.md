# JIRA Work-Unit Kanban Board — Design

**Date:** 2026-06-30
**Status:** Approved

## Purpose

A personal, local kanban board that pulls JIRA stories assigned to the user and lets them break each story into small, locally-managed work units. The work units — not the stories themselves — are the cards that move through the board, organized into one swimlane per story. Progress on the board feeds back into JIRA by auto-transitioning the parent story's status and, on completion, posting an AI-generated summary comment of what was done.

## Scope

Single user, local-only deployment (`npm run dev` on localhost). Not a team tool, not deployed anywhere shared. One JIRA account, one Claude API key, both supplied via local `.env`.

Scoped to the **TEAM** JIRA project only in v1. The project filter is configured as a list (see `JIRA_PROJECT_KEYS` below) so adding more projects later is a config change, not a code change — all configured projects' stories flow into the same combined swimlane board (no per-project board separation planned).

## Architecture

A single Next.js (App Router, TypeScript) application containing both the UI and the backend (API routes). Persistence is a local SQLite file accessed via Prisma. No external services beyond the two integrations below; no auth system beyond the JIRA/Claude API credentials.

Two external integrations, both called server-side only — API keys are never exposed to the browser:

- **JIRA REST API** (Atlassian Cloud) — pull stories assigned to the user; fetch and apply issue status transitions; post comments.
- **Claude API** (Anthropic) — generate suggested work-unit breakdowns from a story's summary/description, and generate a completion-summary comment when a story's work units are all done.

Credentials required in `.env` (documented via `.env.example`, gitignored):
- `JIRA_SITE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEYS` — comma-separated JIRA project keys to pull from; v1 is set to `TEAM` only, but the sync logic already loops over the full list so adding a second project later is just editing this value
- `ANTHROPIC_API_KEY`

## Data Model

**Story**
| field | notes |
|---|---|
| id | local primary key |
| jiraKey | e.g. `TEAM-123` |
| jiraId | JIRA's internal issue id, used for API calls |
| projectKey | JIRA project key the story belongs to (e.g. `TEAM`), parsed from jiraKey; lets the board filter/tag by project once multiple are configured |
| summary | story title |
| description | story description, used as AI breakdown input |
| jiraStatus | last-known JIRA status name, refreshed on sync |
| url | deep link back to the JIRA issue |
| lastSyncedAt | timestamp of last successful sync |
| completionCommentPostedAt | timestamp the completion summary comment was last posted to JIRA; null if not yet posted for the current completion |

**WorkUnit**
| field | notes |
|---|---|
| id | local primary key |
| storyId | FK to Story |
| title | short label shown on the card |
| description | optional longer detail |
| column | `todo` \| `in_progress` \| `done` |
| order | position within its column, for manual reordering |
| createdAt | |
| completedAt | set when column becomes `done` |

Work units are **local-only**: they are never created, updated, or synced as JIRA subtasks or any other JIRA entity. They exist purely in the local SQLite database.

## Sync Flow (JIRA → Board)

Sync is manual, triggered by a "Sync" button in the UI — no background polling or cron in v1.

On sync, the app builds a JQL query from the configured `JIRA_PROJECT_KEYS` list:

```
project IN (TEAM) AND assignee = currentUser() AND statusCategory != Done
```

(the `project IN (...)` clause expands to every configured key, so v1 with one key behaves identically to adding more later).

For each returned issue, it upserts the corresponding `Story` row (summary, description, jiraStatus, url, lastSyncedAt). Existing `WorkUnit` rows for that story are never touched by a sync — local breakdown work is never clobbered by a JIRA-side edit. Stories no longer returned by the query (e.g. completed or reassigned) are left in the local DB as-is; they simply stop being refreshed. The user can ignore or manually archive them.

## Board UI

**Needs breakdown tray** — a sidebar/section listing stories that have zero work units yet. This is where freshly synced stories land.

**Breakdown flow** — from a story in the tray, clicking "Break down with AI" sends the story's summary and description to the Claude API, which returns a suggested list of work units. The user reviews the suggestions in an editable list (edit titles, remove items, add their own) before accepting. Accepted items are created as `WorkUnit` rows in the `todo` column, and the story is promoted out of the tray into its own swimlane.

**Board** — a swimlane board with one horizontal lane per story that has at least one work unit, each lane containing the same three columns (`To Do`, `In Progress`, `Done`). The lane header shows the story's JIRA key, summary, and a link back to the JIRA issue. Work units only move within their own story's lane — they're dragged between columns and reordered within a column via drag-and-drop, never between lanes.

A story can return to the tray for further breakdown at any time (e.g. adding more work units later) even after some of its units are already on the board — its swimlane stays in place while this happens.

## Status Sync (Board → JIRA)

Two triggers, both evaluated whenever a work unit's column changes:

1. **First unit started** — when a work unit moves out of `todo` and no other work unit for the same story is already `in_progress` or `done`, the app fetches the issue's available transitions from JIRA (`GET /issue/{id}/transitions`) and applies whichever transition's target status falls in the "In Progress" status category.
2. **All units done** — when every work unit for a story is `done`, the app does two things:
   - Applies whichever available transition's target status falls in the "Done" status category.
   - Generates an AI summary (via Claude, from the completed work units' titles/descriptions) and opens a **review dialog** showing it, editable, with a "Post to JIRA" action. Confirming posts it as a comment on the issue (`POST /issue/{id}/comment`) and sets `completionCommentPostedAt`. Dismissing without posting leaves `completionCommentPostedAt` null; the lane shows a "Post completion summary" button so it can be triggered again later.

If no transition in the fetched list targets the needed category (workflow uses non-standard naming, or the issue is already in that category), the app skips that part silently and shows a brief non-blocking toast. Neither the transition nor the comment step ever blocks or reverts the board action — the work unit move always succeeds locally regardless of whether either JIRA call succeeds.

If a work unit is later dragged back out of `done` after a completion comment was already posted, `completionCommentPostedAt` is reset to null so a future re-completion offers to post a fresh summary rather than silently staying stale.

## Error Handling

- JIRA or Claude API failures (auth error, rate limit, network failure) are caught at the API route boundary, logged server-side, and surfaced to the user as a non-blocking toast.
- Manual work-unit creation, editing, and drag-and-drop always function independently of integration health — a JIRA or Claude outage degrades sync/breakdown/status-push features only, never the core board.
- Sync and breakdown actions are explicit user-triggered actions (button clicks), so failures have an obvious retry point — no silent background failures.

## Testing

- Vitest unit tests for: JQL query construction (including multi-key `project IN (...)` expansion), the transition-matching logic (picking the right transition from a list given a target status category), the all-units-done/first-unit-started trigger logic (including the `completionCommentPostedAt` reset when a unit leaves `done`), and WorkUnit CRUD operations.
- Manual click-through testing for drag-and-drop board interactions and the breakdown review UI — not automated in v1, low value relative to cost for a single-user tool.

## Out of Scope (v1)

- Writing work units back to JIRA as subtasks (explicitly rejected — local-only by design).
- Background/scheduled sync polling.
- Multi-user or hosted deployment.
- Configurable status-category-to-transition mapping UI (the "In Progress"/"Done" category matching described above is fixed logic, not user-configurable, in v1).
- Auto-posting the completion summary without review (always requires explicit confirmation in v1).
- Swimlanes grouped by anything other than story (e.g. priority, issue type).
- Per-project board separation or filtering UI (v1 is a single combined board; project scoping is config-only via `JIRA_PROJECT_KEYS`).
- Code repository integration of any kind (no GitHub/git linkage in the data model).
