/**
 * Pure math helpers for the report layer — no database access.
 * Cycle times are fractional days rounded to 2 decimals; weekly buckets are
 * Monday-start ISO weeks in UTC.
 */

import type { WeeklyBucket } from "./types";

const MS_PER_DAY = 86_400_000;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

export function cycleTimeDays(createdAt: Date, completedAt: Date): number {
  return round2((completedAt.getTime() - createdAt.getTime()) / MS_PER_DAY);
}

/** Monday-start ISO week (UTC) containing `date`, as YYYY-MM-DD. */
export function isoWeekStartUtc(date: Date): string {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - daysSinceMonday);
  return day.toISOString().slice(0, 10);
}

/** UTC calendar day containing `date`, as YYYY-MM-DD. */
export function isoDayUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Buckets completed cards into Monday-start UTC weeks. Weeks with zero
 * completions between the first and last bucket are included so charts
 * don't skip gaps.
 */
export function buildWeeklyBuckets(
  cards: { createdAt: Date; completedAt: Date }[]
): WeeklyBucket[] {
  if (cards.length === 0) return [];

  const cycleTimesByWeek = new Map<string, number[]>();
  for (const card of cards) {
    const week = isoWeekStartUtc(card.completedAt);
    const cycleTimes = cycleTimesByWeek.get(week) ?? [];
    cycleTimes.push(cycleTimeDays(card.createdAt, card.completedAt));
    cycleTimesByWeek.set(week, cycleTimes);
  }

  const weeks = [...cycleTimesByWeek.keys()].sort();
  const first = new Date(`${weeks[0]}T00:00:00.000Z`);
  const last = new Date(`${weeks[weeks.length - 1]}T00:00:00.000Z`);

  const buckets: WeeklyBucket[] = [];
  for (
    let cursor = first;
    cursor.getTime() <= last.getTime();
    cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY)
  ) {
    const weekStart = cursor.toISOString().slice(0, 10);
    const cycleTimes = cycleTimesByWeek.get(weekStart) ?? [];
    buckets.push({
      weekStart,
      completedCount: cycleTimes.length,
      avgCycleTimeDays: mean(cycleTimes),
      medianCycleTimeDays: median(cycleTimes),
    });
  }
  return buckets;
}
