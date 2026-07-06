/**
 * Throughput & cycle-time report over completed work units (archived
 * included). Cycle time = completedAt - createdAt in fractional days; weekly
 * buckets are Monday-start UTC ISO weeks (see stats.ts).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildWeeklyBuckets, cycleTimeDays, mean, median, round2 } from "./stats";
import type { ReportFilters, ThroughputReport } from "./types";

export async function getThroughput(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<ThroughputReport> {
  const completed = await prismaClient.workUnit.findMany({
    where: {
      completedAt: {
        not: null,
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
      ...(filters.projectId ? { story: { projectId: filters.projectId } } : {}),
    },
    select: { createdAt: true, completedAt: true },
  });

  const cards = completed.map((unit) => ({
    createdAt: unit.createdAt,
    completedAt: unit.completedAt as Date,
  }));
  const weeks = buildWeeklyBuckets(cards);
  const cycleTimes = cards.map((card) =>
    cycleTimeDays(card.createdAt, card.completedAt)
  );

  return {
    weeks,
    totalCompleted: cards.length,
    avgCycleTimeDays: mean(cycleTimes),
    medianCycleTimeDays: median(cycleTimes),
    avgCardsPerWeek:
      weeks.length > 0 ? round2(cards.length / weeks.length) : null,
  };
}
