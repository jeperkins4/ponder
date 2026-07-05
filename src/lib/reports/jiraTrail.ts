/**
 * JIRA reporting trail: a chronological event list (newest first) derived
 * from existing timestamps — Move-to-QA reports, verification outcomes, and
 * story completion comments. No new event table; archived cards included
 * (Move-to-QA archives the cards it reports on).
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { JiraTrailEvent, JiraTrailReport, ReportFilters } from "./types";

export async function getJiraTrail(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<JiraTrailReport> {
  const range = {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lte: filters.to } : {}),
  };
  const workUnitProjectScope = filters.projectId
    ? { story: { projectId: filters.projectId } }
    : {};

  const [qaReports, verifications, completedStories] = await Promise.all([
    prismaClient.workUnit.findMany({
      where: { movedToQaReportedAt: { not: null, ...range }, ...workUnitProjectScope },
      select: {
        title: true,
        movedToQaReportedAt: true,
        story: { select: { jiraKey: true } },
      },
    }),
    prismaClient.workUnit.findMany({
      where: { verifiedAt: { not: null, ...range }, ...workUnitProjectScope },
      select: {
        title: true,
        verifiedAt: true,
        verificationOutcome: true,
        story: { select: { jiraKey: true } },
      },
    }),
    prismaClient.story.findMany({
      where: {
        completionCommentPostedAt: { not: null, ...range },
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
      },
      select: { jiraKey: true, summary: true, completionCommentPostedAt: true },
    }),
  ]);

  const events: JiraTrailEvent[] = [
    ...qaReports.map((unit) => ({
      type: "moved_to_qa" as const,
      jiraKey: unit.story.jiraKey,
      detail: unit.title,
      timestamp: (unit.movedToQaReportedAt as Date).toISOString(),
    })),
    ...verifications.map((unit) => ({
      type: "verification" as const,
      jiraKey: unit.story.jiraKey,
      detail: unit.title,
      timestamp: (unit.verifiedAt as Date).toISOString(),
      ...(unit.verificationOutcome
        ? { outcome: unit.verificationOutcome as "passed" | "failed" }
        : {}),
    })),
    ...completedStories.map((story) => ({
      type: "story_completed" as const,
      jiraKey: story.jiraKey,
      detail: story.summary,
      timestamp: (story.completionCommentPostedAt as Date).toISOString(),
    })),
  ];

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { events };
}
