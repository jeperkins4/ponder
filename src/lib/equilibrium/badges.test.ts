/**
 * Integration tests for the Equilibrium Meter's badge award logic, against
 * the test database.
 */

import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { checkAndAwardBadges, getBadgeStatus, BADGE_DEFINITIONS } from "./badges";
import type { EquilibriumSnapshotDTO, StreaksDTO } from "./types";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory() {
  const key = uniqueKey("EQ-BADGE");
  return prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "EQBADGE",
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

const flatSnapshot: EquilibriumSnapshotDTO = {
  date: "2026-07-17",
  decomposition: 60,
  rigor: 60,
  wip: 60,
  staleness: 60,
  churnEvents: 0,
  overall: 60,
  band: "drifting",
};

const flatStreaks: StreaksDTO = { rigorStreak: 0, balanceStreak: 0 };

afterEach(async () => {
  await prisma.badge.deleteMany({});
  await prisma.meterSnapshot.deleteMany({});
});

describe("getBadgeStatus", () => {
  it("lists every defined badge as unearned by default", async () => {
    const status = await getBadgeStatus(prisma);
    expect(status).toHaveLength(BADGE_DEFINITIONS.length);
    expect(status.every((b) => b.earnedAt === null)).toBe(true);
  });
});

describe("checkAndAwardBadges", () => {
  it("awards 'in_equilibrium' the first time the band is equilibrium", async () => {
    await checkAndAwardBadges(
      prisma,
      { ...flatSnapshot, band: "equilibrium", overall: 85 },
      flatStreaks
    );
    const status = await getBadgeStatus(prisma);
    const badge = status.find((b) => b.key === "in_equilibrium");
    expect(badge?.earnedAt).not.toBeNull();
  });

  it("does not re-award an already-earned badge", async () => {
    await prisma.badge.create({ data: { key: "in_equilibrium" } });
    await checkAndAwardBadges(
      prisma,
      { ...flatSnapshot, band: "equilibrium", overall: 85 },
      flatStreaks
    );
    const rows = await prisma.badge.findMany({ where: { key: "in_equilibrium" } });
    expect(rows).toHaveLength(1);
  });

  it("awards 'clean_run' once the rigor streak reaches 10", async () => {
    await checkAndAwardBadges(prisma, flatSnapshot, { rigorStreak: 10, balanceStreak: 0 });
    const status = await getBadgeStatus(prisma);
    expect(status.find((b) => b.key === "clean_run")?.earnedAt).not.toBeNull();
  });

  it("does not award 'clean_run' below a streak of 10", async () => {
    await checkAndAwardBadges(prisma, flatSnapshot, { rigorStreak: 9, balanceStreak: 0 });
    const status = await getBadgeStatus(prisma);
    expect(status.find((b) => b.key === "clean_run")?.earnedAt).toBeNull();
  });

  it("awards 'right_sized_backlog' when decomposition is 100 and wip is >= 80", async () => {
    await checkAndAwardBadges(
      prisma,
      { ...flatSnapshot, decomposition: 100, wip: 80 },
      flatStreaks
    );
    const status = await getBadgeStatus(prisma);
    expect(status.find((b) => b.key === "right_sized_backlog")?.earnedAt).not.toBeNull();
  });

  it("does not award 'right_sized_backlog' when only one condition holds", async () => {
    await checkAndAwardBadges(
      prisma,
      { ...flatSnapshot, decomposition: 100, wip: 79 },
      flatStreaks
    );
    const status = await getBadgeStatus(prisma);
    expect(status.find((b) => b.key === "right_sized_backlog")?.earnedAt).toBeNull();
  });

  it("awards 'steady_week' after 7 consecutive green snapshots", async () => {
    for (let i = 6; i >= 0; i--) {
      await prisma.meterSnapshot.create({
        data: {
          date: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
          decomposition: 90, rigor: 90, wip: 90, staleness: 90,
          churnEvents: 0, overall: 90, band: "equilibrium",
        },
      });
    }
    await checkAndAwardBadges(prisma, flatSnapshot, flatStreaks);
    const status = await getBadgeStatus(prisma);
    expect(status.find((b) => b.key === "steady_week")?.earnedAt).not.toBeNull();
  });

  it("awards 'quick_unstick' for a work unit that resumed activity after a stale gap and resolved cleanly within 48h", async () => {
    const story = await createStory();
    try {
      const staleGapStart = Date.now() - 10 * 24 * 60 * 60 * 1000;
      const unit = await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Unstuck",
          column: "done",
          order: 0,
          verifiedAt: new Date(staleGapStart + 6 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
          verificationOutcome: "passed",
          reopenCount: 0,
        },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "WorkUnit" SET "createdAt" = $1 WHERE id = $2`,
        new Date(staleGapStart),
        unit.id
      );
      // Activity resumes 6 days later (past the 5-day staleness window),
      // then verified 1 hour after that — well within 48h.
      await prisma.workNote.create({
        data: {
          workUnitId: unit.id,
          body: "Picking this back up",
        },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "WorkNote" SET "createdAt" = $1 WHERE "workUnitId" = $2`,
        new Date(staleGapStart + 6 * 24 * 60 * 60 * 1000),
        unit.id
      );

      await checkAndAwardBadges(prisma, flatSnapshot, flatStreaks);
      const status = await getBadgeStatus(prisma);
      expect(status.find((b) => b.key === "quick_unstick")?.earnedAt).not.toBeNull();
    } finally {
      await cleanupStory(story.id);
    }
  });

  it("does not award 'quick_unstick' when there was no stale gap", async () => {
    const story = await createStory();
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Never stale",
          column: "done",
          order: 0,
          verifiedAt: new Date(),
          verificationOutcome: "passed",
          reopenCount: 0,
        },
      });
      await checkAndAwardBadges(prisma, flatSnapshot, flatStreaks);
      const status = await getBadgeStatus(prisma);
      expect(status.find((b) => b.key === "quick_unstick")?.earnedAt).toBeNull();
    } finally {
      await cleanupStory(story.id);
    }
  });
});
