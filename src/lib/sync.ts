/**
 * Sync orchestration layer
 * Fetches stories from JIRA and persists them to the database via Prisma
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  fetchAssignedStories,
  fetchStoriesForProject,
  type JiraConfig,
} from "@/lib/jira/client";
import { applyPrGatedCompletion } from "@/lib/github/prGatedCompletion";

/**
 * Result of a sync operation
 */
export interface SyncResult {
  created: number;
  updated: number;
}

/**
 * Result of a project-aware sync operation. `message` is populated (and
 * created/updated left at 0) when the project isn't linked to JIRA, so
 * callers can distinguish "nothing to sync" from "sync failed".
 */
export interface ProjectSyncResult {
  created: number;
  updated: number;
  message?: string;
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

/**
 * Syncs stories from JIRA into a specific project, filtered by that
 * project's jiraProjectKey. Credentials (siteUrl/email/apiToken) are read
 * from the project row itself — there is NO fallback to env vars.
 *
 * - Non-existent project: throws (callers, e.g. the sync route, should map
 *   this to an error response).
 * - STANDALONE project or missing jiraProjectKey: returns a no-op result
 *   with an explanatory message rather than erroring, since "not linked to
 *   JIRA" is an expected, non-exceptional state.
 * - JIRA project missing any of jiraSiteUrl/jiraEmail/jiraApiToken: returns
 *   a no-op result telling the caller to configure credentials, rather than
 *   throwing an opaque error.
 * - JIRA project with complete credentials: fetches Story/Task/Bug issues
 *   for the project's key and upserts them into Story, keyed by jiraKey,
 *   with projectId set.
 *
 * @param projectId - ID of the Project to sync
 * @param prismaClient - Prisma client instance (defaults to the app singleton;
 *   overridable for tests)
 * @returns Object with created/updated counts, and an optional message
 * @throws Error if the project does not exist
 */
export async function syncStoriesForProject(
  projectId: string,
  prismaClient: PrismaClient = prisma
): Promise<ProjectSyncResult> {
  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (project.type !== "JIRA" || !project.jiraProjectKey) {
    return { created: 0, updated: 0, message: "Project is not linked to JIRA" };
  }

  if (!project.jiraSiteUrl || !project.jiraEmail || !project.jiraApiToken) {
    return {
      created: 0,
      updated: 0,
      message: "JIRA credentials not configured. Add them in project settings.",
    };
  }

  const jiraConfig: JiraConfig = {
    siteUrl: project.jiraSiteUrl,
    email: project.jiraEmail,
    apiToken: project.jiraApiToken,
  };

  const stories = await fetchStoriesForProject(project.jiraProjectKey, jiraConfig);

  let created = 0;
  let updated = 0;

  for (const story of stories) {
    const existingStory = await prismaClient.story.findUnique({
      where: { jiraKey: story.jiraKey },
    });

    if (existingStory) {
      await prismaClient.story.update({
        where: { jiraKey: story.jiraKey },
        data: {
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
          projectId,
        },
      });
      updated++;
    } else {
      await prismaClient.story.create({
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
          projectId,
        },
      });
      created++;
    }
  }

  // PR-gated completion runs after the JIRA sync. GitHub problems must
  // never fail the sync — they surface as message parts instead.
  const messageParts: string[] = [];
  try {
    const gate = await applyPrGatedCompletion(projectId, prismaClient);
    if (gate.cardsCompleted > 0) {
      messageParts.push(`${gate.cardsCompleted} card(s) completed by PRs`);
    }
    messageParts.push(...gate.warnings.map((warning) => `GitHub: ${warning}`));
  } catch (error) {
    messageParts.push(
      `GitHub: PR check failed (${error instanceof Error ? error.message : String(error)})`
    );
  }

  return {
    created,
    updated,
    ...(messageParts.length > 0 ? { message: messageParts.join(" · ") } : {}),
  };
}
