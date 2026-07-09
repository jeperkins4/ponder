/**
 * Unit tests for JIRA API client
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchAssignedStories,
  fetchStoriesForProject,
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
      expect(url).toContain("fields=summary%2Cdescription%2Cstatus");
      expect(url).toContain("maxResults=");
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

  describe("fetchAssignedStories", () => {
    it("fetches and converts assigned stories", async () => {
      const mockResponse = {
        issues: [
          {
            id: "10001",
            key: "TEAM-123",
            fields: {
              summary: "First Story",
              description: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "This is a description",
                      },
                    ],
                  },
                ],
              },
              status: {
                name: "In Progress",
              },
            },
          },
          {
            id: "10002",
            key: "TEAM-124",
            fields: {
              summary: "Second Story",
              description: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Another description",
                      },
                    ],
                  },
                ],
              },
              status: {
                name: "To Do",
              },
            },
          },
        ],
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }));

      const stories = await fetchAssignedStories(["TEAM"], mockConfig);

      expect(stories).toHaveLength(2);
      expect(stories[0].jiraKey).toBe("TEAM-123");
      expect(stories[0].summary).toBe("First Story");
      expect(stories[0].jiraStatus).toBe("In Progress");
      expect(stories[0].description).toBe("This is a description");
      expect(stories[1].jiraKey).toBe("TEAM-124");
      expect(stories[1].summary).toBe("Second Story");
    });

    it("handles missing description", async () => {
      const mockResponse = {
        issues: [
          {
            id: "10001",
            key: "TEAM-123",
            fields: {
              summary: "Story without description",
              description: null,
              status: {
                name: "To Do",
              },
            },
          },
        ],
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }));

      const stories = await fetchAssignedStories(["TEAM"], mockConfig);

      expect(stories).toHaveLength(1);
      expect(stories[0].description).toBe("");
    });

    it("extracts project key from jira key", async () => {
      const mockResponse = {
        issues: [
          {
            id: "10001",
            key: "PROJECTKEY-123",
            fields: {
              summary: "Test Story",
              description: null,
              status: {
                name: "To Do",
              },
            },
          },
        ],
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }));

      const stories = await fetchAssignedStories(["PROJECTKEY"], mockConfig);

      expect(stories[0].projectKey).toBe("PROJECTKEY");
    });

    it("builds correct authorization header", async () => {
      const mockResponse = {
        issues: [],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      vi.stubGlobal("fetch", mockFetch);

      await fetchAssignedStories(["TEAM"], mockConfig);

      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      const options = call[1] as Record<string, unknown>;

      // Verify Authorization header is present and correctly formatted
      const authHeader = options.headers as Record<string, string>;
      expect(authHeader.Authorization).toBeDefined();
      expect(authHeader.Authorization).toMatch(/^Basic /);

      // Decode and verify it's email:apiToken
      const encodedCreds = authHeader.Authorization.replace("Basic ", "");
      const decodedCreds = Buffer.from(encodedCreds, "base64").toString("utf-8");
      expect(decodedCreds).toBe("user@example.com:test-token-123");
    });

    it("makes fetch call with correct URL and JQL", async () => {
      const mockResponse = {
        issues: [],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      vi.stubGlobal("fetch", mockFetch);

      await fetchAssignedStories(["TEAM", "OPS"], mockConfig);

      expect(mockFetch).toHaveBeenCalled();
      const url = mockFetch.mock.calls[0][0] as string;

      // Verify URL structure
      expect(url).toContain("https://example.atlassian.net/rest/api/3/search");
      expect(url).toContain("jql=");
      // Check for project IN (with either space encoding or +)
      expect(url).toMatch(/project[+%20]IN/);
    });

    it("includes all required fields in story DTO", async () => {
      const mockResponse = {
        issues: [
          {
            id: "10001",
            key: "TEAM-123",
            fields: {
              summary: "Complete Story",
              description: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Full description",
                      },
                    ],
                  },
                ],
              },
              status: {
                name: "In Progress",
              },
            },
          },
        ],
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }));

      const stories = await fetchAssignedStories(["TEAM"], mockConfig);
      const story = stories[0];

      // Verify all required fields are present
      expect(story.id).toBeDefined();
      expect(story.jiraKey).toBe("TEAM-123");
      expect(story.jiraId).toBe("10001");
      expect(story.projectKey).toBe("TEAM");
      expect(story.summary).toBe("Complete Story");
      expect(story.description).toBe("Full description");
      expect(story.jiraStatus).toBe("In Progress");
      expect(story.url).toBe("https://example.atlassian.net/browse/TEAM-123");
      expect(story.lastSyncedAt).toBeDefined();
      expect(story.completionCommentPostedAt).toBeNull();
      expect(story.workUnits).toEqual([]);
    });

    it("throws error on API failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      }));

      await expect(fetchAssignedStories(["TEAM"], mockConfig)).rejects.toThrow(
        "JIRA API error"
      );
    });

    it("converts multiple stories with different statuses", async () => {
      const mockResponse = {
        issues: [
          {
            id: "10001",
            key: "TEAM-123",
            fields: {
              summary: "Story 1",
              description: null,
              status: {
                name: "To Do",
              },
            },
          },
          {
            id: "10002",
            key: "TEAM-124",
            fields: {
              summary: "Story 2",
              description: null,
              status: {
                name: "In Progress",
              },
            },
          },
          {
            id: "10003",
            key: "OPS-100",
            fields: {
              summary: "Story 3",
              description: null,
              status: {
                name: "In Review",
              },
            },
          },
        ],
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }));

      const stories = await fetchAssignedStories(["TEAM", "OPS"], mockConfig);

      expect(stories).toHaveLength(3);
      expect(stories[0].jiraStatus).toBe("To Do");
      expect(stories[1].jiraStatus).toBe("In Progress");
      expect(stories[2].jiraStatus).toBe("In Review");
      expect(stories[0].projectKey).toBe("TEAM");
      expect(stories[1].projectKey).toBe("TEAM");
      expect(stories[2].projectKey).toBe("OPS");
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
});
