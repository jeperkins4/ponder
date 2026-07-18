/**
 * Live, resettable streaks — no dedicated storage. Both are computed by
 * walking recent rows most-recent-first and counting until the streak
 * condition breaks. The balance streak additionally excludes today, since
 * today isn't a "completed" day yet — see getBalanceStreak.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { StreaksDTO } from "./types";

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

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

/** Consecutive *prior* MeterSnapshot rows (most recent first, excluding
 * today) in the "equilibrium" band. Today's row is always excluded — even
 * once it exists — so the result is order-independent: it can't change
 * depending on whether/when getTodaysSnapshot has been called yet today. A
 * day only starts counting toward the streak once it's over. */
export async function getBalanceStreak(
  prismaClient: PrismaClient = prisma
): Promise<number> {
  const todayStart = startOfUTCDay(new Date());
  const recent = await prismaClient.meterSnapshot.findMany({
    where: { date: { lt: todayStart } },
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
