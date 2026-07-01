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
