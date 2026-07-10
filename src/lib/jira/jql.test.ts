/**
 * Unit tests for JIRA Query Language (JQL) builder
 */

import { describe, it, expect } from "vitest";
import {
  buildProjectStoriesJql,
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
