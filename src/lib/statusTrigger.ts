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
} from "@/lib/jira/writeback";
import { pickTransitionByStatusName } from "@/lib/jira/transitions";
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
};

const defaultDeps: ApplyStoryStatusSyncDeps = {
  getTransitions: defaultGetTransitions,
  transitionIssue: defaultTransitionIssue,
  addComment: defaultAddComment,
  summarizeCompletedWork: defaultSummarizeCompletedWork,
  uploadAttachment: defaultUploadAttachment,
  consolidateAcceptanceCriteria: defaultConsolidateAcceptanceCriteria,
  readAttachmentFile: defaultReadAttachmentFile,
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
function hasJiraCredentials(
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
      include: { workUnits: { include: { attachments: true } }, project: true },
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
          try {
            const buffer = await deps.readAttachmentFile(attachment.id);
            await deps.uploadAttachment(
              story.jiraKey,
              { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
              config
            );
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
