/**
 * JIRA REST API client
 * Fetches stories from JIRA and converts them to StoryDTO format
 */

import cuid from "cuid";
import { StoryDTO } from "@/lib/types";
import { buildAssignedStoriesJql } from "@/lib/jira/jql";
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
  // Build JQL query
  const jql = buildAssignedStoriesJql(projectKeys);

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
