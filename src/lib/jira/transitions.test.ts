/**
 * Unit tests for JIRA transition matching logic
 */

import { describe, it, expect } from "vitest";
import { pickTransition, pickTransitionByStatusName, JiraTransition } from "./transitions";

describe("Transitions", () => {
  const mockTransitions: JiraTransition[] = [
    {
      id: "1",
      name: "To Do",
      to: {
        name: "To Do",
        statusCategory: { key: "indeterminate" },
      },
    },
    {
      id: "2",
      name: "In Progress",
      to: {
        name: "In Progress",
        statusCategory: { key: "indeterminate" },
      },
    },
    {
      id: "3",
      name: "Done",
      to: {
        name: "Done",
        statusCategory: { key: "done" },
      },
    },
  ];

  it("should find a transition matching the target category", () => {
    const transition = pickTransition(mockTransitions, "done");
    expect(transition).toBeDefined();
    expect(transition?.id).toBe("3");
    expect(transition?.name).toBe("Done");
  });

  it("should find a transition for indeterminate category", () => {
    const transition = pickTransition(mockTransitions, "indeterminate");
    expect(transition).toBeDefined();
    expect(transition?.id).toBe("1");
  });

  it("should return null if no matching transition exists", () => {
    const transition = pickTransition([], "done");
    expect(transition).toBeNull();
  });

  it("should return null when no matching transition exists", () => {
    // mockTransitions has 'done' and 'indeterminate' transitions, search for 'indeterminate'
    // Filter to only 'done' transitions, then search for 'indeterminate' — no match
    const onlyDoneTransitions = mockTransitions.filter(
      t => t.to.statusCategory.key === 'done'
    )
    expect(pickTransition(onlyDoneTransitions, 'indeterminate')).toBeNull()
  });

  it("should handle multiple transitions with same category", () => {
    const transition = pickTransition(mockTransitions, "indeterminate");
    // Should return the first match
    expect(transition?.id).toBe("1");
  });
});

describe("pickTransitionByStatusName", () => {
  const workflowTransitions: JiraTransition[] = [
    {
      id: "11",
      name: "Start Progress",
      to: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    },
    {
      id: "21",
      name: "Send to Review",
      to: { name: "Code Revew", statusCategory: { key: "indeterminate" } },
    },
  ];

  it("matches a transition by its destination status name", () => {
    const t = pickTransitionByStatusName(workflowTransitions, "In Progress");
    expect(t?.id).toBe("11");
  });

  it("matches case-insensitively", () => {
    const t = pickTransitionByStatusName(workflowTransitions, "in progress");
    expect(t?.id).toBe("11");
  });

  it("treats 'Code Review' and 'Code Revew' as equivalent", () => {
    const t1 = pickTransitionByStatusName(workflowTransitions, "Code Review");
    expect(t1?.id).toBe("21");

    const misspelledTransitions: JiraTransition[] = [
      {
        id: "22",
        name: "Send to Review",
        to: { name: "Code Review", statusCategory: { key: "indeterminate" } },
      },
    ];
    const t2 = pickTransitionByStatusName(misspelledTransitions, "Code Revew");
    expect(t2?.id).toBe("22");
  });

  it("returns null when no transition matches the status name", () => {
    const t = pickTransitionByStatusName(workflowTransitions, "Done");
    expect(t).toBeNull();
  });

  it("returns null for an empty transitions list", () => {
    expect(pickTransitionByStatusName([], "In Progress")).toBeNull();
  });
});
