/**
 * Shared TypeScript types for the kanban application
 */

export type Column =
  | "todo"
  | "in_progress"
  | "code_review"
  | "done";

export interface WorkUnitDTO {
  id: string;
  storyId: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  verification: string | null;
  column: Column;
  order: number;
  subNumber: number | null; // stable 1-based decomposition suffix (e.g. COM-540-1); Ponder-local, never sent to JIRA
  createdAt: string; // ISO string
  completedAt: string | null; // ISO string
  archivedAt: string | null; // ISO string
  movedToQaReportedAt: string | null; // ISO string
  verificationRequestedAt: string | null; // ISO string
  verifiedAt: string | null; // ISO string
  verificationOutcome: "passed" | "failed" | null;
  verificationSummary: string | null;
}

/** @public consumed starting in Task 2/3 (work-unit detail modal work notes) */
export interface WorkNoteDTO {
  id: string;
  workUnitId: string;
  body: string;
  createdAt: string; // ISO string
}

/** @public consumed starting in Task 2 (work-unit detail modal attachments) */
export interface AttachmentDTO {
  id: string;
  workUnitId: string;
  filename: string;
  mimeType: string;
  size: number;
  jiraUploadedAt: string | null; // ISO string, or null if not yet uploaded to JIRA
  createdAt: string; // ISO string
  url: string; // /api/attachments/{id}
}

export interface StoryDTO {
  id: string;
  jiraKey: string;
  jiraId: string;
  projectKey: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  /** JIRA statusCategory key; present only on DTOs from the JIRA fetch path
   * (import/sync). Local API serializers never set it. */
  jiraStatusCategory?: "new" | "indeterminate" | "done";
  url: string;
  lastSyncedAt: string; // ISO string
  completionCommentPostedAt: string | null; // ISO string
  workUnits: WorkUnitDTO[];
}

export interface Project {
  id: string;
  name: string;
  type: "JIRA" | "STANDALONE";
  jiraProjectKey?: string;
  jiraSiteUrl?: string;
  jiraEmail?: string;
  githubRepos?: string;
  jiraSyncStatuses?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectWithStats extends Project {
  hasApiToken: boolean;
  storyCount: number;
  workUnitCount: number;
}
