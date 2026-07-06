# Reporting Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/reports` page and four read-only MCP tools that report completed-work history, throughput & cycle time, current status snapshot, and the JIRA reporting trail — all built on one shared, tested query layer in `src/lib/reports/`.

**Architecture:** Four pure Prisma-backed query functions in `src/lib/reports/` return typed DTOs (ISO-string dates). A single `GET /api/reports` route runs all four and returns one payload. The `/reports` page (client component) and four MCP tools (via a new `PonderClient.getReports` method) are thin consumers with no aggregation logic of their own. Charts are two small hand-rolled inline-SVG components — no charting dependency.

**Tech Stack:** Next.js 15 App Router, Prisma 7 (PostgreSQL), React 18 client components, Tailwind, Vitest + Testing Library, MCP SDK with `zod/v3`.

**Spec:** `docs/superpowers/specs/2026-07-05-reporting-suite-design.md`

## Global Constraints

- **No new dependencies.** Charts are hand-rolled SVG.
- All DTO dates are **ISO strings**; Prisma `Date` → ISO conversion happens inside `src/lib/reports/` (spec: every consumer sees the same serialized shape).
- Completed-work and throughput queries **include archived cards** (archiving via Move-to-QA does not erase completion). The snapshot uses **active (`archivedAt: null`) cards only** and ignores `from`/`to`.
- Date-range boundaries are **inclusive** (`gte`/`lte`).
- Weekly buckets are **ISO weeks, Monday start, UTC**, keyed by `weekStart` as `YYYY-MM-DD`; zero-completion weeks between the first and last bucket are included.
- Cycle time = `completedAt − createdAt` in **fractional days rounded to 2 decimals**.
- Project filtering goes through the story relation: `{ story: { projectId } }` (Story.projectId is the canonical link).
- Lib/route tests are **integration tests against the test database**: unique keys via `` `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}` ``, explicit cleanup in `try/finally`, no blanket `deleteMany` on shared tables (Story/WorkUnit) — see `src/lib/importDedup.test.ts`.
- In `src/mcp/server.ts`, import zod as `import { z } from "zod/v3";` (root import breaks TS — see existing comment in that file).
- Run tests with `npx vitest run <path>`; typecheck with `npx npm run typecheck 2>/dev/null || npx tsc --noEmit`.
- Work happens on the existing branch `feature/reporting-suite`.

## File Structure

```
src/lib/reports/
  types.ts               — ReportFilters + all report DTOs (Task 1)
  stats.ts               — pure math: round2, mean, median, cycleTimeDays,
                           isoWeekStartUtc, buildWeeklyBuckets (Task 1)
  stats.test.ts          — pure unit tests, no DB (Task 1)
  completedWork.ts       — getCompletedWork query (Task 2)
  completedWork.test.ts  — integration tests (Task 2)
  snapshot.ts            — getStatusSnapshot query (Task 2)
  snapshot.test.ts       — integration tests (Task 2)
  throughput.ts          — getThroughput query (Task 3)
  throughput.test.ts     — integration tests (Task 3)
  jiraTrail.ts           — getJiraTrail query (Task 3)
  jiraTrail.test.ts      — integration tests (Task 3)
src/app/api/reports/
  route.ts               — GET /api/reports (Task 4)
  route.test.ts          — integration tests (Task 4)
src/components/reports/
  WeeklyBarChart.tsx     — SVG bar chart (Task 5)
  WeeklyBarChart.test.tsx
  TrendLineChart.tsx     — SVG line chart (Task 5)
  TrendLineChart.test.tsx
src/app/reports/
  page.tsx               — /reports client page (Task 6)
  page.test.tsx
src/components/TopNav.tsx — add Reports link (Task 6, modify)
src/mcp/client.ts        — add getReports method (Task 7, modify)
src/mcp/tools.ts         — four report tools (Task 7, modify)
src/mcp/tools.test.ts    — tool tests (Task 7, modify)
src/mcp/server.ts        — register four tools (Task 7, modify)
README.md                — feature + MCP docs (Task 8, modify)
```

---

### Task 1: Report DTOs and pure stats helpers

**Files:**
- Create: `src/lib/reports/types.ts`
- Create: `src/lib/reports/stats.ts`
- Test: `src/lib/reports/stats.test.ts`

**Interfaces:**
- Consumes: `Column` from `@/lib/types`.
- Produces (used by Tasks 2–7):
  - All DTO interfaces below, exported from `src/lib/reports/types.ts`.
  - `round2(value: number): number`
  - `mean(values: number[]): number | null` (null for empty input)
  - `median(values: number[]): number | null` (null for empty; even count = mean of middle two, rounded)
  - `cycleTimeDays(createdAt: Date, completedAt: Date): number`
  - `isoWeekStartUtc(date: Date): string` (Monday-start UTC week as `YYYY-MM-DD`)
  - `buildWeeklyBuckets(cards: { createdAt: Date; completedAt: Date }[]): WeeklyBucket[]`

- [ ] **Step 1: Create the DTO module**

Create `src/lib/reports/types.ts`:

```ts
/**
 * Report-layer filter and DTO types.
 *
 * Dates in DTOs are ISO strings (matching src/lib/types.ts conventions);
 * the Prisma Date -> ISO conversion happens inside src/lib/reports/ so every
 * consumer (API route, /reports page, MCP tools, future digest) sees the
 * same serialized shape.
 */

import type { Column } from "@/lib/types";

export interface ReportFilters {
  projectId?: string; // omitted = all projects
  from?: Date; // omitted = beginning of time; inclusive
  to?: Date; // omitted = now; inclusive
}

export interface CompletedCard {
  id: string;
  title: string;
  subNumber: number | null;
  completedAt: string; // ISO string
  archivedAt: string | null; // ISO string
  verificationOutcome: "passed" | "failed" | null;
}

export interface CompletedStoryGroup {
  jiraKey: string;
  summary: string;
  jiraStatus: string;
  cards: CompletedCard[];
}

export interface CompletedWorkReport {
  stories: CompletedStoryGroup[];
  totalCards: number;
  totalStories: number;
}

export interface WeeklyBucket {
  weekStart: string; // Monday-start ISO week (UTC) as YYYY-MM-DD
  completedCount: number;
  avgCycleTimeDays: number | null; // null when completedCount is 0
  medianCycleTimeDays: number | null; // null when completedCount is 0
}

export interface ThroughputReport {
  weeks: WeeklyBucket[];
  totalCompleted: number;
  avgCycleTimeDays: number | null;
  medianCycleTimeDays: number | null;
  avgCardsPerWeek: number | null; // totalCompleted / weeks.length; null when no weeks
}

export interface SnapshotStoryRow {
  jiraKey: string;
  summary: string;
  jiraStatus: string;
  columnCounts: Record<Column, number>;
}

export interface StatusSnapshotReport {
  stories: SnapshotStoryRow[]; // ordered by jiraKey; zero-active-card stories omitted
  columnTotals: Record<Column, number>;
  awaitingVerification: number; // verificationRequestedAt set, verifiedAt null
  failedVerification: number; // verificationOutcome === "failed" on an active card
}

export type JiraTrailEventType = "moved_to_qa" | "verification" | "story_completed";

export interface JiraTrailEvent {
  type: JiraTrailEventType;
  jiraKey: string;
  detail: string; // card title (work-unit events) or story summary (story_completed)
  timestamp: string; // ISO string
  outcome?: "passed" | "failed"; // verification events only
}

export interface JiraTrailReport {
  events: JiraTrailEvent[]; // newest first
}

export interface ReportsPayload {
  completedWork: CompletedWorkReport;
  throughput: ThroughputReport;
  statusSnapshot: StatusSnapshotReport;
  jiraTrail: JiraTrailReport;
}
```

- [ ] **Step 2: Write the failing stats tests**

Create `src/lib/reports/stats.test.ts`:

```ts
/**
 * Pure unit tests for the report math helpers — no database.
 */

import { describe, it, expect } from "vitest";
import {
  round2,
  mean,
  median,
  cycleTimeDays,
  isoWeekStartUtc,
  buildWeeklyBuckets,
} from "./stats";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(3.14159)).toBe(3.14);
    expect(round2(2.005)).toBe(2.01);
    expect(round2(5)).toBe(5);
  });
});

describe("mean", () => {
  it("returns null for an empty list", () => {
    expect(mean([])).toBeNull();
  });

  it("averages and rounds", () => {
    expect(mean([1, 2, 4])).toBe(2.33);
  });
});

describe("median", () => {
  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });

  it("returns the middle value for an odd count", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("returns the mean of the middle two for an even count", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe("cycleTimeDays", () => {
  it("returns fractional days rounded to 2 decimals", () => {
    const created = new Date("2026-07-01T00:00:00.000Z");
    const completed = new Date("2026-07-02T12:00:00.000Z");
    expect(cycleTimeDays(created, completed)).toBe(1.5);
  });
});

describe("isoWeekStartUtc", () => {
  it("maps a Wednesday to the preceding Monday", () => {
    // 2026-07-01 is a Wednesday
    expect(isoWeekStartUtc(new Date("2026-07-01T15:30:00.000Z"))).toBe("2026-06-29");
  });

  it("maps a Monday to itself", () => {
    expect(isoWeekStartUtc(new Date("2026-06-29T00:00:00.000Z"))).toBe("2026-06-29");
  });

  it("maps a Sunday to the Monday six days earlier", () => {
    // 2026-07-05 is a Sunday
    expect(isoWeekStartUtc(new Date("2026-07-05T23:59:59.000Z"))).toBe("2026-06-29");
  });
});

describe("buildWeeklyBuckets", () => {
  it("returns an empty array for no cards", () => {
    expect(buildWeeklyBuckets([])).toEqual([]);
  });

  it("groups completions into Monday-start weeks with cycle stats", () => {
    const buckets = buildWeeklyBuckets([
      {
        createdAt: new Date("2026-06-29T00:00:00.000Z"),
        completedAt: new Date("2026-06-30T00:00:00.000Z"), // week 2026-06-29, cycle 1d
      },
      {
        createdAt: new Date("2026-06-28T00:00:00.000Z"),
        completedAt: new Date("2026-07-01T00:00:00.000Z"), // week 2026-06-29, cycle 3d
      },
    ]);
    expect(buckets).toEqual([
      {
        weekStart: "2026-06-29",
        completedCount: 2,
        avgCycleTimeDays: 2,
        medianCycleTimeDays: 2,
      },
    ]);
  });

  it("fills zero-completion weeks between the first and last bucket", () => {
    const buckets = buildWeeklyBuckets([
      {
        createdAt: new Date("2026-06-15T00:00:00.000Z"),
        completedAt: new Date("2026-06-16T00:00:00.000Z"), // week 2026-06-15
      },
      {
        createdAt: new Date("2026-06-29T00:00:00.000Z"),
        completedAt: new Date("2026-06-30T00:00:00.000Z"), // week 2026-06-29
      },
    ]);
    expect(buckets.map((b) => b.weekStart)).toEqual([
      "2026-06-15",
      "2026-06-22",
      "2026-06-29",
    ]);
    expect(buckets[1]).toEqual({
      weekStart: "2026-06-22",
      completedCount: 0,
      avgCycleTimeDays: null,
      medianCycleTimeDays: null,
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/reports/stats.test.ts`
Expected: FAIL — `Cannot find module './stats'` (or equivalent).

- [ ] **Step 4: Write the stats implementation**

Create `src/lib/reports/stats.ts`:

```ts
/**
 * Pure math helpers for the report layer — no database access.
 * Cycle times are fractional days rounded to 2 decimals; weekly buckets are
 * Monday-start ISO weeks in UTC.
 */

import type { WeeklyBucket } from "./types";

const MS_PER_DAY = 86_400_000;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

export function cycleTimeDays(createdAt: Date, completedAt: Date): number {
  return round2((completedAt.getTime() - createdAt.getTime()) / MS_PER_DAY);
}

/** Monday-start ISO week (UTC) containing `date`, as YYYY-MM-DD. */
export function isoWeekStartUtc(date: Date): string {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - daysSinceMonday);
  return day.toISOString().slice(0, 10);
}

/**
 * Buckets completed cards into Monday-start UTC weeks. Weeks with zero
 * completions between the first and last bucket are included so charts
 * don't skip gaps.
 */
export function buildWeeklyBuckets(
  cards: { createdAt: Date; completedAt: Date }[]
): WeeklyBucket[] {
  if (cards.length === 0) return [];

  const cycleTimesByWeek = new Map<string, number[]>();
  for (const card of cards) {
    const week = isoWeekStartUtc(card.completedAt);
    const cycleTimes = cycleTimesByWeek.get(week) ?? [];
    cycleTimes.push(cycleTimeDays(card.createdAt, card.completedAt));
    cycleTimesByWeek.set(week, cycleTimes);
  }

  const weeks = [...cycleTimesByWeek.keys()].sort();
  const first = new Date(`${weeks[0]}T00:00:00.000Z`);
  const last = new Date(`${weeks[weeks.length - 1]}T00:00:00.000Z`);

  const buckets: WeeklyBucket[] = [];
  for (
    let cursor = first;
    cursor.getTime() <= last.getTime();
    cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY)
  ) {
    const weekStart = cursor.toISOString().slice(0, 10);
    const cycleTimes = cycleTimesByWeek.get(weekStart) ?? [];
    buckets.push({
      weekStart,
      completedCount: cycleTimes.length,
      avgCycleTimeDays: mean(cycleTimes),
      medianCycleTimeDays: median(cycleTimes),
    });
  }
  return buckets;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/reports/stats.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/reports/types.ts src/lib/reports/stats.ts src/lib/reports/stats.test.ts
git commit -m "feat: add report DTOs and pure stats helpers"
```

---

### Task 2: getCompletedWork and getStatusSnapshot queries

**Files:**
- Create: `src/lib/reports/completedWork.ts`
- Create: `src/lib/reports/snapshot.ts`
- Test: `src/lib/reports/completedWork.test.ts`
- Test: `src/lib/reports/snapshot.test.ts`

**Interfaces:**
- Consumes: `ReportFilters`, `CompletedWorkReport`, `CompletedStoryGroup`, `StatusSnapshotReport`, `SnapshotStoryRow` from `./types`; `prisma` from `@/lib/prisma`; `Column` from `@/lib/types`.
- Produces (used by Task 4):
  - `getCompletedWork(filters: ReportFilters, prismaClient?: PrismaClient): Promise<CompletedWorkReport>`
  - `getStatusSnapshot(filters: ReportFilters, prismaClient?: PrismaClient): Promise<StatusSnapshotReport>`

Both follow the `importDedup.ts` convention: `prismaClient: PrismaClient = prisma` as the last parameter.

- [ ] **Step 1: Write the failing getCompletedWork tests**

Create `src/lib/reports/completedWork.test.ts`. Test data uses unique keys and try/finally cleanup because Story/WorkUnit are shared with concurrently-running test files:

```ts
/**
 * Integration tests for getCompletedWork against the test database.
 * Completed = completedAt in range; archived cards INCLUDED (Move-to-QA
 * archiving does not erase completion).
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCompletedWork } from "./completedWork";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory(jiraKey: string, projectId?: string) {
  return prisma.story.create({
    data: {
      jiraKey,
      jiraId: `id-${jiraKey}`,
      projectKey: "RPT",
      summary: `Story ${jiraKey}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${jiraKey}`,
      lastSyncedAt: new Date(),
      ...(projectId ? { projectId } : {}),
    },
  });
}

describe("getCompletedWork", () => {
  it("returns an empty report when nothing is completed in range", async () => {
    const key = uniqueKey("RPT-CW-EMPTY");
    const story = await createStory(key);
    try {
      await prisma.workUnit.create({
        data: { storyId: story.id, title: "Open card", column: "todo", order: 0 },
      });
      // Scope to a project that doesn't exist so concurrent test data can't leak in.
      const report = await getCompletedWork({ projectId: "no-such-project" }, prisma);
      expect(report).toEqual({ stories: [], totalCards: 0, totalStories: 0 });
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("includes archived completed cards and groups by story, newest first", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports CW", type: "STANDALONE" },
    });
    const keyA = uniqueKey("RPT-CW-A");
    const keyB = uniqueKey("RPT-CW-B");
    const storyA = await createStory(keyA, project.id);
    const storyB = await createStory(keyB, project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: storyA.id,
          title: "Older archived card",
          column: "done",
          order: 0,
          completedAt: new Date("2026-07-01T10:00:00.000Z"),
          archivedAt: new Date("2026-07-02T10:00:00.000Z"),
          verificationOutcome: "passed",
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: storyB.id,
          title: "Newer active card",
          column: "done",
          order: 0,
          completedAt: new Date("2026-07-03T10:00:00.000Z"),
        },
      });

      const report = await getCompletedWork({ projectId: project.id }, prisma);

      expect(report.totalCards).toBe(2);
      expect(report.totalStories).toBe(2);
      // Stories ordered by latest completion desc: storyB first.
      expect(report.stories.map((s) => s.jiraKey)).toEqual([keyB, keyA]);
      expect(report.stories[1].cards[0]).toMatchObject({
        title: "Older archived card",
        completedAt: "2026-07-01T10:00:00.000Z",
        archivedAt: "2026-07-02T10:00:00.000Z",
        verificationOutcome: "passed",
      });
    } finally {
      await prisma.workUnit.deleteMany({
        where: { storyId: { in: [storyA.id, storyB.id] } },
      });
      await prisma.story.deleteMany({
        where: { id: { in: [storyA.id, storyB.id] } },
      });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("honors inclusive from/to boundaries", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports CW range", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-CW-RANGE");
    const story = await createStory(key, project.id);
    try {
      const boundary = new Date("2026-07-01T00:00:00.000Z");
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "On the boundary",
          column: "done",
          order: 0,
          completedAt: boundary,
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Before the range",
          column: "done",
          order: 1,
          completedAt: new Date("2026-06-30T23:59:59.000Z"),
        },
      });

      const report = await getCompletedWork(
        { projectId: project.id, from: boundary, to: boundary },
        prisma
      );

      expect(report.totalCards).toBe(1);
      expect(report.stories[0].cards[0].title).toBe("On the boundary");
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("filters by projectId through the story relation", async () => {
    const projectA = await prisma.project.create({
      data: { name: "Reports CW proj A", type: "STANDALONE" },
    });
    const projectB = await prisma.project.create({
      data: { name: "Reports CW proj B", type: "STANDALONE" },
    });
    const keyA = uniqueKey("RPT-CW-PA");
    const keyB = uniqueKey("RPT-CW-PB");
    const storyA = await createStory(keyA, projectA.id);
    const storyB = await createStory(keyB, projectB.id);
    try {
      const completedAt = new Date("2026-07-01T10:00:00.000Z");
      await prisma.workUnit.create({
        data: { storyId: storyA.id, title: "A card", column: "done", order: 0, completedAt },
      });
      await prisma.workUnit.create({
        data: { storyId: storyB.id, title: "B card", column: "done", order: 0, completedAt },
      });

      const report = await getCompletedWork({ projectId: projectA.id }, prisma);

      expect(report.stories.map((s) => s.jiraKey)).toEqual([keyA]);
    } finally {
      await prisma.workUnit.deleteMany({
        where: { storyId: { in: [storyA.id, storyB.id] } },
      });
      await prisma.story.deleteMany({
        where: { id: { in: [storyA.id, storyB.id] } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: [projectA.id, projectB.id] } },
      });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/reports/completedWork.test.ts`
Expected: FAIL — `Cannot find module './completedWork'`.

- [ ] **Step 3: Implement getCompletedWork**

Create `src/lib/reports/completedWork.ts`:

```ts
/**
 * Completed-work history report: work units with completedAt in range,
 * INCLUDING archived cards (Move-to-QA archiving does not erase completion),
 * grouped by story, newest completion first.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CompletedStoryGroup,
  CompletedWorkReport,
  ReportFilters,
} from "./types";

export async function getCompletedWork(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<CompletedWorkReport> {
  const workUnits = await prismaClient.workUnit.findMany({
    where: {
      completedAt: {
        not: null,
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
      ...(filters.projectId ? { story: { projectId: filters.projectId } } : {}),
    },
    include: {
      story: {
        select: { id: true, jiraKey: true, summary: true, jiraStatus: true },
      },
    },
    orderBy: { completedAt: "desc" },
  });

  // The list is completedAt-desc, so a story's first appearance is its latest
  // completion — Map insertion order gives "stories by latest completion desc"
  // and cards within a story arrive already sorted desc.
  const groups = new Map<string, CompletedStoryGroup>();
  for (const unit of workUnits) {
    let group = groups.get(unit.story.id);
    if (!group) {
      group = {
        jiraKey: unit.story.jiraKey,
        summary: unit.story.summary,
        jiraStatus: unit.story.jiraStatus,
        cards: [],
      };
      groups.set(unit.story.id, group);
    }
    group.cards.push({
      id: unit.id,
      title: unit.title,
      subNumber: unit.subNumber,
      completedAt: (unit.completedAt as Date).toISOString(),
      archivedAt: unit.archivedAt?.toISOString() ?? null,
      verificationOutcome: unit.verificationOutcome as "passed" | "failed" | null,
    });
  }

  return {
    stories: [...groups.values()],
    totalCards: workUnits.length,
    totalStories: groups.size,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/reports/completedWork.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing getStatusSnapshot tests**

Create `src/lib/reports/snapshot.test.ts`:

```ts
/**
 * Integration tests for getStatusSnapshot against the test database.
 * Snapshot covers ACTIVE (archivedAt: null) cards only and ignores from/to.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { getStatusSnapshot } from "./snapshot";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory(jiraKey: string, projectId: string) {
  return prisma.story.create({
    data: {
      jiraKey,
      jiraId: `id-${jiraKey}`,
      projectKey: "RPT",
      summary: `Story ${jiraKey}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${jiraKey}`,
      lastSyncedAt: new Date(),
      projectId,
    },
  });
}

describe("getStatusSnapshot", () => {
  it("counts active cards per column, excludes archived, and omits empty stories", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports snapshot", type: "STANDALONE" },
    });
    const keyActive = uniqueKey("RPT-SNAP-A");
    const keyArchivedOnly = uniqueKey("RPT-SNAP-B");
    const storyActive = await createStory(keyActive, project.id);
    const storyArchivedOnly = await createStory(keyArchivedOnly, project.id);
    try {
      await prisma.workUnit.create({
        data: { storyId: storyActive.id, title: "Todo card", column: "todo", order: 0 },
      });
      await prisma.workUnit.create({
        data: {
          storyId: storyActive.id,
          title: "In progress card",
          column: "in_progress",
          order: 1,
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: storyActive.id,
          title: "Archived done card",
          column: "done",
          order: 2,
          completedAt: new Date(),
          archivedAt: new Date(),
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: storyArchivedOnly.id,
          title: "Only archived",
          column: "done",
          order: 0,
          completedAt: new Date(),
          archivedAt: new Date(),
        },
      });

      const report = await getStatusSnapshot({ projectId: project.id }, prisma);

      expect(report.stories.map((s) => s.jiraKey)).toEqual([keyActive]);
      expect(report.stories[0].columnCounts).toEqual({
        todo: 1,
        in_progress: 1,
        code_review: 0,
        done: 0,
      });
      expect(report.columnTotals).toEqual({
        todo: 1,
        in_progress: 1,
        code_review: 0,
        done: 0,
      });
    } finally {
      await prisma.workUnit.deleteMany({
        where: { storyId: { in: [storyActive.id, storyArchivedOnly.id] } },
      });
      await prisma.story.deleteMany({
        where: { id: { in: [storyActive.id, storyArchivedOnly.id] } },
      });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("counts awaiting-verification and failed-verification active cards", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports snapshot verif", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-SNAP-V");
    const story = await createStory(key, project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Awaiting verification",
          column: "code_review",
          order: 0,
          verificationRequestedAt: new Date(),
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Verified (failed)",
          column: "code_review",
          order: 1,
          verificationRequestedAt: new Date(),
          verifiedAt: new Date(),
          verificationOutcome: "failed",
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Verified (passed)",
          column: "done",
          order: 2,
          verificationRequestedAt: new Date(),
          verifiedAt: new Date(),
          verificationOutcome: "passed",
        },
      });

      const report = await getStatusSnapshot({ projectId: project.id }, prisma);

      expect(report.awaitingVerification).toBe(1);
      expect(report.failedVerification).toBe(1);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("orders stories by jiraKey", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports snapshot order", type: "STANDALONE" },
    });
    // Fixed suffixes keep the relative order deterministic.
    const base = `RPT-SNAP-ORD-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const keyZ = `${base}-Z`;
    const keyA = `${base}-A`;
    const storyZ = await createStory(keyZ, project.id);
    const storyA = await createStory(keyA, project.id);
    try {
      await prisma.workUnit.create({
        data: { storyId: storyZ.id, title: "Z card", column: "todo", order: 0 },
      });
      await prisma.workUnit.create({
        data: { storyId: storyA.id, title: "A card", column: "todo", order: 0 },
      });

      const report = await getStatusSnapshot({ projectId: project.id }, prisma);

      expect(report.stories.map((s) => s.jiraKey)).toEqual([keyA, keyZ]);
    } finally {
      await prisma.workUnit.deleteMany({
        where: { storyId: { in: [storyZ.id, storyA.id] } },
      });
      await prisma.story.deleteMany({
        where: { id: { in: [storyZ.id, storyA.id] } },
      });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/lib/reports/snapshot.test.ts`
Expected: FAIL — `Cannot find module './snapshot'`.

- [ ] **Step 7: Implement getStatusSnapshot**

Create `src/lib/reports/snapshot.ts`:

```ts
/**
 * Current status snapshot: active (archivedAt: null) cards only, counted per
 * column per story, plus verification-state tallies. Ignores from/to — the
 * snapshot is "right now" by definition — but honors projectId.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Column } from "@/lib/types";
import type {
  ReportFilters,
  SnapshotStoryRow,
  StatusSnapshotReport,
} from "./types";

function emptyColumnCounts(): Record<Column, number> {
  return { todo: 0, in_progress: 0, code_review: 0, done: 0 };
}

export async function getStatusSnapshot(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<StatusSnapshotReport> {
  const workUnits = await prismaClient.workUnit.findMany({
    where: {
      archivedAt: null,
      ...(filters.projectId ? { story: { projectId: filters.projectId } } : {}),
    },
    include: {
      story: {
        select: { id: true, jiraKey: true, summary: true, jiraStatus: true },
      },
    },
  });

  const stories = new Map<string, SnapshotStoryRow>();
  const columnTotals = emptyColumnCounts();
  let awaitingVerification = 0;
  let failedVerification = 0;

  for (const unit of workUnits) {
    let row = stories.get(unit.story.id);
    if (!row) {
      row = {
        jiraKey: unit.story.jiraKey,
        summary: unit.story.summary,
        jiraStatus: unit.story.jiraStatus,
        columnCounts: emptyColumnCounts(),
      };
      stories.set(unit.story.id, row);
    }
    const column = unit.column as Column;
    row.columnCounts[column] += 1;
    columnTotals[column] += 1;

    if (unit.verificationRequestedAt && !unit.verifiedAt) {
      awaitingVerification += 1;
    }
    if (unit.verificationOutcome === "failed") {
      failedVerification += 1;
    }
  }

  return {
    stories: [...stories.values()].sort((a, b) =>
      a.jiraKey.localeCompare(b.jiraKey)
    ),
    columnTotals,
    awaitingVerification,
    failedVerification,
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/lib/reports/snapshot.test.ts src/lib/reports/completedWork.test.ts`
Expected: PASS (both files).

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/reports/completedWork.ts src/lib/reports/completedWork.test.ts src/lib/reports/snapshot.ts src/lib/reports/snapshot.test.ts
git commit -m "feat: add completed-work and status-snapshot report queries"
```

---

### Task 3: getThroughput and getJiraTrail queries

**Files:**
- Create: `src/lib/reports/throughput.ts`
- Create: `src/lib/reports/jiraTrail.ts`
- Test: `src/lib/reports/throughput.test.ts`
- Test: `src/lib/reports/jiraTrail.test.ts`

**Interfaces:**
- Consumes: `ReportFilters`, `ThroughputReport`, `JiraTrailReport`, `JiraTrailEvent` from `./types`; `buildWeeklyBuckets`, `cycleTimeDays`, `mean`, `median`, `round2` from `./stats` (Task 1).
- Produces (used by Task 4):
  - `getThroughput(filters: ReportFilters, prismaClient?: PrismaClient): Promise<ThroughputReport>`
  - `getJiraTrail(filters: ReportFilters, prismaClient?: PrismaClient): Promise<JiraTrailReport>`

- [ ] **Step 1: Write the failing getThroughput tests**

Create `src/lib/reports/throughput.test.ts`:

```ts
/**
 * Integration tests for getThroughput against the test database.
 * Uses completedAt-in-range cards (archived included); math is covered by
 * stats.test.ts — these tests exercise the query + wiring.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { getThroughput } from "./throughput";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory(jiraKey: string, projectId: string) {
  return prisma.story.create({
    data: {
      jiraKey,
      jiraId: `id-${jiraKey}`,
      projectKey: "RPT",
      summary: `Story ${jiraKey}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${jiraKey}`,
      lastSyncedAt: new Date(),
      projectId,
    },
  });
}

describe("getThroughput", () => {
  it("returns an empty report when nothing is completed", async () => {
    const report = await getThroughput({ projectId: "no-such-project" }, prisma);
    expect(report).toEqual({
      weeks: [],
      totalCompleted: 0,
      avgCycleTimeDays: null,
      medianCycleTimeDays: null,
      avgCardsPerWeek: null,
    });
  });

  it("buckets completions weekly and computes cycle stats (archived included)", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports throughput", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-TP");
    const story = await createStory(key, project.id);
    try {
      // Week of 2026-06-29: two cards, cycle times 1d and 3d.
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "One-day card",
          column: "done",
          order: 0,
          createdAt: new Date("2026-06-29T00:00:00.000Z"),
          completedAt: new Date("2026-06-30T00:00:00.000Z"),
          archivedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Three-day card",
          column: "done",
          order: 1,
          createdAt: new Date("2026-06-28T00:00:00.000Z"),
          completedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      });

      const report = await getThroughput({ projectId: project.id }, prisma);

      expect(report.totalCompleted).toBe(2);
      expect(report.weeks).toEqual([
        {
          weekStart: "2026-06-29",
          completedCount: 2,
          avgCycleTimeDays: 2,
          medianCycleTimeDays: 2,
        },
      ]);
      expect(report.avgCycleTimeDays).toBe(2);
      expect(report.medianCycleTimeDays).toBe(2);
      expect(report.avgCardsPerWeek).toBe(2);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("applies the from/to range to completedAt", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports throughput range", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-TP-RANGE");
    const story = await createStory(key, project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "In range",
          column: "done",
          order: 0,
          createdAt: new Date("2026-06-30T00:00:00.000Z"),
          completedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Out of range",
          column: "done",
          order: 1,
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          completedAt: new Date("2026-06-02T00:00:00.000Z"),
        },
      });

      const report = await getThroughput(
        {
          projectId: project.id,
          from: new Date("2026-06-29T00:00:00.000Z"),
          to: new Date("2026-07-05T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.totalCompleted).toBe(1);
      expect(report.weeks.map((w) => w.weekStart)).toEqual(["2026-06-29"]);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/reports/throughput.test.ts`
Expected: FAIL — `Cannot find module './throughput'`.

- [ ] **Step 3: Implement getThroughput**

Create `src/lib/reports/throughput.ts`:

```ts
/**
 * Throughput & cycle-time report over completed work units (archived
 * included). Cycle time = completedAt - createdAt in fractional days; weekly
 * buckets are Monday-start UTC ISO weeks (see stats.ts).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildWeeklyBuckets, cycleTimeDays, mean, median, round2 } from "./stats";
import type { ReportFilters, ThroughputReport } from "./types";

export async function getThroughput(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<ThroughputReport> {
  const completed = await prismaClient.workUnit.findMany({
    where: {
      completedAt: {
        not: null,
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
      ...(filters.projectId ? { story: { projectId: filters.projectId } } : {}),
    },
    select: { createdAt: true, completedAt: true },
  });

  const cards = completed.map((unit) => ({
    createdAt: unit.createdAt,
    completedAt: unit.completedAt as Date,
  }));
  const weeks = buildWeeklyBuckets(cards);
  const cycleTimes = cards.map((card) =>
    cycleTimeDays(card.createdAt, card.completedAt)
  );

  return {
    weeks,
    totalCompleted: cards.length,
    avgCycleTimeDays: mean(cycleTimes),
    medianCycleTimeDays: median(cycleTimes),
    avgCardsPerWeek:
      weeks.length > 0 ? round2(cards.length / weeks.length) : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/reports/throughput.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing getJiraTrail tests**

Create `src/lib/reports/jiraTrail.test.ts`:

```ts
/**
 * Integration tests for getJiraTrail against the test database.
 * Events derive from existing timestamps (no event table): Move-to-QA
 * reports, verification outcomes, story completion comments. Archived cards
 * are included — Move-to-QA archives the cards it reports on.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { getJiraTrail } from "./jiraTrail";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

describe("getJiraTrail", () => {
  it("returns an empty report when there are no events", async () => {
    const report = await getJiraTrail({ projectId: "no-such-project" }, prisma);
    expect(report).toEqual({ events: [] });
  });

  it("merges all three event types, newest first, including archived cards", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports trail", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-TRAIL");
    const story = await prisma.story.create({
      data: {
        jiraKey: key,
        jiraId: `id-${key}`,
        projectKey: "RPT",
        summary: `Story ${key}`,
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/${key}`,
        lastSyncedAt: new Date(),
        completionCommentPostedAt: new Date("2026-07-03T10:00:00.000Z"),
        projectId: project.id,
      },
    });
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "QA-reported card",
          column: "done",
          order: 0,
          movedToQaReportedAt: new Date("2026-07-01T10:00:00.000Z"),
          archivedAt: new Date("2026-07-01T10:00:00.000Z"),
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Verified card",
          column: "code_review",
          order: 1,
          verifiedAt: new Date("2026-07-02T10:00:00.000Z"),
          verificationOutcome: "passed",
        },
      });

      const report = await getJiraTrail({ projectId: project.id }, prisma);

      expect(report.events).toEqual([
        {
          type: "story_completed",
          jiraKey: key,
          detail: `Story ${key}`,
          timestamp: "2026-07-03T10:00:00.000Z",
        },
        {
          type: "verification",
          jiraKey: key,
          detail: "Verified card",
          timestamp: "2026-07-02T10:00:00.000Z",
          outcome: "passed",
        },
        {
          type: "moved_to_qa",
          jiraKey: key,
          detail: "QA-reported card",
          timestamp: "2026-07-01T10:00:00.000Z",
        },
      ]);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("applies the date range to each event's own timestamp", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports trail range", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-TRAIL-RANGE");
    const story = await prisma.story.create({
      data: {
        jiraKey: key,
        jiraId: `id-${key}`,
        projectKey: "RPT",
        summary: `Story ${key}`,
        jiraStatus: "In Progress",
        url: `https://example.atlassian.net/browse/${key}`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Old QA report",
          column: "done",
          order: 0,
          movedToQaReportedAt: new Date("2026-06-01T10:00:00.000Z"),
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Recent QA report",
          column: "done",
          order: 1,
          movedToQaReportedAt: new Date("2026-07-01T10:00:00.000Z"),
        },
      });

      const report = await getJiraTrail(
        { projectId: project.id, from: new Date("2026-06-15T00:00:00.000Z") },
        prisma
      );

      expect(report.events.map((e) => e.detail)).toEqual(["Recent QA report"]);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/lib/reports/jiraTrail.test.ts`
Expected: FAIL — `Cannot find module './jiraTrail'`.

- [ ] **Step 7: Implement getJiraTrail**

Create `src/lib/reports/jiraTrail.ts`:

```ts
/**
 * JIRA reporting trail: a chronological event list (newest first) derived
 * from existing timestamps — Move-to-QA reports, verification outcomes, and
 * story completion comments. No new event table; archived cards included
 * (Move-to-QA archives the cards it reports on).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { JiraTrailEvent, JiraTrailReport, ReportFilters } from "./types";

export async function getJiraTrail(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<JiraTrailReport> {
  const range = {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lte: filters.to } : {}),
  };
  const workUnitProjectScope = filters.projectId
    ? { story: { projectId: filters.projectId } }
    : {};

  const [qaReports, verifications, completedStories] = await Promise.all([
    prismaClient.workUnit.findMany({
      where: { movedToQaReportedAt: { not: null, ...range }, ...workUnitProjectScope },
      select: {
        title: true,
        movedToQaReportedAt: true,
        story: { select: { jiraKey: true } },
      },
    }),
    prismaClient.workUnit.findMany({
      where: { verifiedAt: { not: null, ...range }, ...workUnitProjectScope },
      select: {
        title: true,
        verifiedAt: true,
        verificationOutcome: true,
        story: { select: { jiraKey: true } },
      },
    }),
    prismaClient.story.findMany({
      where: {
        completionCommentPostedAt: { not: null, ...range },
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
      },
      select: { jiraKey: true, summary: true, completionCommentPostedAt: true },
    }),
  ]);

  const events: JiraTrailEvent[] = [
    ...qaReports.map((unit) => ({
      type: "moved_to_qa" as const,
      jiraKey: unit.story.jiraKey,
      detail: unit.title,
      timestamp: (unit.movedToQaReportedAt as Date).toISOString(),
    })),
    ...verifications.map((unit) => ({
      type: "verification" as const,
      jiraKey: unit.story.jiraKey,
      detail: unit.title,
      timestamp: (unit.verifiedAt as Date).toISOString(),
      ...(unit.verificationOutcome
        ? { outcome: unit.verificationOutcome as "passed" | "failed" }
        : {}),
    })),
    ...completedStories.map((story) => ({
      type: "story_completed" as const,
      jiraKey: story.jiraKey,
      detail: story.summary,
      timestamp: (story.completionCommentPostedAt as Date).toISOString(),
    })),
  ];

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { events };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/lib/reports/jiraTrail.test.ts src/lib/reports/throughput.test.ts`
Expected: PASS (both files).

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/reports/throughput.ts src/lib/reports/throughput.test.ts src/lib/reports/jiraTrail.ts src/lib/reports/jiraTrail.test.ts
git commit -m "feat: add throughput and jira-trail report queries"
```

---

### Task 4: GET /api/reports route

**Files:**
- Create: `src/app/api/reports/route.ts`
- Test: `src/app/api/reports/route.test.ts`

**Interfaces:**
- Consumes: `getCompletedWork` (Task 2), `getStatusSnapshot` (Task 2), `getThroughput` (Task 3), `getJiraTrail` (Task 3), `ReportFilters`/`ReportsPayload` from `@/lib/reports/types`.
- Produces (used by Tasks 6 and 7): `GET /api/reports?projectId=&from=&to=` returning JSON `{ completedWork, throughput, statusSnapshot, jiraTrail }` (a `ReportsPayload`). Invalid `from`/`to` or `from > to` → 400 `{ error: string }`. Unknown `projectId` → 200 with empty sections.

- [ ] **Step 1: Write the failing route tests**

Create `src/app/api/reports/route.test.ts`:

```ts
/**
 * Integration tests for GET /api/reports against the test database.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

describe("GET /api/reports", () => {
  it("returns all four sections", async () => {
    const req = new Request("http://localhost:3000/api/reports");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("completedWork.stories");
    expect(data).toHaveProperty("throughput.weeks");
    expect(data).toHaveProperty("statusSnapshot.columnTotals");
    expect(data).toHaveProperty("jiraTrail.events");
  });

  it("returns 400 for an invalid from date", async () => {
    const req = new Request("http://localhost:3000/api/reports?from=not-a-date");
    const res = await GET(req as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("from");
  });

  it("returns 400 for an invalid to date", async () => {
    const req = new Request("http://localhost:3000/api/reports?to=bogus");
    const res = await GET(req as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("to");
  });

  it("returns 400 when from is after to", async () => {
    const req = new Request(
      "http://localhost:3000/api/reports?from=2026-07-05&to=2026-07-01"
    );
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  it("returns empty sections for an unknown projectId", async () => {
    const req = new Request(
      "http://localhost:3000/api/reports?projectId=no-such-project"
    );
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.completedWork.totalCards).toBe(0);
    expect(data.statusSnapshot.stories).toEqual([]);
    expect(data.jiraTrail.events).toEqual([]);
  });

  it("passes projectId and range through to the queries", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports route", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-ROUTE");
    const story = await prisma.story.create({
      data: {
        jiraKey: key,
        jiraId: `id-${key}`,
        projectKey: "RPT",
        summary: `Story ${key}`,
        jiraStatus: "In Progress",
        url: `https://example.atlassian.net/browse/${key}`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Completed card",
          column: "done",
          order: 0,
          createdAt: new Date("2026-06-30T00:00:00.000Z"),
          completedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      });

      const req = new Request(
        `http://localhost:3000/api/reports?projectId=${project.id}&from=2026-06-29T00:00:00.000Z&to=2026-07-05T23:59:59.000Z`
      );
      const res = await GET(req as never);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.completedWork.totalCards).toBe(1);
      expect(data.completedWork.stories[0].jiraKey).toBe(key);
      expect(data.throughput.totalCompleted).toBe(1);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/reports/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/reports/route.ts`:

```ts
/**
 * GET /api/reports - All four report sections in one payload.
 *
 * Query params: projectId? (omitted = all projects), from?/to? (ISO date
 * strings, inclusive). Invalid dates or from > to -> 400. Unknown projectId
 * returns empty sections (consistent with existing routes' tolerance).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCompletedWork } from "@/lib/reports/completedWork";
import { getJiraTrail } from "@/lib/reports/jiraTrail";
import { getStatusSnapshot } from "@/lib/reports/snapshot";
import { getThroughput } from "@/lib/reports/throughput";
import type { ReportFilters } from "@/lib/reports/types";

function parseDateParam(
  value: string | null,
  name: string
): { date?: Date; error?: string } {
  if (value === null) return {};
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: `Invalid ${name} date: ${value}` };
  }
  return { date };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const fromResult = parseDateParam(searchParams.get("from"), "from");
    if (fromResult.error) {
      return NextResponse.json({ error: fromResult.error }, { status: 400 });
    }
    const toResult = parseDateParam(searchParams.get("to"), "to");
    if (toResult.error) {
      return NextResponse.json({ error: toResult.error }, { status: 400 });
    }
    if (fromResult.date && toResult.date && fromResult.date > toResult.date) {
      return NextResponse.json(
        { error: "from must not be after to" },
        { status: 400 }
      );
    }

    const filters: ReportFilters = {
      projectId: searchParams.get("projectId") ?? undefined,
      from: fromResult.date,
      to: toResult.date,
    };

    const [completedWork, throughput, statusSnapshot, jiraTrail] =
      await Promise.all([
        getCompletedWork(filters),
        getThroughput(filters),
        getStatusSnapshot(filters),
        getJiraTrail(filters),
      ]);

    return NextResponse.json({
      completedWork,
      throughput,
      statusSnapshot,
      jiraTrail,
    });
  } catch (error) {
    console.error("Error building reports:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/reports/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/app/api/reports/route.ts src/app/api/reports/route.test.ts
git commit -m "feat: add GET /api/reports route returning all four sections"
```

---

### Task 5: SVG chart components

**Files:**
- Create: `src/components/reports/WeeklyBarChart.tsx`
- Create: `src/components/reports/TrendLineChart.tsx`
- Test: `src/components/reports/WeeklyBarChart.test.tsx`
- Test: `src/components/reports/TrendLineChart.test.tsx`

**Interfaces:**
- Consumes: nothing project-specific (pure presentational components).
- Produces (used by Task 6):
  - `WeeklyBarChart({ data, ariaLabel }: { data: { label: string; value: number }[]; ariaLabel: string })` — returns `null` for empty data.
  - `TrendLineChart({ data, ariaLabel }: { data: { label: string; value: number | null }[]; ariaLabel: string })` — plots only non-null points (nulls are zero-completion weeks); returns `null` when no non-null points.

Both render a `<svg role="img" aria-label={ariaLabel}>` with `viewBox` scaling; bars carry `data-testid="bar"`, line points `data-testid="point"`. Labels render the `MM-DD` tail of the `YYYY-MM-DD` week label.

- [ ] **Step 1: Write the failing WeeklyBarChart tests**

Create `src/components/reports/WeeklyBarChart.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeeklyBarChart } from "./WeeklyBarChart";

const data = [
  { label: "2026-06-22", value: 3 },
  { label: "2026-06-29", value: 0 },
  { label: "2026-07-06", value: 5 },
];

describe("WeeklyBarChart", () => {
  it("renders one bar per datum", () => {
    const { container } = render(
      <WeeklyBarChart data={data} ariaLabel="Weekly throughput" />
    );
    expect(container.querySelectorAll('[data-testid="bar"]')).toHaveLength(3);
  });

  it("is exposed as a labelled image", () => {
    render(<WeeklyBarChart data={data} ariaLabel="Weekly throughput" />);
    expect(
      screen.getByRole("img", { name: "Weekly throughput" })
    ).toBeInTheDocument();
  });

  it("renders MM-DD axis labels and value labels", () => {
    const { container } = render(
      <WeeklyBarChart data={data} ariaLabel="Weekly throughput" />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("06-22");
    expect(text).toContain("07-06");
    expect(text).toContain("5");
  });

  it("renders nothing for empty data", () => {
    const { container } = render(
      <WeeklyBarChart data={[]} ariaLabel="Weekly throughput" />
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/reports/WeeklyBarChart.test.tsx`
Expected: FAIL — `Cannot find module './WeeklyBarChart'`.

- [ ] **Step 3: Implement WeeklyBarChart**

Create `src/components/reports/WeeklyBarChart.tsx`:

```tsx
/**
 * Minimal hand-rolled SVG bar chart for weekly counts — no charting
 * dependency by design (see the reporting-suite spec). Scales via viewBox;
 * colors use Tailwind fill classes so it follows the app theme.
 */

interface BarDatum {
  label: string; // YYYY-MM-DD week start
  value: number;
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = { top: 16, right: 8, bottom: 24, left: 8 };

export function WeeklyBarChart({
  data,
  ariaLabel,
}: {
  data: BarDatum[];
  ariaLabel: string;
}) {
  if (data.length === 0) return null;

  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = chartWidth / data.length;
  const barWidth = Math.min(slot * 0.7, 48);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full max-w-2xl"
    >
      {data.map((d, i) => {
        const barHeight = (d.value / max) * chartHeight;
        const xCenter = PADDING.left + i * slot + slot / 2;
        const y = PADDING.top + chartHeight - barHeight;
        return (
          <g key={d.label}>
            <rect
              data-testid="bar"
              x={xCenter - barWidth / 2}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={3}
              className="fill-blue-500"
            />
            <text
              x={xCenter}
              y={y - 4}
              textAnchor="middle"
              className="fill-current text-[10px]"
            >
              {d.value}
            </text>
            <text
              x={xCenter}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-current text-[10px]"
            >
              {d.label.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/reports/WeeklyBarChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing TrendLineChart tests**

Create `src/components/reports/TrendLineChart.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendLineChart } from "./TrendLineChart";

const data = [
  { label: "2026-06-22", value: 2.5 },
  { label: "2026-06-29", value: null }, // zero-completion week: no point
  { label: "2026-07-06", value: 4 },
];

describe("TrendLineChart", () => {
  it("renders one point per non-null datum and a connecting polyline", () => {
    const { container } = render(
      <TrendLineChart data={data} ariaLabel="Cycle time trend" />
    );
    expect(container.querySelectorAll('[data-testid="point"]')).toHaveLength(2);
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  it("is exposed as a labelled image", () => {
    render(<TrendLineChart data={data} ariaLabel="Cycle time trend" />);
    expect(
      screen.getByRole("img", { name: "Cycle time trend" })
    ).toBeInTheDocument();
  });

  it("renders MM-DD axis labels for every datum, null or not", () => {
    const { container } = render(
      <TrendLineChart data={data} ariaLabel="Cycle time trend" />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("06-22");
    expect(text).toContain("06-29");
    expect(text).toContain("07-06");
  });

  it("renders nothing when every value is null", () => {
    const { container } = render(
      <TrendLineChart
        data={[{ label: "2026-06-22", value: null }]}
        ariaLabel="Cycle time trend"
      />
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/components/reports/TrendLineChart.test.tsx`
Expected: FAIL — `Cannot find module './TrendLineChart'`.

- [ ] **Step 7: Implement TrendLineChart**

Create `src/components/reports/TrendLineChart.tsx`:

```tsx
/**
 * Minimal hand-rolled SVG line chart for weekly trends. Null values (weeks
 * with no completions) get an axis label but no point; the line connects the
 * non-null points in order.
 */

interface TrendDatum {
  label: string; // YYYY-MM-DD week start
  value: number | null;
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = { top: 16, right: 16, bottom: 24, left: 16 };

export function TrendLineChart({
  data,
  ariaLabel,
}: {
  data: TrendDatum[];
  ariaLabel: string;
}) {
  const points = data
    .map((d, index) => ({ ...d, index }))
    .filter((d): d is { label: string; value: number; index: number } =>
      d.value !== null
    );
  if (points.length === 0) return null;

  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(...points.map((p) => p.value), 1);
  const xAt = (index: number) =>
    data.length === 1
      ? PADDING.left + chartWidth / 2
      : PADDING.left + (index / (data.length - 1)) * chartWidth;
  const yAt = (value: number) =>
    PADDING.top + chartHeight - (value / max) * chartHeight;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full max-w-2xl"
    >
      <polyline
        points={points.map((p) => `${xAt(p.index)},${yAt(p.value)}`).join(" ")}
        className="fill-none stroke-purple-500"
        strokeWidth={2}
      />
      {points.map((p) => (
        <g key={p.label}>
          <circle
            data-testid="point"
            cx={xAt(p.index)}
            cy={yAt(p.value)}
            r={3.5}
            className="fill-purple-500"
          />
          <text
            x={xAt(p.index)}
            y={yAt(p.value) - 8}
            textAnchor="middle"
            className="fill-current text-[10px]"
          >
            {p.value}
          </text>
        </g>
      ))}
      {data.map((d, index) => (
        <text
          key={d.label}
          x={xAt(index)}
          y={HEIGHT - 8}
          textAnchor="middle"
          className="fill-current text-[10px]"
        >
          {d.label.slice(5)}
        </text>
      ))}
    </svg>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/components/reports/TrendLineChart.test.tsx src/components/reports/WeeklyBarChart.test.tsx`
Expected: PASS (both files).

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/components/reports/
git commit -m "feat: add hand-rolled SVG bar and trend-line chart components"
```

---

### Task 6: /reports page and nav link

**Files:**
- Create: `src/app/reports/page.tsx`
- Test: `src/app/reports/page.test.tsx`
- Modify: `src/components/TopNav.tsx` (add Reports to the `links` array, currently lines 16–19)

**Interfaces:**
- Consumes: `GET /api/reports` (Task 4), `GET /api/projects` (existing), `ReportsPayload` from `@/lib/reports/types`, `WeeklyBarChart`/`TrendLineChart` (Task 5), `ProjectWithStats` from `@/lib/types`, `COLUMNS` from `@/lib/columns`, `useTheme` from `@/hooks/useTheme`.
- Produces: the `/reports` route; nothing consumed by later tasks.

- [ ] **Step 1: Write the failing page tests**

Create `src/app/reports/page.test.tsx`:

```tsx
/**
 * Tests for the /reports page. fetch is stubbed: /api/projects returns the
 * project list for the selector, /api/reports returns a canned payload.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsPage from "./page";
import type { ReportsPayload } from "@/lib/reports/types";

const payload: ReportsPayload = {
  completedWork: {
    stories: [
      {
        jiraKey: "TEAM-1",
        summary: "First story",
        jiraStatus: "Code Revew",
        cards: [
          {
            id: "w1",
            title: "Ship the thing",
            subNumber: null,
            completedAt: "2026-07-01T10:00:00.000Z",
            archivedAt: null,
            verificationOutcome: "passed",
          },
        ],
      },
    ],
    totalCards: 1,
    totalStories: 1,
  },
  throughput: {
    weeks: [
      {
        weekStart: "2026-06-29",
        completedCount: 1,
        avgCycleTimeDays: 2.5,
        medianCycleTimeDays: 2.5,
      },
    ],
    totalCompleted: 1,
    avgCycleTimeDays: 2.5,
    medianCycleTimeDays: 2.5,
    avgCardsPerWeek: 1,
  },
  statusSnapshot: {
    stories: [
      {
        jiraKey: "TEAM-2",
        summary: "Active story",
        jiraStatus: "In Progress",
        columnCounts: { todo: 2, in_progress: 1, code_review: 0, done: 0 },
      },
    ],
    columnTotals: { todo: 2, in_progress: 1, code_review: 0, done: 0 },
    awaitingVerification: 1,
    failedVerification: 0,
  },
  jiraTrail: {
    events: [
      {
        type: "moved_to_qa",
        jiraKey: "TEAM-3",
        detail: "QA card",
        timestamp: "2026-07-02T09:00:00.000Z",
      },
    ],
  },
};

const projects = [
  {
    id: "p1",
    name: "TEAM Alliance",
    type: "JIRA",
    jiraProjectKey: "TEAM",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasApiToken: true,
    storyCount: 2,
    workUnitCount: 4,
  },
];

function okJson(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/projects")) return okJson(projects);
    if (url.includes("/api/reports")) return okJson(payload);
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReportsPage", () => {
  it("renders all four report sections from the payload", async () => {
    render(<ReportsPage />);

    expect(
      await screen.findByRole("heading", { name: /snapshot/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /throughput & cycle time/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /completed work/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /jira trail/i })
    ).toBeInTheDocument();

    // Section content spot-checks.
    expect(screen.getByText("Ship the thing")).toBeInTheDocument();
    expect(screen.getByText("Active story")).toBeInTheDocument();
    expect(screen.getByText("QA card")).toBeInTheDocument();
  });

  it("defaults to the 30-day range (sends a from param)", async () => {
    render(<ReportsPage />);
    await screen.findByRole("heading", { name: /snapshot/i });

    const reportCall = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes("/api/reports"));
    expect(reportCall).toContain("from=");
  });

  it("refetches without a from param when All time is selected", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);
    await screen.findByRole("heading", { name: /snapshot/i });

    await user.click(screen.getByRole("button", { name: "All time" }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes("/api/reports"));
      expect(urls.length).toBeGreaterThan(1);
      expect(urls[urls.length - 1]).not.toContain("from=");
    });
  });

  it("refetches with projectId when a project is selected", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);
    await screen.findByRole("heading", { name: /snapshot/i });

    await user.selectOptions(
      await screen.findByLabelText(/project/i),
      "p1"
    );

    await waitFor(() => {
      const urls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes("/api/reports"));
      expect(urls[urls.length - 1]).toContain("projectId=p1");
    });
  });

  it("shows an error state when the reports request fails", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/projects")) return okJson(projects);
      return Promise.resolve(new Response("nope", { status: 500 }));
    });

    render(<ReportsPage />);

    expect(await screen.findByText(/failed to load reports/i)).toBeInTheDocument();
  });

  it("shows empty states when there is no data", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/projects")) return okJson(projects);
      return okJson({
        completedWork: { stories: [], totalCards: 0, totalStories: 0 },
        throughput: {
          weeks: [],
          totalCompleted: 0,
          avgCycleTimeDays: null,
          medianCycleTimeDays: null,
          avgCardsPerWeek: null,
        },
        statusSnapshot: {
          stories: [],
          columnTotals: { todo: 0, in_progress: 0, code_review: 0, done: 0 },
          awaitingVerification: 0,
          failedVerification: 0,
        },
        jiraTrail: { events: [] },
      } satisfies ReportsPayload);
    });

    render(<ReportsPage />);

    expect(
      await screen.findByText(/no completed work in this range/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/no jira events in this range/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/reports/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 3: Implement the page**

Create `src/app/reports/page.tsx`:

```tsx
"use client";

/**
 * /reports — the reporting suite page. One fetch to GET /api/reports returns
 * all four sections; the project selector and date-range presets refetch.
 * All aggregation lives in src/lib/reports/ — this page only renders.
 */

import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { COLUMNS } from "@/lib/columns";
import { TrendLineChart } from "@/components/reports/TrendLineChart";
import { WeeklyBarChart } from "@/components/reports/WeeklyBarChart";
import type { ReportsPayload } from "@/lib/reports/types";
import type { ProjectWithStats } from "@/lib/types";

const MS_PER_DAY = 86_400_000;

const RANGE_PRESETS: { label: string; days: number | null }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: null },
];

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatDateTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

const EVENT_LABELS: Record<string, string> = {
  moved_to_qa: "Moved to QA",
  verification: "Verification",
  story_completed: "Story completed",
};

export default function ReportsPage() {
  const { isDark, mounted } = useTheme();
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [rangeDays, setRangeDays] = useState<number | null>(30);
  const [report, setReport] = useState<ReportsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dark = mounted && isDark;

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (rangeDays !== null) {
      params.set(
        "from",
        new Date(Date.now() - rangeDays * MS_PER_DAY).toISOString()
      );
    }
    const query = params.toString();

    fetch(`/api/reports${query ? `?${query}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((data: ReportsPayload) => {
        if (!cancelled) setReport(data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load reports.");
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, rangeDays]);

  const textClass = dark ? "text-ponder-dark-text" : "text-ponder-light-text";
  const mutedClass = dark
    ? "text-ponder-dark-text-muted"
    : "text-ponder-light-text-muted";
  const cardClass = dark
    ? "bg-ponder-dark-surface border-ponder-dark-border"
    : "bg-ponder-light-surface border-ponder-light-card-border";

  return (
    <main className={`mx-auto max-w-7xl px-6 py-8 ${textClass}`}>
      <h1 className="font-space-grotesk text-2xl font-bold">Reports</h1>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="report-project" className={`text-sm ${mutedClass}`}>
          Project
        </label>
        <select
          id="report-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${cardClass}`}
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1" role="group" aria-label="Date range">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setRangeDays(preset.days)}
              aria-pressed={rangeDays === preset.days}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                rangeDays === preset.days
                  ? "border-transparent bg-blue-600 text-white"
                  : cardClass
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-500">
          {error}
        </p>
      )}
      {!error && !report && <p className={`mt-6 text-sm ${mutedClass}`}>Loading…</p>}

      {!error && report && (
        <div className="mt-8 space-y-10">
          {/* 1. Snapshot */}
          <section aria-labelledby="snapshot-heading">
            <h2 id="snapshot-heading" className="font-space-grotesk text-lg font-bold">
              Snapshot
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {COLUMNS.map((column) => (
                <div key={column.key} className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                  <div className={`text-xs ${mutedClass}`}>{column.label}</div>
                  <div className="text-xl font-bold">
                    {report.statusSnapshot.columnTotals[column.key]}
                  </div>
                </div>
              ))}
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Awaiting verification</div>
                <div className="text-xl font-bold">
                  {report.statusSnapshot.awaitingVerification}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Failed verification</div>
                <div className="text-xl font-bold">
                  {report.statusSnapshot.failedVerification}
                </div>
              </div>
            </div>
            {report.statusSnapshot.stories.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>No active cards.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className={mutedClass}>
                      <th className="py-2 pr-4 font-semibold">Story</th>
                      <th className="py-2 pr-4 font-semibold">Status</th>
                      {COLUMNS.map((column) => (
                        <th key={column.key} className="py-2 pr-4 font-semibold">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.statusSnapshot.stories.map((story) => (
                      <tr key={story.jiraKey} className={`border-t ${cardClass}`}>
                        <td className="py-2 pr-4">
                          <span className="font-semibold">{story.jiraKey}</span>{" "}
                          {story.summary}
                        </td>
                        <td className="py-2 pr-4">{story.jiraStatus}</td>
                        {COLUMNS.map((column) => (
                          <td key={column.key} className="py-2 pr-4">
                            {story.columnCounts[column.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 2. Throughput & cycle time */}
          <section aria-labelledby="throughput-heading">
            <h2 id="throughput-heading" className="font-space-grotesk text-lg font-bold">
              Throughput &amp; cycle time
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Completed</div>
                <div className="text-xl font-bold">{report.throughput.totalCompleted}</div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Avg cycle time</div>
                <div className="text-xl font-bold">
                  {report.throughput.avgCycleTimeDays ?? "—"}
                  {report.throughput.avgCycleTimeDays !== null && "d"}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Median cycle time</div>
                <div className="text-xl font-bold">
                  {report.throughput.medianCycleTimeDays ?? "—"}
                  {report.throughput.medianCycleTimeDays !== null && "d"}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Cards / week</div>
                <div className="text-xl font-bold">
                  {report.throughput.avgCardsPerWeek ?? "—"}
                </div>
              </div>
            </div>
            {report.throughput.weeks.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No completed work in this range.
              </p>
            ) : (
              <div className="mt-4 space-y-6">
                <WeeklyBarChart
                  ariaLabel="Cards completed per week"
                  data={report.throughput.weeks.map((week) => ({
                    label: week.weekStart,
                    value: week.completedCount,
                  }))}
                />
                <TrendLineChart
                  ariaLabel="Average cycle time per week (days)"
                  data={report.throughput.weeks.map((week) => ({
                    label: week.weekStart,
                    value: week.avgCycleTimeDays,
                  }))}
                />
              </div>
            )}
          </section>

          {/* 3. Completed work */}
          <section aria-labelledby="completed-heading">
            <h2 id="completed-heading" className="font-space-grotesk text-lg font-bold">
              Completed work
            </h2>
            <p className={`mt-1 text-sm ${mutedClass}`}>
              {report.completedWork.totalCards} card(s) across{" "}
              {report.completedWork.totalStories} story(ies)
            </p>
            {report.completedWork.stories.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No completed work in this range.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className={mutedClass}>
                      <th className="py-2 pr-4 font-semibold">Card</th>
                      <th className="py-2 pr-4 font-semibold">Completed</th>
                      <th className="py-2 pr-4 font-semibold">Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.completedWork.stories.map((story) => (
                      <>
                        <tr key={story.jiraKey} className={`border-t ${cardClass}`}>
                          <td colSpan={3} className="py-2 pr-4 font-semibold">
                            {story.jiraKey}: {story.summary}
                          </td>
                        </tr>
                        {story.cards.map((card) => (
                          <tr key={card.id} className={`border-t ${cardClass}`}>
                            <td className="py-2 pl-6 pr-4">
                              {card.title}
                              {card.subNumber !== null && (
                                <span className={mutedClass}> #{card.subNumber}</span>
                              )}
                            </td>
                            <td className="py-2 pr-4">{formatDate(card.completedAt)}</td>
                            <td className="py-2 pr-4">
                              {card.verificationOutcome === "passed" && (
                                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                  passed
                                </span>
                              )}
                              {card.verificationOutcome === "failed" && (
                                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                                  failed
                                </span>
                              )}
                              {card.verificationOutcome === null && (
                                <span className={mutedClass}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 4. JIRA trail */}
          <section aria-labelledby="trail-heading">
            <h2 id="trail-heading" className="font-space-grotesk text-lg font-bold">
              JIRA trail
            </h2>
            {report.jiraTrail.events.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No JIRA events in this range.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className={mutedClass}>
                      <th className="py-2 pr-4 font-semibold">When</th>
                      <th className="py-2 pr-4 font-semibold">Event</th>
                      <th className="py-2 pr-4 font-semibold">Issue</th>
                      <th className="py-2 pr-4 font-semibold">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.jiraTrail.events.map((event) => (
                      <tr
                        key={`${event.type}-${event.jiraKey}-${event.timestamp}`}
                        className={`border-t ${cardClass}`}
                      >
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {formatDateTime(event.timestamp)}
                        </td>
                        <td className="py-2 pr-4">
                          {EVENT_LABELS[event.type] ?? event.type}
                          {event.outcome && ` (${event.outcome})`}
                        </td>
                        <td className="py-2 pr-4 font-semibold">{event.jiraKey}</td>
                        <td className="py-2 pr-4">{event.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Add the nav link**

In `src/components/TopNav.tsx`, change the `links` array (currently lines 16–19):

```tsx
  const links = [
    { href: "/projects", label: "Projects" },
    { href: "/board", label: "Board" },
    { href: "/reports", label: "Reports" },
  ];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/reports/page.test.tsx`
Expected: PASS.

Note: if React logs a key warning for the fragment inside the completed-work `tbody` map, replace the bare `<>` with `<Fragment key={story.jiraKey}>` (import `Fragment` from `"react"`) and drop the `key` from the story header `<tr>`.

- [ ] **Step 6: Typecheck, lint, and commit**

Run: `npx tsc --noEmit && npx next lint --dir src/app/reports --dir src/components 2>/dev/null || npx eslint src/app/reports src/components/reports src/components/TopNav.tsx`
Expected: no new errors (3 pre-existing warnings elsewhere are known).

```bash
git add src/app/reports/ src/components/TopNav.tsx
git commit -m "feat: add /reports page with snapshot, throughput, completed-work, and jira-trail sections"
```

---

### Task 7: MCP report tools

**Files:**
- Modify: `src/mcp/client.ts` (add `getReports` method)
- Modify: `src/mcp/tools.ts` (add four report tool handlers)
- Modify: `src/mcp/server.ts` (register the four tools)
- Test: `src/mcp/tools.test.ts` (add tests; existing tests must keep passing)
- Test: `src/mcp/server.test.ts` (extend the registered-tool-names assertion if one exists — check the file first; if it asserts a tool list, add the four new names)

**Interfaces:**
- Consumes: `GET /api/reports` (Task 4), `ReportsPayload` from `@/lib/reports/types`, existing `PonderClient.request`, `textResult`/`McpTextResult` in `tools.ts`.
- Produces:
  - `PonderClient.getReports(args?: { projectId?: string; from?: string; to?: string }): Promise<ReportsPayload>`
  - Tool handlers in `tools.ts`: `reportCompletedWork`, `reportThroughput`, `reportStatusSnapshot`, `reportJiraTrail` — each `(client, args) => Promise<McpTextResult>`.
  - MCP tools registered as `report_completed_work`, `report_throughput`, `report_status_snapshot`, `report_jira_trail`.

- [ ] **Step 1: Write the failing tool tests**

Append to `src/mcp/tools.test.ts` (keep all existing imports/tests; add the new handler names to the existing `./tools` import):

```ts
import type { ReportsPayload } from "@/lib/reports/types";
// ...add to the existing ./tools import:
// reportCompletedWork, reportThroughput, reportStatusSnapshot, reportJiraTrail

const reportsPayload: ReportsPayload = {
  completedWork: {
    stories: [
      {
        jiraKey: "PONE-1",
        summary: "Do the thing",
        jiraStatus: "Code Revew",
        cards: [
          {
            id: "w1",
            title: "Task A",
            subNumber: 1,
            completedAt: "2026-07-01T10:00:00.000Z",
            archivedAt: null,
            verificationOutcome: "passed",
          },
        ],
      },
    ],
    totalCards: 1,
    totalStories: 1,
  },
  throughput: {
    weeks: [
      {
        weekStart: "2026-06-29",
        completedCount: 1,
        avgCycleTimeDays: 2.5,
        medianCycleTimeDays: 2.5,
      },
    ],
    totalCompleted: 1,
    avgCycleTimeDays: 2.5,
    medianCycleTimeDays: 2.5,
    avgCardsPerWeek: 1,
  },
  statusSnapshot: {
    stories: [
      {
        jiraKey: "PONE-2",
        summary: "Active story",
        jiraStatus: "In Progress",
        columnCounts: { todo: 2, in_progress: 1, code_review: 0, done: 0 },
      },
    ],
    columnTotals: { todo: 2, in_progress: 1, code_review: 0, done: 0 },
    awaitingVerification: 1,
    failedVerification: 0,
  },
  jiraTrail: {
    events: [
      {
        type: "verification",
        jiraKey: "PONE-1",
        detail: "Task A",
        timestamp: "2026-07-02T09:00:00.000Z",
        outcome: "passed",
      },
      {
        type: "moved_to_qa",
        jiraKey: "PONE-3",
        detail: "QA card",
        timestamp: "2026-07-01T09:00:00.000Z",
      },
    ],
  },
};

function emptyReportsPayload(): ReportsPayload {
  return {
    completedWork: { stories: [], totalCards: 0, totalStories: 0 },
    throughput: {
      weeks: [],
      totalCompleted: 0,
      avgCycleTimeDays: null,
      medianCycleTimeDays: null,
      avgCardsPerWeek: null,
    },
    statusSnapshot: {
      stories: [],
      columnTotals: { todo: 0, in_progress: 0, code_review: 0, done: 0 },
      awaitingVerification: 0,
      failedVerification: 0,
    },
    jiraTrail: { events: [] },
  };
}

describe("reportCompletedWork", () => {
  it("formats completed cards grouped by story", async () => {
    const getReports = vi.fn().mockResolvedValue(reportsPayload);
    const client = fakeClient({ getReports });

    const result = await reportCompletedWork(client, {});

    expect(getReports).toHaveBeenCalledWith({});
    const text = result.content[0].text;
    expect(text).toContain("1 card(s) completed across 1 story(ies)");
    expect(text).toContain("PONE-1: Do the thing");
    expect(text).toContain("Task A [passed] (completed 2026-07-01)");
  });

  it("passes filters through and handles an empty report", async () => {
    const getReports = vi.fn().mockResolvedValue(emptyReportsPayload());
    const client = fakeClient({ getReports });

    const result = await reportCompletedWork(client, {
      projectId: "p1",
      from: "2026-06-01",
      to: "2026-07-01",
    });

    expect(getReports).toHaveBeenCalledWith({
      projectId: "p1",
      from: "2026-06-01",
      to: "2026-07-01",
    });
    expect(result.content[0].text).toBe("No completed work in the selected range.");
  });
});

describe("reportThroughput", () => {
  it("formats totals and weekly buckets", async () => {
    const getReports = vi.fn().mockResolvedValue(reportsPayload);
    const client = fakeClient({ getReports });

    const result = await reportThroughput(client, {});

    const text = result.content[0].text;
    expect(text).toContain("1 completed");
    expect(text).toContain("avg cycle 2.5d");
    expect(text).toContain("median 2.5d");
    expect(text).toContain("- 2026-06-29: 1 completed (avg 2.5d, median 2.5d)");
  });

  it("handles an empty report", async () => {
    const getReports = vi.fn().mockResolvedValue(emptyReportsPayload());
    const client = fakeClient({ getReports });

    const result = await reportThroughput(client, {});

    expect(result.content[0].text).toBe("No completed work in the selected range.");
  });
});

describe("reportStatusSnapshot", () => {
  it("formats column totals, verification tallies, and per-story rows", async () => {
    const getReports = vi.fn().mockResolvedValue(reportsPayload);
    const client = fakeClient({ getReports });

    const result = await reportStatusSnapshot(client, { projectId: "p1" });

    expect(getReports).toHaveBeenCalledWith({ projectId: "p1" });
    const text = result.content[0].text;
    expect(text).toContain("todo 2, in_progress 1, code_review 0, done 0");
    expect(text).toContain("Awaiting verification: 1");
    expect(text).toContain("Failed verification: 0");
    expect(text).toContain("PONE-2: Active story [In Progress]");
  });

  it("handles an empty board", async () => {
    const getReports = vi.fn().mockResolvedValue(emptyReportsPayload());
    const client = fakeClient({ getReports });

    const result = await reportStatusSnapshot(client, {});

    expect(result.content[0].text).toContain("No active cards.");
  });
});

describe("reportJiraTrail", () => {
  it("formats events newest first with outcomes", async () => {
    const getReports = vi.fn().mockResolvedValue(reportsPayload);
    const client = fakeClient({ getReports });

    const result = await reportJiraTrail(client, {});

    const text = result.content[0].text;
    expect(text).toContain("2 JIRA event(s)");
    expect(text).toContain(
      "- 2026-07-02T09:00:00.000Z verification (passed) PONE-1 — Task A"
    );
    expect(text).toContain(
      "- 2026-07-01T09:00:00.000Z moved_to_qa PONE-3 — QA card"
    );
  });

  it("handles an empty trail", async () => {
    const getReports = vi.fn().mockResolvedValue(emptyReportsPayload());
    const client = fakeClient({ getReports });

    const result = await reportJiraTrail(client, {});

    expect(result.content[0].text).toBe("No JIRA events in the selected range.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/mcp/tools.test.ts`
Expected: FAIL — the new handlers are not exported from `./tools`.

- [ ] **Step 3: Add PonderClient.getReports**

In `src/mcp/client.ts`, add `ReportsPayload` to imports and add this method after `getStories` (after line 29):

```ts
import type { ReportsPayload } from "@/lib/reports/types";
// (merge into the existing type-only import list or add as its own import)

  async getReports(
    args: { projectId?: string; from?: string; to?: string } = {}
  ): Promise<ReportsPayload> {
    const params = new URLSearchParams();
    if (args.projectId) params.set("projectId", args.projectId);
    if (args.from) params.set("from", args.from);
    if (args.to) params.set("to", args.to);
    const query = params.toString();
    return this.request<ReportsPayload>(
      "GET",
      `/api/reports${query ? `?${query}` : ""}`
    );
  }
```

- [ ] **Step 4: Add the tool handlers**

Append to `src/mcp/tools.ts`:

```ts
export interface ReportToolArgs {
  projectId?: string;
  from?: string;
  to?: string;
}

/** Completed-work history grouped by story. */
export async function reportCompletedWork(
  client: PonderClient,
  args: ReportToolArgs
): Promise<McpTextResult> {
  const { completedWork } = await client.getReports(args);

  if (completedWork.totalCards === 0) {
    return textResult("No completed work in the selected range.");
  }

  const lines = completedWork.stories.map((story) => {
    const cards = story.cards.map((card) => {
      const outcome = card.verificationOutcome
        ? ` [${card.verificationOutcome}]`
        : "";
      return `  - ${card.title}${outcome} (completed ${card.completedAt.slice(0, 10)})`;
    });
    return [
      `- ${story.jiraKey}: ${story.summary} [${story.jiraStatus}]`,
      ...cards,
    ].join("\n");
  });

  return textResult(
    `${completedWork.totalCards} card(s) completed across ${completedWork.totalStories} story(ies):\n${lines.join("\n")}`
  );
}

/** Weekly throughput and cycle-time stats. */
export async function reportThroughput(
  client: PonderClient,
  args: ReportToolArgs
): Promise<McpTextResult> {
  const { throughput } = await client.getReports(args);

  if (throughput.totalCompleted === 0) {
    return textResult("No completed work in the selected range.");
  }

  const weekLines = throughput.weeks.map((week) => {
    const stats =
      week.completedCount > 0
        ? ` (avg ${week.avgCycleTimeDays}d, median ${week.medianCycleTimeDays}d)`
        : "";
    return `- ${week.weekStart}: ${week.completedCount} completed${stats}`;
  });

  return textResult(
    `Throughput: ${throughput.totalCompleted} completed; ` +
      `avg cycle ${throughput.avgCycleTimeDays}d, median ${throughput.medianCycleTimeDays}d; ` +
      `${throughput.avgCardsPerWeek} card(s)/week avg.\nWeekly:\n${weekLines.join("\n")}`
  );
}

/** Current board snapshot: active cards per column, verification tallies. */
export async function reportStatusSnapshot(
  client: PonderClient,
  args: { projectId?: string }
): Promise<McpTextResult> {
  const { statusSnapshot } = await client.getReports(args);

  const totals = statusSnapshot.columnTotals;
  const header =
    `Active cards: todo ${totals.todo}, in_progress ${totals.in_progress}, ` +
    `code_review ${totals.code_review}, done ${totals.done}. ` +
    `Awaiting verification: ${statusSnapshot.awaitingVerification}. ` +
    `Failed verification: ${statusSnapshot.failedVerification}.`;

  if (statusSnapshot.stories.length === 0) {
    return textResult(`${header}\nNo active cards.`);
  }

  const storyLines = statusSnapshot.stories.map((story) => {
    const counts = COLUMNS.filter((c) => story.columnCounts[c.key] > 0)
      .map((c) => `${c.key}: ${story.columnCounts[c.key]}`)
      .join(", ");
    return `- ${story.jiraKey}: ${story.summary} [${story.jiraStatus}] — ${counts}`;
  });

  return textResult(`${header}\nPer story:\n${storyLines.join("\n")}`);
}

/** Chronological JIRA reporting trail, newest first. */
export async function reportJiraTrail(
  client: PonderClient,
  args: ReportToolArgs
): Promise<McpTextResult> {
  const { jiraTrail } = await client.getReports(args);

  if (jiraTrail.events.length === 0) {
    return textResult("No JIRA events in the selected range.");
  }

  const lines = jiraTrail.events.map((event) => {
    const outcome = event.outcome ? ` (${event.outcome})` : "";
    return `- ${event.timestamp} ${event.type}${outcome} ${event.jiraKey} — ${event.detail}`;
  });

  return textResult(`${jiraTrail.events.length} JIRA event(s):\n${lines.join("\n")}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/mcp/tools.test.ts`
Expected: PASS (new and pre-existing tests).

- [ ] **Step 6: Register the tools in the server**

In `src/mcp/server.ts`, add the four handlers to the `./tools` import, then register after the existing `report_verification` block (after line 169):

```ts
  server.registerTool(
    "report_completed_work",
    {
      description:
        "Report completed work (cards with a completedAt, archived included) " +
        "grouped by story. Optional projectId and from/to ISO dates (inclusive).",
      inputSchema: {
        projectId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    async ({ projectId, from, to }) =>
      reportCompletedWork(client, { projectId, from, to })
  );

  server.registerTool(
    "report_throughput",
    {
      description:
        "Report weekly throughput and cycle time (completedAt - createdAt, " +
        "fractional days) for completed cards. Optional projectId and " +
        "from/to ISO dates (inclusive).",
      inputSchema: {
        projectId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    async ({ projectId, from, to }) =>
      reportThroughput(client, { projectId, from, to })
  );

  server.registerTool(
    "report_status_snapshot",
    {
      description:
        "Report the current board snapshot: active card counts per column " +
        "per story, awaiting-verification and failed-verification tallies. " +
        "Optional projectId; date ranges do not apply (snapshot is 'right now').",
      inputSchema: {
        projectId: z.string().optional(),
      },
    },
    async ({ projectId }) => reportStatusSnapshot(client, { projectId })
  );

  server.registerTool(
    "report_jira_trail",
    {
      description:
        "Report the chronological JIRA trail (newest first): Move-to-QA " +
        "reports, verification outcomes, story completion comments. Optional " +
        "projectId and from/to ISO dates (inclusive).",
      inputSchema: {
        projectId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    async ({ projectId, from, to }) =>
      reportJiraTrail(client, { projectId, from, to })
  );
```

- [ ] **Step 7: Check server.test.ts for a tool-list assertion**

Read `src/mcp/server.test.ts`. If it asserts the set of registered tool names, add `report_completed_work`, `report_throughput`, `report_status_snapshot`, `report_jira_trail` to the expected list. If it doesn't, no change needed.

- [ ] **Step 8: Run the MCP suite and typecheck**

Run: `npx vitest run src/mcp/ && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/mcp/
git commit -m "feat: add four report MCP tools backed by GET /api/reports"
```

---

### Task 8: Full-suite verification, README, PR

**Files:**
- Modify: `README.md` (MCP tools table around lines 100–108; Roadmap section at lines 112–115)

**Interfaces:**
- Consumes: everything above.
- Produces: green suite, updated docs, an open PR.

- [ ] **Step 1: Run the full verification suite**

```bash
npx tsc --noEmit && npx vitest run && npx eslint src
```

Expected: no type errors; all tests pass (previous full-suite count was 570 — expect that plus the new tests); lint clean except the 3 pre-existing warnings. Fix anything the new code broke (do not "fix" unrelated pre-existing failures — flag them instead).

- [ ] **Step 2: Update the README**

In `README.md`:

1. Add four rows to the MCP tools table (after the `update_work_unit` row):

```markdown
| `report_completed_work` | `projectId?`, `from?`, `to?` | Completed-work history grouped by story (archived cards included) |
| `report_throughput` | `projectId?`, `from?`, `to?` | Weekly throughput + cycle-time stats (created→completed) |
| `report_status_snapshot` | `projectId?` | Active cards per column per story, verification tallies |
| `report_jira_trail` | `projectId?`, `from?`, `to?` | Chronological trail of what was reported to JIRA and when |
```

2. Add a short **Reports** feature blurb near the other feature descriptions (adjust placement to match the README's existing structure):

```markdown
## Reports

The `/reports` page answers four questions, filterable by project and date range (7/30/90 days or all time): a current **status snapshot** (active cards per column, verification states), **throughput & cycle time** (weekly completions and created→completed cycle times, charted), **completed work** history grouped by story, and the **JIRA trail** (every Move-to-QA report, verification outcome, and completion comment, newest first). The same data is available to MCP clients via the four `report_*` tools.
```

3. In the Roadmap section, add the deferred follow-up:

```markdown
- **Scheduled report digest** — periodic summary built on the report layer (delivery channel TBD).
```

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: document reports page and MCP report tools"
git push -u origin feature/reporting-suite
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "Reporting suite: /reports page + MCP report tools" --body "$(cat <<'EOF'
## Summary
- Shared report-query layer in `src/lib/reports/` (completed work, throughput & cycle time, status snapshot, JIRA trail) with pure stats helpers and integration tests
- `GET /api/reports` returning all four sections in one payload (`projectId`/`from`/`to` filters, inclusive bounds, 400 on bad dates)
- `/reports` page: project + date-range presets (default 30 days), stat tiles, per-story tables, hand-rolled SVG weekly-throughput bar chart and cycle-time trend line — no new dependencies
- Four read-only MCP tools (`report_completed_work`, `report_throughput`, `report_status_snapshot`, `report_jira_trail`) via a new `PonderClient.getReports`
- Scheduled digest deliberately deferred to a follow-up spec (documented in Roadmap)

Spec: `docs/superpowers/specs/2026-07-05-reporting-suite-design.md`
Plan: `docs/superpowers/plans/2026-07-05-reporting-suite.md`

## Test plan
- [ ] `npx vitest run` — full suite green
- [ ] `npx tsc --noEmit` — clean
- [ ] Manual: `/reports` renders all four sections; project and range filters refetch; MCP `report_*` tools return sensible text

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Do not merge — John merges PRs himself.
