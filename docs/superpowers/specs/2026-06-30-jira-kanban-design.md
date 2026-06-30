# JIRA Work-Unit Kanban Board — Design

**Date:** 2026-06-30
**Status:** Approved

## Purpose

A personal, local kanban board that pulls JIRA stories assigned to the user and lets them break each story into small, locally-managed work units. The work units — not the stories themselves — are the cards that move through the board. Progress on the board feeds back into JIRA by auto-transitioning the parent story's status.

## Scope

Single user, local-only deployment (`npm run dev` on localhost). Not a team tool, not deployed anywhere shared. One JIRA account, one Claude API key, both supplied via local `.env`.

## Architecture

A single Next.js (App Router, TypeScript) application containing both the UI and the backend (API routes). Persistence is a local SQLite file accessed via Prisma. No external services beyond the two integrations below; no auth system beyond the JIRA/Claude API credentials.

Two external integrations, both called server-side only — API keys are never exposed to the browser:

- **JIRA REST API** (Atlassian Cloud) — pull stories assigned to the user; fetch and apply issue status transitions.
- **Claude API** (Anthropic) — generate suggested work-unit breakdowns from a story's summary/description.

Credentials required in `.env` (documented via `.env.example`, gitignored):
- `JIRA_SITE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `ANTHROPIC_API_KEY`

## Data Model

**Story**
| field | notes |
|---|---|
| id | local primary key |
| jiraKey | e.g. `PROJ-123` |
| jiraId | JIRA's internal issue id, used for API calls |
| summary | story title |
| description | story description, used as AI breakdown input |
| jiraStatus | last-known JIRA status name, refreshed on sync |
| url | deep link back to the JIRA issue |
| lastSyncedAt | timestamp of last successful sync |

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

On sync, the app queries JIRA with:

```
assignee = currentUser() AND statusCategory != Done
```

For each returned issue, it upserts the corresponding `Story` row (summary, description, jiraStatus, url, lastSyncedAt). Existing `WorkUnit` rows for that story are never touched by a sync — local breakdown work is never clobbered by a JIRA-side edit. Stories no longer returned by the query (e.g. completed or reassigned) are left in the local DB as-is; they simply stop being refreshed. The user can ignore or manually archive them.

## Board UI

**Needs breakdown tray** — a sidebar/section listing stories that have zero work units yet. This is where freshly synced stories land.

**Breakdown flow** — from a story in the tray, clicking "Break down with AI" sends the story's summary and description to the Claude API, which returns a suggested list of work units. The user reviews the suggestions in an editable list (edit titles, remove items, add their own) before accepting. Accepted items are created as `WorkUnit` rows in the `todo` column.

**Board** — a flat three-column kanban (`To Do`, `In Progress`, `Done`) showing all work units across all stories. Each card displays its title and a small badge with the parent story's JIRA key (e.g. `PROJ-123`); clicking the badge shows the story's full summary/description/JIRA link. Cards are dragged between columns and reordered within a column via drag-and-drop.

A story can return to the tray for further breakdown at any time (e.g. adding more work units later) even after some of its units are already on the board.

## Status Sync (Board → JIRA)

Two triggers, both evaluated whenever a work unit's column changes:

1. **First unit started** — when a work unit moves out of `todo` and no other work unit for the same story is already `in_progress` or `done`, the app fetches the issue's available transitions from JIRA (`GET /issue/{id}/transitions`) and applies whichever transition's target status falls in the "In Progress" status category.
2. **All units done** — when every work unit for a story is `done`, the app applies whichever available transition's target status falls in the "Done" status category.

If no transition in the fetched list targets the needed category (workflow uses non-standard naming, or the issue is already in that category), the app skips silently and shows a brief non-blocking toast noting the story wasn't updated. This never blocks or reverts the board action — the work unit move always succeeds locally regardless of whether the JIRA transition succeeds.

## Error Handling

- JIRA or Claude API failures (auth error, rate limit, network failure) are caught at the API route boundary, logged server-side, and surfaced to the user as a non-blocking toast.
- Manual work-unit creation, editing, and drag-and-drop always function independently of integration health — a JIRA or Claude outage degrades sync/breakdown/status-push features only, never the core board.
- Sync and breakdown actions are explicit user-triggered actions (button clicks), so failures have an obvious retry point — no silent background failures.

## Testing

- Vitest unit tests for: JQL query construction, the transition-matching logic (picking the right transition from a list given a target status category), and WorkUnit CRUD operations.
- Manual click-through testing for drag-and-drop board interactions and the breakdown review UI — not automated in v1, low value relative to cost for a single-user tool.

## Out of Scope (v1)

- Writing work units back to JIRA as subtasks (explicitly rejected — local-only by design).
- Background/scheduled sync polling.
- Multi-user or hosted deployment.
- Configurable status-category-to-transition mapping UI (the "In Progress"/"Done" category matching described above is fixed logic, not user-configurable, in v1).
