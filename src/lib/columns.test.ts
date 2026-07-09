import { describe, it, expect } from "vitest";
import { COLUMNS, jiraStatusToColumn } from "@/lib/columns";

describe("COLUMNS", () => {
  it("has the 4 keys in the specified order", () => {
    expect(COLUMNS.map((c) => c.key)).toEqual([
      "todo",
      "in_progress",
      "code_review",
      "done",
    ]);
  });

  it("pairs each key with a human-readable label and a dot accent color", () => {
    expect(COLUMNS).toEqual([
      { key: "todo", label: "To Do", dotColorClass: "bg-gray-400" },
      { key: "in_progress", label: "In Progress", dotColorClass: "bg-blue-500" },
      { key: "code_review", label: "Code Review", dotColorClass: "bg-purple-500" },
      { key: "done", label: "Done", dotColorClass: "bg-emerald-500" },
    ]);
  });
});

describe("jiraStatusToColumn", () => {
  it("maps 'To Do' to todo", () => {
    expect(jiraStatusToColumn("To Do")).toBe("todo");
  });

  it("maps 'In Progress' to in_progress", () => {
    expect(jiraStatusToColumn("In Progress")).toBe("in_progress");
  });

  it("maps 'Review' to in_progress", () => {
    expect(jiraStatusToColumn("Review")).toBe("in_progress");
  });

  it("maps the misspelled 'Code Revew' to code_review", () => {
    expect(jiraStatusToColumn("Code Revew")).toBe("code_review");
  });

  it("maps 'Code Review' to code_review", () => {
    expect(jiraStatusToColumn("Code Review")).toBe("code_review");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(jiraStatusToColumn("  TO DO  ")).toBe("todo");
    expect(jiraStatusToColumn("code revew")).toBe("code_review");
    expect(jiraStatusToColumn("CODE REVIEW")).toBe("code_review");
    expect(jiraStatusToColumn("review")).toBe("in_progress");
  });

  it("falls back to todo for an unknown status", () => {
    expect(jiraStatusToColumn("Blocked")).toBe("todo");
  });

  it("falls back to todo for an empty status", () => {
    expect(jiraStatusToColumn("")).toBe("todo");
  });
});

describe("jiraStatusToColumn category fallback", () => {
  it("maps unknown statuses by category", () => {
    expect(jiraStatusToColumn("Blocked", "indeterminate")).toBe("in_progress");
    expect(jiraStatusToColumn("Backlog Triage", "new")).toBe("todo");
    expect(jiraStatusToColumn("Shipped", "done")).toBe("done");
  });

  it("lets name overrides beat a contradicting category", () => {
    expect(jiraStatusToColumn("Code Revew", "indeterminate")).toBe("code_review");
    expect(jiraStatusToColumn("To Do", "indeterminate")).toBe("todo");
    expect(jiraStatusToColumn("Review", "done")).toBe("in_progress");
  });

  it("falls back to todo when category is absent or unknown", () => {
    expect(jiraStatusToColumn("Blocked")).toBe("todo");
    expect(
      jiraStatusToColumn("Blocked", "mystery" as unknown as "new")
    ).toBe("todo");
  });
});
