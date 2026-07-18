/**
 * Unit tests for Ponder's canonical JIRA workflow stage ordering, used to
 * detect story status regressions for the Equilibrium Meter.
 */

import { describe, it, expect } from "vitest";
import { statusStageRank, isStatusRegression } from "./statusStage";

describe("statusStageRank", () => {
  it("ranks the known workflow stages in order", () => {
    expect(statusStageRank("To Do")).toBe(0);
    expect(statusStageRank("In Progress")).toBe(1);
    expect(statusStageRank("Code Review")).toBe(2);
    expect(statusStageRank("QA")).toBe(3);
    expect(statusStageRank("Done")).toBe(4);
  });

  it("treats the 'Code Revew' misspelling as equivalent to 'Code Review'", () => {
    expect(statusStageRank("Code Revew")).toBe(2);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(statusStageRank("  qa  ")).toBe(3);
    expect(statusStageRank("QA")).toBe(statusStageRank("qa"));
  });

  it("returns undefined for an unrecognized status", () => {
    expect(statusStageRank("Blocked")).toBeUndefined();
  });
});

describe("isStatusRegression", () => {
  it("is true when the new status is earlier in the workflow", () => {
    expect(isStatusRegression("QA", "In Progress")).toBe(true);
  });

  it("is false when the new status is later in the workflow", () => {
    expect(isStatusRegression("In Progress", "QA")).toBe(false);
  });

  it("is false when the status is unchanged", () => {
    expect(isStatusRegression("In Progress", "In Progress")).toBe(false);
  });

  it("is false when either status is unrecognized", () => {
    expect(isStatusRegression("Blocked", "In Progress")).toBe(false);
    expect(isStatusRegression("In Progress", "Blocked")).toBe(false);
  });
});
