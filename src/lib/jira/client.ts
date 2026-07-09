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
      statusCategory?: { key: string };
    };
  };
};

/**
 * JIRA enhanced-search (`/rest/api/3/search/jql`) response.
 * Token-based pagination: `nextPageToken` is present only while more pages
 * remain. There is no `total` in this API. Some responses also include an
 * explicit `isLast` flag.
 */
type JiraSearchResponse = {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
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
/** JIRA's three fixed category keys; anything unexpected degrades to "new"
 * so the column mapping falls back to To Do (pre-category behavior). */
function narrowStatusCategory(
  key: string | undefined
): "new" | "indeterminate" | "done" {
  return key === "indeterminate" || key === "done" ? key : "new";
}

function issueToStoryDTO(issue: JiraIssue, siteUrl: string): StoryDTO {
  return {
    id: cuid(),
    jiraKey: issue.key,
    jiraId: issue.id,
    projectKey: extractProjectKey(issue.key),
    summary: issue.fields.summary,
    description: adfToPlainText(issue.fields.description),
    jiraStatus: issue.fields.status.name,
    jiraStatusCategory: narrowStatusCategory(issue.fields.status.statusCategory?.key),
    url: `${siteUrl}/browse/${issue.key}`,
    lastSyncedAt: new Date().toISOString(),
    completionCommentPostedAt: null,
    workUnits: [],
  };
}

// Fields we need from each issue. The enhanced search endpoint returns only
// `id`/`key` unless `fields` is requested explicitly, so this must be sent.
const SEARCH_FIELDS = "summary,description,status";
const SEARCH_PAGE_SIZE = 100;
// Safety bound so a misbehaving pagination token can never loop forever.
const MAX_SEARCH_PAGES = 1000;

/**
 * Runs a JQL search against the JIRA REST API and converts the results to
 * StoryDTOs. This is the shared fetch mechanism (Basic Auth) used by every
 * JQL-driven fetch in this module — new fetch functions should build a JQL
 * string and delegate here rather than talking to fetch() directly.
 *
 * Uses the enhanced-search endpoint `/rest/api/3/search/jql` (the classic
 * `/rest/api/3/search` was removed by Atlassian and now returns HTTP 410).
 * That endpoint paginates by opaque `nextPageToken` (there is no `total`),
 * so this walks every page and returns the full result set.
 * @param jql - JQL query string
 * @param config - JIRA configuration (siteUrl, email, apiToken)
 * @returns Array of StoryDTO objects
 * @throws Error if API request fails
 */
async function searchIssuesByJql(
  jql: string,
  config: JiraConfig
): Promise<StoryDTO[]> {
  // Create Basic Auth header
  const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );

  const stories: StoryDTO[] = [];
  let nextPageToken: string | undefined = undefined;

  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const url = new URL(config.siteUrl);
    url.pathname = "/rest/api/3/search/jql";
    url.searchParams.set("jql", jql);
    url.searchParams.set("fields", SEARCH_FIELDS);
    url.searchParams.set("maxResults", String(SEARCH_PAGE_SIZE));
    if (nextPageToken) {
      url.searchParams.set("nextPageToken", nextPageToken);
    }

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

    for (const issue of data.issues ?? []) {
      stories.push(issueToStoryDTO(issue, config.siteUrl));
    }

    // Stop when the API signals the last page or hands back no continuation
    // token. (An empty page with no token also terminates the loop.)
    if (data.isLast === true || !data.nextPageToken) {
      break;
    }
    nextPageToken = data.nextPageToken;
  }

  return stories;
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
  config: JiraConfig,
  excludedStatuses: string[] = ["QA"]
): Promise<StoryDTO[]> {
  const jql = buildProjectStoriesJql(projectKey, excludedStatuses);
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
