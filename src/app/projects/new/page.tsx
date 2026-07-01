"use client";

/**
 * Create-project form.
 *
 * Client component: posts to POST /api/projects, then navigates to the new
 * project's board on success. The JIRA project key field is only shown (and
 * only required) when the STANDALONE/JIRA radio is set to JIRA.
 */

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Project } from "@/lib/types";

type ProjectType = Project["type"];

const focusRing =
  "focus:ring-2 focus:ring-ponder-light-purple focus:outline-none";

export default function NewProjectPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>("STANDALONE");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          ...(type === "JIRA" ? { jiraProjectKey } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to create project");
        setIsLoading(false);
        return;
      }

      router.push(`/projects/${data.id}/board`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-ponder-light-bg p-8">
      <div className="max-w-lg mx-auto">
        <h1 className="font-space-grotesk text-3xl font-bold text-ponder-light-text mb-8">
          New Project
        </h1>

        <form
          onSubmit={handleSubmit}
          className="bg-ponder-light-surface border border-ponder-light-card-border rounded-xl shadow-ponder-card p-6 space-y-6"
          data-testid="new-project-form"
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

          <fieldset>
            <legend className="block text-sm font-instrument font-semibold text-ponder-light-text mb-2">
              Project type
            </legend>
            <div className="space-y-2">
              <label className="flex items-start gap-2 font-instrument text-sm text-ponder-light-text cursor-pointer">
                <input
                  type="radio"
                  name="project-type"
                  value="STANDALONE"
                  checked={type === "STANDALONE"}
                  onChange={() => setType("STANDALONE")}
                  className={`mt-1 ${focusRing}`}
                  data-testid="project-type-standalone"
                />
                <span>
                  <span className="font-semibold">Standalone</span> — manual
                  work units
                </span>
              </label>
              <label className="flex items-start gap-2 font-instrument text-sm text-ponder-light-text cursor-pointer">
                <input
                  type="radio"
                  name="project-type"
                  value="JIRA"
                  checked={type === "JIRA"}
                  onChange={() => setType("JIRA")}
                  className={`mt-1 ${focusRing}`}
                  data-testid="project-type-jira"
                />
                <span>
                  <span className="font-semibold">JIRA Linked</span> — import
                  stories from JIRA
                </span>
              </label>
            </div>
          </fieldset>

          {type === "JIRA" && (
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
            disabled={isLoading}
            className={`px-4 py-2 rounded-lg font-instrument font-semibold text-sm text-white transition-colors ${
              isLoading
                ? "bg-ponder-light-purple/60 cursor-not-allowed"
                : "bg-ponder-light-purple hover:bg-ponder-light-purple-dark"
            } ${focusRing}`}
            data-testid="create-project-submit"
          >
            {isLoading ? "Creating…" : "Create Project"}
          </button>
        </form>
      </div>
    </main>
  );
}
