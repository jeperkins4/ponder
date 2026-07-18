/**
 * GET /api/equilibrium - Equilibrium Meter payload for the header widget.
 * Instance-wide (no project filter) — Phase 1 is single-instance by design,
 * matching Ponder's "each dev runs their own instance" model.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTodaysSnapshot, getSnapshotHistory } from "@/lib/equilibrium/snapshot";
import { getStreaks } from "@/lib/equilibrium/streaks";
import { checkAndAwardBadges, getBadgeStatus } from "@/lib/equilibrium/badges";
import { computeChurnDamper } from "@/lib/equilibrium/churn";
import type { EquilibriumPayload } from "@/lib/equilibrium/types";

export async function GET() {
  try {
    const streaks = await getStreaks(prisma);
    const snapshot = await getTodaysSnapshot(prisma);
    await checkAndAwardBadges(prisma, snapshot, streaks);
    const [badges, history] = await Promise.all([
      getBadgeStatus(prisma),
      getSnapshotHistory(prisma),
    ]);

    const payload: EquilibriumPayload = {
      overall: snapshot.overall,
      band: snapshot.band,
      axes: {
        decomposition: snapshot.decomposition,
        rigor: snapshot.rigor,
        wip: snapshot.wip,
        staleness: snapshot.staleness,
      },
      churnEvents: snapshot.churnEvents,
      churnDamper: computeChurnDamper(snapshot.churnEvents),
      streaks,
      badges,
      history: history.map((h) => ({ date: h.date, overall: h.overall, band: h.band })),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error building equilibrium payload:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
