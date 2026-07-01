/**
 * Unit tests for sync orchestration layer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { syncStoriesFromJira } from "./sync";
import * as jiraClient from "@/lib/jira/client";
import type { StoryDTO } from "@/lib/types";

// Mock the JIRA client
vi.mock("@/lib/jira/client");

describe("syncStoriesFromJira", () => {
  let mockFetchAssignedStories: ReturnType<typeof vi.fn>;
  let mockPrisma: {
    story: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup mock Prisma client
    mockPrisma = {
      story: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    // Setup mock fetchAssignedStories
    mockFetchAssignedStories = vi.fn();
    vi.spyOn(jiraClient, "fetchAssignedStories").mockImplementation(
      mockFetchAssignedStories
    );
  });

  it("should create new stories", async () => {
    // Arrange
    const stories: StoryDTO[] = [
      {
        id: "story-1",
        jiraKey: "TEAM-1",
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "First story",
        description: "First description",
        jiraStatus: "To Do",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: "2024-01-01T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
      {
        id: "story-2",
        jiraKey: "TEAM-2",
        jiraId: "10001",
        projectKey: "TEAM",
        summary: "Second story",
        description: "Second description",
        jiraStatus: "In Progress",
        url: "https://example.com/browse/TEAM-2",
        lastSyncedAt: "2024-01-01T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
    ];

    mockFetchAssignedStories.mockResolvedValueOnce(stories);
    mockPrisma.story.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockPrisma.story.create.mockResolvedValueOnce({});

    // Act
    const result = await syncStoriesFromJira(
      ["TEAM"],
      { siteUrl: "https://example.com", email: "test@example.com", apiToken: "token" },
      mockPrisma as unknown as PrismaClient
    );

    // Assert
    expect(mockPrisma.story.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.story.update).toHaveBeenCalledTimes(0);
    expect(result).toEqual({ created: 2, updated: 0 });

    // Verify correct data passed to first create call
    expect(mockPrisma.story.create).toHaveBeenNthCalledWith(1, {
      data: {
        jiraKey: "TEAM-1",
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "First story",
        description: "First description",
        jiraStatus: "To Do",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: new Date("2024-01-01T00:00:00.000Z"),
        completionCommentPostedAt: null,
      },
    });
  });

  it("should update existing stories", async () => {
    // Arrange
    const stories: StoryDTO[] = [
      {
        id: "story-1",
        jiraKey: "TEAM-1",
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "Updated story",
        description: "Updated description",
        jiraStatus: "In Progress",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: "2024-01-02T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
      {
        id: "story-2",
        jiraKey: "TEAM-2",
        jiraId: "10001",
        projectKey: "TEAM",
        summary: "Another updated story",
        description: null,
        jiraStatus: "Done",
        url: "https://example.com/browse/TEAM-2",
        lastSyncedAt: "2024-01-02T00:00:00.000Z",
        completionCommentPostedAt: "2024-01-02T10:00:00.000Z",
        workUnits: [],
      },
    ];

    mockFetchAssignedStories.mockResolvedValueOnce(stories);
    mockPrisma.story.findUnique
      .mockResolvedValueOnce({ id: "existing-1" })
      .mockResolvedValueOnce({ id: "existing-2" });
    mockPrisma.story.update.mockResolvedValueOnce({});

    // Act
    const result = await syncStoriesFromJira(
      ["TEAM"],
      { siteUrl: "https://example.com", email: "test@example.com", apiToken: "token" },
      mockPrisma as unknown as PrismaClient
    );

    // Assert
    expect(mockPrisma.story.create).toHaveBeenCalledTimes(0);
    expect(mockPrisma.story.update).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ created: 0, updated: 2 });

    // Verify correct data passed to first update call
    expect(mockPrisma.story.update).toHaveBeenNthCalledWith(1, {
      where: { jiraId: "10000" },
      data: {
        jiraKey: "TEAM-1",
        projectKey: "TEAM",
        summary: "Updated story",
        description: "Updated description",
        jiraStatus: "In Progress",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: new Date("2024-01-02T00:00:00.000Z"),
        completionCommentPostedAt: null,
      },
    });

    // Verify second update call with completionCommentPostedAt set
    expect(mockPrisma.story.update).toHaveBeenNthCalledWith(2, {
      where: { jiraId: "10001" },
      data: {
        jiraKey: "TEAM-2",
        projectKey: "TEAM",
        summary: "Another updated story",
        description: null,
        jiraStatus: "Done",
        url: "https://example.com/browse/TEAM-2",
        lastSyncedAt: new Date("2024-01-02T00:00:00.000Z"),
        completionCommentPostedAt: new Date("2024-01-02T10:00:00.000Z"),
      },
    });
  });

  it("should handle mix of new and existing stories", async () => {
    // Arrange
    const stories: StoryDTO[] = [
      {
        id: "story-1",
        jiraKey: "TEAM-1",
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "New story",
        description: "New description",
        jiraStatus: "To Do",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: "2024-01-01T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
      {
        id: "story-2",
        jiraKey: "TEAM-2",
        jiraId: "10001",
        projectKey: "TEAM",
        summary: "Existing updated story",
        description: "Updated",
        jiraStatus: "In Progress",
        url: "https://example.com/browse/TEAM-2",
        lastSyncedAt: "2024-01-02T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
    ];

    mockFetchAssignedStories.mockResolvedValueOnce(stories);
    mockPrisma.story.findUnique
      .mockResolvedValueOnce(null) // First story doesn't exist
      .mockResolvedValueOnce({ id: "existing-2" }); // Second story exists
    mockPrisma.story.create.mockResolvedValueOnce({});
    mockPrisma.story.update.mockResolvedValueOnce({});

    // Act
    const result = await syncStoriesFromJira(
      ["TEAM"],
      { siteUrl: "https://example.com", email: "test@example.com", apiToken: "token" },
      mockPrisma as unknown as PrismaClient
    );

    // Assert
    expect(mockPrisma.story.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.story.update).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: 1, updated: 1 });

    // Verify create was called for new story
    expect(mockPrisma.story.create).toHaveBeenCalledWith({
      data: {
        jiraKey: "TEAM-1",
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "New story",
        description: "New description",
        jiraStatus: "To Do",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: new Date("2024-01-01T00:00:00.000Z"),
        completionCommentPostedAt: null,
      },
    });

    // Verify update was called for existing story
    expect(mockPrisma.story.update).toHaveBeenCalledWith({
      where: { jiraId: "10001" },
      data: {
        jiraKey: "TEAM-2",
        projectKey: "TEAM",
        summary: "Existing updated story",
        description: "Updated",
        jiraStatus: "In Progress",
        url: "https://example.com/browse/TEAM-2",
        lastSyncedAt: new Date("2024-01-02T00:00:00.000Z"),
        completionCommentPostedAt: null,
      },
    });
  });

  it("should return correct counts", async () => {
    // Arrange
    const stories: StoryDTO[] = [
      {
        id: "story-1",
        jiraKey: "TEAM-1",
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "Story 1",
        description: null,
        jiraStatus: "To Do",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: "2024-01-01T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
      {
        id: "story-2",
        jiraKey: "TEAM-2",
        jiraId: "10001",
        projectKey: "TEAM",
        summary: "Story 2",
        description: null,
        jiraStatus: "To Do",
        url: "https://example.com/browse/TEAM-2",
        lastSyncedAt: "2024-01-01T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
      {
        id: "story-3",
        jiraKey: "TEAM-3",
        jiraId: "10002",
        projectKey: "TEAM",
        summary: "Story 3",
        description: null,
        jiraStatus: "In Progress",
        url: "https://example.com/browse/TEAM-3",
        lastSyncedAt: "2024-01-01T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
    ];

    mockFetchAssignedStories.mockResolvedValueOnce(stories);
    mockPrisma.story.findUnique
      .mockResolvedValueOnce(null) // Story 1 is new
      .mockResolvedValueOnce(null) // Story 2 is new
      .mockResolvedValueOnce({ id: "existing-3" }); // Story 3 exists
    mockPrisma.story.create.mockResolvedValue({});
    mockPrisma.story.update.mockResolvedValue({});

    // Act
    const result = await syncStoriesFromJira(
      ["TEAM"],
      { siteUrl: "https://example.com", email: "test@example.com", apiToken: "token" },
      mockPrisma as unknown as PrismaClient
    );

    // Assert
    expect(result.created).toBe(2);
    expect(result.updated).toBe(1);
    expect(result).toEqual({ created: 2, updated: 1 });
  });
});
