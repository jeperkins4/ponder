/**
 * Shared TypeScript types for the kanban application
 */

export type Column = "todo" | "in_progress" | "done";

export const COLUMNS: Column[] = ["todo", "in_progress", "done"];

export interface WorkUnitDTO {
  id: string;
  storyId: string;
  title: string;
  description: string | null;
  column: Column;
  order: number;
  createdAt: string; // ISO string
  completedAt: string | null; // ISO string
}

export interface StoryDTO {
  id: string;
  jiraKey: string;
  jiraId: string;
  projectKey: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectWithStats extends Project {
  hasApiToken: boolean;
  storyCount: number;
  workUnitCount: number;
}
