"use client";

import Link from "next/link";
import { useTheme } from "@/hooks/useTheme";

interface ProjectSettingsLinkProps {
  projectId: string;
}

/**
 * Header-action link to a project's settings page (where JIRA connection
 * credentials are configured). Theme-aware to match the other board-header
 * actions (ProjectSelector, ImportFromJiraButton).
 */
export function ProjectSettingsLink({ projectId }: ProjectSettingsLinkProps) {
  const { isDark } = useTheme();

  return (
    <Link
      href={`/projects/${projectId}/settings`}
      data-testid="project-settings-link"
      aria-label="Project settings"
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-instrument font-semibold text-sm border transition-colors focus:ring-2 focus:ring-ponder-light-purple focus:outline-none ${
        isDark
          ? "border-ponder-dark-border text-ponder-dark-text hover:bg-ponder-dark-bg"
          : "border-ponder-light-card-border text-ponder-light-text hover:bg-ponder-light-bg"
      }`}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      Settings
    </Link>
  );
}
