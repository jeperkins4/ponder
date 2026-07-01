"use client";

/**
 * Edit-project (settings) form.
 *
 * Client component: fetches the project on mount via GET
 * /api/projects/[projectId], pre-fills the form, and PUTs the updated values
 * on submit, navigating to the project's board on success. The JIRA project
 * key field is only shown for projects whose type is JIRA.
 */

import { useEffect, useState, FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Project } from "@/lib/types";

const focusRing =
  "focus:ring-2 focus:ring-ponder-light-purple focus:outline-none";

export default function ProjectSettingsPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        const response = await fetch(`/api/projects/${projectId}`);
        const data = await response.json();

        if (!response.ok) {
          if (!cancelled) {
            setError(data.error || "Failed to load project");
          }
          return;
        }

        if (!cancelled) {
          setProject(data);
          setName(data.name);
          setJiraProjectKey(data.jiraProjectKey ?? "");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (!cancelled) {
          setIsFetching(false);
        }
      }
    }

    loadProject();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, jiraProjectKey }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to save project");
        setIsSaving(false);
        return;
      }

      router.push(`/projects/${projectId}/board`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSaving(false);
    }
  };

  if (isFetching) {
    return (
      <main className="min-h-screen bg-ponder-light-bg p-8">
        <div className="max-w-lg mx-auto">
          <p
            className="text-ponder-light-text-muted font-instrument"
            data-testid="settings-loading"
          >
            Loading project…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ponder-light-bg p-8">
      <div className="max-w-lg mx-auto">
        <h1 className="font-space-grotesk text-3xl font-bold text-ponder-light-text mb-8">
          Project Settings
        </h1>

        <form
          onSubmit={handleSubmit}
          className="bg-ponder-light-surface border border-ponder-light-card-border rounded-xl shadow-ponder-card p-6 space-y-6"
          data-testid="project-settings-form"
        >
          <div>
            <label
              htmlFor="project-name"
              className="block text-sm font-instrument font-semibold text-ponder-light-text mb-1"
            >
              Project name
            </label>
            <input
              id="project-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full px-3 py-2 bg-ponder-light-surface border border-ponder-light-card-border rounded-lg font-instrument text-ponder-light-text ${focusRing}`}
              data-testid="project-name-input"
            />
          </div>

          {project?.type === "JIRA" && (
            <div>
              <label
                htmlFor="jira-project-key"
                className="block text-sm font-instrument font-semibold text-ponder-light-text mb-1"
              >
                JIRA project key
              </label>
              <input
                id="jira-project-key"
                type="text"
                required
                value={jiraProjectKey}
                onChange={(e) =>
                  setJiraProjectKey(e.target.value.toUpperCase())
                }
                className={`w-full px-3 py-2 bg-ponder-light-surface border border-ponder-light-card-border rounded-lg font-instrument text-ponder-light-text uppercase ${focusRing}`}
                data-testid="jira-project-key-input"
              />
              <p className="mt-1 text-xs text-ponder-light-text-muted font-instrument">
                The uppercase issue-key prefix, e.g. TEAM in TEAM-1.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="text-sm font-instrument text-red-600"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className={`px-4 py-2 rounded-lg font-instrument font-semibold text-sm text-white transition-colors ${
              isSaving
                ? "bg-ponder-light-purple/60 cursor-not-allowed"
                : "bg-ponder-light-purple hover:bg-ponder-light-purple-dark"
            } ${focusRing}`}
            data-testid="save-project-submit"
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </div>
    </main>
  );
}
