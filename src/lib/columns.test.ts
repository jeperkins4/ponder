import { describe, it, expect } from "vitest";
import { COLUMNS, jiraStatusToColumn } from "@/lib/columns";

describe("COLUMNS", () => {
  it("has the 5 keys in the specified order", () => {
    expect(COLUMNS.map((c) => c.key)).toEqual([
      "todo",
      "in_progress",
      "code_review",
      "in_review",
      "done",
    ]);
  });

  it("pairs each key with a human-readable label", () => {
    expect(COLUMNS).toEqual([
      { key: "todo", label: "To Do" },
      { key: "in_progress", label: "In Progress" },
      { key: "code_review", label: "Code Review" },
      { key: "in_review", label: "In Review" },
      { key: "done", label: "Done" },
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
