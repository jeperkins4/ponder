/**
 * Badges: a small, curated set of permanent, once-earned unlocks — distinct
 * from the live, resettable streaks in streaks.ts. Checked on every
 * GET /api/equilibrium call; each check is idempotent (an already-earned
 * badge is never re-awarded).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BadgeDefinition, BadgeStatusDTO, EquilibriumSnapshotDTO, StreaksDTO } from "./types";
import { STALENESS_DAYS } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = STALENESS_DAYS * DAY_MS;
const QUICK_UNSTICK_WINDOW_MS = 48 * 60 * 60 * 1000;

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  { key: "in_equilibrium", label: "In Equilibrium", condition: "Reach the green band for the first time" },
  { key: "steady_week", label: "Steady Week", condition: "7 consecutive days in the green band" },
  { key: "clean_run", label: "Clean Run", condition: "10 work units resolved in a row with zero churn" },
  {
    key: "quick_unstick",
    label: "Quick Unstick",
    condition: "Resolve a work unit stale 5+ days within 48 hours of its next activity",
  },
  {
    key: "right_sized_backlog",
    label: "Right-Sized Backlog",
    condition: "Decomposition at 100 and WIP at 80+ at the same time",
  },
];

/** Scans every cleanly-resolved work unit (verificationOutcome "passed",
 * reopenCount 0) for a gap of STALE_MS+ between two consecutive activity
 * timestamps (createdAt, WorkNote.createdAt, Attachment.createdAt) followed
 * by a verification within QUICK_UNSTICK_WINDOW_MS of the activity that
 * ended the gap. Scans the whole table on every call — fine at this app's
 * single-user scale. */
async function hasQuickUnstickMoment(prismaClient: PrismaClient): Promise<boolean> {
  const candidates = await prismaClient.workUnit.findMany({
    where: { verificationOutcome: "passed", reopenCount: 0, verifiedAt: { not: null } },
    include: { workNotes: true, attachments: true },
  });

  return candidates.some((unit) => {
    const activity = [
      unit.createdAt,
      ...unit.workNotes.map((n) => n.createdAt),
      ...unit.attachments.map((a) => a.createdAt),
    ].sort((a, b) => a.getTime() - b.getTime());

    for (let i = 1; i < activity.length; i++) {
      const gap = activity[i].getTime() - activity[i - 1].getTime();
      if (gap < STALE_MS) continue;
      const resumedAt = activity[i];
      const verifiedGap = (unit.verifiedAt as Date).getTime() - resumedAt.getTime();
      if (verifiedGap >= 0 && verifiedGap <= QUICK_UNSTICK_WINDOW_MS) {
        return true;
      }
    }
    return false;
  });
}

export async function checkAndAwardBadges(
  prismaClient: PrismaClient = prisma,
  snapshot: EquilibriumSnapshotDTO,
  streaks: StreaksDTO
): Promise<void> {
  const alreadyEarned = new Set(
    (await prismaClient.badge.findMany({ select: { key: true } })).map((b) => b.key)
  );

  const toAward: string[] = [];

  if (!alreadyEarned.has("in_equilibrium") && snapshot.band === "equilibrium") {
    toAward.push("in_equilibrium");
  }

  if (!alreadyEarned.has("steady_week")) {
    const recent = await prismaClient.meterSnapshot.findMany({
      orderBy: { date: "desc" },
      take: 7,
    });
    if (recent.length === 7 && recent.every((s) => s.band === "equilibrium")) {
      toAward.push("steady_week");
    }
  }

  if (!alreadyEarned.has("clean_run") && streaks.rigorStreak >= 10) {
    toAward.push("clean_run");
  }

  if (
    !alreadyEarned.has("right_sized_backlog") &&
    snapshot.decomposition === 100 &&
    snapshot.wip >= 80
  ) {
    toAward.push("right_sized_backlog");
  }

  if (!alreadyEarned.has("quick_unstick") && (await hasQuickUnstickMoment(prismaClient))) {
    toAward.push("quick_unstick");
  }

  if (toAward.length > 0) {
    await prismaClient.badge.createMany({
      data: toAward.map((key) => ({ key })),
      skipDuplicates: true,
    });
  }
}

export async function getBadgeStatus(
  prismaClient: PrismaClient = prisma
): Promise<BadgeStatusDTO[]> {
  const earned = await prismaClient.badge.findMany();
  const earnedMap = new Map(earned.map((b) => [b.key, b.earnedAt]));

  return BADGE_DEFINITIONS.map((def) => ({
    ...def,
    earnedAt: earnedMap.get(def.key)?.toISOString() ?? null,
  }));
}
