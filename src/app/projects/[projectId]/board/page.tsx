/**
 * Per-project board page.
 *
 * Server component: looks up the project via Prisma, renders a not-found
 * state if it doesn't exist, otherwise renders the project-scoped
 * KanbanBoard with the project's name as its single `<h1>` and the
 * ProjectSelector plus "Import from JIRA" button (JIRA-linked projects only)
 * injected as header actions. Keeping all of that chrome inside KanbanBoard
 * avoids a second `<h1>` on the page and keeps the skip link the first
 * focusable element inside the board's `<main>` landmark.
 */

import { prisma } from "@/lib/prisma";
import { Project } from "@/lib/types";
import { ProjectSelector } from "@/components/ProjectSelector";
import { ImportFromJiraButton } from "@/components/ImportFromJiraButton";
import { KanbanBoard } from "@/components/KanbanBoard";
import { ProjectNotFound } from "@/components/ProjectNotFound";

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const [project, allProjects] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.project.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  if (!project) {
    return <ProjectNotFound />;
  }

  const projects: Project[] = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type as "JIRA" | "STANDALONE",
    jiraProjectKey: p.jiraProjectKey ?? undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  return (
    <KanbanBoard
      projectId={project.id}
      title={project.name}
      headerActions={
        <>
          <ProjectSelector projects={projects} currentProjectId={project.id} />
          {project.type === "JIRA" && (
            <ImportFromJiraButton projectId={project.id} />
          )}
        </>
      }
    />
  );
}
