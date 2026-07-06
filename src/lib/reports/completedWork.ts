/**
 * Completed-work history report: work units with completedAt in range,
 * INCLUDING archived cards (Move-to-QA archiving does not erase completion),
 * grouped by story, newest completion first.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CompletedStoryGroup,
  CompletedWorkReport,
  ReportFilters,
} from "./types";

export async function getCompletedWork(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<CompletedWorkReport> {
  const workUnits = await prismaClient.workUnit.findMany({
    where: {
      completedAt: {
        not: null,
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
      ...(filters.projectId ? { story: { projectId: filters.projectId } } : {}),
    },
    include: {
      story: {
        select: { id: true, jiraKey: true, summary: true, jiraStatus: true },
      },
    },
    orderBy: { completedAt: "desc" },
  });

  // The list is completedAt-desc, so a story's first appearance is its latest
  // completion — Map insertion order gives "stories by latest completion desc"
  // and cards within a story arrive already sorted desc.
  const groups = new Map<string, CompletedStoryGroup>();
  for (const unit of workUnits) {
    let group = groups.get(unit.story.id);
    if (!group) {
      group = {
        jiraKey: unit.story.jiraKey,
        summary: unit.story.summary,
        jiraStatus: unit.story.jiraStatus,
        cards: [],
      };
      groups.set(unit.story.id, group);
    }
    group.cards.push({
      id: unit.id,
      title: unit.title,
      subNumber: unit.subNumber,
      completedAt: (unit.completedAt as Date).toISOString(),
      archivedAt: unit.archivedAt?.toISOString() ?? null,
      verificationOutcome: unit.verificationOutcome as "passed" | "failed" | null,
    });
  }

  return {
    stories: [...groups.values()],
    totalCards: workUnits.length,
    totalStories: groups.size,
  };
}
