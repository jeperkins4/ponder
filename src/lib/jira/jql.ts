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
 * Parses a project's comma-separated "statuses to exclude from sync" setting.
 * null/undefined (pre-setting rows) fall back to the default ["QA"]; an
 * empty string is an explicit "exclude nothing".
 */
export function parseExcludedStatuses(
  value: string | null | undefined
): string[] {
  if (value === null || value === undefined) return ["QA"];
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Double-quotes a JQL string value, escaping backslashes and quotes. */
function quoteJqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Builds a JQL query for a single project's issues assigned to the current
 * user in any not-Done statusCategory, minus explicitly excluded status
 * names (e.g. QA). Category-based matching means custom or renamed active
 * statuses import without code changes; the exclusion list keeps parked
 * work (QA by default) off the board.
 * @param projectKey - JIRA project key (e.g., 'TEAM')
 * @param excludedStatuses - status names to exclude (already parsed; see
 *   parseExcludedStatuses)
 * @throws Error if projectKey is empty
 */
export function buildProjectStoriesJql(
  projectKey: string,
  excludedStatuses: string[]
): string {
  if (!projectKey) {
    throw new Error("buildProjectStoriesJql requires a project key");
  }
  const names = excludedStatuses.map((name) => name.trim()).filter(Boolean);
  const exclusion =
    names.length > 0
      ? ` AND status NOT IN (${names.map(quoteJqlString).join(", ")})`
      : "";
  return `project = "${projectKey}" AND assignee = currentUser() AND statusCategory != Done${exclusion}`;
}
