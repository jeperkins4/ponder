/**
 * Integration tests for the lazy daily MeterSnapshot: computed once per UTC
 * day, cached on every subsequent read that same day.
 */

import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { getTodaysSnapshot, getSnapshotHistory } from "./snapshot";

afterEach(async () => {
  await prisma.meterSnapshot.deleteMany({});
});

describe("getTodaysSnapshot", () => {
  it("computes and persists a snapshot on first read", async () => {
    const snapshot = await getTodaysSnapshot(prisma);
    expect(snapshot.overall).toBeGreaterThanOrEqual(0);
    expect(["equilibrium", "drifting", "out"]).toContain(snapshot.band);

    const rows = await prisma.meterSnapshot.findMany();
    expect(rows).toHaveLength(1);
  });

  it("returns the cached row on a second read the same day, not a fresh computation", async () => {
    const first = await getTodaysSnapshot(prisma);
    await prisma.meterSnapshot.updateMany({ data: { overall: 42, band: "out" } });

    const second = await getTodaysSnapshot(prisma);
    expect(second.overall).toBe(42);
    expect(second.band).toBe("out");
    expect(second.date).toBe(first.date);

    const rows = await prisma.meterSnapshot.findMany();
    expect(rows).toHaveLength(1);
  });
});

describe("getSnapshotHistory", () => {
  it("returns snapshots within the requested window, oldest first", async () => {
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        decomposition: 100,
        rigor: 100,
        wip: 100,
        staleness: 100,
        churnEvents: 0,
        overall: 100,
        band: "equilibrium",
      },
    });
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        decomposition: 50,
        rigor: 50,
        wip: 50,
        staleness: 50,
        churnEvents: 2,
        overall: 50,
        band: "drifting",
      },
    });

    const history = await getSnapshotHistory(prisma, 30);
    expect(history).toHaveLength(2);
    expect(history[0].overall).toBe(100);
    expect(history[1].overall).toBe(50);
  });

  it("excludes snapshots older than the requested window", async () => {
    await prisma.meterSnapshot.create({
      data: {
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        decomposition: 100,
        rigor: 100,
        wip: 100,
        staleness: 100,
        churnEvents: 0,
        overall: 100,
        band: "equilibrium",
      },
    });

    const history = await getSnapshotHistory(prisma, 30);
    expect(history).toHaveLength(0);
  });
});
