/**
 * Report-layer filter and DTO types.
 *
 * Dates in DTOs are ISO strings (matching src/lib/types.ts conventions);
 * the Prisma Date -> ISO conversion happens inside src/lib/reports/ so every
 * consumer (API route, /reports page, MCP tools, future digest) sees the
 * same serialized shape.
 */

import type { Column } from "@/lib/types";

export interface ReportFilters {
  projectId?: string; // omitted = all projects
  from?: Date; // omitted = beginning of time; inclusive
  to?: Date; // omitted = now; inclusive
}

interface CompletedCard {
  id: string;
  title: string;
  subNumber: number | null;
  completedAt: string; // ISO string
  archivedAt: string | null; // ISO string
  verificationOutcome: "passed" | "failed" | null;
}

export interface CompletedStoryGroup {
  jiraKey: string;
  summary: string;
  jiraStatus: string;
  cards: CompletedCard[];
}

export interface CompletedWorkReport {
  stories: CompletedStoryGroup[];
  totalCards: number;
  totalStories: number;
}

export interface WeeklyBucket {
  weekStart: string; // Monday-start ISO week (UTC) as YYYY-MM-DD
  completedCount: number;
  avgCycleTimeDays: number | null; // null when completedCount is 0
  medianCycleTimeDays: number | null; // null when completedCount is 0
}

export interface ThroughputReport {
  weeks: WeeklyBucket[];
  totalCompleted: number;
  avgCycleTimeDays: number | null;
  medianCycleTimeDays: number | null;
  avgCardsPerWeek: number | null; // totalCompleted / weeks.length; null when no weeks
}

export interface SnapshotStoryRow {
  jiraKey: string;
  summary: string;
  jiraStatus: string;
  columnCounts: Record<Column, number>;
}

export interface StatusSnapshotReport {
  stories: SnapshotStoryRow[]; // ordered by jiraKey; zero-active-card stories omitted
  columnTotals: Record<Column, number>;
  awaitingVerification: number; // verificationRequestedAt set, verifiedAt null
  failedVerification: number; // verificationOutcome === "failed" on an active card
}

type JiraTrailEventType = "moved_to_qa" | "verification" | "story_completed";

export interface JiraTrailEvent {
  type: JiraTrailEventType;
  jiraKey: string;
  detail: string; // card title (work-unit events) or story summary (story_completed)
  timestamp: string; // ISO string
  outcome?: "passed" | "failed"; // verification events only
}

export interface JiraTrailReport {
  events: JiraTrailEvent[]; // newest first
}

export interface ReportsPayload {
  completedWork: CompletedWorkReport;
  throughput: ThroughputReport;
  statusSnapshot: StatusSnapshotReport;
  jiraTrail: JiraTrailReport;
}
