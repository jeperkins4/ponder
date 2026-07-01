"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Project } from "@/lib/types";
import { useTheme } from "@/hooks/useTheme";

interface ProjectSelectorProps {
  projects: Project[];
  currentProjectId?: string;
}

const focusRing =
  "focus:ring-2 focus:ring-ponder-light-purple focus:outline-none";

export function ProjectSelector({
  projects,
  currentProjectId,
}: ProjectSelectorProps) {
  const { isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentProject = projects.find((p) => p.id === currentProjectId);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className="relative inline-block text-left"
      data-testid="project-selector"
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Switch project"
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg font-instrument text-sm font-semibold transition-colors ${focusRing} ${
          isDark
            ? "bg-ponder-dark-surface border border-ponder-dark-border text-ponder-dark-text hover:bg-ponder-dark-purple-light"
            : "bg-ponder-light-surface border border-ponder-light-card-border text-ponder-light-text hover:bg-ponder-light-purple-light"
        }`}
        data-testid="project-selector-toggle"
      >
        <span className="truncate max-w-[10rem]">
          {currentProject ? currentProject.name : "Select project"}
        </span>
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-4 h-4 flex-shrink-0 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && (
        <ul
          aria-label="Projects"
          className={`absolute left-0 z-10 mt-2 w-64 rounded-lg shadow-ponder-card-hover py-1 ${
            isDark
              ? "bg-ponder-dark-surface border border-ponder-dark-border"
              : "bg-ponder-light-surface border border-ponder-light-card-border"
          }`}
          data-testid="project-selector-menu"
        >
          {projects.length === 0 && (
            <li
              className={`px-3 py-2 text-sm font-instrument ${
                isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"
              }`}
            >
              No projects yet
            </li>
          )}
          {projects.map((project) => {
            const isCurrent = project.id === currentProjectId;
            return (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}/board`}
                  onClick={() => setIsOpen(false)}
                  aria-current={isCurrent ? "page" : undefined}
                  className={`block px-3 py-2 text-sm font-instrument ${focusRing} ${
                    isCurrent
                      ? isDark
                        ? "bg-ponder-dark-purple-light text-ponder-dark-purple font-semibold"
                        : "bg-ponder-light-purple-light text-ponder-light-purple font-semibold"
                      : isDark
                        ? "text-ponder-dark-text hover:bg-ponder-dark-bg"
                        : "text-ponder-light-text hover:bg-ponder-light-bg"
                  }`}
                  data-testid={`project-selector-item-${project.id}`}
                >
                  {project.name}
                  {isCurrent && <span className="sr-only"> (current)</span>}
                </Link>
              </li>
            );
          })}
          <li
            className={`border-t mt-1 pt-1 ${
              isDark ? "border-ponder-dark-border" : "border-ponder-light-card-border"
            }`}
          >
            <Link
              href="/projects/new"
              onClick={() => setIsOpen(false)}
              className={`block px-3 py-2 text-sm font-instrument font-semibold ${focusRing} ${
                isDark
                  ? "text-ponder-dark-purple hover:bg-ponder-dark-purple-light"
                  : "text-ponder-light-purple hover:bg-ponder-light-purple-light"
              }`}
              data-testid="project-selector-new-link"
            >
              + New Project
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
