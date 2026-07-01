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
