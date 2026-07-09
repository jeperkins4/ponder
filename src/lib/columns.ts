import type { Column } from "@/lib/types";

export const COLUMNS: { key: Column; label: string; dotColorClass: string }[] = [
  { key: "todo", label: "To Do", dotColorClass: "bg-gray-400" },
  { key: "in_progress", label: "In Progress", dotColorClass: "bg-blue-500" },
  { key: "code_review", label: "Code Review", dotColorClass: "bg-purple-500" },
  { key: "done", label: "Done", dotColorClass: "bg-emerald-500" },
];

// Explicit name overrides for import target columns. `done` is a local-only
// lane for name matching (no JIRA status name maps to it), but the category
// fallback below can land there. Names win over category — "Code Revew" is
// indeterminate-category yet must map to code_review.
const STATUS_TO_COLUMN: Record<string, Column> = {
  "to do": "todo",
  "in progress": "in_progress",
  review: "in_progress",
  "code revew": "code_review", // matches the real (misspelled) JIRA status
  "code review": "code_review",
};

/**
 * Maps a JIRA status to a board column: explicit name overrides first, then
 * the status's JIRA statusCategory (new/indeterminate/done), then todo.
 * The category parameter is optional so pre-category callers keep today's
 * name-or-todo behavior.
 */
export function jiraStatusToColumn(
  status: string,
  category?: "new" | "indeterminate" | "done"
): Column {
  const byName = STATUS_TO_COLUMN[status.trim().toLowerCase()];
  if (byName) return byName;
  if (category === "indeterminate") return "in_progress";
  if (category === "done") return "done";
  return "todo";
}
