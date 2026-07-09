/**
 * Shared helper for converting a Prisma Project (with story/work-unit counts)
 * into the ProjectWithStats DTO used by the /api/projects endpoints.
 */

import { ProjectWithStats } from "@/lib/types";

export function projectToDTO(project: {
  id: string;
  name: string;
  type: string;
  jiraProjectKey: string | null;
  jiraSiteUrl?: string | null;
  jiraEmail?: string | null;
  jiraApiToken?: string | null;
  githubRepos?: string | null;
  jiraSyncStatuses?: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { stories: number; workUnits: number };
}): ProjectWithStats {
  return {
    id: project.id,
    name: project.name,
    type: project.type as "JIRA" | "STANDALONE",
    jiraProjectKey: project.jiraProjectKey ?? undefined,
    jiraSiteUrl: project.jiraSiteUrl ?? undefined,
    jiraEmail: project.jiraEmail ?? undefined,
    githubRepos: project.githubRepos ?? undefined,
    jiraSyncStatuses: project.jiraSyncStatuses ?? undefined,
    hasApiToken: Boolean(project.jiraApiToken),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    storyCount: project._count.stories,
    workUnitCount: project._count.workUnits,
  };
}
