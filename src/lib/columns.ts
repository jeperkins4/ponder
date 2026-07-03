import type { Column } from "@/lib/types";

export const COLUMNS: { key: Column; label: string; dotColorClass: string }[] = [
  { key: "todo", label: "To Do", dotColorClass: "bg-gray-400" },
  { key: "in_progress", label: "In Progress", dotColorClass: "bg-blue-500" },
  { key: "code_review", label: "Code Review", dotColorClass: "bg-purple-500" },
  { key: "done", label: "Done", dotColorClass: "bg-emerald-500" },
];

// Import target columns only. `done` is a local-only lane (no JIRA status maps
// to it; users drag cards there as work progresses).
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
