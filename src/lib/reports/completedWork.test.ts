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
