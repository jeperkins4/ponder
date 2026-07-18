/**
 * Story status sync — JIRA write-back
 *
 * On every work-unit move, recomputes the story's desired JIRA status from its
 * work units and syncs JIRA to match: transitions to "In Progress" once work
 * has started, and to "Code Revew" (posting a Claude-generated summary
 * comment) once every card is done.
 *
 * This is the FIRST write-path to JIRA in this codebase — everything else is
 * read/import. It is designed to be NON-BLOCKING: any JIRA or Claude failure
 * is caught here and never propagates to the caller (a local board move must
 * always succeed regardless of JIRA's availability), and REUSABLE: a future
 * MCP "move card" tool can call `applyStoryStatusSync` directly.
 */

import { Attachment, PrismaClient, Project, Story, WorkUnit } from "@prisma/client";
import type { JiraConfig } from "@/lib/jira/client";
import {
  getTransitions as defaultGetTransitions,
  transitionIssue as defaultTransitionIssue,
  addComment as defaultAddComment,
  uploadAttachment as defaultUploadAttachment,
  getIssueStatus as defaultGetIssueStatus,
} from "@/lib/jira/writeback";
import { pickTransitionByStatusName, normalizeStatusName } from "@/lib/jira/transitions";
import { summarizeCompletedWork as defaultSummarizeCompletedWork } from "@/lib/anthropic/summarize";
import { consolidateAcceptanceCriteria as defaultConsolidateAcceptanceCriteria } from "@/lib/anthropic/consolidateAcceptanceCriteria";
import { readAttachmentFile as defaultReadAttachmentFile } from "@/lib/attachmentStorage";

/**
 * The two JIRA statuses this sync ever writes. `null` means "leave the JIRA
 * item alone" (either there's no work yet, or nothing has changed).
 */
export type DesiredJiraStatus = "In Progress" | "Code Revew";

/** Minimal shape `computeDesiredJiraStatus` needs from a work unit. */
export type ColumnLike = { column: string };

/**
 * Computes the story's desired JIRA status purely from its work units'
 * columns:
 * - No work units → `null` (nothing to sync).
 * - Every card `column === "done"` → `"Code Revew"` (work complete, ready for review).
 * - Else any card in a working lane (`in_progress` | `code_review`) → `"In Progress"`.
 * - Else (every card still `todo`) → `null` (work hasn't started).
 */
export function computeDesiredJiraStatus(
  workUnits: ColumnLike[]
): DesiredJiraStatus | null {
  if (workUnits.length === 0) {
    return null;
  }

  if (workUnits.every((w) => w.column === "done")) {
    return "Code Revew";
  }

  if (workUnits.some((w) => w.column === "in_progress" || w.column === "code_review")) {
    return "In Progress";
  }

  return null;
}

/** Minimal shape `computeStoryQaReadiness` needs from a work unit. */
export type QaReadinessLike = { column: string; movedToQaReportedAt: Date | null };

/**
 * True once every one of a story's work units is both `column === "done"`
 * and has been individually reported to JIRA via the Move-to-QA button
 * (`movedToQaReportedAt` set). An empty list is never "ready" — there's
 * nothing to transition.
 */
export function computeStoryQaReadiness(workUnits: QaReadinessLike[]): boolean {
  if (workUnits.length === 0) {
    return false;
  }
  return workUnits.every((w) => w.column === "done" && w.movedToQaReportedAt != null);
}

/**
 * Injectable dependency bag for `applyStoryStatusSync`. Defaults to the real
 * JIRA/Claude implementations; tests inject fakes instead.
 */
export type ApplyStoryStatusSyncDeps = {
  getTransitions: typeof defaultGetTransitions;
  transitionIssue: typeof defaultTransitionIssue;
  addComment: typeof defaultAddComment;
  summarizeCompletedWork: typeof defaultSummarizeCompletedWork;
  uploadAttachment: typeof defaultUploadAttachment;
  consolidateAcceptanceCriteria: typeof defaultConsolidateAcceptanceCriteria;
  readAttachmentFile: typeof defaultReadAttachmentFile;
  getIssueStatus: typeof defaultGetIssueStatus;
};

const defaultDeps: ApplyStoryStatusSyncDeps = {
  getTransitions: defaultGetTransitions,
  transitionIssue: defaultTransitionIssue,
  addComment: defaultAddComment,
  summarizeCompletedWork: defaultSummarizeCompletedWork,
  uploadAttachment: defaultUploadAttachment,
  consolidateAcceptanceCriteria: defaultConsolidateAcceptanceCriteria,
  readAttachmentFile: defaultReadAttachmentFile,
  getIssueStatus: defaultGetIssueStatus,
};

export type ApplyStoryStatusSyncResult = {
  transitioned: boolean;
  commented: boolean;
  warning?: string;
};

type WorkUnitWithAttachments = WorkUnit & { attachments: Attachment[] };
type StoryWithRelations = Story & { workUnits: WorkUnitWithAttachments[]; project: Project | null };

/**
 * Returns true when a project has complete JIRA credentials configured.
 */
export function hasJiraCredentials(
  project: Project | null
): project is Project & { jiraSiteUrl: string; jiraEmail: string; jiraApiToken: string } {
  return (
    !!project &&
    project.type === "JIRA" &&
    !!project.jiraSiteUrl &&
    !!project.jiraEmail &&
    !!project.jiraApiToken
  );
}

/**
 * Syncs a story's JIRA status/comment to match the current state of its board
 * cards. NEVER throws — every failure mode (missing story, unlinked project,
 * incomplete credentials, no matching workflow transition, a JIRA/Claude API
 * failure) is caught, logged via `console.warn`, and returned as a
 * non-blocking result so a local board move always completes successfully.
 *
 * @param storyId - The story whose work units just changed
 * @param prisma - Prisma client instance
 * @param deps - Injectable JIRA/Claude functions (defaults to the real ones)
 * @returns A small result describing what happened, for logging/tests only —
 *   callers should NOT branch on it to decide whether the local move succeeded.
 */
export async function applyStoryStatusSync(
  storyId: string,
  prisma: PrismaClient,
  deps: ApplyStoryStatusSyncDeps = defaultDeps
): Promise<ApplyStoryStatusSyncResult> {
  try {
    const story = (await prisma.story.findUnique({
      where: { id: storyId },
      include: {
        workUnits: { where: { archivedAt: null }, include: { attachments: true } },
        project: true,
      },
    })) as StoryWithRelations | null;

    if (!story) {
      console.warn(`applyStoryStatusSync: story not found: ${storyId}`);
      return { transitioned: false, commented: false };
    }

    const desired = computeDesiredJiraStatus(story.workUnits);
    if (!desired) {
      return { transitioned: false, commented: false };
    }

    if (story.jiraStatus === desired) {
      return { transitioned: false, commented: false };
    }

    if (!hasJiraCredentials(story.project)) {
      const warning = `applyStoryStatusSync: story ${storyId} (${story.jiraKey}) has no fully-configured JIRA project; skipping write-back`;
      console.warn(warning);
      return { transitioned: false, commented: false, warning };
    }

    const config: JiraConfig = {
      siteUrl: story.project.jiraSiteUrl,
      email: story.project.jiraEmail,
      apiToken: story.project.jiraApiToken,
    };

    const transitions = await deps.getTransitions(story.jiraKey, config);
    const transition = pickTransitionByStatusName(transitions, desired);

    if (!transition) {
      const warning = `applyStoryStatusSync: no transition to "${desired}" available for ${story.jiraKey} from its current status`;
      console.warn(warning);
      return { transitioned: false, commented: false, warning };
    }

    await deps.transitionIssue(story.jiraKey, transition.id, config);

    let commented = false;
    let completionCommentPostedAt = story.completionCommentPostedAt;

    if (desired === "Code Revew" && story.completionCommentPostedAt == null) {
      const doneWorkUnits = story.workUnits.filter((w) => w.column === "done");
      const summaryText = await deps.summarizeCompletedWork(story, doneWorkUnits);

      // Claude failure here must never block the transition/local update —
      // degrade to a comment without the consolidated AC/verification section.
      let consolidated = { acceptanceCriteria: "", verification: "" };
      try {
        consolidated = await deps.consolidateAcceptanceCriteria(story, doneWorkUnits);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `applyStoryStatusSync: consolidateAcceptanceCriteria failed non-fatally for story ${storyId}: ${message}`
        );
      }

      const sections = [
        `${summaryText}\n\nWork units:\n` + doneWorkUnits.map((w) => `• ${w.title}`).join("\n"),
      ];
      if (consolidated.acceptanceCriteria) {
        sections.push(`Acceptance Criteria:\n${consolidated.acceptanceCriteria}`);
      }
      if (consolidated.verification) {
        sections.push(`Verification:\n${consolidated.verification}`);
      }
      const comment = sections.join("\n\n");

      await deps.addComment(story.jiraKey, comment, config);
      commented = true;
      completionCommentPostedAt = new Date();

      // Upload each done work unit's attachments as JIRA attachments on the
      // issue. Never let a single failed upload (or the whole loop) break
      // the transition/local update — log and continue.
      for (const workUnit of doneWorkUnits) {
        for (const attachment of workUnit.attachments) {
          if (attachment.jiraUploadedAt != null) continue;
          try {
            const buffer = await deps.readAttachmentFile(attachment.id);
            await deps.uploadAttachment(
              story.jiraKey,
              { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
              config
            );
            await prisma.attachment.update({
              where: { id: attachment.id },
              data: { jiraUploadedAt: new Date() },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
              `applyStoryStatusSync: failed to upload attachment ${attachment.id} (${attachment.filename}) to ${story.jiraKey}: ${message}`
            );
          }
        }
      }
    }

    await prisma.story.update({
      where: { id: storyId },
      data: {
        jiraStatus: desired,
        ...(commented ? { completionCommentPostedAt } : {}),
      },
    });

    return { transitioned: true, commented };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `applyStoryStatusSync: JIRA/Claude sync failed non-fatally for story ${storyId}: ${message}`
    );
    return { transitioned: false, commented: false, warning: message };
  }
}

export type TransitionStoryToQAResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Archives every one of a story's currently-active Done work units — sets
 * `archivedAt` so they're excluded from the board and stats going forward,
 * without deleting the row (retained for future reporting). Called only
 * after `transitionStoryToQA` has already confirmed every one of the
 * story's active work units is Done, so this intentionally does not
 * re-check that condition itself.
 */
async function archiveDoneWorkUnits(storyId: string, prisma: PrismaClient): Promise<number> {
  const result = await prisma.workUnit.updateMany({
    where: { storyId, archivedAt: null, column: "done" },
    data: { archivedAt: new Date() },
  });
  return result.count;
}

/**
 * Explicitly transitions a story's JIRA issue to "QA". Unlike
 * `applyStoryStatusSync` (an automatic, never-throwing side effect of an
 * unrelated board action), this is a primary, human-triggered action — every
 * failure mode is returned as a clear `{ ok: false, error }` result so the
 * caller (the Move-to-QA button) can show the user what happened, rather than
 * being silently swallowed.
 *
 * Requires every one of the story's work units to be in the `done` column;
 * otherwise returns an error without calling JIRA at all.
 *
 * If JIRA has no "QA" transition available because the issue is already
 * sitting in QA (e.g. someone moved it there directly in JIRA), this is
 * treated as already satisfied: the local record is brought in sync and the
 * work units are archived, but JIRA itself is left untouched — there is
 * nothing to transition.
 */
export async function transitionStoryToQA(
  storyId: string,
  prisma: PrismaClient,
  deps: Pick<
    ApplyStoryStatusSyncDeps,
    "getTransitions" | "transitionIssue" | "getIssueStatus"
  > = defaultDeps
): Promise<TransitionStoryToQAResult> {
  const story = (await prisma.story.findUnique({
    where: { id: storyId },
    include: { workUnits: { where: { archivedAt: null } }, project: true },
  })) as (Story & { workUnits: WorkUnit[]; project: Project | null }) | null;

  if (!story) {
    return { ok: false, error: `Story not found: ${storyId}` };
  }

  if (story.workUnits.length === 0 || !story.workUnits.every((w) => w.column === "done")) {
    return {
      ok: false,
      error: "All work units for this story must be Done before moving it to QA",
    };
  }

  if (!hasJiraCredentials(story.project)) {
    return {
      ok: false,
      error: `Story ${story.jiraKey} has no fully-configured JIRA project`,
    };
  }

  const config: JiraConfig = {
    siteUrl: story.project.jiraSiteUrl,
    email: story.project.jiraEmail,
    apiToken: story.project.jiraApiToken,
  };

  try {
    const transitions = await deps.getTransitions(story.jiraKey, config);
    const transition = pickTransitionByStatusName(transitions, "QA");

    if (!transition) {
      const currentStatus = await deps.getIssueStatus(story.jiraKey, config);
      if (normalizeStatusName(currentStatus.name) !== normalizeStatusName("QA")) {
        return {
          ok: false,
          error: `No "QA" transition available for ${story.jiraKey} from its current status`,
        };
      }
      // Already in QA on the JIRA side — nothing to transition there, but
      // the local record and work units still need to catch up.
    } else {
      await deps.transitionIssue(story.jiraKey, transition.id, config);
    }

    await prisma.story.update({
      where: { id: storyId },
      data: { jiraStatus: "QA" },
    });

    await archiveDoneWorkUnits(storyId, prisma);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Posts one work unit's own evidence (title/description/acceptanceCriteria/
 * verification as a comment, its own attachments as JIRA attachments) to its
 * parent story's JIRA issue, then marks it reported. If every one of the
 * story's active work units is now Done AND reported, also runs
 * `transitionStoryToQA` (JIRA transition to QA + archive-all) as a second
 * step.
 *
 * Any failure posting the comment or uploading an attachment aborts before
 * `movedToQaReportedAt` is set — nothing is marked reported, matching this
 * action's human-triggered, error-surfacing contract (unlike
 * `applyStoryStatusSync`'s non-blocking automatic sync).
 */
export async function reportWorkUnitToQA(
  workUnitId: string,
  prisma: PrismaClient,
  deps: Pick<
    ApplyStoryStatusSyncDeps,
    | "getTransitions"
    | "transitionIssue"
    | "addComment"
    | "uploadAttachment"
    | "readAttachmentFile"
    | "getIssueStatus"
  > = defaultDeps
): Promise<TransitionStoryToQAResult & { transitioned?: boolean }> {
  const workUnit = await prisma.workUnit.findUnique({
    where: { id: workUnitId },
    include: {
      attachments: true,
      story: { include: { project: true, workUnits: { where: { archivedAt: null } } } },
    },
  });

  if (!workUnit) {
    return { ok: false, error: `Work unit not found: ${workUnitId}` };
  }

  const story = workUnit.story;

  if (!hasJiraCredentials(story.project)) {
    return {
      ok: false,
      error: `Story ${story.jiraKey} has no fully-configured JIRA project`,
    };
  }

  const config: JiraConfig = {
    siteUrl: story.project.jiraSiteUrl,
    email: story.project.jiraEmail,
    apiToken: story.project.jiraApiToken,
  };

  let reportedAt = workUnit.movedToQaReportedAt;

  if (!reportedAt) {
    const sections = [`${workUnit.title}`];
    if (workUnit.description) sections.push(`Description:\n${workUnit.description}`);
    if (workUnit.acceptanceCriteria) sections.push(`Acceptance Criteria:\n${workUnit.acceptanceCriteria}`);
    if (workUnit.verification) sections.push(`Verification:\n${workUnit.verification}`);
    const comment = sections.join("\n\n");

    try {
      await deps.addComment(story.jiraKey, comment, config);

      for (const attachment of workUnit.attachments) {
        if (attachment.jiraUploadedAt != null) continue;
        const buffer = await deps.readAttachmentFile(attachment.id);
        await deps.uploadAttachment(
          story.jiraKey,
          { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
          config
        );
        await prisma.attachment.update({
          where: { id: attachment.id },
          data: { jiraUploadedAt: new Date() },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }

    reportedAt = new Date();
    await prisma.workUnit.update({
      where: { id: workUnitId },
      data: { movedToQaReportedAt: reportedAt },
    });
  }

  const siblingsAfterReport = story.workUnits.map((w) =>
    w.id === workUnitId ? { column: w.column, movedToQaReportedAt: reportedAt } : w
  );

  if (!computeStoryQaReadiness(siblingsAfterReport)) {
    return { ok: true, transitioned: false };
  }

  const transitionResult = await transitionStoryToQA(story.id, prisma, deps);
  if (!transitionResult.ok) {
    return transitionResult;
  }
  return { ok: true, transitioned: true };
}
