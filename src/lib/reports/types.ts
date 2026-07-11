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

export interface TrendsReport {
  granularity: "day" | "week";
  buckets: string[]; // YYYY-MM-DD bucket starts, contiguous, zero-activity buckets included
  created: number[]; // cards created per bucket (archived included)
  completed: number[]; // cards completed per bucket (archived included)
  cumulativeCompleted: number[]; // running total of `completed` within the window
  wip: number[]; // in-flight count at each bucket END (see getTrends)
  activity: {
    movedToQa: number[];
    verifications: number[];
    storyCompletions: number[];
  };
}

export interface VerificationCapacityReport {
  granularity: "day" | "week";
  buckets: string[]; // YYYY-MM-DD bucket starts, contiguous (same rules as trends)
  generated: number[]; // cards created per bucket
  verified: number[]; // verifications completed (verifiedAt) per bucket
  queueDepth: number[]; // awaiting verification at each bucket END
  totalGenerated: number;
  totalVerified: number;
  capacityRatio: number | null; // totalVerified / totalGenerated; null when nothing generated
  avgVerificationLagDays: number | null; // verifiedAt - verificationRequestedAt
  medianVerificationLagDays: number | null;
  completedInWindow: number;
  completedVerified: number; // completed with a passed verification
  verifiedCompletionRate: number | null; // completedVerified / completedInWindow (0..1)
}

export interface ReportsPayload {
  completedWork: CompletedWorkReport;
  throughput: ThroughputReport;
  statusSnapshot: StatusSnapshotReport;
  jiraTrail: JiraTrailReport;
  trends: TrendsReport;
  verificationCapacity: VerificationCapacityReport;
}
