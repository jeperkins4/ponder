# Reporting Suite — Design

**Date:** 2026-07-05
**Status:** Approved

## Goal

A reporting capability that answers four questions across projects and date ranges:

1. **Completed-work history** — what shipped, per story, over a period.
2. **Throughput & cycle time** — flow metrics from existing timestamps.
3. **Current status snapshot** — where everything stands right now.
4. **JIRA reporting trail** — what was reported to JIRA and when.

Delivered through an in-app `/reports` page and read-only MCP tools. A scheduled digest is explicitly deferred to a follow-up spec (it needs scheduler and delivery-channel decisions this spec should not carry); it will reuse the report layer built here.

## Decisions made during brainstorming

- **Scope:** all four report types, structured as one Reports page with sections — not four separate features.
- **Delivery:** in-app `/reports` page + MCP tools now; scheduled digest deferred; no CSV export.
- **Cycle time:** existing timestamps only (`createdAt` → `completedAt`). No column-transition history table — true time-in-column metrics are out of scope.
- **Presentation:** tables for history/audit sections; a small number of hand-rolled SVG charts where a picture genuinely helps (weekly throughput bars, cycle-time trend). No charting dependency.

## Architecture

One shared report-query layer with thin consumers:

```
src/lib/reports/          — pure Prisma-backed query functions + DTOs
  └── consumed by
      /api/reports        — single GET route returning all four sections
        └── consumed by
            /reports page — tables + SVG charts
            MCP tools     — via PonderClient (HTTP), like all existing tools
```

All report logic lives in `src/lib/reports/`. The API route, page, and MCP tools contain no aggregation logic of their own. The future digest becomes a fourth thin consumer.

## 1. Report layer — `src/lib/reports/`

Four pure query functions, each taking a shared filter object:

```ts
interface ReportFilters {
  projectId?: string; // omitted = all projects
  from?: Date;        // omitted = beginning of time
  to?: Date;          // omitted = now
}
```

Date filtering applies to the timestamp that defines each report's events (e.g. `completedAt` for completed work, event timestamps for the JIRA trail). The snapshot ignores `from`/`to` — it is "right now" by definition — but honors `projectId`.

### `getCompletedWork(filters): CompletedWorkReport`

Work units with `completedAt` in range, **including archived cards** — archiving (Move-to-QA) does not erase completion. Grouped by story:

- Story: `jiraKey`, `summary`, `jiraStatus`.
- Per card: `title`, `subNumber`, `completedAt`, `archivedAt`, `verificationOutcome` (`passed` / `failed` / `null` = never verified).
- Totals: cards completed, stories touched.

Ordered by most recent completion first (stories by their latest card completion, cards within a story by `completedAt` desc).

### `getThroughput(filters): ThroughputReport`

Over work units with `completedAt` in range (archived included):

- **Weekly buckets** — ISO week (UTC, Monday start): `weekStart` (ISO date), `completedCount`, `avgCycleTimeDays`, `medianCycleTimeDays`. Weeks with zero completions inside the range are included so charts don't skip gaps.
- **Cycle time** per card = `completedAt − createdAt`, reported in fractional days.
- **Overall stats:** total completed, average and median cycle time, cards/week average across the bucketed range.

### `getStatusSnapshot(filters): StatusSnapshotReport`

Current state over **active (non-archived) cards only**:

- Per story: `jiraKey`, `summary`, `jiraStatus`, count per column (`todo` / `in_progress` / `code_review` / `done`).
- Aggregate tiles: total active cards per column, **awaiting verification** (`verificationRequestedAt` set, `verifiedAt` null), **failed verification** (`verificationOutcome = "failed"` on an active card).
- Stories with zero active cards are omitted.

### `getJiraTrail(filters): JiraTrailReport`

A chronological event list (newest first) derived from existing timestamps — no new event table:

| Event type | Source | Fields |
|---|---|---|
| `moved_to_qa` | `WorkUnit.movedToQaReportedAt` | jiraKey, card title, timestamp |
| `verification` | `WorkUnit.verifiedAt` | jiraKey, card title, timestamp, outcome (`passed`/`failed`) |
| `story_completed` | `Story.completionCommentPostedAt` | jiraKey, story summary, timestamp |

Each event carries the JIRA key the comment/transition was posted to. Date filtering applies to the event timestamp.

### DTO conventions

Each function returns a typed DTO defined alongside it in `src/lib/reports/`. Dates are ISO strings in DTOs, matching `src/lib/types.ts` conventions. Prisma `Date` → ISO conversion happens inside the report layer, so every consumer (API, page, MCP, future digest) sees the same serialized shape.

## 2. API — `GET /api/reports`

Single route: `GET /api/reports?projectId=&from=&to=`

- Runs all four query functions and returns `{ completedWork, throughput, statusSnapshot, jiraTrail }` in one payload. The queries are cheap at this dataset's scale; one round-trip keeps the page simple.
- `from`/`to` are ISO date strings; invalid dates or `from > to` → 400 with an error message. Unknown `projectId` returns empty sections (consistent with existing routes' tolerance), not 404.
- No auth changes — same posture as the rest of the API.

## 3. `/reports` page

New page at `src/app/reports/page.tsx`, linked from the main navigation alongside Projects/Board.

**Controls (top bar):**
- Project selector: "All projects" (default) or a specific project.
- Date-range presets: **7 / 30 / 90 days / All time** (default 30 days). Presets only — no custom date pickers in v1.
- Changing a control refetches `/api/reports` with the new params.

**Sections, top to bottom:**

1. **Snapshot** — stat tiles (active cards per column, awaiting verification, failed verification) + a per-story table of column counts.
2. **Throughput & cycle time** — a stats row (total completed, avg/median cycle time, cards per week), a **weekly throughput bar chart**, and a **cycle-time trend line** (weekly average). Both are small hand-rolled inline SVG components — no charting dependency. Empty range renders an empty-state message instead of empty charts.
3. **Completed work** — table grouped by story: story header row (jiraKey, summary), card rows (title, completed date, verification outcome badge).
4. **JIRA trail** — chronological table: timestamp, event type, jiraKey, detail.

Loading and error states follow the existing board page patterns.

## 4. MCP tools

Four read-only tools registered in `src/mcp/`, mirroring the report sections:

| Tool | Args | Returns |
|---|---|---|
| `report_completed_work` | `projectId?`, `from?`, `to?` | Plain-text completed-work summary grouped by story |
| `report_throughput` | `projectId?`, `from?`, `to?` | Weekly counts + cycle-time stats as text |
| `report_status_snapshot` | `projectId?` | Column counts and verification states as text |
| `report_jira_trail` | `projectId?`, `from?`, `to?` | Chronological event list as text |

Each follows the existing pattern in `src/mcp/tools.ts`: a pure `(client, args) => Promise<McpTextResult>` function calling `GET /api/reports` through `PonderClient` (one new client method) and formatting its section as plain text. No business logic in the tools.

## 5. Testing

- **Report layer:** unit tests per query function with mocked Prisma — empty DB, single-project filtering, date-range boundaries (inclusive edges), archived-card inclusion (completed work / throughput) vs exclusion (snapshot), weekly bucketing including zero-weeks, median with odd/even counts, event-type mapping in the trail.
- **API route:** param validation (invalid dates, `from > to` → 400), payload shape, filter pass-through.
- **Page:** section rendering from a stubbed payload, filter changes trigger refetch, empty and error states. SVG charts get render-level assertions (bar count, axis labels) — no pixel tests.
- **MCP tools:** stubbed `PonderClient`, text formatting per section, graceful empty-report output.

## Out of scope

- **Scheduled digest** — follow-up spec; will consume this report layer.
- Column-transition history table / true time-in-column metrics.
- CSV export.
- JIRA-side data fetching — all reports read the local DB only.
- Custom date pickers (presets only in v1).
