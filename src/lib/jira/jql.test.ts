/**
 * Unit tests for JIRA Query Language (JQL) builder
 */

import { describe, it, expect } from "vitest";
import {
  buildProjectStoriesJql,
  buildEpicsJql,
  buildEpicStoriesJql,
  parseSyncStatuses,
  DEFAULT_SYNC_STATUSES,
} from "./jql";

describe("buildProjectStoriesJql", () => {
  it("builds a status IN (...) allowlist clause with the default list", () => {
    expect(buildProjectStoriesJql("TEAM", DEFAULT_SYNC_STATUSES)).toBe(
      'project = "TEAM" AND assignee = currentUser() AND status IN ("To Do", "In Progress", "Code Revew", "Code Review")'
    );
  });

  it("builds a status IN (...) allowlist clause with a custom list", () => {
    expect(buildProjectStoriesJql("TEAM", ["QA"])).toBe(
      'project = "TEAM" AND assignee = currentUser() AND status IN ("QA")'
    );
    expect(buildProjectStoriesJql("TEAM", ["QA", "Blocked"])).toContain(
      'status IN ("QA", "Blocked")'
    );
  });

  it("trims names and drops blanks in the allowlist", () => {
    expect(buildProjectStoriesJql("TEAM", [" QA ", "", "  "])).toBe(
      'project = "TEAM" AND assignee = currentUser() AND status IN ("QA")'
    );
  });

  it("escapes embedded quotes and backslashes in status names", () => {
    expect(buildProjectStoriesJql("TEAM", ['Wei"rd'])).toContain(
      'status IN ("Wei\\"rd")'
    );
    expect(buildProjectStoriesJql("TEAM", ["Back\\slash"])).toContain(
      'status IN ("Back\\\\slash")'
    );
  });

  it("throws for an empty project key", () => {
    expect(() => buildProjectStoriesJql("", ["QA"])).toThrow(
      "buildProjectStoriesJql requires a project key"
    );
  });

  it("throws when the cleaned sync-status list is empty", () => {
    expect(() => buildProjectStoriesJql("TEAM", [])).toThrow(
      "buildProjectStoriesJql requires at least one sync status"
    );
    expect(() => buildProjectStoriesJql("TEAM", ["", "  "])).toThrow(
      "buildProjectStoriesJql requires at least one sync status"
    );
  });
});

describe("parseSyncStatuses", () => {
  it("defaults null/undefined/empty/all-blank to the default four", () => {
    expect(parseSyncStatuses(null)).toEqual(DEFAULT_SYNC_STATUSES);
    expect(parseSyncStatuses(undefined)).toEqual(DEFAULT_SYNC_STATUSES);
    expect(parseSyncStatuses("")).toEqual(DEFAULT_SYNC_STATUSES);
    expect(parseSyncStatuses("  ,  ,")).toEqual(DEFAULT_SYNC_STATUSES);
  });

  it("splits on commas, trims, and drops blanks", () => {
    expect(parseSyncStatuses(" To Do , QA ,, ")).toEqual(["To Do", "QA"]);
  });

  it("parses a single custom status", () => {
    expect(parseSyncStatuses("Blocked")).toEqual(["Blocked"]);
  });
});

describe("buildEpicsJql", () => {
  it("builds a project-scoped Epic-issuetype query ordered by most recently updated", () => {
    expect(buildEpicsJql("TEAM")).toBe(
      'project = "TEAM" AND issuetype = Epic ORDER BY updated DESC'
    );
  });

  it("throws for an empty project key", () => {
    expect(() => buildEpicsJql("")).toThrow(
      "buildEpicsJql requires a project key"
    );
  });
});

describe("buildEpicStoriesJql", () => {
  it("builds a parent-only clause when the Epic Link field is absent", () => {
    expect(buildEpicStoriesJql("TEAM-100", ["To Do"], false)).toBe(
      'parent = "TEAM-100" AND status IN ("To Do")'
    );
  });

  it("builds a parent-OR-Epic-Link clause when the Epic Link field is present", () => {
    expect(buildEpicStoriesJql("TEAM-100", ["To Do"], true)).toBe(
      '(parent = "TEAM-100" OR "Epic Link" = "TEAM-100") AND status IN ("To Do")'
    );
  });

  it("never includes an assignee clause", () => {
    expect(buildEpicStoriesJql("TEAM-100", DEFAULT_SYNC_STATUSES, true)).not.toContain(
      "assignee"
    );
  });

  it("applies the same quoting/escaping to the epic key as to status names", () => {
    expect(buildEpicStoriesJql('Wei"rd-1', ["QA"], false)).toBe(
      'parent = "Wei\\"rd-1" AND status IN ("QA")'
    );
  });

  it("trims names and drops blanks in the status allowlist", () => {
    expect(buildEpicStoriesJql("TEAM-100", [" QA ", "", "  "], false)).toBe(
      'parent = "TEAM-100" AND status IN ("QA")'
    );
  });

  it("throws for an empty epic key", () => {
    expect(() => buildEpicStoriesJql("", ["QA"], false)).toThrow(
      "buildEpicStoriesJql requires an epic key"
    );
  });

  it("throws when the cleaned sync-status list is empty", () => {
    expect(() => buildEpicStoriesJql("TEAM-100", [], false)).toThrow(
      "buildEpicStoriesJql requires at least one sync status"
    );
  });
});
