"use client";

import { useTheme } from "@/hooks/useTheme";

/**
 * Not-found fallback for the project board page. A tiny client component (not
 * inlined in the server-rendered page) so it can read the shared `useTheme`
 * state and match KanbanBoard/ProjectSelector's light/dark palette instead of
 * hardcoding light-mode tokens.
 */
export function ProjectNotFound() {
  const { isDark } = useTheme();

  return (
    <main
      className={`min-h-screen p-8 ${isDark ? "bg-ponder-dark-bg" : "bg-ponder-light-bg"}`}
    >
      <div className="max-w-5xl mx-auto">
        <p
          data-testid="project-not-found"
          className={`font-instrument ${
            isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"
          }`}
        >
          Project not found.
        </p>
      </div>
    </main>
  );
}
