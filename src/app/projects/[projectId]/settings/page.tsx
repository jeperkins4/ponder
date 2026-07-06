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
import { ProjectWithStats } from "@/lib/types";

const focusRing =
  "focus:ring-2 focus:ring-ponder-light-purple focus:outline-none";

type TestConnectionStatus = "idle" | "testing" | "success" | "error";

export default function ProjectSettingsPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId as string;

  const [project, setProject] = useState<ProjectWithStats | null>(null);
  const [name, setName] = useState("");
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [jiraSiteUrl, setJiraSiteUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [githubRepos, setGithubRepos] = useState("");
  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestConnectionStatus>("idle");
  const [testMessage, setTestMessage] = useState("");

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
          setJiraSiteUrl(data.jiraSiteUrl ?? "");
          setJiraEmail(data.jiraEmail ?? "");
          setGithubRepos(data.githubRepos ?? "");
          // The API token is write-only and never returned by the API, so
          // it is intentionally never pre-filled here.
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
      const body: Record<string, unknown> = {
        name,
        jiraProjectKey,
        jiraSiteUrl,
        jiraEmail,
        githubRepos,
      };
      // The API token is write-only: only send it when the user actually
      // typed something, so leaving it blank preserves the stored token.
      if (jiraApiToken.trim() !== "") {
        body.jiraApiToken = jiraApiToken;
      }

      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestMessage("");

    try {
      const body: Record<string, unknown> = { jiraSiteUrl, jiraEmail };
      if (jiraApiToken.trim() !== "") {
        body.jiraApiToken = jiraApiToken;
      }

      const response = await fetch(
        `/api/projects/${projectId}/test-connection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      const data = await response.json();

      if (data.ok) {
        setTestStatus("success");
        setTestMessage(
          data.displayName
            ? `✓ Connected as ${data.displayName}`
            : "✓ Connection successful"
        );
      } else {
        setTestStatus("error");
        setTestMessage(`✗ ${data.error || "Connection failed"}`);
      }
    } catch (err) {
      setTestStatus("error");
      setTestMessage(
        `✗ ${err instanceof Error ? err.message : "Connection failed"}`
      );
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

          {project?.type === "JIRA" && (
            <div
              className="space-y-4 border-t border-ponder-light-card-border pt-6"
              data-testid="jira-connection-section"
            >
              <h2 className="text-sm font-instrument font-semibold text-ponder-light-text">
                JIRA Connection
              </h2>

              <div>
                <label
                  htmlFor="jira-site-url"
                  className="block text-sm font-instrument font-semibold text-ponder-light-text mb-1"
                >
                  Site URL
                </label>
                <input
                  id="jira-site-url"
                  type="text"
                  value={jiraSiteUrl}
                  onChange={(e) => setJiraSiteUrl(e.target.value)}
                  placeholder="https://your-domain.atlassian.net"
                  className={`w-full px-3 py-2 bg-ponder-light-surface border border-ponder-light-card-border rounded-lg font-instrument text-ponder-light-text ${focusRing}`}
                  data-testid="jira-site-url-input"
                />
              </div>

              <div>
                <label
                  htmlFor="jira-email"
                  className="block text-sm font-instrument font-semibold text-ponder-light-text mb-1"
                >
                  Email
                </label>
                <input
                  id="jira-email"
                  type="text"
                  value={jiraEmail}
                  onChange={(e) => setJiraEmail(e.target.value)}
                  className={`w-full px-3 py-2 bg-ponder-light-surface border border-ponder-light-card-border rounded-lg font-instrument text-ponder-light-text ${focusRing}`}
                  data-testid="jira-email-input"
                />
              </div>

              <div>
                <label
                  htmlFor="jira-api-token"
                  className="block text-sm font-instrument font-semibold text-ponder-light-text mb-1"
                >
                  API token
                </label>
                <input
                  id="jira-api-token"
                  type="password"
                  value={jiraApiToken}
                  onChange={(e) => setJiraApiToken(e.target.value)}
                  placeholder={
                    project?.hasApiToken
                      ? "•••••••• (saved — leave blank to keep)"
                      : "Paste your Atlassian API token"
                  }
                  className={`w-full px-3 py-2 bg-ponder-light-surface border border-ponder-light-card-border rounded-lg font-instrument text-ponder-light-text ${focusRing}`}
                  data-testid="jira-api-token-input"
                />
                <p className="mt-1 text-xs text-ponder-light-text-muted font-instrument">
                  Create a token at{" "}
                  <a
                    href="https://id.atlassian.com/manage-profile/security/api-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`underline text-ponder-light-purple ${focusRing}`}
                  >
                    id.atlassian.com
                  </a>{" "}
                  → Security → API tokens.
                </p>
              </div>

              <div>
                <label
                  htmlFor="github-repos"
                  className="block text-sm font-instrument font-semibold text-ponder-light-text mb-1"
                >
                  GitHub repositories
                </label>
                <input
                  id="github-repos"
                  type="text"
                  value={githubRepos}
                  onChange={(e) => setGithubRepos(e.target.value)}
                  placeholder="owner/repo, owner/repo"
                  className={`w-full px-3 py-2 bg-ponder-light-surface border border-ponder-light-card-border rounded-lg font-instrument text-ponder-light-text ${focusRing}`}
                  data-testid="github-repos-input"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testStatus === "testing"}
                  className={`px-4 py-2 rounded-lg font-instrument font-semibold text-sm border transition-colors ${
                    testStatus === "testing"
                      ? "border-ponder-light-card-border text-ponder-light-text-muted cursor-not-allowed"
                      : "border-ponder-light-purple text-ponder-light-purple hover:bg-ponder-light-purple/10"
                  } ${focusRing}`}
                  data-testid="test-connection-button"
                >
                  {testStatus === "testing" ? "Testing…" : "Test connection"}
                </button>

                {testMessage && (
                  <p
                    role={testStatus === "error" ? "alert" : "status"}
                    className={`mt-2 text-sm font-instrument ${
                      testStatus === "error"
                        ? "text-red-600"
                        : "text-green-700"
                    }`}
                    data-testid="test-connection-result"
                  >
                    {testMessage}
                  </p>
                )}
              </div>
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
