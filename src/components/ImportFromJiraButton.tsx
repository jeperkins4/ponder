"use client";

import { useState } from "react";

interface ImportFromJiraButtonProps {
  projectId: string;
}

interface SyncResponse {
  created: number;
  updated: number;
  error?: string;
}

/**
 * Triggers a project-scoped JIRA import via POST /api/projects/[projectId]/sync.
 * Rendered on a project's board page only when that project is JIRA-linked.
 */
export function ImportFromJiraButton({ projectId }: ImportFromJiraButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/sync`, {
        method: "POST",
      });
      const data: SyncResponse = await response.json();

      if (!response.ok) {
        setError(data.error || "Sync failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred during sync");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleSync}
        disabled={isLoading}
        data-testid="import-from-jira-button"
        className={`px-4 py-2 rounded-lg font-instrument font-semibold text-sm text-white transition-colors focus:ring-2 focus:ring-ponder-light-purple focus:outline-none ${
          isLoading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-ponder-light-purple hover:bg-ponder-light-purple-dark"
        }`}
      >
        {isLoading ? "Importing…" : "Import from JIRA"}
      </button>

      {error && (
        <div role="alert" className="text-sm text-red-600 font-instrument">
          Error: {error}
        </div>
      )}

      {result && (
        <div className="text-sm text-green-600 font-instrument">
          {result.created + result.updated} stories imported ({result.created} created,{" "}
          {result.updated} updated)
        </div>
      )}
    </div>
  );
}
