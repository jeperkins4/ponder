/**
 * Import de-duplication predicate.
 *
 * A story counts as "already imported" when a local Story row with that
 * jiraKey exists AND it has at least one active (archivedAt: null) work
 * unit. Stories whose cards were ALL archived by Move-to-QA count as fresh,
 * so a story reopened in JIRA after failing QA imports normally.
 *
 * Used by BOTH the import preview route (to flag rows in the UI) and the
 * import process route (to skip card creation server-side) — the guard is
 * deliberately duplicated at both layers so a stale preview or a direct API
 * call can never duplicate cards.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Returns the subset of `jiraKeys` that are already imported, using a single
 * grouped query (no per-key N+1).
 */
export async function findAlreadyImportedKeys(
  jiraKeys: string[],
  prismaClient: PrismaClient = prisma
): Promise<Set<string>> {
  if (jiraKeys.length === 0) {
    return new Set();
  }

  const stories = await prismaClient.story.findMany({
    where: {
      jiraKey: { in: jiraKeys },
      workUnits: { some: { archivedAt: null } },
    },
    select: { jiraKey: true },
  });

  return new Set(stories.map((s) => s.jiraKey));
}
