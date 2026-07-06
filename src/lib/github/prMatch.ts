/**
 * Pure PR-to-story matcher. A PR gates a story when the story's JIRA key
 * appears — case-insensitively, on word boundaries — in the PR's branch
 * name or title, and the PR is open or merged (closed-unmerged PRs are
 * abandoned work and don't count).
 */

import type { PrSummary } from "./client";

function containsKey(text: string, jiraKey: string): boolean {
  const escaped = jiraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Boundary = start/end of string or any non-alphanumeric character, so
  // COM-54 does not match COM-540 and COM-540 does not match COM-5401.
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(text);
}

export function findPrForKey(jiraKey: string, prs: PrSummary[]): PrSummary | null {
  for (const pr of prs) {
    if (pr.state === "closed" && !pr.merged) continue;
    if (containsKey(pr.headRef, jiraKey) || containsKey(pr.title, jiraKey)) {
      return pr;
    }
  }
  return null;
}
