/**
 * Unit tests for JIRA API client
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchAssignedStories, extractProjectKey } from "./client";
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
});
