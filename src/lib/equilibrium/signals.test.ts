/**
 * Integration tests for the Equilibrium Meter's four leading-indicator axis
 * scores, against the test database.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getDecompositionScore,
  getRigorScore,
  getWipScore,
  getStalenessScore,
} from "./signals";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory() {
  const key = uniqueKey("EQ-SIG");
  return prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "EQSIG",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
    },
  });
}

async function cleanupStory(storyId: string) {
  await prisma.attachment.deleteMany({ where: { workUnit: { storyId } } });
  await prisma.workNote.deleteMany({ where: { workUnit: { storyId } } });
  await prisma.workUnit.deleteMany({ where: { storyId } });
  await prisma.story.delete({ where: { id: storyId } });
}

// Clear database before each test to ensure signals operate on known state
beforeEach(async () => {
  await prisma.attachment.deleteMany({});
  await prisma.workNote.deleteMany({});
  await prisma.workUnit.deleteMany({});
  await prisma.story.deleteMany({});
});

describe("getDecompositionScore", () => {
  it("is 100 when there are no open work units", async () => {
    expect(await getDecompositionScore(prisma)).toBe(100);
  });

  it("scores the % of open work units with both acceptanceCriteria and verification set", async () => {
    const story = await createStory();
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Well specified",
          column: "todo",
          order: 0,
          acceptanceCriteria: "Given/when/then",
          verification: "Click the button",
        },
      });
      await prisma.workUnit.create({
        data: { storyId: story.id, title: "Vague", column: "todo", order: 1 },
      });
      expect(await getDecompositionScore(prisma)).toBe(50);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("excludes archived and done work units", async () => {
    const story = await createStory();
    try {
      await prisma.workUnit.create({
        data: { storyId: story.id, title: "Done", column: "done", order: 0 },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Archived",
          column: "todo",
          order: 1,
          archivedAt: new Date(),
        },
      });
      expect(await getDecompositionScore(prisma)).toBe(100);
    } finally {
      await cleanupStory(story.id);
    }
  });
});

describe("getWipScore", () => {
  it("is 100 at or under the WIP limit", async () => {
    const story = await createStory();
    try {
      for (let i = 0; i < 3; i++) {
        await prisma.workUnit.create({
          data: { storyId: story.id, title: `In progress ${i}`, column: "in_progress", order: i },
        });
      }
      expect(await getWipScore(prisma)).toBe(100);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("decays 25 points per unit over the limit", async () => {
    const story = await createStory();
    try {
      for (let i = 0; i < 5; i++) {
        await prisma.workUnit.create({
          data: { storyId: story.id, title: `In progress ${i}`, column: "in_progress", order: i },
        });
      }
      expect(await getWipScore(prisma)).toBe(50);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("ignores archived work units", async () => {
    const story = await createStory();
    try {
      for (let i = 0; i < 5; i++) {
        await prisma.workUnit.create({
          data: {
            storyId: story.id,
            title: `Archived ${i}`,
            column: "in_progress",
            order: i,
            archivedAt: new Date(),
          },
        });
      }
      expect(await getWipScore(prisma)).toBe(100);
    } finally {
      await cleanupStory(story.id);
    }
  });
});

describe("getStalenessScore", () => {
  it("is 100 when there are no open work units", async () => {
    expect(await getStalenessScore(prisma)).toBe(100);
  });

  it("penalizes a work unit with no activity in the staleness window", async () => {
    const story = await createStory();
    try {
      const unit = await prisma.workUnit.create({
        data: { storyId: story.id, title: "Stale", column: "todo", order: 0 },
      });
      // Force updatedAt into the past — Prisma's @updatedAt stamps "now" on
      // create, so this must be a raw update bypassing the trigger's normal
      // "now" behavior by writing an old timestamp directly.
      await prisma.$executeRawUnsafe(
        `UPDATE "WorkUnit" SET "updatedAt" = $1 WHERE id = $2`,
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        unit.id
      );
      expect(await getStalenessScore(prisma)).toBe(0);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("treats a recent WorkNote as activity even if the work unit itself is old", async () => {
    const story = await createStory();
    try {
      const unit = await prisma.workUnit.create({
        data: { storyId: story.id, title: "Recently noted", column: "todo", order: 0 },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "WorkUnit" SET "updatedAt" = $1 WHERE id = $2`,
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        unit.id
      );
      await prisma.workNote.create({ data: { workUnitId: unit.id, body: "Still working on it" } });
      expect(await getStalenessScore(prisma)).toBe(100);
    } finally {
      await cleanupStory(story.id);
    }
  });
});

describe("getRigorScore", () => {
  it("is 100 when nothing moved to QA in the window", async () => {
    expect(await getRigorScore(prisma)).toBe(100);
  });

  it("scores 100 when a work unit moved to QA had verification requested and an evidence attachment", async () => {
    const story = await createStory();
    try {
      const unit = await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Verified",
          column: "done",
          order: 0,
          movedToQaReportedAt: new Date(),
          verificationRequestedAt: new Date(),
        },
      });
      await prisma.attachment.create({
        data: { workUnitId: unit.id, filename: "evidence.png", mimeType: "image/png", size: 100 },
      });
      expect(await getRigorScore(prisma)).toBe(100);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("scores 0 when a work unit moved to QA had no verification requested", async () => {
    const story = await createStory();
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Skipped",
          column: "done",
          order: 0,
          movedToQaReportedAt: new Date(),
        },
      });
      expect(await getRigorScore(prisma)).toBe(0);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("ignores work units moved to QA outside the rolling window", async () => {
    const story = await createStory();
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Old, unverified",
          column: "done",
          order: 0,
          movedToQaReportedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      });
      expect(await getRigorScore(prisma)).toBe(100);
    } finally {
      await cleanupStory(story.id);
    }
  });
});
