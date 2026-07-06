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
