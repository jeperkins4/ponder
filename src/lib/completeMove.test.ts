/**
 * Integration tests for moveWorkUnitColumn against the test database.
 * Entering done stamps completedAt (only if null); leaving done clears it;
 * same-column moves never touch it. The helper does NOT fire the JIRA
 * status trigger — callers own that.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { moveWorkUnitColumn } from "./completeMove";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStoryWithUnit(column: string, completedAt: Date | null = null) {
  const key = uniqueKey("CMOVE");
  const story = await prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "CMOVE",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
    },
  });
  const unit = await prisma.workUnit.create({
    data: { storyId: story.id, title: "Card", column, order: 0, completedAt },
  });
  return { story, unit };
}

async function cleanup(storyId: string) {
  await prisma.workUnit.deleteMany({ where: { storyId } });
  await prisma.story.delete({ where: { id: storyId } });
}

describe("moveWorkUnitColumn", () => {
  it("stamps completedAt when entering done", async () => {
    const { story, unit } = await createStoryWithUnit("in_progress");
    try {
      const before = Date.now();
      const moved = await moveWorkUnitColumn(unit.id, "done", 3, prisma);
      expect(moved.column).toBe("done");
      expect(moved.order).toBe(3);
      expect(moved.completedAt).not.toBeNull();
      expect((moved.completedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      await cleanup(story.id);
    }
  });

  it("preserves an existing completedAt when entering done again", async () => {
    const original = new Date("2026-07-01T10:00:00.000Z");
    const { story, unit } = await createStoryWithUnit("in_progress", original);
    try {
      const moved = await moveWorkUnitColumn(unit.id, "done", 0, prisma);
      expect(moved.completedAt?.toISOString()).toBe(original.toISOString());
    } finally {
      await cleanup(story.id);
    }
  });

  it("clears completedAt when leaving done", async () => {
    const { story, unit } = await createStoryWithUnit("done", new Date());
    try {
      const moved = await moveWorkUnitColumn(unit.id, "in_progress", 1, prisma);
      expect(moved.column).toBe("in_progress");
      expect(moved.completedAt).toBeNull();
    } finally {
      await cleanup(story.id);
    }
  });

  it("does not touch completedAt on a same-column reorder in done", async () => {
    const original = new Date("2026-07-01T10:00:00.000Z");
    const { story, unit } = await createStoryWithUnit("done", original);
    try {
      const moved = await moveWorkUnitColumn(unit.id, "done", 5, prisma);
      expect(moved.order).toBe(5);
      expect(moved.completedAt?.toISOString()).toBe(original.toISOString());
    } finally {
      await cleanup(story.id);
    }
  });

  it("leaves completedAt null on moves between non-done columns", async () => {
    const { story, unit } = await createStoryWithUnit("todo");
    try {
      const moved = await moveWorkUnitColumn(unit.id, "in_progress", 0, prisma);
      expect(moved.completedAt).toBeNull();
    } finally {
      await cleanup(story.id);
    }
  });

  it("increments reopenCount and stamps lastReopenedAt on a backward move", async () => {
    const { story, unit } = await createStoryWithUnit("code_review");
    try {
      const before = Date.now();
      const moved = await moveWorkUnitColumn(unit.id, "in_progress", 0, prisma);
      expect(moved.reopenCount).toBe(1);
      expect(moved.lastReopenedAt).not.toBeNull();
      expect((moved.lastReopenedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      await cleanup(story.id);
    }
  });

  it("does not increment reopenCount on a forward move", async () => {
    const { story, unit } = await createStoryWithUnit("todo");
    try {
      const moved = await moveWorkUnitColumn(unit.id, "in_progress", 0, prisma);
      expect(moved.reopenCount).toBe(0);
      expect(moved.lastReopenedAt).toBeNull();
    } finally {
      await cleanup(story.id);
    }
  });

  it("does not increment reopenCount on a same-column reorder", async () => {
    const { story, unit } = await createStoryWithUnit("in_progress");
    try {
      const moved = await moveWorkUnitColumn(unit.id, "in_progress", 5, prisma);
      expect(moved.reopenCount).toBe(0);
      expect(moved.lastReopenedAt).toBeNull();
    } finally {
      await cleanup(story.id);
    }
  });

  it("accumulates reopenCount across multiple backward moves", async () => {
    const { story, unit } = await createStoryWithUnit("done", new Date());
    try {
      await moveWorkUnitColumn(unit.id, "todo", 0, prisma);
      const movedAgain = await moveWorkUnitColumn(unit.id, "in_progress", 0, prisma);
      const backAgain = await moveWorkUnitColumn(unit.id, "done", 0, prisma);
      const secondRegression = await moveWorkUnitColumn(backAgain.id, "todo", 0, prisma);
      expect(secondRegression.reopenCount).toBe(2);
    } finally {
      await cleanup(story.id);
    }
  });
});
