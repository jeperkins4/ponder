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
