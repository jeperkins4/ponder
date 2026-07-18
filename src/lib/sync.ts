/**
 * Sync orchestration layer
 * Fetches stories from JIRA and persists them to the database via Prisma
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchStoriesForProject, type JiraConfig } from "@/lib/jira/client";
import { applyPrGatedCompletion } from "@/lib/github/prGatedCompletion";
import { parseSyncStatuses } from "@/lib/jira/jql";
import { isStatusRegression } from "@/lib/jira/statusStage";

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

  const stories = await fetchStoriesForProject(
    project.jiraProjectKey,
    jiraConfig,
    parseSyncStatuses(project.jiraSyncStatuses)
  );

  let created = 0;
  let updated = 0;

  type ExistingStoryRow = {
    jiraKey: string;
    jiraStatus: string;
    linkedFollowUpKeys: string | null;
    completionCommentPostedAt: Date | null;
  };

  // Existing stories are resolved once, up front, instead of a per-story
  // findUnique — halves the round trips (N upserts instead of N finds + N
  // create/update) and mirrors the batch-then-upsert pattern already used
  // by the import/process route (see findAlreadyImportedKeys). Also carries
  // the fields this loop needs to detect two Equilibrium Meter churn
  // signals without extra queries: jiraStatus (regression) and
  // linkedFollowUpKeys/completionCommentPostedAt (new follow-up links).
  const jiraKeys = stories.map((story) => story.jiraKey);
  const existingByKey =
    jiraKeys.length > 0
      ? new Map<string, ExistingStoryRow>(
          (
            await prismaClient.story.findMany({
              where: { jiraKey: { in: jiraKeys } },
              select: {
                jiraKey: true,
                jiraStatus: true,
                linkedFollowUpKeys: true,
                completionCommentPostedAt: true,
              },
            })
          ).map((s) => [s.jiraKey, s])
        )
      : new Map<string, ExistingStoryRow>();

  for (const story of stories) {
    const existing = existingByKey.get(story.jiraKey);
    const isRegression = existing
      ? isStatusRegression(existing.jiraStatus, story.jiraStatus)
      : false;

    // A story only accrues "linked follow-up" churn once it has already
    // shipped (completionCommentPostedAt set) — a link on a story still in
    // progress is normal cross-referencing, not fallout. Any key present
    // now that wasn't in the stored list is treated as newly observed;
    // there's no per-key timestamp, so all of a story's linked keys share
    // one lastLinkedFollowUpAt whenever a new one shows up.
    const previouslySeenKeys = new Set(
      (existing?.linkedFollowUpKeys ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    );
    const newlyLinkedKeys = existing?.completionCommentPostedAt
      ? (story.linkedIssueKeys ?? []).filter((key) => !previouslySeenKeys.has(key))
      : [];
    const mergedLinkedKeys =
      newlyLinkedKeys.length > 0
        ? [...previouslySeenKeys, ...newlyLinkedKeys].join(",")
        : undefined;

    const fields = {
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
    };

    await prismaClient.story.upsert({
      where: { jiraKey: story.jiraKey },
      create: { jiraKey: story.jiraKey, ...fields },
      update: {
        ...fields,
        // Status regressions (e.g. QA -> In Progress after a JIRA reopen)
        // are a churn signal for the Equilibrium Meter, regardless of
        // whether the miss was technical or a scoping problem.
        ...(isRegression
          ? { reopenCount: { increment: 1 }, lastReopenedAt: new Date() }
          : {}),
        ...(mergedLinkedKeys !== undefined
          ? { linkedFollowUpKeys: mergedLinkedKeys, lastLinkedFollowUpAt: new Date() }
          : {}),
      },
    });

    if (existing) {
      updated++;
    } else {
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
