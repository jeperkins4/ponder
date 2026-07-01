/**
 * Unit tests for JIRA Query Language (JQL) builder
 */

import { describe, it, expect } from "vitest";
import { buildAssignedStoriesJql } from "./jql";

describe("JQL Builder", () => {
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
