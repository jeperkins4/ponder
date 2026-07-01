/**
 * Projects list page.
 *
 * Server component: fetches all projects (with story/work-unit stats) directly
 * via Prisma and renders a card grid. Each card links to that project's board;
 * the "New Project" button links to /projects/new.
 */

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { projectToDTO } from "@/lib/projectDto";

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    include: {
      _count: {
        select: { stories: true, workUnits: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const projectDTOs = projects.map(projectToDTO);

  return (
    <main className="min-h-screen bg-ponder-light-bg p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-space-grotesk text-3xl font-bold text-ponder-light-text">
            Projects
          </h1>
          <Link
            href="/projects/new"
            aria-label="Create a new project"
            className="px-4 py-2 bg-ponder-light-purple text-white rounded-lg font-instrument font-semibold text-sm hover:bg-ponder-light-purple-dark transition-colors focus:ring-2 focus:ring-ponder-light-purple focus:outline-none"
            data-testid="new-project-button"
          >
            New Project
          </Link>
        </div>

        {projectDTOs.length === 0 ? (
          <p
            className="text-ponder-light-text-muted font-instrument"
            data-testid="projects-empty-state"
          >
            No projects yet. Create one to get started.
          </p>
        ) : (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            data-testid="projects-grid"
          >
            {projectDTOs.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}/board`}
                aria-label={`Open ${project.name} board`}
                className="block p-4 bg-ponder-light-surface border border-ponder-light-card-border rounded-xl shadow-ponder-card hover:shadow-ponder-card-hover hover:-translate-y-0.5 transition-all focus:ring-2 focus:ring-ponder-light-purple focus:outline-none"
                data-testid={`project-card-${project.id}`}
              >
                <h2 className="font-instrument font-semibold text-lg text-ponder-light-text mb-1">
                  {project.name}
                </h2>
                <p className="text-sm text-ponder-light-text-muted font-instrument">
                  {project.type === "JIRA"
                    ? `JIRA Project: ${project.jiraProjectKey ?? "(no key set)"}`
                    : "Standalone project"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
