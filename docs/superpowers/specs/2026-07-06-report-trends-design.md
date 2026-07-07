# Report Trends (Time-Series Graphs) — Design

**Date:** 2026-07-06
**Status:** Approved

## Goal

Add time-series graphs to the `/reports` page: a new **Trends** section with four charts — Created vs Completed, Cumulative completed (burnup), WIP over time, and JIRA activity — derived entirely from existing timestamps and rendered by the existing hand-rolled SVG chart family.

## Decisions made during brainstorming

- **Series:** all four — Created vs Completed, Cumulative burnup, WIP over time, Activity timeline.
- **Granularity:** daily, auto-coarsening to weekly for long ranges (span > 35 days). A caption shows which is active.
- **Placement:** one new Trends section (after Snapshot), sharing the page's existing project/date-range controls — no new controls.
- **Charting:** extend the hand-rolled SVG kit with one multi-series `TimeSeriesChart`; no charting dependency (reaffirming the reporting spec's decision). No hover tooltips in v1 — legend + last-point value labels + thinned axis labels.

## Architecture

```
src/lib/reports/trends.ts              — getTrends(filters): TrendsReport (Prisma + stats helpers)
src/lib/reports/types.ts               — TrendsReport DTO; ReportsPayload gains trends
src/lib/reports/stats.ts               — new isoDayUtc helper (sibling of isoWeekStartUtc)
src/app/api/reports/route.ts           — getTrends joins the existing Promise.all
src/components/reports/TimeSeriesChart.tsx — one multi-series line chart
src/app/reports/page.tsx               — new Trends section (after Snapshot)
```

All aggregation stays in the report layer; the route, page, and charts remain logic-free consumers, per the reporting architecture.

## 1. Trends query — `getTrends(filters: ReportFilters): TrendsReport`

**Window resolution.** `from` = `filters.from` ?? the earliest `createdAt` among the project's cards (all projects when unscoped); `to` = `filters.to` ?? now. If there are no cards at all, return an empty report (`buckets: []`).

**Granularity.** Window span ≤ 35 days → `"day"` buckets (`isoDayUtc`, YYYY-MM-DD); otherwise → `"week"` buckets (`isoWeekStartUtc`, Monday-start UTC). Buckets run contiguously from the window start's bucket to the window end's bucket — zero-activity buckets included.

**DTO** (parallel arrays, one entry per bucket):

```ts
export interface TrendsReport {
  granularity: "day" | "week";
  buckets: string[];              // YYYY-MM-DD bucket starts
  created: number[];              // cards created in bucket
  completed: number[];            // cards completed in bucket (archived included)
  cumulativeCompleted: number[];  // running total of `completed` within the window
  wip: number[];                  // in-flight count at each bucket END
  activity: {
    movedToQa: number[];          // WorkUnit.movedToQaReportedAt in bucket
    verifications: number[];      // WorkUnit.verifiedAt in bucket
    storyCompletions: number[];   // Story.completionCommentPostedAt in bucket
  };
}
```

**Semantics.**

- `created` / `completed`: counts of `createdAt` / `completedAt` falling in the bucket. **Archived cards included** in both (consistent with the throughput report — archiving does not erase history).
- `cumulativeCompleted[i]` = sum of `completed[0..i]` (starts from 0 within the window; not an all-time total).
- `wip[i]` — in-flight at the bucket's END (exclusive upper edge = start of the next bucket): cards with `createdAt < bucketEnd` AND (`completedAt` null or `>= bucketEnd`) AND (`archivedAt` null or `>= bucketEnd`).
- `activity`: same three event timestamps the JIRA trail uses, counted per bucket.
- Project filtering: work units via `{ story: { projectId } }`, stories via `projectId` — same as every other report query.
- Implementation shape: fetch the relevant timestamp columns once (one query per source: work units with `createdAt/completedAt/archivedAt/movedToQaReportedAt/verifiedAt`, stories with `completionCommentPostedAt`), then bucket in memory with the stats helpers. Dataset scale makes this trivially cheap and keeps the math pure and testable.

**New stats helper.** `isoDayUtc(date: Date): string` — the UTC calendar day as YYYY-MM-DD (sibling of `isoWeekStartUtc`).

## 2. API

`GET /api/reports` response gains a `trends: TrendsReport` key: `getTrends(filters)` joins the existing `Promise.all` in the route. Param handling, validation, and error posture unchanged. `ReportsPayload` gains `trends`.

MCP tools deliberately untouched in v1 — no one consumes trend data over MCP yet; the payload already carries it for a later tool.

## 3. Chart component — `TimeSeriesChart`

`src/components/reports/TimeSeriesChart.tsx`, in the existing hand-rolled family:

```ts
interface TimeSeriesChartProps {
  series: {
    name: string;        // legend label
    colorClass: string;  // Tailwind stroke/fill class pair root, e.g. "text-blue-500"
    points: { label: string; value: number }[];
  }[];
  ariaLabel: string;
}
```

- One `<polyline>` per series (stroke = series color), points sharing the same x positions (all series have identical label arrays — guaranteed by the DTO's parallel arrays).
- Legend row above the chart: a color swatch + name per series.
- A value label at each series' **last** point only.
- X-axis labels: MM-DD tails, **thinned to at most 10** evenly-spaced labels (always including first and last bucket).
- Y scale: 0 to the max value across all series (min 1, matching the existing charts' divide-by-zero guard).
- Returns `null` when every series is empty; `<svg role="img" aria-label>` + viewBox scaling, `data-testid="ts-point"` on last-point markers — all conventions carried over from `TrendLineChart`.

The existing `WeeklyBarChart`/`TrendLineChart` are untouched.

## 4. Page — Trends section

New section on `/reports`, immediately after **Snapshot**, heading "Trends", sharing the existing project/date-range controls. Content, top to bottom:

1. Granularity caption: "Daily buckets" / "Weekly buckets" (from `trends.granularity`).
2. **Created vs Completed** — 2 series (created: blue, completed: emerald).
3. **Cumulative completed** — 1 series (purple).
4. **WIP over time** — 1 series (amber).
5. **JIRA activity** — 3 series (Move to QA: blue, Verifications: emerald, Story completions: purple).

Empty state: when `trends.buckets` is empty, the section shows "No activity in this range." instead of charts. Loading/error behavior is the page's existing one (single fetch already covers trends).

## 5. Testing

- **getTrends (integration, test DB):** day-vs-week switchover around the 35-day boundary; created/completed bucket placement (inclusive edges); WIP boundary semantics (created-not-completed counts, completed-mid-window drops out of later buckets, archived drops out); cumulative math; activity mapping per event type; project scoping; zero-cards → empty report; zero-activity buckets present.
- **TimeSeriesChart (render):** one polyline per series; legend renders series names; ≤ 10 axis labels for a long bucket array (first and last present); last-point value labels; all-empty series → null.
- **Page:** Trends section renders all four chart headings from a stubbed payload; empty-state message when buckets is empty; granularity caption.
- **Route:** response contains a `trends` key with parallel-array lengths matching `buckets`.

All tests run via `npm test` / `npm run test:ci` only (vitest.setup guard).

## Out of scope

- Hover tooltips, zoom/pan.
- Per-column cumulative flow diagram — requires the column-transition history table the reporting spec already deferred.
- MCP trend tools.
- CSV export.
