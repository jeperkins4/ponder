/**
 * Shared types for the Equilibrium Meter gamification layer. See
 * docs/superpowers/specs/2026-07-17-equilibrium-meter-gamification-design.md
 */

export type Band = "equilibrium" | "drifting" | "out";

export interface AxisScores {
  decomposition: number;
  rigor: number;
  wip: number;
  staleness: number;
}

export interface EquilibriumComposite {
  overall: number;
  band: Band;
  churnEvents: number;
  churnDamper: number;
}

export interface EquilibriumSnapshotDTO extends AxisScores {
  date: string; // YYYY-MM-DD
  churnEvents: number;
  overall: number;
  band: Band;
}

export interface StreaksDTO {
  rigorStreak: number;
  balanceStreak: number;
}

export interface BadgeDefinition {
  key: string;
  label: string;
  condition: string;
}

export interface BadgeStatusDTO extends BadgeDefinition {
  earnedAt: string | null;
}

export interface EquilibriumPayload {
  overall: number;
  band: Band;
  axes: AxisScores;
  churnEvents: number;
  churnDamper: number;
  streaks: StreaksDTO;
  badges: BadgeStatusDTO[];
  history: { date: string; overall: number; band: Band }[];
}
