/**
 * Unit tests for sync orchestration layer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncStoriesForProject } from "./sync";
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

describe("syncStoriesForProject", () => {
  let mockFetchStoriesForProject: ReturnType<typeof vi.fn>;
  let mockPrisma: {
    project: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    story: {
      findMany: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      project: {
        findUnique: vi.fn(),
      },
      story: {
        findMany: vi.fn(),
        upsert: vi.fn(),
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
    mockPrisma.story.findMany.mockResolvedValueOnce([]);
    mockPrisma.story.upsert.mockResolvedValueOnce({});

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
      ["To Do", "In Progress", "Code Revew", "Code Review"]
    );
    expect(mockPrisma.story.findMany).toHaveBeenCalledWith({
      where: { jiraKey: { in: ["TEAM-1"] } },
      select: { jiraKey: true, jiraStatus: true },
    });
    expect(mockPrisma.story.upsert).toHaveBeenCalledWith({
      where: { jiraKey: "TEAM-1" },
      create: {
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
      update: {
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
    mockPrisma.story.findMany.mockResolvedValueOnce([
      { jiraKey: "TEAM-1", jiraStatus: "To Do" },
    ]);
    mockPrisma.story.upsert.mockResolvedValueOnce({});

    const result = await syncStoriesForProject(
      "proj-4",
      mockPrisma as unknown as PrismaClient
    );

    expect(mockPrisma.story.upsert).toHaveBeenCalledWith({
      where: { jiraKey: "TEAM-1" },
      create: {
        jiraKey: "TEAM-1",
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
      update: {
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

  it("increments Story.reopenCount and stamps lastReopenedAt when jiraStatus regresses", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-5",
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
        summary: "Reopened story",
        description: null,
        jiraStatus: "In Progress",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: "2024-01-03T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
    ];

    mockFetchStoriesForProject.mockResolvedValueOnce(stories);
    mockPrisma.story.findMany.mockResolvedValueOnce([
      { jiraKey: "TEAM-1", jiraStatus: "QA" },
    ]);
    mockPrisma.story.upsert.mockResolvedValueOnce({});

    await syncStoriesForProject("proj-5", mockPrisma as unknown as PrismaClient);

    const call = mockPrisma.story.upsert.mock.calls[0][0];
    expect(call.update.reopenCount).toEqual({ increment: 1 });
    expect(call.update.lastReopenedAt).toBeInstanceOf(Date);
  });

  it("does not increment Story.reopenCount when jiraStatus advances", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-6",
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
        summary: "Advancing story",
        description: null,
        jiraStatus: "QA",
        url: "https://example.com/browse/TEAM-1",
        lastSyncedAt: "2024-01-03T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
    ];

    mockFetchStoriesForProject.mockResolvedValueOnce(stories);
    mockPrisma.story.findMany.mockResolvedValueOnce([
      { jiraKey: "TEAM-1", jiraStatus: "In Progress" },
    ]);
    mockPrisma.story.upsert.mockResolvedValueOnce({});

    await syncStoriesForProject("proj-6", mockPrisma as unknown as PrismaClient);

    const call = mockPrisma.story.upsert.mock.calls[0][0];
    expect(call.update.reopenCount).toBeUndefined();
    expect(call.update.lastReopenedAt).toBeUndefined();
  });

  it("does not increment reopenCount for a newly created story", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce({
      id: "proj-7",
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
        jiraKey: "TEAM-9",
        jiraId: "10009",
        projectKey: "TEAM",
        summary: "Brand new story",
        description: null,
        jiraStatus: "To Do",
        url: "https://example.com/browse/TEAM-9",
        lastSyncedAt: "2024-01-03T00:00:00.000Z",
        completionCommentPostedAt: null,
        workUnits: [],
      },
    ];

    mockFetchStoriesForProject.mockResolvedValueOnce(stories);
    mockPrisma.story.findMany.mockResolvedValueOnce([]);
    mockPrisma.story.upsert.mockResolvedValueOnce({});

    await syncStoriesForProject("proj-7", mockPrisma as unknown as PrismaClient);

    const call = mockPrisma.story.upsert.mock.calls[0][0];
    expect(call.update.reopenCount).toBeUndefined();
    expect(call.create.reopenCount).toBeUndefined();
  });
});

describe("syncStoriesForProject — status allowlist", () => {
  let mockFetchStoriesForProject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchStoriesForProject = vi.fn();
    vi.spyOn(jiraClient, "fetchStoriesForProject").mockImplementation(
      mockFetchStoriesForProject as unknown as typeof jiraClient.fetchStoriesForProject
    );
    mockFetchStoriesForProject.mockResolvedValue([]);
  });

  async function createJiraLinkedProject(jiraSyncStatuses?: string) {
    return prisma.project.create({
      data: {
        name: `Status Allowlist Sync ${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "team@example.com",
        jiraApiToken: "secret-token",
        ...(jiraSyncStatuses !== undefined ? { jiraSyncStatuses } : {}),
      },
    });
  }

  it("passes the parsed allowlist from the project setting", async () => {
    const project = await createJiraLinkedProject("To Do, QA");
    try {
      await syncStoriesForProject(project.id, prisma);
      expect(mockFetchStoriesForProject).toHaveBeenCalledWith(
        project.jiraProjectKey,
        expect.anything(),
        ["To Do", "QA"]
      );
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("passes the default four statuses for an explicit empty setting", async () => {
    const project = await createJiraLinkedProject("");
    try {
      await syncStoriesForProject(project.id, prisma);
      expect(mockFetchStoriesForProject).toHaveBeenCalledWith(
        project.jiraProjectKey,
        expect.anything(),
        ["To Do", "In Progress", "Code Revew", "Code Review"]
      );
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("passes the default four statuses when the field is null", async () => {
    const project = await createJiraLinkedProject();
    try {
      await prisma.project.update({
        where: { id: project.id },
        data: { jiraSyncStatuses: null },
      });
      await syncStoriesForProject(project.id, prisma);
      expect(mockFetchStoriesForProject).toHaveBeenCalledWith(
        project.jiraProjectKey,
        expect.anything(),
        ["To Do", "In Progress", "Code Revew", "Code Review"]
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
