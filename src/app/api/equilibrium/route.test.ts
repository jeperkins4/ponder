/**
 * Integration tests for GET /api/equilibrium against the test database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

beforeEach(async () => {
  // Clear all work units to ensure a genuinely empty instance
  // (decomposition axis depends on open, non-spec'd work units).
  // Follows the repo convention (vitest.setup.ts, vitest.config.ts):
  // DB-backed suites blanket deleteMany for clean isolation.
  await prisma.attachment.deleteMany({});
  await prisma.workNote.deleteMany({});
  await prisma.workUnit.deleteMany({});
  await prisma.story.deleteMany({});
  await prisma.project.deleteMany({});
  // Clear meterSnapshot (balanceStreak is computed from snapshots, so stale
  // snapshots from previous tests would inflate the streak count)
  await prisma.meterSnapshot.deleteMany({});
  // Clear badges from previous tests
  await prisma.badge.deleteMany({});
});

afterEach(async () => {
  await prisma.badge.deleteMany({});
  await prisma.meterSnapshot.deleteMany({});
});

describe("GET /api/equilibrium", () => {
  it("returns a full payload with sensible defaults on an empty instance", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.overall).toBe(100);
    expect(body.band).toBe("equilibrium");
    expect(body.axes).toEqual({ decomposition: 100, rigor: 100, wip: 100, staleness: 100 });
    expect(body.churnEvents).toBe(0);
    expect(body.churnDamper).toBe(1);
    expect(body.streaks).toEqual({ rigorStreak: 0, balanceStreak: 0 });
    expect(body.badges.length).toBeGreaterThan(0);
    expect(body.badges.find((b: { key: string }) => b.key === "in_equilibrium").earnedAt).not.toBeNull();
    expect(body.history).toHaveLength(1);
  });

  it("persists exactly one snapshot across repeated calls the same day", async () => {
    await GET();
    await GET();
    const rows = await prisma.meterSnapshot.findMany();
    expect(rows).toHaveLength(1);
  });
});
