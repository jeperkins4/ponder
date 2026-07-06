/**
 * Time-series trends report: contiguous daily (<=35-day window) or weekly
 * buckets carrying created/completed counts, a window-local cumulative
 * completed total, WIP at each bucket end, and the three JIRA-activity
 * event series. Parallel arrays, one entry per bucket.
 *
 * WIP at a bucket's END (bucketEnd = start of the next bucket, the
 * exclusive upper edge): createdAt < bucketEnd AND (completedAt null or
 * >= bucketEnd) AND (archivedAt null or >= bucketEnd).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isoDayUtc, isoWeekStartUtc } from "./stats";
import type { ReportFilters, TrendsReport } from "./types";

const MS_PER_DAY = 86_400_000;
const MAX_DAILY_SPAN_DAYS = 35;

function emptyReport(): TrendsReport {
  return {
    granularity: "day",
    buckets: [],
    created: [],
    completed: [],
    cumulativeCompleted: [],
    wip: [],
    activity: { movedToQa: [], verifications: [], storyCompletions: [] },
  };
}

export async function getTrends(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<TrendsReport> {
  const units = await prismaClient.workUnit.findMany({
    where: filters.projectId ? { story: { projectId: filters.projectId } } : {},
    select: {
      createdAt: true,
      completedAt: true,
      archivedAt: true,
      movedToQaReportedAt: true,
      verifiedAt: true,
    },
  });
  const completedStories = await prismaClient.story.findMany({
    where: {
      completionCommentPostedAt: { not: null },
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
    },
    select: { completionCommentPostedAt: true },
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

  const created = zeros();
  const completed = zeros();
  const movedToQa = zeros();
  const verifications = zeros();
  const storyCompletions = zeros();

  const countInto = (series: number[], date: Date | null) => {
    if (!date || date < from || date > to) return;
    const index = indexByBucket.get(bucketOf(date));
    if (index !== undefined) series[index] += 1;
  };

  for (const unit of units) {
    countInto(created, unit.createdAt);
    countInto(completed, unit.completedAt);
    countInto(movedToQa, unit.movedToQaReportedAt);
    countInto(verifications, unit.verifiedAt);
  }
  for (const story of completedStories) {
    countInto(storyCompletions, story.completionCommentPostedAt);
  }

  const cumulativeCompleted: number[] = [];
  let runningTotal = 0;
  for (const count of completed) {
    runningTotal += count;
    cumulativeCompleted.push(runningTotal);
  }

  const wip = buckets.map((bucket) => {
    const bucketEnd = new Date(
      new Date(`${bucket}T00:00:00.000Z`).getTime() + stepMs
    );
    return units.filter(
      (unit) =>
        unit.createdAt < bucketEnd &&
        (unit.completedAt === null || unit.completedAt >= bucketEnd) &&
        (unit.archivedAt === null || unit.archivedAt >= bucketEnd)
    ).length;
  });

  return {
    granularity,
    buckets,
    created,
    completed,
    cumulativeCompleted,
    wip,
    activity: { movedToQa, verifications, storyCompletions },
  };
}
