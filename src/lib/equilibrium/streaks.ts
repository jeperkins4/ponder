/**
 * Live, resettable streaks — no dedicated storage. Both are computed by
 * walking recent rows most-recent-first and counting until the streak
 * condition breaks.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { StreaksDTO } from "./types";

/** Consecutive resolved work units (ordered by verifiedAt, most recent
 * first) with verificationOutcome "passed" and reopenCount 0. */
export async function getRigorStreak(
  prismaClient: PrismaClient = prisma
): Promise<number> {
  const resolved = await prismaClient.workUnit.findMany({
    where: { verifiedAt: { not: null } },
    orderBy: { verifiedAt: "desc" },
    select: { verificationOutcome: true, reopenCount: true },
  });

  let streak = 0;
  for (const unit of resolved) {
    if (unit.verificationOutcome === "passed" && unit.reopenCount === 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/** Consecutive MeterSnapshot rows (most recent first) in the "equilibrium"
 * band. */
export async function getBalanceStreak(
  prismaClient: PrismaClient = prisma
): Promise<number> {
  const recent = await prismaClient.meterSnapshot.findMany({
    orderBy: { date: "desc" },
  });

  let streak = 0;
  for (const snap of recent) {
    if (snap.band === "equilibrium") {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export async function getStreaks(
  prismaClient: PrismaClient = prisma
): Promise<StreaksDTO> {
  const [rigorStreak, balanceStreak] = await Promise.all([
    getRigorStreak(prismaClient),
    getBalanceStreak(prismaClient),
  ]);
  return { rigorStreak, balanceStreak };
}
