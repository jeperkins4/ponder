"use client";

import { useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { ImportReview } from "@/components/ImportReview";

interface ImportFromJiraButtonProps {
  projectId: string;
}

/**
 * Opens the review-before-import flow (ImportReview): clicking loads a
 * preview of the project's incoming JIRA stories, lets the user toggle
 * "break down into subtasks" per story, then processes the selection via
 * POST /api/projects/[projectId]/import/process. Replaces the previous
 * one-shot POST /sync behavior.
 */
export function ImportFromJiraButton({ projectId }: ImportFromJiraButtonProps) {
  const { isDark } = useTheme();
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  const handleImported = () => {
    // No shared refresh channel exists between this button (rendered via
    // KanbanBoard's headerActions) and KanbanBoard's own story-fetching
    // state, so we broadcast a DOM event the same way useTheme syncs theme
    // changes across instances; KanbanBoard listens and silently refetches.
    window.dispatchEvent(new Event("ponder-jira-import-complete"));
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setIsReviewOpen(true)}
        data-testid="import-from-jira-button"
        className={`px-4 py-2 rounded-lg font-instrument font-semibold text-sm text-white transition-colors focus:ring-2 focus:ring-ponder-light-purple focus:outline-none ${
          isDark
            ? "bg-ponder-dark-purple hover:bg-ponder-dark-purple-dark"
            : "bg-ponder-light-purple hover:bg-ponder-light-purple-dark"
        }`}
      >
        Import from JIRA
      </button>

      {isReviewOpen && (
        <ImportReview
          projectId={projectId}
          onClose={() => setIsReviewOpen(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
