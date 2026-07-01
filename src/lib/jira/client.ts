/**
 * JIRA REST API client
 * Fetches stories from JIRA and converts them to StoryDTO format
 */

import cuid from "cuid";
import { StoryDTO } from "@/lib/types";
import { buildAssignedStoriesJql, buildProjectStoriesJql } from "@/lib/jira/jql";
import { adfToPlainText, type AdfNode } from "@/lib/jira/adf";

/**
 * Configuration for connecting to JIRA
 */
export type JiraConfig = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

/**
 * JIRA issue response structure from REST API
 */
type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: AdfNode | null;
    status: {
      name: string;
    };
  };
};

/**
 * JIRA API search response
 */
type JiraSearchResponse = {
  issues: JiraIssue[];
};

/**
 * Extracts the project key from a JIRA issue key
 * @param jiraKey - Issue key (e.g., "TEAM-123")
 * @returns Project key (e.g., "TEAM")
 */
export function extractProjectKey(jiraKey: string): string {
  const parts = jiraKey.split("-");
  return parts[0];
}

/**
 * Converts a JIRA issue to a StoryDTO
 * @param issue - JIRA issue from API response
 * @param siteUrl - Base URL of JIRA instance
 * @returns Converted StoryDTO
 */
function issueToStoryDTO(issue: JiraIssue, siteUrl: string): StoryDTO {
  return {
    id: cuid(),
    jiraKey: issue.key,
    jiraId: issue.id,
    projectKey: extractProjectKey(issue.key),
    summary: issue.fields.summary,
    description: adfToPlainText(issue.fields.description),
    jiraStatus: issue.fields.status.name,
    url: `${siteUrl}/browse/${issue.key}`,
    lastSyncedAt: new Date().toISOString(),
    completionCommentPostedAt: null,
    workUnits: [],
  };
}

/**
 * Runs a JQL search against the JIRA REST API and converts the results to
 * StoryDTOs. This is the shared fetch mechanism (Basic Auth, /rest/api/3/search)
 * used by every JQL-driven fetch in this module — new fetch functions should
 * build a JQL string and delegate here rather than talking to fetch() directly.
 * @param jql - JQL query string
 * @param config - JIRA configuration (siteUrl, email, apiToken)
 * @returns Array of StoryDTO objects
 * @throws Error if API request fails
 */
async function searchIssuesByJql(
  jql: string,
  config: JiraConfig
): Promise<StoryDTO[]> {
  // Construct API URL
  const url = new URL(config.siteUrl);
  url.pathname = "/rest/api/3/search";
  url.searchParams.set("jql", jql);

  // Create Basic Auth header
  const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );

  // Fetch from JIRA API
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `JIRA API error: ${response.status} ${response.statusText}`
    );
  }

  const data: JiraSearchResponse = await response.json();

  // Convert issues to StoryDTO
  return data.issues.map((issue) => issueToStoryDTO(issue, config.siteUrl));
}

/**
 * Fetches assigned stories from JIRA for the given project keys
 * @param projectKeys - Array of JIRA project keys (e.g., ['TEAM', 'OPS'])
 * @param config - JIRA configuration (siteUrl, email, apiToken)
 * @returns Array of StoryDTO objects
 * @throws Error if API request fails
 */
export async function fetchAssignedStories(
  projectKeys: string[],
  config: JiraConfig
): Promise<StoryDTO[]> {
  const jql = buildAssignedStoriesJql(projectKeys);
  return searchIssuesByJql(jql, config);
}

/**
 * Fetches all Story/Task/Bug issues for a single JIRA project (not limited to
 * the current user's assigned issues). Used by project-aware sync to import
 * every relevant issue for a project.
 * @param projectKey - JIRA project key (e.g., 'TEAM')
 * @param config - JIRA configuration (siteUrl, email, apiToken)
 * @returns Array of StoryDTO objects
 * @throws Error if API request fails
 */
export async function fetchStoriesForProject(
  projectKey: string,
  config: JiraConfig
): Promise<StoryDTO[]> {
  const jql = buildProjectStoriesJql(projectKey);
  return searchIssuesByJql(jql, config);
}

/**
 * Result of a lightweight JIRA connection check.
 */
export type JiraConnectionResult =
  | { ok: true; displayName?: string }
  | { ok: false; error: string };

/**
 * Performs a single lightweight authenticated GET against
 * `${siteUrl}/rest/api/3/myself` to validate a set of JIRA credentials,
 * reusing the same Basic-auth header construction as the rest of this
 * module. Never throws: all failure modes (bad credentials, bad site URL,
 * network errors) are surfaced as `{ ok: false, error }`.
 * @param config - JIRA configuration (siteUrl, email, apiToken) to validate
 * @returns `{ ok: true, displayName? }` on success, `{ ok: false, error }` otherwise
 */
export async function testJiraConnection(
  config: JiraConfig
): Promise<JiraConnectionResult> {
  const credentials = Buffer.from(
    `${config.email}:${config.apiToken}`
  ).toString("base64");

  let response: Response;
  try {
    const url = new URL(config.siteUrl);
    url.pathname = "/rest/api/3/myself";

    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, error: `Could not reach JIRA — ${message}` };
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { ok: false, error: "HTTP 401 — check email/API token" };
    }
    if (response.status === 404) {
      return { ok: false, error: "HTTP 404 — check the site URL" };
    }
    return {
      ok: false,
      error: `HTTP ${response.status} — ${response.statusText}`,
    };
  }

  try {
    const data = await response.json();
    return { ok: true, displayName: data?.displayName };
  } catch {
    return { ok: true };
  }
}
