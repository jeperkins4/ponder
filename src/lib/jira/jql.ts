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

/**
 * Builds a JQL query for a single project's Epic-type issues, most recently
 * updated first — used to populate the epic picker in the import review UI.
 * @param projectKey - JIRA project key (e.g., 'TEAM')
 * @throws Error if projectKey is empty
 */
export function buildEpicsJql(projectKey: string): string {
  if (!projectKey) {
    throw new Error("buildEpicsJql requires a project key");
  }
  return `project = ${quoteJqlString(projectKey)} AND issuetype = Epic ORDER BY updated DESC`;
}

/**
 * Builds a JQL query for all issues under a single epic whose status is on
 * the given allowlist. Unlike buildProjectStoriesJql, this has no
 * `assignee = currentUser()` clause — epic import pulls in everything under
 * the epic regardless of who it's assigned to.
 *
 * JIRA represents epic membership differently by project type: team-managed
 * projects use the system `parent` field; company-managed projects use a
 * custom "Epic Link" field. `hasEpicLinkField` (see
 * `hasEpicLinkField` in client.ts) tells this builder whether the site has
 * that custom field, so it can widen the clause with an OR when it does.
 * @param epicKey - JIRA epic key (e.g., 'TEAM-100')
 * @param syncStatuses - status names to include (already parsed; see
 *   parseSyncStatuses)
 * @param hasEpicLinkField - whether this JIRA site has a custom "Epic Link"
 *   field (company-managed projects); when false, only `parent` is used
 * @throws Error if epicKey is empty
 * @throws Error if the cleaned syncStatuses list is empty
 */
export function buildEpicStoriesJql(
  epicKey: string,
  syncStatuses: string[],
  hasEpicLinkField: boolean
): string {
  if (!epicKey) {
    throw new Error("buildEpicStoriesJql requires an epic key");
  }
  const names = syncStatuses.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new Error(
      "buildEpicStoriesJql requires at least one sync status"
    );
  }
  const statusList = names.map(quoteJqlString).join(", ");
  const quotedEpicKey = quoteJqlString(epicKey);
  const epicClause = hasEpicLinkField
    ? `(parent = ${quotedEpicKey} OR "Epic Link" = ${quotedEpicKey})`
    : `parent = ${quotedEpicKey}`;
  return `${epicClause} AND status IN (${statusList})`;
}
