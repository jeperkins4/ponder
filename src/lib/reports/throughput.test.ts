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
