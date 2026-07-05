/**
 * Integration tests for findAlreadyImportedKeys against the test database.
 * "Already imported" = Story row exists for the jiraKey AND it has at least
 * one work unit with archivedAt: null. Archived-only stories count as fresh.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { findAlreadyImportedKeys } from "./importDedup";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory(jiraKey: string) {
  return prisma.story.create({
    data: {
      jiraKey,
      jiraId: `id-${jiraKey}`,
      projectKey: "DEDUP",
      summary: `Story ${jiraKey}`,
      jiraStatus: "To Do",
      url: `https://example.atlassian.net/browse/${jiraKey}`,
      lastSyncedAt: new Date(),
    },
  });
}

describe("findAlreadyImportedKeys", () => {
  it("returns an empty set for an empty input without querying", async () => {
    const result = await findAlreadyImportedKeys([], prisma);
    expect(result).toEqual(new Set());
  });

  it("does not include keys with no local story", async () => {
    const key = uniqueKey("DEDUP-MISSING");
    const result = await findAlreadyImportedKeys([key], prisma);
    expect(result.has(key)).toBe(false);
  });

  it("does not include a story with zero work units", async () => {
    const key = uniqueKey("DEDUP-EMPTY");
    const story = await createStory(key);
    try {
      const result = await findAlreadyImportedKeys([key], prisma);
      expect(result.has(key)).toBe(false);
    } finally {
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("includes a story with at least one active work unit", async () => {
    const key = uniqueKey("DEDUP-ACTIVE");
    const story = await createStory(key);
    try {
      await prisma.workUnit.create({
        data: { storyId: story.id, title: "Active card", column: "todo", order: 0 },
      });
      const result = await findAlreadyImportedKeys([key], prisma);
      expect(result.has(key)).toBe(true);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("does not include a story whose work units are all archived", async () => {
    const key = uniqueKey("DEDUP-ARCHIVED");
    const story = await createStory(key);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Archived card",
          column: "done",
          order: 0,
          archivedAt: new Date(),
        },
      });
      const result = await findAlreadyImportedKeys([key], prisma);
      expect(result.has(key)).toBe(false);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("returns exactly the already-imported subset of a mixed batch", async () => {
    const activeKey = uniqueKey("DEDUP-MIX-ACTIVE");
    const emptyKey = uniqueKey("DEDUP-MIX-EMPTY");
    const missingKey = uniqueKey("DEDUP-MIX-MISSING");
    const activeStory = await createStory(activeKey);
    const emptyStory = await createStory(emptyKey);
    try {
      await prisma.workUnit.create({
        data: { storyId: activeStory.id, title: "Card", column: "in_progress", order: 0 },
      });
      const result = await findAlreadyImportedKeys(
        [activeKey, emptyKey, missingKey],
        prisma
      );
      expect(result).toEqual(new Set([activeKey]));
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: activeStory.id } });
      await prisma.story.delete({ where: { id: activeStory.id } });
      await prisma.story.delete({ where: { id: emptyStory.id } });
    }
  });
});
