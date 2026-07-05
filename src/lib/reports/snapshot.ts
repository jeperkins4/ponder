/**
 * Current status snapshot: active (archivedAt: null) cards only, counted per
 * column per story, plus verification-state tallies. Ignores from/to — the
 * snapshot is "right now" by definition — but honors projectId.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Column } from "@/lib/types";
import type {
  ReportFilters,
  SnapshotStoryRow,
  StatusSnapshotReport,
} from "./types";

function emptyColumnCounts(): Record<Column, number> {
  return { todo: 0, in_progress: 0, code_review: 0, done: 0 };
}

export async function getStatusSnapshot(
  filters: ReportFilters,
  prismaClient: PrismaClient = prisma
): Promise<StatusSnapshotReport> {
  const workUnits = await prismaClient.workUnit.findMany({
    where: {
      archivedAt: null,
      ...(filters.projectId ? { story: { projectId: filters.projectId } } : {}),
    },
    include: {
      story: {
        select: { id: true, jiraKey: true, summary: true, jiraStatus: true },
      },
    },
  });

  const stories = new Map<string, SnapshotStoryRow>();
  const columnTotals = emptyColumnCounts();
  let awaitingVerification = 0;
  let failedVerification = 0;

  for (const unit of workUnits) {
    let row = stories.get(unit.story.id);
    if (!row) {
      row = {
        jiraKey: unit.story.jiraKey,
        summary: unit.story.summary,
        jiraStatus: unit.story.jiraStatus,
        columnCounts: emptyColumnCounts(),
      };
      stories.set(unit.story.id, row);
    }
    const column = unit.column as Column;
    row.columnCounts[column] += 1;
    columnTotals[column] += 1;

    if (unit.verificationRequestedAt && !unit.verifiedAt) {
      awaitingVerification += 1;
    }
    if (unit.verificationOutcome === "failed") {
      failedVerification += 1;
    }
  }

  return {
    stories: [...stories.values()].sort((a, b) =>
      a.jiraKey.localeCompare(b.jiraKey)
    ),
    columnTotals,
    awaitingVerification,
    failedVerification,
  };
}
