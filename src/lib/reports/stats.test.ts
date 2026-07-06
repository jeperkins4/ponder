/**
 * Pure unit tests for the report math helpers — no database.
 */

import { describe, it, expect } from "vitest";
import {
  round2,
  mean,
  median,
  cycleTimeDays,
  isoWeekStartUtc,
  isoDayUtc,
  buildWeeklyBuckets,
} from "./stats";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(3.14159)).toBe(3.14);
    expect(round2(2.005)).toBe(2.01);
    expect(round2(5)).toBe(5);
  });
});

describe("mean", () => {
  it("returns null for an empty list", () => {
    expect(mean([])).toBeNull();
  });

  it("averages and rounds", () => {
    expect(mean([1, 2, 4])).toBe(2.33);
  });
});

describe("median", () => {
  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });

  it("returns the middle value for an odd count", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("returns the mean of the middle two for an even count", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe("cycleTimeDays", () => {
  it("returns fractional days rounded to 2 decimals", () => {
    const created = new Date("2026-07-01T00:00:00.000Z");
    const completed = new Date("2026-07-02T12:00:00.000Z");
    expect(cycleTimeDays(created, completed)).toBe(1.5);
  });
});

describe("isoWeekStartUtc", () => {
  it("maps a Wednesday to the preceding Monday", () => {
    // 2026-07-01 is a Wednesday
    expect(isoWeekStartUtc(new Date("2026-07-01T15:30:00.000Z"))).toBe("2026-06-29");
  });

  it("maps a Monday to itself", () => {
    expect(isoWeekStartUtc(new Date("2026-06-29T00:00:00.000Z"))).toBe("2026-06-29");
  });

  it("maps a Sunday to the Monday six days earlier", () => {
    // 2026-07-05 is a Sunday
    expect(isoWeekStartUtc(new Date("2026-07-05T23:59:59.000Z"))).toBe("2026-06-29");
  });
});

describe("isoDayUtc", () => {
  it("returns the UTC calendar day as YYYY-MM-DD", () => {
    expect(isoDayUtc(new Date("2026-07-06T15:30:00.000Z"))).toBe("2026-07-06");
  });

  it("uses the UTC day, not the local day", () => {
    expect(isoDayUtc(new Date("2026-07-06T23:59:59.999Z"))).toBe("2026-07-06");
    expect(isoDayUtc(new Date("2026-07-07T00:00:00.000Z"))).toBe("2026-07-07");
  });
});

describe("buildWeeklyBuckets", () => {
  it("returns an empty array for no cards", () => {
    expect(buildWeeklyBuckets([])).toEqual([]);
  });

  it("groups completions into Monday-start weeks with cycle stats", () => {
    const buckets = buildWeeklyBuckets([
      {
        createdAt: new Date("2026-06-29T00:00:00.000Z"),
        completedAt: new Date("2026-06-30T00:00:00.000Z"), // week 2026-06-29, cycle 1d
      },
      {
        createdAt: new Date("2026-06-28T00:00:00.000Z"),
        completedAt: new Date("2026-07-01T00:00:00.000Z"), // week 2026-06-29, cycle 3d
      },
    ]);
    expect(buckets).toEqual([
      {
        weekStart: "2026-06-29",
        completedCount: 2,
        avgCycleTimeDays: 2,
        medianCycleTimeDays: 2,
      },
    ]);
  });

  it("fills zero-completion weeks between the first and last bucket", () => {
    const buckets = buildWeeklyBuckets([
      {
        createdAt: new Date("2026-06-15T00:00:00.000Z"),
        completedAt: new Date("2026-06-16T00:00:00.000Z"), // week 2026-06-15
      },
      {
        createdAt: new Date("2026-06-29T00:00:00.000Z"),
        completedAt: new Date("2026-06-30T00:00:00.000Z"), // week 2026-06-29
      },
    ]);
    expect(buckets.map((b) => b.weekStart)).toEqual([
      "2026-06-15",
      "2026-06-22",
      "2026-06-29",
    ]);
    expect(buckets[1]).toEqual({
      weekStart: "2026-06-22",
      completedCount: 0,
      avgCycleTimeDays: null,
      medianCycleTimeDays: null,
    });
  });
});
