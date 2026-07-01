/**
 * Per-project board page.
 *
 * Server component: looks up the project via Prisma, renders a not-found
 * state if it doesn't exist, otherwise shows the project name, a
 * ProjectSelector for switching projects, an "Import from JIRA" button
 * (only for JIRA-linked projects), and the project-scoped KanbanBoard.
 */

import { prisma } from "@/lib/prisma";
import { Project } from "@/lib/types";
import { ProjectSelector } from "@/components/ProjectSelector";
import { ImportFromJiraButton } from "@/components/ImportFromJiraButton";
import { KanbanBoard } from "@/components/KanbanBoard";

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
    return (
      <main className="min-h-screen bg-ponder-light-bg p-8">
        <div className="max-w-5xl mx-auto">
          <p
            data-testid="project-not-found"
            className="text-ponder-light-text-muted font-instrument"
          >
            Project not found.
          </p>
        </div>
      </main>
    );
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
    <div>
      <div className="max-w-7xl mx-auto px-8 pt-8 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h1
            className="font-space-grotesk text-2xl font-bold text-ponder-light-text"
            data-testid="project-board-heading"
          >
            {project.name}
          </h1>
          <ProjectSelector projects={projects} currentProjectId={project.id} />
        </div>

        {project.type === "JIRA" && (
          <ImportFromJiraButton projectId={project.id} />
        )}
      </div>

      <KanbanBoard projectId={project.id} />
    </div>
  );
}
