/**
 * Combines the four leading-indicator axes (signals.ts) with the churn
 * damper (churn.ts) into the Equilibrium Meter's single headline score.
 */

import type { AxisScores, Band, EquilibriumComposite } from "./types";
import { BAND_EQUILIBRIUM_MIN, BAND_DRIFTING_MIN } from "./constants";
import { computeChurnDamper } from "./churn";

export function computeBand(overall: number): Band {
  if (overall >= BAND_EQUILIBRIUM_MIN) return "equilibrium";
  if (overall >= BAND_DRIFTING_MIN) return "drifting";
  return "out";
}

export function computeComposite(
  axes: AxisScores,
  churnEvents: number
): EquilibriumComposite {
  const average = (axes.decomposition + axes.rigor + axes.wip + axes.staleness) / 4;
  const churnDamper = computeChurnDamper(churnEvents);
  const overall = Math.round(average * churnDamper);
  return { overall, band: computeBand(overall), churnEvents, churnDamper };
}
