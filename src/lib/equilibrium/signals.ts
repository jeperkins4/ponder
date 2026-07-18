/**
 * The Equilibrium Meter's four leading-indicator axis scores — each a live
 * 0-100 value computed from current WorkUnit state. See the design spec for
 * the two-tension framing (decomposition + rigor = speed vs. rigor;
 * wip + staleness = present vs. future self).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AxisScores } from "./types";
import { WIP_LIMIT, STALENESS_DAYS, RIGOR_WINDOW_DAYS } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;

/** % of open (non-done, non-archived) work units with both
 * acceptanceCriteria and verification populated — a well-specified backlog.
 * 100 when there are no open work units (nothing under-specified to
 * penalize). */
export async function getDecompositionScore(
  prismaClient: PrismaClient = prisma
): Promise<number> {
  const open = await prismaClient.workUnit.findMany({
    where: { archivedAt: null, column: { not: "done" } },
    select: { acceptanceCriteria: true, verification: true },
  });
  if (open.length === 0) return 100;

  const wellSpecified = open.filter(
    (u) => !!u.acceptanceCriteria?.trim() && !!u.verification?.trim()
  ).length;
  return Math.round((wellSpecified / open.length) * 100);
}

/** % of work units moved to QA in the last RIGOR_WINDOW_DAYS that had
 * verificationRequestedAt set AND at least one attachment created at or
 * before that move — i.e. evidence was actually attached, not skipped. 100
 * when nothing moved to QA in the window (nothing to penalize). */
export async function getRigorScore(
  prismaClient: PrismaClient = prisma
): Promise<number> {
  const since = new Date(Date.now() - RIGOR_WINDOW_DAYS * DAY_MS);
  const movedToQa = await prismaClient.workUnit.findMany({
    where: { movedToQaReportedAt: { gte: since } },
    select: {
      movedToQaReportedAt: true,
      verificationRequestedAt: true,
      attachments: { select: { createdAt: true } },
    },
  });
  if (movedToQa.length === 0) return 100;

  const withEvidence = movedToQa.filter((u) => {
    if (!u.verificationRequestedAt) return false;
    const qaAt = u.movedToQaReportedAt as Date;
    return u.attachments.some((a) => a.createdAt <= qaAt);
  }).length;
  return Math.round((withEvidence / movedToQa.length) * 100);
}

/** 100 at/under WIP_LIMIT non-archived in_progress work units, decaying 25
 * points per unit over the limit, floored at 0. */
export async function getWipScore(
  prismaClient: PrismaClient = prisma
): Promise<number> {
  const count = await prismaClient.workUnit.count({
    where: { archivedAt: null, column: "in_progress" },
  });
  const over = Math.max(0, count - WIP_LIMIT);
  return Math.max(0, 100 - over * 25);
}

/** % of open (non-done, non-archived) work units whose most recent activity
 * (own updatedAt, or a WorkNote/Attachment created since) is within
 * STALENESS_DAYS. 100 when there are no open work units. */
export async function getStalenessScore(
  prismaClient: PrismaClient = prisma
): Promise<number> {
  const open = await prismaClient.workUnit.findMany({
    where: { archivedAt: null, column: { not: "done" } },
    select: {
      updatedAt: true,
      workNotes: { select: { createdAt: true } },
      attachments: { select: { createdAt: true } },
    },
  });
  if (open.length === 0) return 100;

  const staleCutoff = Date.now() - STALENESS_DAYS * DAY_MS;
  const stale = open.filter((u) => {
    const timestamps = [
      u.updatedAt.getTime(),
      ...u.workNotes.map((n) => n.createdAt.getTime()),
      ...u.attachments.map((a) => a.createdAt.getTime()),
    ];
    return Math.max(...timestamps) < staleCutoff;
  }).length;
  return Math.round(100 - (stale / open.length) * 100);
}

export async function getAxisScores(
  prismaClient: PrismaClient = prisma
): Promise<AxisScores> {
  const [decomposition, rigor, wip, staleness] = await Promise.all([
    getDecompositionScore(prismaClient),
    getRigorScore(prismaClient),
    getWipScore(prismaClient),
    getStalenessScore(prismaClient),
  ]);
  return { decomposition, rigor, wip, staleness };
}
