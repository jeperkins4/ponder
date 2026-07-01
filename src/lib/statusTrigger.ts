/**
 * Status Trigger Logic
 *
 * Automatically updates a story's JIRA status to "Done" when all work units are completed.
 */

import { PrismaClient } from "@prisma/client";

/**
 * Checks if all work units for a story are done and updates the story status if so.
 *
 * @param storyId - The ID of the story to check
 * @param prisma - Prisma client instance
 * @returns true if the story status was updated to "Done", false otherwise
 * @throws If database operations fail
 */
export async function checkAndUpdateStoryStatus(
  storyId: string,
  prisma: PrismaClient
): Promise<boolean> {
  // Fetch the story with all its work units
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: { workUnits: true },
  });

  if (!story) {
    throw new Error(`Story not found: ${storyId}`);
  }

  // If there are no work units, return false (can't be "done" without any work defined)
  if (story.workUnits.length === 0) {
    return false;
  }

  // Check if all work units have column === "done"
  const allDone = story.workUnits.every((unit) => unit.column === "done");

  if (allDone) {
    // Update the story status to "Done"
    await prisma.story.update({
      where: { id: storyId },
      data: { jiraStatus: "Done" },
    });
    return true;
  }

  return false;
}
