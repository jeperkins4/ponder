/**
 * JIRA Query Language (JQL) builder
 * Pure functions for constructing JIRA search queries
 */

/**
 * Builds a JQL query for finding assigned stories across multiple projects
 * @param projectKeys - Array of JIRA project keys (e.g., ['TEAM', 'OPS'])
 * @returns JQL query string for assigned stories not in Done status
 * @throws Error if projectKeys array is empty
 */
export function buildAssignedStoriesJql(projectKeys: string[]): string {
  if (projectKeys.length === 0) {
    throw new Error(
      "buildAssignedStoriesJql requires at least one project key"
    );
  }
  const keys = projectKeys.join(", ");
  return `project IN (${keys}) AND assignee = currentUser() AND statusCategory != Done`;
}

/**
 * Builds a JQL query for finding a single project's Story/Task/Bug issues that
 * are assigned to the current user. Used by project-aware sync: `currentUser()`
 * resolves to the account whose credentials the project is configured with, so
 * each project imports only the issues assigned to that account.
 * @param projectKey - JIRA project key (e.g., 'TEAM')
 * @returns JQL query string
 * @throws Error if projectKey is empty
 */
export function buildProjectStoriesJql(projectKey: string): string {
  if (!projectKey) {
    throw new Error("buildProjectStoriesJql requires a project key");
  }
  return `project = "${projectKey}" AND issuetype in (Story, Task, Bug) AND assignee = currentUser()`;
}
