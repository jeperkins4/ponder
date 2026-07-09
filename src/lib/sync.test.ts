/**
 * Unit tests for sync orchestration layer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncStoriesFromJira, syncStoriesForProject } from "./sync";
import * as jiraClient from "@/lib/jira/client";
import { applyPrGatedCompletion } from "@/lib/github/prGatedCompletion";
import type { StoryDTO } from "@/lib/types";

// Mock the JIRA client
vi.mock("@/lib/jira/client");

vi.mock("@/lib/github/prGatedCompletion", () => ({
  applyPrGatedCompletion: vi.fn(async () => ({
    cardsCompleted: 0,
    storiesCompleted: 0,
    warnings: [],
  })),
}));

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
      mockFetchAssignedStories as any
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

describe("syncStoriesForProject", () => {
  let mockFetchStoriesForProject: ReturnType<typeof vi.fn>;
  let mockPrisma: {
    project: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    story: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      project: {
        findUnique: vi.fn(),
      },
      story: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    mockFetchStoriesForProject = vi.fn();
    vi.spyOn(jiraClient, "fetchStoriesForProject").mockImplementation(
      mockFetchStoriesForProject as any
    );
  });

  it("throws when the project does not exist", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce(null);

    await expect(
      syncStoriesForProject("nonexistent-id", mockPrisma as unknown as PrismaClient)
    ).rejects.toThrow("Project not found");

    expect(mockFetchStoriesForProject).not.toHaveBeenCalled();
  });

  it("returns a no-op result for a STANDALONE project without calling JIRA", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-1",
      name: "Personal",
      type: "STANDALONE",
      jiraProjectKey: null,
    });

    const result = await syncStoriesForProject(
      "proj-1",
      mockPrisma as unknown as PrismaClient
    );

    expect(result).toEqual({
      created: 0,
      updated: 0,
      message: "Project is not linked to JIRA",
    });
    expect(mockFetchStoriesForProject).not.toHaveBeenCalled();
  });

  it("returns a no-op result for a JIRA-type project missing a jiraProjectKey", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-2",
      name: "Half-configured",
      type: "JIRA",
      jiraProjectKey: null,
    });

    const result = await syncStoriesForProject(
      "proj-2",
      mockPrisma as unknown as PrismaClient
    );

    expect(result).toEqual({
      created: 0,
      updated: 0,
      message: "Project is not linked to JIRA",
    });
    expect(mockFetchStoriesForProject).not.toHaveBeenCalled();
  });

  it("returns a no-op result for a JIRA project with incomplete credentials", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-2b",
      name: "Missing Creds",
      type: "JIRA",
      jiraProjectKey: "TEAM",
      jiraSiteUrl: "https://example.atlassian.net",
      jiraEmail: null,
      jiraApiToken: null,
    });

    const result = await syncStoriesForProject(
      "proj-2b",
      mockPrisma as unknown as PrismaClient
    );

    expect(result).toEqual({
      created: 0,
      updated: 0,
      message: "JIRA credentials not configured. Add them in project settings.",
    });
    expect(mockFetchStoriesForProject).not.toHaveBeenCalled();
  });

  it("creates new stories with projectId set for a JIRA project", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-3",
      name: "Team Project",
      type: "JIRA",
      jiraProjectKey: "TEAM",
      jiraSiteUrl: "https://example.atlassian.net",
      jiraEmail: "team@example.com",
      jiraApiToken: "secret-token",
    });

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
    ];

    mockFetchStoriesForProject.mockResolvedValueOnce(stories);
    mockPrisma.story.findUnique.mockResolvedValueOnce(null);
    mockPrisma.story.create.mockResolvedValueOnce({});

    const result = await syncStoriesForProject(
      "proj-3",
      mockPrisma as unknown as PrismaClient
    );

    expect(mockFetchStoriesForProject).toHaveBeenCalledWith(
      "TEAM",
      {
        siteUrl: "https://example.atlassian.net",
        email: "team@example.com",
        apiToken: "secret-token",
      },
      ["QA"]
    );
    expect(mockPrisma.story.create).toHaveBeenCalledWith({
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
        projectId: "proj-3",
      },
    });
    expect(result).toEqual({ created: 1, updated: 0 });
  });

  it("updates existing stories (matched by jiraKey) with projectId set", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-4",
      name: "Team Project",
      type: "JIRA",
      jiraProjectKey: "TEAM",
      jiraSiteUrl: "https://example.atlassian.net",
      jiraEmail: "team@example.com",
      jiraApiToken: "secret-token",
    });

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
    ];

    mockFetchStoriesForProject.mockResolvedValueOnce(stories);
    mockPrisma.story.findUnique.mockResolvedValueOnce({ id: "existing-1" });
    mockPrisma.story.update.mockResolvedValueOnce({});

    const result = await syncStoriesForProject(
      "proj-4",
      mockPrisma as unknown as PrismaClient
    );

    expect(mockPrisma.story.update).toHaveBeenCalledWith({
      where: { jiraKey: "TEAM-1" },
      data: {
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "Updated story",
        description: "Updated description",
        jiraStatus: "In Progress",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: new Date("2024-01-02T00:00:00.000Z"),
        completionCommentPostedAt: null,
        projectId: "proj-4",
      },
    });
    expect(result).toEqual({ created: 0, updated: 1 });
  });
});

describe("syncStoriesForProject — status exclusions", () => {
  let mockFetchStoriesForProject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchStoriesForProject = vi.fn();
    vi.spyOn(jiraClient, "fetchStoriesForProject").mockImplementation(
      mockFetchStoriesForProject as unknown as typeof jiraClient.fetchStoriesForProject
    );
    mockFetchStoriesForProject.mockResolvedValue([]);
  });

  async function createJiraLinkedProject(jiraExcludedStatuses?: string) {
    return prisma.project.create({
      data: {
        name: `Status Exclusions Sync ${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "team@example.com",
        jiraApiToken: "secret-token",
        ...(jiraExcludedStatuses !== undefined ? { jiraExcludedStatuses } : {}),
      },
    });
  }

  it("passes the parsed exclusion list from the project setting", async () => {
    const project = await createJiraLinkedProject("QA, Blocked");
    try {
      await syncStoriesForProject(project.id, prisma);
      expect(mockFetchStoriesForProject).toHaveBeenCalledWith(
        project.jiraProjectKey,
        expect.anything(),
        ["QA", "Blocked"]
      );
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("passes [] for an explicit empty setting", async () => {
    const project = await createJiraLinkedProject("");
    try {
      await syncStoriesForProject(project.id, prisma);
      expect(mockFetchStoriesForProject).toHaveBeenCalledWith(
        project.jiraProjectKey,
        expect.anything(),
        []
      );
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("passes the QA default when the field is null", async () => {
    const project = await createJiraLinkedProject();
    try {
      await prisma.project.update({
        where: { id: project.id },
        data: { jiraExcludedStatuses: null },
      });
      await syncStoriesForProject(project.id, prisma);
      expect(mockFetchStoriesForProject).toHaveBeenCalledWith(
        project.jiraProjectKey,
        expect.anything(),
        ["QA"]
      );
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});

describe("syncStoriesForProject — PR gate integration", () => {
  let mockFetchStoriesForProject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchStoriesForProject = vi.fn();
    vi.spyOn(jiraClient, "fetchStoriesForProject").mockImplementation(
      mockFetchStoriesForProject as unknown as typeof jiraClient.fetchStoriesForProject
    );
    mockFetchStoriesForProject.mockResolvedValue([]);
  });

  async function createJiraLinkedProject() {
    return prisma.project.create({
      data: {
        name: `PR Gate Sync ${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "team@example.com",
        jiraApiToken: "secret-token",
      },
    });
  }

  it("appends the completed-by-PRs count to the result message", async () => {
    vi.mocked(applyPrGatedCompletion).mockResolvedValueOnce({
      cardsCompleted: 3,
      storiesCompleted: 2,
      warnings: [],
    });

    const project = await createJiraLinkedProject();
    try {
      const result = await syncStoriesForProject(project.id, prisma);
      expect(result.message).toContain("3 card(s) completed by PRs");
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("appends GitHub warnings to the result message", async () => {
    vi.mocked(applyPrGatedCompletion).mockResolvedValueOnce({
      cardsCompleted: 0,
      storiesCompleted: 0,
      warnings: ["bad/repo: 404 Not Found"],
    });

    const project = await createJiraLinkedProject();
    try {
      const result = await syncStoriesForProject(project.id, prisma);
      expect(result.message).toContain("GitHub: bad/repo: 404 Not Found");
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("returns no message when the gate is silent", async () => {
    const project = await createJiraLinkedProject();
    try {
      const result = await syncStoriesForProject(project.id, prisma);
      expect(result.message).toBeUndefined();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("reports a warning instead of failing when the gate throws", async () => {
    vi.mocked(applyPrGatedCompletion).mockRejectedValueOnce(new Error("boom"));

    const project = await createJiraLinkedProject();
    try {
      const result = await syncStoriesForProject(project.id, prisma);
      expect(result.created).toBeGreaterThanOrEqual(0); // sync itself succeeded
      expect(result.message).toContain("GitHub: PR check failed (boom)");
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
