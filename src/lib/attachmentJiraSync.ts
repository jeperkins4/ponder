/**
 * Immediate JIRA attachment upload — uploads a freshly created Ponder
 * attachment to its parent JIRA issue right away, rather than waiting for
 * the deferred batch uploads in statusTrigger.ts (story completion, Move to
 * QA). Non-blocking: every failure is caught and returned, never thrown, so
 * an attachment's local creation never depends on JIRA succeeding — those
 * deferred paths remain a safety net for anything this misses.
 */

import type { PrismaClient } from "@prisma/client";
import type { JiraConfig } from "@/lib/jira/client";
import { uploadAttachment as defaultUploadAttachment } from "@/lib/jira/writeback";
import { readAttachmentFile as defaultReadAttachmentFile } from "@/lib/attachmentStorage";
import { hasJiraCredentials } from "@/lib/statusTrigger";

export type SyncAttachmentToJiraDeps = {
  uploadAttachment: typeof defaultUploadAttachment;
  readAttachmentFile: typeof defaultReadAttachmentFile;
};

const defaultDeps: SyncAttachmentToJiraDeps = {
  uploadAttachment: defaultUploadAttachment,
  readAttachmentFile: defaultReadAttachmentFile,
};

export type SyncAttachmentToJiraResult = {
  uploaded: boolean;
  warning?: string;
};

/**
 * Uploads a single attachment to its parent story's JIRA issue and stamps
 * `jiraUploadedAt` on success. Never throws.
 * @param attachmentId - the Attachment row to upload
 * @param prisma - Prisma client instance
 * @param deps - Injectable JIRA/storage functions (defaults to the real ones)
 */
export async function syncAttachmentToJira(
  attachmentId: string,
  prisma: PrismaClient,
  deps: SyncAttachmentToJiraDeps = defaultDeps
): Promise<SyncAttachmentToJiraResult> {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { workUnit: { include: { story: { include: { project: true } } } } },
    });

    if (!attachment) {
      const warning = `syncAttachmentToJira: attachment not found: ${attachmentId}`;
      console.warn(warning);
      return { uploaded: false, warning };
    }

    const story = attachment.workUnit.story;

    if (!hasJiraCredentials(story.project)) {
      const warning = `syncAttachmentToJira: story ${story.jiraKey} has no fully-configured JIRA project; skipping upload`;
      console.warn(warning);
      return { uploaded: false, warning };
    }

    const config: JiraConfig = {
      siteUrl: story.project.jiraSiteUrl,
      email: story.project.jiraEmail,
      apiToken: story.project.jiraApiToken,
    };

    const buffer = await deps.readAttachmentFile(attachment.id);
    await deps.uploadAttachment(
      story.jiraKey,
      { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
      config
    );

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { jiraUploadedAt: new Date() },
    });

    return { uploaded: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const warning = `syncAttachmentToJira: failed to upload attachment ${attachmentId} to JIRA: ${message}`;
    console.warn(warning);
    return { uploaded: false, warning };
  }
}
