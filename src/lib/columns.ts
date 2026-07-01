import type { Column } from "@/lib/types";

export const COLUMNS: { key: Column; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "code_review", label: "Code Review" },
  { key: "in_review", label: "In Review" },
  { key: "done", label: "Done" },
];

// Import target columns only. `in_review` and `done` are local-only lanes
// (no JIRA status maps to them; users drag cards there as work progresses).
const STATUS_TO_COLUMN: Record<string, Column> = {
  "to do": "todo",
  "in progress": "in_progress",
  review: "in_progress",
  "code revew": "code_review", // matches the real (misspelled) JIRA status
  "code review": "code_review",
};

export function jiraStatusToColumn(status: string): Column {
  return STATUS_TO_COLUMN[status.trim().toLowerCase()] ?? "todo";
}
