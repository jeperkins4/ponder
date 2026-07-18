/**
 * Integration tests for the Equilibrium Meter's two live streaks, against
 * the test database.
 */

import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { getRigorStreak, getBalanceStreak, getStreaks } from "./streaks";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory() {
  const key = uniqueKey("EQ-STREAK");
  return prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "EQSTREAK",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
    },
  });
}

async function cleanupStory(storyId: string) {
  await prisma.workUnit.deleteMany({ where: { storyId } });
  await prisma.story.delete({ where: { id: storyId } });
}

describe("getRigorStreak", () => {
  it("is 0 with no resolved work units", async () => {
    expect(await getRigorStreak(prisma)).toBe(0);
  });

  it("counts consecutive clean resolutions, most recent first", async () => {
    const story = await createStory();
    try {
      const now = Date.now();
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Clean 1",
          column: "done",
          order: 0,
          verifiedAt: new Date(now - 3000),
          verificationOutcome: "passed",
          reopenCount: 0,
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Clean 2 (most recent)",
          column: "done",
          order: 1,
          verifiedAt: new Date(now),
          verificationOutcome: "passed",
          reopenCount: 0,
        },
      });
      expect(await getRigorStreak(prisma)).toBe(2);
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("breaks the streak at the most recent unclean resolution", async () => {
    const story = await createStory();
    try {
      const now = Date.now();
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Clean, older",
          column: "done",
          order: 0,
          verifiedAt: new Date(now - 5000),
          verificationOutcome: "passed",
          reopenCount: 0,
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Failed, most recent",
          column: "in_progress",
          order: 1,
          verifiedAt: new Date(now),
          verificationOutcome: "failed",
          reopenCount: 0,
        },
      });
      expect(await getRigorStreak(prisma)).toBe(0);
    } finally {
      await cleanupStory(story.id);
    }
  });
});

describe("getBalanceStreak", () => {
  afterEach(async () => {
    await prisma.meterSnapshot.deleteMany({});
  });

  it("is 0 with no snapshots", async () => {
    expect(await getBalanceStreak(prisma)).toBe(0);
  });

  it("counts consecutive green snapshots, most recent first", async () => {
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        decomposition: 90, rigor: 90, wip: 90, staleness: 90,
        churnEvents: 0, overall: 90, band: "equilibrium",
      },
    });
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        decomposition: 85, rigor: 85, wip: 85, staleness: 85,
        churnEvents: 0, overall: 85, band: "equilibrium",
      },
    });
    expect(await getBalanceStreak(prisma)).toBe(2);
  });

  it("breaks at the most recent non-green snapshot", async () => {
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        decomposition: 90, rigor: 90, wip: 90, staleness: 90,
        churnEvents: 0, overall: 90, band: "equilibrium",
      },
    });
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        decomposition: 40, rigor: 40, wip: 40, staleness: 40,
        churnEvents: 5, overall: 40, band: "out",
      },
    });
    expect(await getBalanceStreak(prisma)).toBe(0);
  });

  it("excludes today's row from the streak regardless of its band, so the result cannot change based on whether today's snapshot has been created yet", async () => {
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        decomposition: 85, rigor: 85, wip: 85, staleness: 85,
        churnEvents: 0, overall: 85, band: "equilibrium",
      },
    });
    // Today's row exists and is green, but must NOT count toward the streak
    // — the streak reflects only completed prior days.
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(),
        decomposition: 95, rigor: 95, wip: 95, staleness: 95,
        churnEvents: 0, overall: 95, band: "equilibrium",
      },
    });
    // Same result whether or not today's row exists.
    expect(await getBalanceStreak(prisma)).toBe(1);
  });
});

describe("getStreaks", () => {
  afterEach(async () => {
    await prisma.meterSnapshot.deleteMany({});
  });

  it("combines both streaks into one object", async () => {
    expect(await getStreaks(prisma)).toEqual({ rigorStreak: 0, balanceStreak: 0 });
  });
});
