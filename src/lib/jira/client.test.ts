/**
 * Unit tests for JIRA API client
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchStoriesForProject,
  fetchEpicsForProject,
  hasEpicLinkField,
  fetchStoriesForEpic,
  extractProjectKey,
  testJiraConnection,
} from "./client";
import type { JiraConfig } from "./client";

describe("JIRA API Client", () => {
  const mockConfig: JiraConfig = {
    siteUrl: "https://example.atlassian.net",
    email: "user@example.com",
    apiToken: "test-token-123",
  };

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  describe("extractProjectKey", () => {
    it("extracts project key from jira key", () => {
      expect(extractProjectKey("TEAM-123")).toBe("TEAM");
    });

    it("handles multi-character project keys", () => {
      expect(extractProjectKey("PROJECT-456")).toBe("PROJECT");
    });

    it("handles single-character project keys", () => {
      expect(extractProjectKey("A-789")).toBe("A");
    });
  });

  describe("enhanced search endpoint (/rest/api/3/search/jql)", () => {
    const makeIssue = (n: number) => ({
      id: `100${n}`,
      key: `TEAM-${n}`,
      fields: {
        summary: `Issue ${n}`,
        description: null,
        status: { name: "To Do", statusCategory: { key: "new" } },
      },
    });

    it("targets /search/jql and requests fields + maxResults explicitly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [makeIssue(1)] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await fetchStoriesForProject("TEAM", mockConfig);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/rest/api/3/search/jql");
      // The enhanced endpoint returns only id/key unless fields is requested.
      expect(url).toContain("fields=summary%2Cdescription%2Cstatus%2Cissuelinks");
      expect(url).toContain("maxResults=");
    });

    it("extracts linked issue keys from issuelinks onto the StoryDTO", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          issues: [
            {
              id: "10001",
              key: "TEAM-1",
              fields: {
                summary: "Issue 1",
                description: null,
                status: { name: "Code Revew", statusCategory: { key: "indeterminate" } },
                issuelinks: [
                  { outwardIssue: { key: "TEAM-2" } },
                  { inwardIssue: { key: "TEAM-3" } },
                  {}, // a link type this app doesn't need to understand
                ],
              },
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const [story] = await fetchStoriesForProject("TEAM", mockConfig);

      expect(story.linkedIssueKeys).toEqual(["TEAM-2", "TEAM-3"]);
    });

    it("defaults linkedIssueKeys to an empty array when issuelinks is absent", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [makeIssue(1)] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const [story] = await fetchStoriesForProject("TEAM", mockConfig);

      expect(story.linkedIssueKeys).toEqual([]);
    });

    it("walks every page using nextPageToken and returns all issues", async () => {
      const mockFetch = vi
        .fn()
        // Page 1: a continuation token is returned.
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            issues: [makeIssue(1), makeIssue(2)],
            nextPageToken: "TOKEN_PAGE_2",
          }),
        })
        // Page 2: no token → last page.
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ issues: [makeIssue(3)] }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const stories = await fetchStoriesForProject("TEAM", mockConfig);

      // All three issues across both pages are returned.
      expect(stories.map((s) => s.jiraKey)).toEqual([
        "TEAM-1",
        "TEAM-2",
        "TEAM-3",
      ]);
      // Two requests were made, and the second carried the page-2 token.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).not.toContain("nextPageToken");
      expect(mockFetch.mock.calls[1][0]).toContain("nextPageToken=TOKEN_PAGE_2");
    });

    it("stops paginating when isLast is true even if a token is present", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [makeIssue(1)],
          nextPageToken: "SHOULD_NOT_BE_USED",
          isLast: true,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const stories = await fetchStoriesForProject("TEAM", mockConfig);

      expect(stories).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchStoriesForProject", () => {
    it("fetches and converts all issues for a single project", async () => {
      const mockResponse = {
        issues: [
          {
            id: "10001",
            key: "TEAM-123",
            fields: {
              summary: "Unassigned bug",
              description: null,
              status: { name: "To Do" },
            },
          },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        })
      );

      const stories = await fetchStoriesForProject("TEAM", mockConfig);

      expect(stories).toHaveLength(1);
      expect(stories[0].jiraKey).toBe("TEAM-123");
      expect(stories[0].projectKey).toBe("TEAM");
    });

    it("builds a JQL query scoped to the project key and the current user", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await fetchStoriesForProject("TEAM", mockConfig);

      const url = mockFetch.mock.calls[0][0] as string;
      const decodedUrl = decodeURIComponent(url.replace(/\+/g, " "));
      expect(decodedUrl).toContain('project = "TEAM"');
      expect(decodedUrl).not.toContain("issuetype");
      expect(decodedUrl).toContain("assignee = currentUser()");
      expect(decodedUrl).toContain(
        'status IN ("To Do", "In Progress", "Code Revew", "Code Review")'
      );
    });

    it("throws error on API failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        })
      );

      await expect(fetchStoriesForProject("TEAM", mockConfig)).rejects.toThrow(
        "JIRA API error"
      );
    });

    it("maps statusCategory onto the story DTO", async () => {
      const mockResponse = {
        issues: [
          {
            id: "10001",
            key: "TEAM-123",
            fields: {
              summary: "Blocked story",
              description: null,
              status: { name: "Blocked", statusCategory: { key: "indeterminate" } },
            },
          },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        })
      );

      const [story] = await fetchStoriesForProject("TEAM", mockConfig);

      expect(story.jiraStatusCategory).toBe("indeterminate");
    });

    it("narrows an unknown statusCategory key to new", async () => {
      const mockResponse = {
        issues: [
          {
            id: "10001",
            key: "TEAM-123",
            fields: {
              summary: "Weird status",
              description: null,
              status: { name: "Weird", statusCategory: { key: "weird" } },
            },
          },
        ],
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        })
      );

      const [story] = await fetchStoriesForProject("TEAM", mockConfig);

      expect(story.jiraStatusCategory).toBe("new");
    });

    it("passes the sync-status allowlist into the JQL", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await fetchStoriesForProject("TEAM", mockConfig, ["QA", "Blocked"]);

      const url = mockFetch.mock.calls[0][0] as string;
      const decodedUrl = decodeURIComponent(url.replace(/\+/g, " "));
      expect(decodedUrl).toContain('status IN ("QA", "Blocked")');

      mockFetch.mockClear();
      await fetchStoriesForProject("TEAM", mockConfig);

      const defaultUrl = mockFetch.mock.calls[0][0] as string;
      const decodedDefaultUrl = decodeURIComponent(
        defaultUrl.replace(/\+/g, " ")
      );
      expect(decodedDefaultUrl).toContain(
        'status IN ("To Do", "In Progress", "Code Revew", "Code Review")'
      );
    });
  });

  describe("testJiraConnection", () => {
    it("returns ok with the display name on a 200 response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ displayName: "Jane Doe" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await testJiraConnection(mockConfig);

      expect(result).toEqual({ ok: true, displayName: "Jane Doe" });
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.atlassian.net/rest/api/3/myself");
      const authHeader = (options.headers as Record<string, string>)
        .Authorization;
      expect(authHeader).toMatch(/^Basic /);
      const decoded = Buffer.from(
        authHeader.replace("Basic ", ""),
        "base64"
      ).toString("utf-8");
      expect(decoded).toBe("user@example.com:test-token-123");
    });

    it("returns ok without a display name when the response has none", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({}),
        })
      );

      const result = await testJiraConnection(mockConfig);

      expect(result).toEqual({ ok: true, displayName: undefined });
    });

    it("maps a 401 response to a friendly credentials error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        })
      );

      const result = await testJiraConnection(mockConfig);

      expect(result).toEqual({
        ok: false,
        error: "HTTP 401 — check email/API token",
      });
    });

    it("maps a 404 response to a friendly site-url error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
        })
      );

      const result = await testJiraConnection(mockConfig);

      expect(result).toEqual({
        ok: false,
        error: "HTTP 404 — check the site URL",
      });
    });

    it("maps other non-ok statuses to a generic HTTP error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      const result = await testJiraConnection(mockConfig);

      expect(result).toEqual({
        ok: false,
        error: "HTTP 500 — Internal Server Error",
      });
    });

    it("maps a network error to a friendly message", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("fetch failed"))
      );

      const result = await testJiraConnection(mockConfig);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain(
        "fetch failed"
      );
    });
  });

  describe("fetchEpicsForProject", () => {
    it("fetches Epic-type issues and maps them to { key, name }", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          issues: [
            {
              id: "5001",
              key: "TEAM-100",
              fields: { summary: "Big epic", description: null, status: { name: "To Do" } },
            },
            {
              id: "5002",
              key: "TEAM-200",
              fields: { summary: "Other epic", description: null, status: { name: "To Do" } },
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const epics = await fetchEpicsForProject("TEAM", mockConfig);

      expect(epics).toEqual([
        { key: "TEAM-100", name: "Big epic" },
        { key: "TEAM-200", name: "Other epic" },
      ]);
      const url = mockFetch.mock.calls[0][0] as string;
      const decodedUrl = decodeURIComponent(url.replace(/\+/g, " "));
      expect(decodedUrl).toContain('project = "TEAM"');
      expect(decodedUrl).toContain("issuetype = Epic");
    });
  });

  describe("hasEpicLinkField", () => {
    it("returns true when a field named Epic Link exists", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            { id: "customfield_10014", name: "Epic Link" },
            { id: "summary", name: "Summary" },
          ],
        })
      );

      expect(await hasEpicLinkField(mockConfig)).toBe(true);
    });

    it("returns false when no field is named Epic Link", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{ id: "summary", name: "Summary" }],
        })
      );

      expect(await hasEpicLinkField(mockConfig)).toBe(false);
    });

    it("returns false on a non-ok response rather than throwing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Error" })
      );

      expect(await hasEpicLinkField(mockConfig)).toBe(false);
    });

    it("returns false on a network error rather than throwing", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

      expect(await hasEpicLinkField(mockConfig)).toBe(false);
    });

    it("requests /rest/api/3/field with Basic auth", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
      vi.stubGlobal("fetch", mockFetch);

      await hasEpicLinkField(mockConfig);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.atlassian.net/rest/api/3/field");
      expect((options.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    });
  });

  describe("fetchStoriesForEpic", () => {
    it("checks for the Epic Link field, then fetches issues under the epic with no assignee clause", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/rest/api/3/field")) {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: "customfield_10014", name: "Epic Link" }],
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            issues: [
              {
                id: "9001",
                key: "TEAM-101",
                fields: { summary: "Story under epic", description: null, status: { name: "To Do" } },
              },
            ],
          }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const stories = await fetchStoriesForEpic("TEAM-100", mockConfig);

      expect(stories).toHaveLength(1);
      expect(stories[0].jiraKey).toBe("TEAM-101");

      const searchCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes("/rest/api/3/search/jql")
      );
      const decodedUrl = decodeURIComponent(String(searchCall![0]).replace(/\+/g, " "));
      expect(decodedUrl).toContain('parent = "TEAM-100"');
      expect(decodedUrl).toContain('"Epic Link" = "TEAM-100"');
      expect(decodedUrl).not.toContain("assignee");
    });

    it("passes a custom sync-status allowlist through to the JQL", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/rest/api/3/field")) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        return Promise.resolve({ ok: true, json: async () => ({ issues: [] }) });
      });
      vi.stubGlobal("fetch", mockFetch);

      await fetchStoriesForEpic("TEAM-100", mockConfig, ["QA", "Blocked"]);

      const searchCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes("/rest/api/3/search/jql")
      );
      const decodedUrl = decodeURIComponent(String(searchCall![0]).replace(/\+/g, " "));
      expect(decodedUrl).toContain('status IN ("QA", "Blocked")');
      expect(decodedUrl).not.toContain('"Epic Link"');
    });
  });
});
