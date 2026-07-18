/**
 * Lazily computed, once-per-day MeterSnapshot: the first read on a given UTC
 * day computes and persists the Equilibrium Meter's state; every later read
 * that same day returns the cached row. No cron job — matches this app's
 * request-driven-computation pattern (see src/lib/reports/snapshot.ts).
 */

import { MeterSnapshot, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Band, EquilibriumSnapshotDTO } from "./types";
import { getAxisScores } from "./signals";
import { countChurnEvents } from "./churn";
import { computeComposite } from "./composite";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toSnapshotDTO(row: MeterSnapshot): EquilibriumSnapshotDTO {
  return {
    date: row.date.toISOString().slice(0, 10),
    decomposition: row.decomposition,
    rigor: row.rigor,
    wip: row.wip,
    staleness: row.staleness,
    churnEvents: row.churnEvents,
    overall: row.overall,
    band: row.band as Band,
  };
}

export async function getTodaysSnapshot(
  prismaClient: PrismaClient = prisma
): Promise<EquilibriumSnapshotDTO> {
  const today = startOfUTCDay(new Date());

  const existing = await prismaClient.meterSnapshot.findUnique({ where: { date: today } });
  if (existing) {
    return toSnapshotDTO(existing);
  }

  const axes = await getAxisScores(prismaClient);
  const churnEvents = await countChurnEvents(prismaClient);
  const composite = computeComposite(axes, churnEvents);

  try {
    const created = await prismaClient.meterSnapshot.create({
      data: {
        date: today,
        decomposition: axes.decomposition,
        rigor: axes.rigor,
        wip: axes.wip,
        staleness: axes.staleness,
        churnEvents,
        overall: composite.overall,
        band: composite.band,
      },
    });
    return toSnapshotDTO(created);
  } catch (err) {
    // A concurrent request on the same day can race to create today's row;
    // the loser just reads back what the winner created.
    const retryExisting = await prismaClient.meterSnapshot.findUnique({ where: { date: today } });
    if (retryExisting) return toSnapshotDTO(retryExisting);
    throw err;
  }
}

export async function getSnapshotHistory(
  prismaClient: PrismaClient = prisma,
  days = 30
): Promise<EquilibriumSnapshotDTO[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prismaClient.meterSnapshot.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "asc" },
  });
  return rows.map(toSnapshotDTO);
}
