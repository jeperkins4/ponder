/**
 * Shared column-move write path. Both the manual move route and PR-gated
 * completion go through here so completedAt semantics stay in one place:
 * entering done stamps it (only if not already set), leaving done clears
 * it, same-column moves never touch it.
 *
 * Deliberately does NOT call applyStoryStatusSync — callers decide when to
 * fire the JIRA trigger (the move route fires per move; the PR gate fires
 * once per story after moving all of its cards).
 */

import { PrismaClient, WorkUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

  return prismaClient.workUnit.update({
    where: { id: workUnitId },
    data: {
      column,
      order,
      ...(enteringDone && existing.completedAt === null
        ? { completedAt: new Date() }
        : {}),
      ...(leavingDone ? { completedAt: null } : {}),
    },
  });
}
