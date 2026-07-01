/**
 * Sync orchestration layer
 * Fetches stories from JIRA and persists them to the database via Prisma
 */

import { PrismaClient } from "@prisma/client";
import { fetchAssignedStories, type JiraConfig } from "@/lib/jira/client";
import type { StoryDTO } from "@/lib/types";

/**
 * Result of a sync operation
 */
export interface SyncResult {
  created: number;
  updated: number;
}

/**
 * Syncs stories from JIRA to the database
 * @param projectKeys - Array of JIRA project keys (e.g., ['TEAM', 'OPS'])
 * @param jiraConfig - JIRA configuration (siteUrl, email, apiToken)
 * @param prisma - Prisma client instance
 * @returns Object with count of created and updated stories
 */
export async function syncStoriesFromJira(
  projectKeys: string[],
  jiraConfig: JiraConfig,
  prisma: PrismaClient
): Promise<SyncResult> {
  // Fetch stories from JIRA
  const stories = await fetchAssignedStories(projectKeys, jiraConfig);

  let created = 0;
  let updated = 0;

  // Sync each story
  for (const story of stories) {
    // Check if story exists by jiraId
    const existingStory = await prisma.story.findUnique({
      where: { jiraId: story.jiraId },
    });

    if (existingStory) {
      // Update existing story
      await prisma.story.update({
        where: { jiraId: story.jiraId },
        data: {
          jiraKey: story.jiraKey,
          projectKey: story.projectKey,
          summary: story.summary,
          description: story.description,
          jiraStatus: story.jiraStatus,
          url: story.url,
          lastSyncedAt: new Date(story.lastSyncedAt),
          completionCommentPostedAt: story.completionCommentPostedAt
            ? new Date(story.completionCommentPostedAt)
            : null,
        },
      });
      updated++;
    } else {
      // Create new story
      await prisma.story.create({
        data: {
          jiraKey: story.jiraKey,
          jiraId: story.jiraId,
          projectKey: story.projectKey,
          summary: story.summary,
          description: story.description,
          jiraStatus: story.jiraStatus,
          url: story.url,
          lastSyncedAt: new Date(story.lastSyncedAt),
          completionCommentPostedAt: story.completionCommentPostedAt
            ? new Date(story.completionCommentPostedAt)
            : null,
        },
      });
      created++;
    }
  }

  return { created, updated };
}
