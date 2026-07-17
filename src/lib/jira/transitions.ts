/**
 * JIRA transition matching logic
 * Pure functions for working with JIRA workflow transitions
 */

/**
 * Represents a JIRA workflow transition
 */
export type JiraTransition = {
  id: string;
  name: string;
  to: {
    name: string;
    statusCategory: { key: string };
  };
};

/**
 * JIRA status category
 */
export type StatusCategory = "indeterminate" | "done";

/**
 * Finds the first transition that matches the target status category
 * @param transitions - Array of available transitions
 * @param targetCategory - Target status category to find ('indeterminate' or 'done')
 * @returns The matching transition or null if no match found
 */
export function pickTransition(
  transitions: JiraTransition[],
  targetCategory: StatusCategory
): JiraTransition | null {
  return transitions.find((t) => t.to.statusCategory.key === targetCategory) ??
    null;
}

/**
 * Normalizes a JIRA status name for comparison, treating "Code Review" and
 * "Code Revew" (a common misspelling used by some workflows) as equivalent.
 */
export function normalizeStatusName(name: string): string {
  return name.trim().toLowerCase().replace(/code revew/, "code review");
}

/**
 * Finds the transition whose destination status NAME matches the given
 * status name (case-insensitively), treating "Code Review" and "Code Revew"
 * as the same status.
 * @param transitions - Array of available transitions
 * @param statusName - Desired destination status name (e.g. "In Progress", "Code Revew")
 * @returns The matching transition or null if no match found
 */
export function pickTransitionByStatusName(
  transitions: JiraTransition[],
  statusName: string
): JiraTransition | null {
  const target = normalizeStatusName(statusName);
  return (
    transitions.find((t) => normalizeStatusName(t.to.name) === target) ?? null
  );
}
