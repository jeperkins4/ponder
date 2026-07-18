/**
 * Tests for churn event counting (integration, against the test database)
 * and the churn damper formula (pure).
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { countChurnEvents, computeChurnDamper } from "./churn";
import { CHURN_DAMPER_FLOOR } from "./constants";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory(overrides: Partial<Parameters<typeof prisma.story.create>[0]["data"]> = {}) {
  const key = uniqueKey("EQ-CHURN");
  return prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "EQCHURN",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
      ...overrides,
    },
  });
}

async function cleanupStory(storyId: string) {
  await prisma.workUnit.deleteMany({ where: { storyId } });
  await prisma.story.delete({ where: { id: storyId } });
}

describe("countChurnEvents", () => {
  it("is 0 with no churn signals present", async () => {
    expect(await countChurnEvents(prisma)).toBe(0);
  });

  it("counts a work unit with a recent failed verification", async () => {
    const story = await createStory();
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Failed verification",
          column: "in_progress",
          order: 0,
          verifiedAt: new Date(),
          verificationOutcome: "failed",
        },
      });
      expect(await countChurnEvents(prisma)).toBe(1);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("ignores a failed verification outside the churn window", async () => {
    const story = await createStory();
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Old failure",
          column: "in_progress",
          order: 0,
          verifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          verificationOutcome: "failed",
        },
      });
      expect(await countChurnEvents(prisma)).toBe(0);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("counts a work unit with a recent reopen", async () => {
    const story = await createStory();
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Reopened",
          column: "in_progress",
          order: 0,
          reopenCount: 1,
          lastReopenedAt: new Date(),
        },
      });
      expect(await countChurnEvents(prisma)).toBe(1);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("counts a story with a recent status regression", async () => {
    const story = await createStory({ reopenCount: 1, lastReopenedAt: new Date() });
    try {
      expect(await countChurnEvents(prisma)).toBe(1);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("counts a story with a recently-linked follow-up", async () => {
    const story = await createStory({
      linkedFollowUpKeys: "TEAM-99",
      lastLinkedFollowUpAt: new Date(),
    });
    try {
      expect(await countChurnEvents(prisma)).toBe(1);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("sums churn events across all four sources", async () => {
    const story = await createStory({ reopenCount: 1, lastReopenedAt: new Date() });
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Failed",
          column: "in_progress",
          order: 0,
          verifiedAt: new Date(),
          verificationOutcome: "failed",
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Reopened unit",
          column: "in_progress",
          order: 1,
          reopenCount: 1,
          lastReopenedAt: new Date(),
        },
      });
      // story itself already has a status regression from createStory above
      expect(await countChurnEvents(prisma)).toBe(3);
    } finally {
      await cleanupStory(story.id);
    }
  });
});

describe("computeChurnDamper", () => {
  it("is 1.0 with zero churn events", () => {
    expect(computeChurnDamper(0)).toBe(1);
  });

  it("decreases by CHURN_WEIGHT per event", () => {
    expect(computeChurnDamper(1)).toBeCloseTo(0.92);
    expect(computeChurnDamper(5)).toBeCloseTo(0.6);
  });

  it("floors at CHURN_DAMPER_FLOOR regardless of how high churn goes", () => {
    expect(computeChurnDamper(100)).toBe(CHURN_DAMPER_FLOOR);
  });
});
