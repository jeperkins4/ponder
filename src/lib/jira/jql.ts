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
 * JIRA statuses considered "active work" for the local board. Stories outside
 * these statuses (e.g. Closed, QA Approved) are not imported.
 *
 * NOTE: both "Code Revew" (the current, misspelled status name in the JIRA
 * instance) and "Code Review" (the corrected spelling) are listed so the sync
 * keeps working if/when the typo is fixed in JIRA. JQL status matching is exact.
 */
const PROJECT_SYNC_STATUSES = [
  "To Do",
  "In Progress",
  "Code Revew",
  "Code Review",
];

/**
 * Builds a JQL query for finding a single project's issues assigned to the
 * current user and currently in an active status (see PROJECT_SYNC_STATUSES).
 * Any issue type assigned to the current user in an active status is included —
 * sub-tasks and epics arrive as ordinary board stories. Used by project-aware
 * sync: `currentUser()` resolves to the account whose credentials the project
 * is configured with, so each project imports only that account's active,
 * assigned issues.
 * @param projectKey - JIRA project key (e.g., 'TEAM')
 * @returns JQL query string
 * @throws Error if projectKey is empty
 */
export function buildProjectStoriesJql(projectKey: string): string {
  if (!projectKey) {
    throw new Error("buildProjectStoriesJql requires a project key");
  }
  const statuses = PROJECT_SYNC_STATUSES.map((s) => `"${s}"`).join(", ");
  return `project = "${projectKey}" AND assignee = currentUser() AND status in (${statuses})`;
}
