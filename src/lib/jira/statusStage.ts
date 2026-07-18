/**
 * Canonical ordering of Ponder's known JIRA workflow stages, used to detect
 * when a story's status regresses (moves backward) between syncs — a churn
 * signal for the Equilibrium Meter. Statuses outside this map (custom
 * workflow stages) rank as `undefined`; regression can't be safely judged
 * without a known position, so callers must treat that as "not a
 * regression" rather than guessing.
 */
const STAGE_RANK: Record<string, number> = {
  "to do": 0,
  "in progress": 1,
  "code review": 2,
  qa: 3,
  done: 4,
};

/** Treats "Code Revew" (a real misspelling used by some JIRA workflows) and
 * "Code Review" as the same stage — same normalization as
 * pickTransitionByStatusName in transitions.ts. */
function normalizeStatusStage(name: string): string {
  return name.trim().toLowerCase().replace(/code revew/, "code review");
}

/** This status's position in Ponder's known workflow, or `undefined` if this
 * map doesn't recognize it. */
export function statusStageRank(name: string): number | undefined {
  return STAGE_RANK[normalizeStatusStage(name)];
}

/**
 * True only when both statuses are recognized AND the new one is strictly
 * earlier in the workflow than the old one. Unrecognized statuses on either
 * side never count as a regression.
 */
export function isStatusRegression(oldStatus: string, newStatus: string): boolean {
  const oldRank = statusStageRank(oldStatus);
  const newRank = statusStageRank(newStatus);
  if (oldRank === undefined || newRank === undefined) return false;
  return newRank < oldRank;
}
