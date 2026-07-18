/**
 * Churn — the Equilibrium Meter's lagging indicator. Unlike the four axes
 * in signals.ts (leading indicators: care taken before calling something
 * done), churn measures whether that care actually held up: work that had
 * to be redone, regardless of whether the miss was technical or a scoping
 * problem. It acts as a damper on the composite score rather than a fifth
 * parallel axis (see composite.ts).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CHURN_WINDOW_DAYS, CHURN_WEIGHT, CHURN_DAMPER_FLOOR } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Counts churn events in the rolling window: failed verifications,
 * work-unit column regressions, story status regressions, and newly-linked
 * follow-up stories. Each source stores only its MOST RECENT event
 * timestamp (no separate event log — see the design spec), so a work
 * unit/story reopened multiple times within the window still counts once
 * per source. This is an intentional undercount that favors simplicity over
 * a full audit trail.
 */
export async function countChurnEvents(
  prismaClient: PrismaClient = prisma
): Promise<number> {
  const since = new Date(Date.now() - CHURN_WINDOW_DAYS * DAY_MS);

  const [failedVerifications, workUnitReopens, storyReopens, linkedFollowUps] =
    await Promise.all([
      prismaClient.workUnit.count({
        where: { verificationOutcome: "failed", verifiedAt: { gte: since } },
      }),
      prismaClient.workUnit.count({
        where: { lastReopenedAt: { gte: since } },
      }),
      prismaClient.story.count({
        where: { lastReopenedAt: { gte: since } },
      }),
      prismaClient.story.count({
        where: { lastLinkedFollowUpAt: { gte: since } },
      }),
    ]);

  return failedVerifications + workUnitReopens + storyReopens + linkedFollowUps;
}

/**
 * Each churn event dampens the composite score. Floors at
 * CHURN_DAMPER_FLOOR rather than 0 — a churny stretch should read as
 * clearly bad, but pinning at absolute zero would stop signaling direction
 * (improving vs. worsening), which undercuts the meter's purpose.
 */
export function computeChurnDamper(churnEvents: number): number {
  const raw = 1 - CHURN_WEIGHT * churnEvents;
  return Math.min(1, Math.max(CHURN_DAMPER_FLOOR, raw));
}
