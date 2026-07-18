/**
 * Shared column-move write path. Both the manual move route and PR-gated
 * completion go through here so completedAt semantics stay in one place:
 * entering done stamps it (only if not already set), leaving done clears
 * it, same-column moves never touch it. Also tracks column regressions
 * (moving backward, e.g. done -> in_progress) as a churn signal for the
 * Equilibrium Meter — regardless of whether the regression was a technical
 * miss or a scoping problem, it counts.
 *
 * Deliberately does NOT call applyStoryStatusSync — callers decide when to
 * fire the JIRA trigger (the move route fires per move; the PR gate fires
 * once per story after moving all of its cards).
 */

import { PrismaClient, WorkUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { COLUMNS } from "@/lib/columns";

/** Position of a column in the board's left-to-right order. Unrecognized
 * values rank first (0) so an unexpected column can never be misread as a
 * backward move. */
function columnRank(column: string): number {
  const index = COLUMNS.findIndex((c) => c.key === column);
  return index === -1 ? 0 : index;
}

export async function moveWorkUnitColumn(
  workUnitId: string,
  column: string,
  order: number,
  prismaClient: PrismaClient = prisma
): Promise<WorkUnit> {
  const existing = await prismaClient.workUnit.findUniqueOrThrow({
    where: { id: workUnitId },
  });

  const enteringDone = column === "done" && existing.column !== "done";
  const leavingDone = column !== "done" && existing.column === "done";
  const isRegression =
    column !== existing.column && columnRank(column) < columnRank(existing.column);

  return prismaClient.workUnit.update({
    where: { id: workUnitId },
    data: {
      column,
      order,
      ...(enteringDone && existing.completedAt === null
        ? { completedAt: new Date() }
        : {}),
      ...(leavingDone ? { completedAt: null } : {}),
      ...(isRegression
        ? { reopenCount: { increment: 1 }, lastReopenedAt: new Date() }
        : {}),
    },
  });
}
