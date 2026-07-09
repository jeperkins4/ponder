/**
 * JIRA Query Language (JQL) builder
 * Pure functions for constructing JIRA search queries
 */

/**
 * Default per-project "Statuses to sync" allowlist — today's exact
 * historical fetch behavior. Note "Code Revew" is not a typo here: it is
 * the real, misspelled status name used in the JIRA instance, kept
 * alongside the correctly-spelled "Code Review" so either matches.
 */
export const DEFAULT_SYNC_STATUSES = [
  "To Do",
  "In Progress",
  "Code Revew",
  "Code Review",
];

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
 * Parses a project's comma-separated "statuses to sync" setting. A null,
 * undefined, empty, or all-blank value falls back to the default allowlist
 * — misconfiguration can never mean "sync nothing" or "sync everything".
 */
export function parseSyncStatuses(
  value: string | null | undefined
): string[] {
  if (value === null || value === undefined) return [...DEFAULT_SYNC_STATUSES];
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? names : [...DEFAULT_SYNC_STATUSES];
}

/** Double-quotes a JQL string value, escaping backslashes and quotes. */
function quoteJqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Builds a JQL query for a single project's issues assigned to the current
 * user whose status is on the given allowlist. Unknown/future statuses
 * default out; the allowlist is the per-project "Statuses to sync" setting
 * (see parseSyncStatuses).
 * @param projectKey - JIRA project key (e.g., 'TEAM')
 * @param syncStatuses - status names to include (already parsed; see
 *   parseSyncStatuses)
 * @throws Error if projectKey is empty
 * @throws Error if the cleaned syncStatuses list is empty
 */
export function buildProjectStoriesJql(
  projectKey: string,
  syncStatuses: string[]
): string {
  if (!projectKey) {
    throw new Error("buildProjectStoriesJql requires a project key");
  }
  const names = syncStatuses.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new Error(
      "buildProjectStoriesJql requires at least one sync status"
    );
  }
  const statusList = names.map(quoteJqlString).join(", ");
  return `project = "${projectKey}" AND assignee = currentUser() AND status IN (${statusList})`;
}
