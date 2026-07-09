/**
 * Unit tests for JIRA Query Language (JQL) builder
 */

import { describe, it, expect } from "vitest";
import {
  buildAssignedStoriesJql,
  buildProjectStoriesJql,
  parseExcludedStatuses,
} from "./jql";

describe("buildAssignedStoriesJql", () => {
  it("should build JQL for a single project", () => {
    const jql = buildAssignedStoriesJql(["TEAM"]);
    expect(jql).toBe(
      "project IN (TEAM) AND assignee = currentUser() AND statusCategory != Done"
    );
  });

  it("should build JQL for multiple projects", () => {
    const jql = buildAssignedStoriesJql(["TEAM", "OPS"]);
    expect(jql).toBe(
      "project IN (TEAM, OPS) AND assignee = currentUser() AND statusCategory != Done"
    );
  });

  it("should build JQL for many projects", () => {
    const jql = buildAssignedStoriesJql(["TEAM", "OPS", "INFRA", "PRODUCT"]);
    expect(jql).toBe(
      "project IN (TEAM, OPS, INFRA, PRODUCT) AND assignee = currentUser() AND statusCategory != Done"
    );
  });

  it("should throw an error for empty array", () => {
    expect(() => buildAssignedStoriesJql([])).toThrow(
      "buildAssignedStoriesJql requires at least one project key"
    );
  });
});

describe("buildProjectStoriesJql", () => {
  it("filters by statusCategory != Done", () => {
    expect(buildProjectStoriesJql("TEAM", [])).toBe(
      'project = "TEAM" AND assignee = currentUser() AND statusCategory != Done'
    );
  });

  it("appends a NOT IN clause for excluded statuses", () => {
    expect(buildProjectStoriesJql("TEAM", ["QA"])).toBe(
      'project = "TEAM" AND assignee = currentUser() AND statusCategory != Done AND status NOT IN ("QA")'
    );
    expect(buildProjectStoriesJql("TEAM", ["QA", "Blocked"])).toContain(
      'status NOT IN ("QA", "Blocked")'
    );
  });

  it("trims names and drops blanks in the exclusion list", () => {
    expect(buildProjectStoriesJql("TEAM", [" QA ", "", "  "])).toContain(
      'status NOT IN ("QA")'
    );
  });

  it("escapes embedded quotes and backslashes in status names", () => {
    expect(buildProjectStoriesJql("TEAM", ['Wei"rd'])).toContain(
      'status NOT IN ("Wei\\"rd")'
    );
    expect(buildProjectStoriesJql("TEAM", ["Back\\slash"])).toContain(
      'status NOT IN ("Back\\\\slash")'
    );
  });

  it("throws for an empty project key", () => {
    expect(() => buildProjectStoriesJql("", [])).toThrow(
      "buildProjectStoriesJql requires a project key"
    );
  });
});

describe("parseExcludedStatuses", () => {
  it("defaults null/undefined to QA", () => {
    expect(parseExcludedStatuses(null)).toEqual(["QA"]);
    expect(parseExcludedStatuses(undefined)).toEqual(["QA"]);
  });

  it("treats an empty string as exclude-nothing", () => {
    expect(parseExcludedStatuses("")).toEqual([]);
  });

  it("splits on commas, trims, and drops blanks", () => {
    expect(parseExcludedStatuses(" QA , Blocked ,, ")).toEqual(["QA", "Blocked"]);
  });
});
