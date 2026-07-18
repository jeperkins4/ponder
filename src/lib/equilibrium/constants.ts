/**
 * Equilibrium Meter tuning constants. Hardcoded for v1, not per-project
 * settings — see the design spec's Non-Goals.
 */
export const WIP_LIMIT = 3;
export const STALENESS_DAYS = 5;
export const RIGOR_WINDOW_DAYS = 14;
export const CHURN_WINDOW_DAYS = 14;
export const CHURN_WEIGHT = 0.08;
export const CHURN_DAMPER_FLOOR = 0.15;
export const BAND_EQUILIBRIUM_MIN = 80;
export const BAND_DRIFTING_MIN = 50;
