# Report Trends (Time-Series Graphs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Trends section on `/reports` with four time-series charts — Created vs Completed, Cumulative completed, WIP over time, JIRA activity — computed by a new `getTrends` query and rendered by one new multi-series SVG chart component.

**Architecture:** `getTrends(filters)` joins the report layer in `src/lib/reports/` (parallel-array `TrendsReport`, daily buckets auto-coarsening to weekly past 35 days), rides the existing `GET /api/reports` payload as a `trends` key, and renders through a new `TimeSeriesChart` in the existing hand-rolled chart family. No aggregation outside the report layer; no new dependencies.

**Tech Stack:** Next.js 15 App Router, Prisma 7, Vitest + Testing Library, hand-rolled SVG.

**Spec:** `docs/superpowers/specs/2026-07-06-report-trends-design.md`

## Global Constraints

- **No new dependencies.**
- **Run tests ONLY via `npm test -- run <path>` / `npm run test:ci`** — NEVER bare `npx vitest` (vitest.setup.ts refuses non-`_test` databases).
- Granularity: window span ≤ 35 days → `"day"`, else `"week"`. Buckets are contiguous from the window start's bucket to the window end's bucket, zero-activity buckets included, keyed YYYY-MM-DD.
- Window: `from` ?? earliest project card `createdAt`; `to` ?? now. No cards at all → empty report (`buckets: []`).
- `created`/`completed` counts **include archived cards**; range filtering on each event's own timestamp, inclusive `from`/`to`.
- `cumulativeCompleted[i]` = sum of `completed[0..i]` (window-local, starts from 0).
- **WIP at bucket end** (bucketEnd = start of the next bucket, the exclusive upper edge): `createdAt < bucketEnd && (completedAt null || completedAt >= bucketEnd) && (archivedAt null || archivedAt >= bucketEnd)`.
- Activity series use the same three timestamps as the JIRA trail: `movedToQaReportedAt`, `verifiedAt`, `Story.completionCommentPostedAt`.
- Project filtering: work units via `{ story: { projectId } }`, stories via `projectId`.
- Chart: one polyline per series, HTML legend row above the SVG, value label at each series' **last point only**, axis labels thinned to **at most 10** (first and last always shown), `Math.max(1, …)` y-scale guard, returns null when every series is empty. Existing charts untouched.
- Series colors on the page: created/movedToQa `text-blue-500`; completed/verifications `text-emerald-500`; cumulative/storyCompletions `text-purple-500`; WIP `text-amber-500`.
- Work happens on the existing branch `feature/report-trends`.

## File Structure

```
src/lib/reports/stats.ts          — add isoDayUtc (Task 1)
src/lib/reports/types.ts          — TrendsReport; ReportsPayload.trends (Task 1)
src/lib/reports/trends.ts         — getTrends (Task 1)
src/lib/reports/trends.test.ts    — integration tests (Task 1)
src/lib/reports/stats.test.ts     — isoDayUtc tests (Task 1)
src/app/api/reports/route.ts      — add getTrends to Promise.all (Task 2)
src/app/api/reports/route.test.ts — trends-key test (Task 2)
src/components/reports/TimeSeriesChart.tsx      — (Task 3)
src/components/reports/TimeSeriesChart.test.tsx — (Task 3)
src/app/reports/page.tsx          — Trends section after Snapshot (Task 4)
src/app/reports/page.test.tsx     — fixture gains trends + section tests (Task 4)
README.md                         — Reports blurb mention (Task 5)
```

---

### Task 1: isoDayUtc, TrendsReport DTO, getTrends query

**Files:**
- Modify: `src/lib/reports/stats.ts` (add `isoDayUtc` after `isoWeekStartUtc`, line ~41)
- Modify: `src/lib/reports/types.ts` (add `TrendsReport`; add `trends` to `ReportsPayload`)
- Create: `src/lib/reports/trends.ts`
- Test: `src/lib/reports/stats.test.ts` (append), `src/lib/reports/trends.test.ts` (create)

**Interfaces:**
- Consumes: `prisma`, `isoWeekStartUtc` (existing), `ReportFilters`.
- Produces (used by Tasks 2 and 4):
  - `isoDayUtc(date: Date): string`
  - `interface TrendsReport { granularity: "day" | "week"; buckets: string[]; created: number[]; completed: number[]; cumulativeCompleted: number[]; wip: number[]; activity: { movedToQa: number[]; verifications: number[]; storyCompletions: number[] } }`
  - `ReportsPayload` gains `trends: TrendsReport`
  - `getTrends(filters: ReportFilters, prismaClient?: PrismaClient): Promise<TrendsReport>`

- [ ] **Step 1: Write the failing stats test**

Append to `src/lib/reports/stats.test.ts` (add `isoDayUtc` to the import from `./stats`):

```ts
describe("isoDayUtc", () => {
  it("returns the UTC calendar day as YYYY-MM-DD", () => {
    expect(isoDayUtc(new Date("2026-07-06T15:30:00.000Z"))).toBe("2026-07-06");
  });

  it("uses the UTC day, not the local day", () => {
    expect(isoDayUtc(new Date("2026-07-06T23:59:59.999Z"))).toBe("2026-07-06");
    expect(isoDayUtc(new Date("2026-07-07T00:00:00.000Z"))).toBe("2026-07-07");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run src/lib/reports/stats.test.ts`
Expected: FAIL — `isoDayUtc` is not exported.

- [ ] **Step 3: Implement isoDayUtc and the DTO**

Append to `src/lib/reports/stats.ts`:

```ts
/** UTC calendar day containing `date`, as YYYY-MM-DD. */
export function isoDayUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

In `src/lib/reports/types.ts`, add before `ReportsPayload`:

```ts
export interface TrendsReport {
  granularity: "day" | "week";
  buckets: string[]; // YYYY-MM-DD bucket starts, contiguous, zero-activity buckets included
  created: number[]; // cards created per bucket (archived included)
  completed: number[]; // cards completed per bucket (archived included)
  cumulativeCompleted: number[]; // running total of `completed` within the window
  wip: number[]; // in-flight count at each bucket END (see getTrends)
  activity: {
    movedToQa: number[];
    verifications: number[];
    storyCompletions: number[];
  };
}
```

and add `trends: TrendsReport;` to `ReportsPayload`.

Run: `npm test -- run src/lib/reports/stats.test.ts`
Expected: PASS. (`tsc` will flag consumers building `ReportsPayload` literals without `trends` — the page/tools test fixtures. Do NOT fix those here; Tasks 2–4 own their files. Run `npx tsc --noEmit` and confirm the ONLY new errors are missing-`trends` object literals in `src/app/reports/page.test.tsx` and `src/mcp/tools.test.ts`; note them in your report.)

- [ ] **Step 4: Write the failing getTrends tests**

Create `src/lib/reports/trends.test.ts`:

```ts
/**
 * Integration tests for getTrends against the test database.
 * Deterministic windows are always passed explicitly (from/to) except the
 * empty-report case. Buckets: daily <= 35-day span, else weekly.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { getTrends } from "./trends";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createProject() {
  return prisma.project.create({
    data: { name: `Trends ${Date.now()}-${Math.random()}`, type: "STANDALONE" },
  });
}

async function createStory(projectId: string, extra: object = {}) {
  const key = uniqueKey("TRND");
  return prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "TRND",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
      projectId,
      ...extra,
    },
  });
}

async function cleanup(projectId: string) {
  await prisma.workUnit.deleteMany({ where: { story: { projectId } } });
  await prisma.story.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });
}

describe("getTrends", () => {
  it("returns an empty report when the project has no cards", async () => {
    const project = await createProject();
    try {
      const report = await getTrends({ projectId: project.id }, prisma);
      expect(report.buckets).toEqual([]);
      expect(report.created).toEqual([]);
      expect(report.activity.movedToQa).toEqual([]);
    } finally {
      await cleanup(project.id);
    }
  });

  it("buckets daily for a <=35-day window, with contiguous zero-filled buckets", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Card A",
          column: "done",
          order: 0,
          createdAt: new Date("2026-07-01T10:00:00.000Z"),
          completedAt: new Date("2026-07-03T10:00:00.000Z"),
        },
      });

      const report = await getTrends(
        {
          projectId: project.id,
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-05T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.granularity).toBe("day");
      expect(report.buckets).toEqual([
        "2026-07-01",
        "2026-07-02",
        "2026-07-03",
        "2026-07-04",
        "2026-07-05",
      ]);
      expect(report.created).toEqual([1, 0, 0, 0, 0]);
      expect(report.completed).toEqual([0, 0, 1, 0, 0]);
      expect(report.cumulativeCompleted).toEqual([0, 0, 1, 1, 1]);
      // WIP at each bucket end: created July 1, completed July 3 10:00 ->
      // still WIP at end of July 1 and July 2; completed before the end of
      // July 3, so gone from July 3 onward.
      expect(report.wip).toEqual([1, 1, 0, 0, 0]);
    } finally {
      await cleanup(project.id);
    }
  });

  it("switches to weekly buckets past a 35-day span", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Old card",
          column: "done",
          order: 0,
          createdAt: new Date("2026-05-05T10:00:00.000Z"), // Tuesday, week 2026-05-04
          completedAt: new Date("2026-06-20T10:00:00.000Z"), // Saturday, week 2026-06-15
        },
      });

      const report = await getTrends(
        {
          projectId: project.id,
          from: new Date("2026-05-04T00:00:00.000Z"),
          to: new Date("2026-06-21T23:59:59.000Z"), // 48-day span
        },
        prisma
      );

      expect(report.granularity).toBe("week");
      expect(report.buckets[0]).toBe("2026-05-04");
      expect(report.buckets[report.buckets.length - 1]).toBe("2026-06-15");
      expect(report.buckets).toHaveLength(7); // 7 Mondays inclusive
      expect(report.created[0]).toBe(1);
      expect(report.completed[6]).toBe(1);
      // WIP: in flight from week 1 through week 5 ends; completed mid week 7's
      // bucket... completed 06-20 which is before end of week 2026-06-15
      // (bucket end 06-22), so WIP drops to 0 in the final bucket.
      expect(report.wip[0]).toBe(1);
      expect(report.wip[5]).toBe(1);
      expect(report.wip[6]).toBe(0);
    } finally {
      await cleanup(project.id);
    }
  });

  it("drops archived-but-never-completed cards from WIP at archive time", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Archived card",
          column: "code_review",
          order: 0,
          createdAt: new Date("2026-07-01T10:00:00.000Z"),
          archivedAt: new Date("2026-07-02T10:00:00.000Z"),
        },
      });

      const report = await getTrends(
        {
          projectId: project.id,
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-03T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.wip).toEqual([1, 0, 0]);
      expect(report.completed).toEqual([0, 0, 0]);
    } finally {
      await cleanup(project.id);
    }
  });

  it("counts the three activity series on their own timestamps", async () => {
    const project = await createProject();
    const story = await createStory(project.id, {
      completionCommentPostedAt: new Date("2026-07-03T09:00:00.000Z"),
    });
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Busy card",
          column: "done",
          order: 0,
          createdAt: new Date("2026-07-01T08:00:00.000Z"),
          movedToQaReportedAt: new Date("2026-07-01T10:00:00.000Z"),
          verifiedAt: new Date("2026-07-02T10:00:00.000Z"),
          verificationOutcome: "passed",
        },
      });

      const report = await getTrends(
        {
          projectId: project.id,
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-03T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.activity.movedToQa).toEqual([1, 0, 0]);
      expect(report.activity.verifications).toEqual([0, 1, 0]);
      expect(report.activity.storyCompletions).toEqual([0, 0, 1]);
    } finally {
      await cleanup(project.id);
    }
  });

  it("scopes to the requested project", async () => {
    const projectA = await createProject();
    const projectB = await createProject();
    const storyA = await createStory(projectA.id);
    const storyB = await createStory(projectB.id);
    try {
      const at = {
        createdAt: new Date("2026-07-01T10:00:00.000Z"),
      };
      await prisma.workUnit.create({
        data: { storyId: storyA.id, title: "A", column: "todo", order: 0, ...at },
      });
      await prisma.workUnit.create({
        data: { storyId: storyB.id, title: "B", column: "todo", order: 0, ...at },
      });

      const report = await getTrends(
        {
          projectId: projectA.id,
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-01T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.created).toEqual([1]);
    } finally {
      await cleanup(projectA.id);
      await cleanup(projectB.id);
    }
  });

  it("defaults the window to earliest createdAt .. now", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Recent card",
          column: "todo",
          order: 0,
          createdAt: twoDaysAgo,
        },
      });

      const report = await getTrends({ projectId: project.id }, prisma);

      expect(report.granularity).toBe("day");
      expect(report.buckets[0]).toBe(twoDaysAgo.toISOString().slice(0, 10));
      expect(report.created[0]).toBe(1);
      expect(report.wip[report.wip.length - 1]).toBe(1);
    } finally {
      await cleanup(project.id);
    }
  });
});
```

- [ ] **Step 5: Run to verify they fail**

Run: `npm test -- run src/lib/reports/trends.test.ts`
Expected: FAIL — `Cannot find module './trends'`.

- [ ] **Step 6: Implement getTrends**

Create `src/lib/reports/trends.ts`:

```ts
/**
 * Time-series trends report: contiguous daily (<=35-day window) or weekly
 * buckets carrying created/completed counts, a window-local cumulative
 * completed total, WIP at each bucket end, and the three JIRA-activity
 * event series. Parallel arrays, one entry per bucket.
 *
 * WIP at a bucket's END (bucketEnd = start of the next bucket, the
 * exclusive upper edge): createdAt < bucketEnd AND (completedAt null or
 * >= bucketEnd) AND (archivedAt null or >= bucketEnd).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isoDayUtc, isoWeekStartUtc } from "./stats";
import type { ReportFilters, TrendsReport } from "./types";

const MS_PER_DAY = 86_400_000;
const MAX_DAILY_SPAN_DAYS = 35;

function emptyReport(): TrendsReport {
  return {
    granularity: "day",
    buckets: [],
    created: [],
    completed: [],
    cumulativeCompleted: [],
    wip: [],
    activity: { movedToQa: [], verifications: [], storyCompletions: [] },
  };
}

export async function getTrends(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<TrendsReport> {
  const units = await prismaClient.workUnit.findMany({
    where: filters.projectId ? { story: { projectId: filters.projectId } } : {},
    select: {
      createdAt: true,
      completedAt: true,
      archivedAt: true,
      movedToQaReportedAt: true,
      verifiedAt: true,
    },
  });
  const completedStories = await prismaClient.story.findMany({
    where: {
      completionCommentPostedAt: { not: null },
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
    },
    select: { completionCommentPostedAt: true },
  });

  if (units.length === 0) return emptyReport();

  const earliestCreated = units.reduce(
    (min, unit) => (unit.createdAt < min ? unit.createdAt : min),
    units[0].createdAt
  );
  const from = filters.from ?? earliestCreated;
  const to = filters.to ?? new Date();
  if (from > to) return emptyReport();

  const spanDays = (to.getTime() - from.getTime()) / MS_PER_DAY;
  const granularity: "day" | "week" =
    spanDays <= MAX_DAILY_SPAN_DAYS ? "day" : "week";
  const bucketOf = granularity === "day" ? isoDayUtc : isoWeekStartUtc;
  const stepMs = granularity === "day" ? MS_PER_DAY : 7 * MS_PER_DAY;

  const buckets: string[] = [];
  const first = new Date(`${bucketOf(from)}T00:00:00.000Z`);
  const last = new Date(`${bucketOf(to)}T00:00:00.000Z`);
  for (
    let cursor = first;
    cursor.getTime() <= last.getTime();
    cursor = new Date(cursor.getTime() + stepMs)
  ) {
    buckets.push(cursor.toISOString().slice(0, 10));
  }

  const indexByBucket = new Map(buckets.map((bucket, i) => [bucket, i]));
  const zeros = () => buckets.map(() => 0);

  const created = zeros();
  const completed = zeros();
  const movedToQa = zeros();
  const verifications = zeros();
  const storyCompletions = zeros();

  const countInto = (series: number[], date: Date | null) => {
    if (!date || date < from || date > to) return;
    const index = indexByBucket.get(bucketOf(date));
    if (index !== undefined) series[index] += 1;
  };

  for (const unit of units) {
    countInto(created, unit.createdAt);
    countInto(completed, unit.completedAt);
    countInto(movedToQa, unit.movedToQaReportedAt);
    countInto(verifications, unit.verifiedAt);
  }
  for (const story of completedStories) {
    countInto(storyCompletions, story.completionCommentPostedAt);
  }

  const cumulativeCompleted: number[] = [];
  let runningTotal = 0;
  for (const count of completed) {
    runningTotal += count;
    cumulativeCompleted.push(runningTotal);
  }

  const wip = buckets.map((bucket) => {
    const bucketEnd = new Date(
      new Date(`${bucket}T00:00:00.000Z`).getTime() + stepMs
    );
    return units.filter(
      (unit) =>
        unit.createdAt < bucketEnd &&
        (unit.completedAt === null || unit.completedAt >= bucketEnd) &&
        (unit.archivedAt === null || unit.archivedAt >= bucketEnd)
    ).length;
  });

  return {
    granularity,
    buckets,
    created,
    completed,
    cumulativeCompleted,
    wip,
    activity: { movedToQa, verifications, storyCompletions },
  };
}
```

- [ ] **Step 7: Run to verify they pass**

Run: `npm test -- run src/lib/reports/trends.test.ts src/lib/reports/stats.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Commit**

`npx tsc --noEmit` — the only errors allowed are the missing-`trends` fixture literals in `src/app/reports/page.test.tsx` and `src/mcp/tools.test.ts` (owned by Tasks 2/4; if `src/mcp/tools.test.ts` errors, fix it here minimally by adding an `emptyTrends()`-style object to its `ReportsPayload` fixtures since no later task owns that file — see the fixture shape in Step 4's `emptyReport()`).

```bash
git add src/lib/reports/stats.ts src/lib/reports/stats.test.ts src/lib/reports/types.ts src/lib/reports/trends.ts src/lib/reports/trends.test.ts src/mcp/tools.test.ts
git commit -m "feat: add getTrends time-series report query and isoDayUtc helper"
```

(Omit `src/mcp/tools.test.ts` from the add if it needed no change.)

---

### Task 2: Route wiring

**Files:**
- Modify: `src/app/api/reports/route.ts` (import `getTrends`; add to `Promise.all` at lines 53–66)
- Test: `src/app/api/reports/route.test.ts` (append one test)

**Interfaces:**
- Consumes: `getTrends` (Task 1).
- Produces (used by Task 4): `GET /api/reports` responses carry `trends: TrendsReport` alongside the existing four sections.

- [ ] **Step 1: Write the failing test**

Append to `src/app/api/reports/route.test.ts`:

```ts
  it("includes a trends section with parallel arrays", async () => {
    const req = new Request("http://localhost:3000/api/reports?projectId=no-such-project");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trends).toBeDefined();
    expect(["day", "week"]).toContain(data.trends.granularity);
    const n = data.trends.buckets.length;
    expect(data.trends.created).toHaveLength(n);
    expect(data.trends.completed).toHaveLength(n);
    expect(data.trends.cumulativeCompleted).toHaveLength(n);
    expect(data.trends.wip).toHaveLength(n);
    expect(data.trends.activity.movedToQa).toHaveLength(n);
    expect(data.trends.activity.verifications).toHaveLength(n);
    expect(data.trends.activity.storyCompletions).toHaveLength(n);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run src/app/api/reports/route.test.ts`
Expected: FAIL — `data.trends` undefined.

- [ ] **Step 3: Wire the route**

In `src/app/api/reports/route.ts`: add `import { getTrends } from "@/lib/reports/trends";`, extend the destructure and `Promise.all`:

```ts
    const [completedWork, throughput, statusSnapshot, jiraTrail, trends] =
      await Promise.all([
        getCompletedWork(filters),
        getThroughput(filters),
        getStatusSnapshot(filters),
        getJiraTrail(filters),
        getTrends(filters),
      ]);

    return NextResponse.json({
      completedWork,
      throughput,
      statusSnapshot,
      jiraTrail,
      trends,
    });
```

- [ ] **Step 4: Run to verify it passes, typecheck, commit**

Run: `npm test -- run src/app/api/reports/route.test.ts && npx tsc --noEmit`
Expected: route tests PASS; tsc errors only in `src/app/reports/page.test.tsx` fixtures (Task 4's file) if any remain.

```bash
git add src/app/api/reports/route.ts src/app/api/reports/route.test.ts
git commit -m "feat: include trends section in GET /api/reports payload"
```

---

### Task 3: TimeSeriesChart component

**Files:**
- Create: `src/components/reports/TimeSeriesChart.tsx`
- Test: `src/components/reports/TimeSeriesChart.test.tsx`

**Interfaces:**
- Consumes: nothing project-specific.
- Produces (used by Task 4): `TimeSeriesChart({ series, ariaLabel })` where `series: { name: string; colorClass: string; points: { label: string; value: number }[] }[]` — all series share the same label array. Returns null when every series is empty. Last-point markers carry `data-testid="ts-point"`; the legend row carries `data-testid="ts-legend"`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/reports/TimeSeriesChart.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimeSeriesChart } from "./TimeSeriesChart";

function points(values: number[], startDay = 1): { label: string; value: number }[] {
  return values.map((value, i) => ({
    label: `2026-07-${String(startDay + i).padStart(2, "0")}`,
    value,
  }));
}

describe("TimeSeriesChart", () => {
  it("renders one polyline and one last-point marker per series", () => {
    const { container } = render(
      <TimeSeriesChart
        ariaLabel="Created vs completed"
        series={[
          { name: "Created", colorClass: "text-blue-500", points: points([1, 2, 3]) },
          { name: "Completed", colorClass: "text-emerald-500", points: points([0, 1, 1]) },
        ]}
      />
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="ts-point"]')).toHaveLength(2);
  });

  it("renders a legend entry per series", () => {
    render(
      <TimeSeriesChart
        ariaLabel="Chart"
        series={[
          { name: "Created", colorClass: "text-blue-500", points: points([1]) },
          { name: "Completed", colorClass: "text-emerald-500", points: points([2]) },
        ]}
      />
    );
    const legend = screen.getByTestId("ts-legend");
    expect(legend).toHaveTextContent("Created");
    expect(legend).toHaveTextContent("Completed");
  });

  it("is exposed as a labelled image", () => {
    render(
      <TimeSeriesChart
        ariaLabel="WIP over time"
        series={[{ name: "WIP", colorClass: "text-amber-500", points: points([1, 2]) }]}
      />
    );
    expect(screen.getByRole("img", { name: "WIP over time" })).toBeInTheDocument();
  });

  it("thins axis labels to at most 10, always keeping first and last", () => {
    const many = points(Array.from({ length: 28 }, (_, i) => i), 1); // 07-01..07-28
    const { container } = render(
      <TimeSeriesChart
        ariaLabel="Long range"
        series={[{ name: "S", colorClass: "text-blue-500", points: many }]}
      />
    );
    const axisLabels = [...container.querySelectorAll('[data-testid="ts-axis-label"]')];
    expect(axisLabels.length).toBeLessThanOrEqual(10);
    const texts = axisLabels.map((el) => el.textContent);
    expect(texts).toContain("07-01");
    expect(texts).toContain("07-28");
  });

  it("shows the last value of each series", () => {
    const { container } = render(
      <TimeSeriesChart
        ariaLabel="Chart"
        series={[{ name: "S", colorClass: "text-blue-500", points: points([1, 5, 9]) }]}
      />
    );
    expect(container.textContent).toContain("9");
  });

  it("renders nothing when every series is empty", () => {
    const { container } = render(
      <TimeSeriesChart ariaLabel="Empty" series={[{ name: "S", colorClass: "text-blue-500", points: [] }]} />
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- run src/components/reports/TimeSeriesChart.test.tsx`
Expected: FAIL — `Cannot find module './TimeSeriesChart'`.

- [ ] **Step 3: Implement the component**

Create `src/components/reports/TimeSeriesChart.tsx`:

```tsx
/**
 * Multi-series hand-rolled SVG line chart — the time-series member of the
 * reports chart family (no charting dependency by design). All series share
 * one label array (parallel to the trends DTO's bucket array). Legend above,
 * a value label at each series' last point, axis labels thinned to <= 10.
 */

interface TimeSeriesPoint {
  label: string; // YYYY-MM-DD bucket start
  value: number;
}

export interface TimeSeries {
  name: string;
  colorClass: string; // Tailwind text color, e.g. "text-blue-500"
  points: TimeSeriesPoint[];
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = { top: 16, right: 16, bottom: 24, left: 16 };
const MAX_AXIS_LABELS = 10;

export function TimeSeriesChart({
  series,
  ariaLabel,
}: {
  series: TimeSeries[];
  ariaLabel: string;
}) {
  const nonEmpty = series.filter((s) => s.points.length > 0);
  if (nonEmpty.length === 0) return null;

  const labels = nonEmpty[0].points.map((p) => p.label);
  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(1, ...nonEmpty.flatMap((s) => s.points.map((p) => p.value)));

  const xAt = (i: number) =>
    labels.length === 1
      ? PADDING.left + chartWidth / 2
      : PADDING.left + (i / (labels.length - 1)) * chartWidth;
  const yAt = (value: number) =>
    PADDING.top + chartHeight - (value / max) * chartHeight;

  const stride =
    labels.length <= MAX_AXIS_LABELS
      ? 1
      : Math.ceil((labels.length - 1) / (MAX_AXIS_LABELS - 1));
  const shownLabels = new Set<number>();
  for (let i = 0; i < labels.length; i += stride) shownLabels.add(i);
  shownLabels.add(labels.length - 1);
  // Guard: the stride walk plus the forced last label can exceed the cap by
  // one when they land adjacently; drop the second-to-last shown label then.
  if (shownLabels.size > MAX_AXIS_LABELS) {
    const shown = [...shownLabels].sort((a, b) => a - b);
    shownLabels.delete(shown[shown.length - 2]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-4" data-testid="ts-legend">
        {nonEmpty.map((s) => (
          <span key={s.name} className={`flex items-center gap-1.5 text-xs ${s.colorClass}`}>
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current" />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-1 w-full max-w-2xl"
      >
        {nonEmpty.map((s) => {
          const lastIndex = s.points.length - 1;
          const lastPoint = s.points[lastIndex];
          return (
            <g key={s.name} className={s.colorClass}>
              <polyline
                points={s.points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(" ")}
                className="fill-none stroke-current"
                strokeWidth={2}
              />
              <circle
                data-testid="ts-point"
                cx={xAt(lastIndex)}
                cy={yAt(lastPoint.value)}
                r={3.5}
                className="fill-current"
              />
              <text
                x={xAt(lastIndex)}
                y={yAt(lastPoint.value) - 8}
                textAnchor="middle"
                className="fill-current text-[10px]"
              >
                {lastPoint.value}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) =>
          shownLabels.has(i) ? (
            <text
              key={label}
              data-testid="ts-axis-label"
              x={xAt(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-current text-[10px]"
            >
              {label.slice(5)}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify they pass, typecheck, commit**

Run: `npm test -- run src/components/reports/TimeSeriesChart.test.tsx && npx tsc --noEmit`
Expected: PASS; tsc errors only in Task 4's fixture file (if any).

```bash
git add src/components/reports/TimeSeriesChart.tsx src/components/reports/TimeSeriesChart.test.tsx
git commit -m "feat: add multi-series TimeSeriesChart to the reports chart family"
```

---

### Task 4: Trends section on the page

**Files:**
- Modify: `src/app/reports/page.tsx` (insert a section after the Snapshot `</section>`, ~line 209; add the `TimeSeriesChart` import)
- Test: `src/app/reports/page.test.tsx` (extend fixtures with `trends`; add section tests)

**Interfaces:**
- Consumes: `trends` on `ReportsPayload` (Tasks 1–2), `TimeSeriesChart` (Task 3).
- Produces: the Trends UI; nothing downstream.

- [ ] **Step 1: Extend the test fixtures and write the failing tests**

In `src/app/reports/page.test.tsx`:

1. Add to the main `payload` fixture (the `ReportsPayload` literal):

```ts
  trends: {
    granularity: "day" as const,
    buckets: ["2026-07-04", "2026-07-05", "2026-07-06"],
    created: [2, 1, 0],
    completed: [0, 1, 1],
    cumulativeCompleted: [0, 1, 2],
    wip: [2, 2, 1],
    activity: {
      movedToQa: [0, 1, 0],
      verifications: [0, 0, 1],
      storyCompletions: [0, 0, 1],
    },
  },
```

2. Add to the empty-payload literal in the empty-states test:

```ts
  trends: {
    granularity: "day" as const,
    buckets: [],
    created: [],
    completed: [],
    cumulativeCompleted: [],
    wip: [],
    activity: { movedToQa: [], verifications: [], storyCompletions: [] },
  },
```

3. Add tests:

```tsx
  it("renders the Trends section with all four charts and the granularity caption", async () => {
    render(<ReportsPage />);

    expect(
      await screen.findByRole("heading", { name: /trends/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Daily buckets")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /created vs completed/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /cumulative completed/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /wip over time/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /jira activity/i })
    ).toBeInTheDocument();
  });
```

and to the existing empty-states test add:

```tsx
    expect(screen.getByText(/no activity in this range/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- run src/app/reports/page.test.tsx`
Expected: the new assertions FAIL (no Trends heading); pre-existing tests pass (fixtures now complete).

- [ ] **Step 3: Implement the section**

In `src/app/reports/page.tsx`, add the import:

```tsx
import { TimeSeriesChart } from "@/components/reports/TimeSeriesChart";
```

Add a small helper near `formatDate`/`formatDateTime`:

```tsx
function toSeriesPoints(buckets: string[], values: number[]) {
  return buckets.map((label, i) => ({ label, value: values[i] }));
}
```

Insert after the Snapshot section's closing `</section>` (before the Throughput section):

```tsx
          {/* Trends */}
          <section aria-labelledby="trends-heading">
            <h2 id="trends-heading" className="font-space-grotesk text-lg font-bold">
              Trends
            </h2>
            {report.trends.buckets.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No activity in this range.
              </p>
            ) : (
              <div className="mt-3 space-y-8">
                <p className={`text-xs ${mutedClass}`}>
                  {report.trends.granularity === "day"
                    ? "Daily buckets"
                    : "Weekly buckets"}
                </p>
                <div>
                  <h3 className="text-sm font-semibold">Created vs Completed</h3>
                  <TimeSeriesChart
                    ariaLabel="Cards created vs completed over time"
                    series={[
                      {
                        name: "Created",
                        colorClass: "text-blue-500",
                        points: toSeriesPoints(report.trends.buckets, report.trends.created),
                      },
                      {
                        name: "Completed",
                        colorClass: "text-emerald-500",
                        points: toSeriesPoints(report.trends.buckets, report.trends.completed),
                      },
                    ]}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Cumulative completed</h3>
                  <TimeSeriesChart
                    ariaLabel="Cumulative completed cards over time"
                    series={[
                      {
                        name: "Completed (cumulative)",
                        colorClass: "text-purple-500",
                        points: toSeriesPoints(
                          report.trends.buckets,
                          report.trends.cumulativeCompleted
                        ),
                      },
                    ]}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">WIP over time</h3>
                  <TimeSeriesChart
                    ariaLabel="Work in progress over time"
                    series={[
                      {
                        name: "WIP",
                        colorClass: "text-amber-500",
                        points: toSeriesPoints(report.trends.buckets, report.trends.wip),
                      },
                    ]}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">JIRA activity</h3>
                  <TimeSeriesChart
                    ariaLabel="JIRA-facing events over time"
                    series={[
                      {
                        name: "Move to QA",
                        colorClass: "text-blue-500",
                        points: toSeriesPoints(
                          report.trends.buckets,
                          report.trends.activity.movedToQa
                        ),
                      },
                      {
                        name: "Verifications",
                        colorClass: "text-emerald-500",
                        points: toSeriesPoints(
                          report.trends.buckets,
                          report.trends.activity.verifications
                        ),
                      },
                      {
                        name: "Story completions",
                        colorClass: "text-purple-500",
                        points: toSeriesPoints(
                          report.trends.buckets,
                          report.trends.activity.storyCompletions
                        ),
                      },
                    ]}
                  />
                </div>
              </div>
            )}
          </section>
```

- [ ] **Step 4: Run tests, typecheck, lint, commit**

Run: `npm test -- run src/app/reports/page.test.tsx && npx tsc --noEmit && npx eslint src/app/reports src/components/reports`
Expected: PASS; tsc fully clean repo-wide now; no new lint warnings.

```bash
git add src/app/reports/page.tsx src/app/reports/page.test.tsx
git commit -m "feat: add Trends section with four time-series charts to /reports"
```

---

### Task 5: Full verification, README, PR

**Files:**
- Modify: `README.md` (Reports section, added 2026-07-05)

**Interfaces:** consumes everything above; produces a green suite, docs, and an open PR.

- [ ] **Step 1: Full verification**

```bash
npx tsc --noEmit && npm run test:ci && npx eslint src && npm run knip
```

Expected: clean (3 pre-existing lint warnings allowed; previous full-suite count 657 + new tests). If knip flags a genuinely internal-only new export, un-export it (precedent: PR #26).

- [ ] **Step 2: Update the README's Reports paragraph**

Extend the existing Reports section's text with one sentence:

```markdown
A **Trends** section adds time-series graphs — created vs completed, cumulative completed, WIP over time, and JIRA activity — bucketed daily for short ranges and weekly past ~5 weeks.
```

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: document the reports Trends section"
git push -u origin feature/report-trends
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "Reports: Trends section with time-series graphs" --body "$(cat <<'EOF'
## Summary
- New `getTrends` query in the report layer: contiguous daily buckets (auto-coarsening to weekly past a 35-day span) carrying created/completed counts, window-local cumulative completed, WIP at each bucket end, and the three JIRA-activity event series — parallel arrays, fully integration-tested
- `GET /api/reports` payload gains a `trends` section (route otherwise untouched)
- New multi-series `TimeSeriesChart` (hand-rolled SVG, legend, last-point value labels, axis labels thinned to <= 10) joins the existing chart family — still no charting dependency
- `/reports` gains a Trends section (after Snapshot) with four charts sharing the existing project/date-range controls, plus a daily/weekly granularity caption

Spec: `docs/superpowers/specs/2026-07-06-report-trends-design.md`
Plan: `docs/superpowers/plans/2026-07-06-report-trends.md`

## Test plan
- [ ] `npm run test:ci` — full suite green
- [ ] `npx tsc --noEmit` / `npx eslint src` / `npm run knip` — clean
- [ ] Manual: /reports shows the four trend charts; switching range presets flips daily/weekly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Do not merge — John merges PRs himself.
