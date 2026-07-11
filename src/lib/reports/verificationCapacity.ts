/**
 * Verification capacity vs generation capacity — the report that asks
 * whether checking is keeping pace with making.
 *
 * Per bucket (same day/week bucketing rules as trends.ts): cards generated
 * (createdAt), verifications completed (verifiedAt), and the verification
 * queue depth at the bucket's END (requested but not yet verified, and not
 * archived). Summary stats: the capacity ratio (verified / generated in
 * window), verification lag (verifiedAt - verificationRequestedAt, fractional
 * days), and the verified-completion rate — the share of cards completed in
 * the window that carry a passed verification. Completions without one are
 * unverified completions: accountability debt, made visible.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isoDayUtc, isoWeekStartUtc, mean, median, round2 } from "./stats";
import type { ReportFilters, VerificationCapacityReport } from "./types";

const MS_PER_DAY = 86_400_000;
const MAX_DAILY_SPAN_DAYS = 35;

function emptyReport(): VerificationCapacityReport {
  return {
    granularity: "day",
    buckets: [],
    generated: [],
    verified: [],
    queueDepth: [],
    totalGenerated: 0,
    totalVerified: 0,
    capacityRatio: null,
    avgVerificationLagDays: null,
    medianVerificationLagDays: null,
    completedInWindow: 0,
    completedVerified: 0,
    verifiedCompletionRate: null,
  };
}

export async function getVerificationCapacity(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<VerificationCapacityReport> {
  const units = await prismaClient.workUnit.findMany({
    where: filters.projectId ? { story: { projectId: filters.projectId } } : {},
    select: {
      createdAt: true,
      completedAt: true,
      archivedAt: true,
      verificationRequestedAt: true,
      verifiedAt: true,
      verificationOutcome: true,
    },
  });

  if (units.length === 0) return emptyReport();

  const earliestCreated = units.reduce(
    (min, unit) => (unit.createdAt < min ? unit.createdAt : min),
    units[0].createdAt
  );
  const from = filters.from ?? earliestCreated;
  const to = filters.to ?? new Date();
  if (from > to) return emptyReport();

  const spanDays = (to.getTime() - from.getTime()) / MS_PER_DAY;
  const granularity: "day" | "week" =
    spanDays <= MAX_DAILY_SPAN_DAYS ? "day" : "week";
  const bucketOf = granularity === "day" ? isoDayUtc : isoWeekStartUtc;
  const stepMs = granularity === "day" ? MS_PER_DAY : 7 * MS_PER_DAY;

  const buckets: string[] = [];
  const first = new Date(`${bucketOf(from)}T00:00:00.000Z`);
  const last = new Date(`${bucketOf(to)}T00:00:00.000Z`);
  for (
    let cursor = first;
    cursor.getTime() <= last.getTime();
    cursor = new Date(cursor.getTime() + stepMs)
  ) {
    buckets.push(cursor.toISOString().slice(0, 10));
  }

  const indexByBucket = new Map(buckets.map((bucket, i) => [bucket, i]));
  const zeros = () => buckets.map(() => 0);

  const generated = zeros();
  const verified = zeros();

  const countInto = (series: number[], date: Date | null) => {
    if (!date || date < from || date > to) return;
    const index = indexByBucket.get(bucketOf(date));
    if (index !== undefined) series[index] += 1;
  };

  for (const unit of units) {
    countInto(generated, unit.createdAt);
    countInto(verified, unit.verifiedAt);
  }

  // Queue depth at each bucket's END: verification requested before the
  // bucket edge, not yet verified at that edge, and the card not archived
  // before it (an archived card no longer demands verification capacity).
  const queueDepth = buckets.map((bucket) => {
    const bucketEnd = new Date(
      new Date(`${bucket}T00:00:00.000Z`).getTime() + stepMs
    );
    return units.filter(
      (unit) =>
        unit.verificationRequestedAt !== null &&
        unit.verificationRequestedAt < bucketEnd &&
        (unit.verifiedAt === null || unit.verifiedAt >= bucketEnd) &&
        (unit.archivedAt === null || unit.archivedAt >= bucketEnd)
    ).length;
  });

  const totalGenerated = generated.reduce((sum, n) => sum + n, 0);
  const totalVerified = verified.reduce((sum, n) => sum + n, 0);
  const capacityRatio =
    totalGenerated > 0 ? round2(totalVerified / totalGenerated) : null;

  // Lag is attributed to the bucket window the verification LANDED in.
  const lags = units
    .filter(
      (unit) =>
        unit.verifiedAt !== null &&
        unit.verificationRequestedAt !== null &&
        unit.verifiedAt >= from &&
        unit.verifiedAt <= to
    )
    .map((unit) =>
      round2(
        (unit.verifiedAt!.getTime() - unit.verificationRequestedAt!.getTime()) /
          MS_PER_DAY
      )
    );

  const completedUnits = units.filter(
    (unit) =>
      unit.completedAt !== null &&
      unit.completedAt >= from &&
      unit.completedAt <= to
  );
  const completedVerified = completedUnits.filter(
    (unit) => unit.verificationOutcome === "passed"
  ).length;

  return {
    granularity,
    buckets,
    generated,
    verified,
    queueDepth,
    totalGenerated,
    totalVerified,
    capacityRatio,
    avgVerificationLagDays: mean(lags),
    medianVerificationLagDays: median(lags),
    completedInWindow: completedUnits.length,
    completedVerified,
    verifiedCompletionRate:
      completedUnits.length > 0
        ? round2(completedVerified / completedUnits.length)
        : null,
  };
}
