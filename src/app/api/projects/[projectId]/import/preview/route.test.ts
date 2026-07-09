/**
 * Integration tests for POST /api/projects/[projectId]/import/preview
 * Tests actual Prisma client against test database; JIRA access is mocked at
 * the same module boundary used by src/lib/sync.test.ts and the sibling
 * sync route's tests. This endpoint is read-only: it must never write to
 * the database.
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";
import * as jiraClient from "@/lib/jira/client";
import type { StoryDTO } from "@/lib/types";

vi.mock("@/lib/jira/client");

function makeStory(overrides: Partial<StoryDTO>): StoryDTO {
  return {
    id: "mock-id",
    jiraKey: "PREV-1",
    jiraId: "PREV-1",
    projectKey: "PREV",
    summary: "A story",
    description: null,
    jiraStatus: "To Do",
    url: "https://example.atlassian.net/browse/PREV-1",
    lastSyncedAt: new Date().toISOString(),
    completionCommentPostedAt: null,
    workUnits: [],
    ...overrides,
  };
}

describe("POST /api/projects/[projectId]/import/preview", () => {
  it("returns 404 when the project does not exist", async () => {
    const req = new Request(
      "http://localhost:3000/api/projects/nonexistent/import/preview",
      { method: "POST" }
    );
    const res = await POST(req as never, {
      params: Promise.resolve({ projectId: "nonexistent" }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("not found");
    expect(jiraClient.fetchStoriesForProject).not.toHaveBeenCalled();
  });

  it("returns an empty list with a message for a STANDALONE project, without calling JIRA", async () => {
    const project = await prisma.project.create({
      data: { name: "Standalone Preview Test", type: "STANDALONE" },
    });

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/preview`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        stories: [],
        message: "Project is not linked to JIRA",
      });
      expect(jiraClient.fetchStoriesForProject).not.toHaveBeenCalled();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("returns an empty list with a message for a JIRA project missing credentials", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Incomplete Creds Preview Test",
        type: "JIRA",
        jiraProjectKey: "PREV",
        jiraSiteUrl: "https://example.atlassian.net",
        // jiraEmail / jiraApiToken intentionally omitted
      },
    });

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/preview`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        stories: [],
        message: "JIRA credentials not configured. Add them in project settings.",
      });
      expect(jiraClient.fetchStoriesForProject).not.toHaveBeenCalled();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("computes target columns for a JIRA project's stories and persists nothing", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Preview Route Team",
        type: "JIRA",
        jiraProjectKey: "PREVRT",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "preview-route@example.com",
        jiraApiToken: "preview-route-token",
      },
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const mockStories: StoryDTO[] = [
      makeStory({
        jiraKey: `PREVRT-${suffix}-1`,
        jiraId: `PREVRT-${suffix}-1`,
        summary: "Todo story",
        jiraStatus: "To Do",
      }),
      makeStory({
        jiraKey: `PREVRT-${suffix}-2`,
        jiraId: `PREVRT-${suffix}-2`,
        summary: "In progress story",
        jiraStatus: "In Progress",
      }),
      makeStory({
        jiraKey: `PREVRT-${suffix}-3`,
        jiraId: `PREVRT-${suffix}-3`,
        summary: "Code review story (misspelled JIRA status)",
        jiraStatus: "Code Revew",
        description: "Has a description",
      }),
    ];

    vi.mocked(jiraClient.fetchStoriesForProject).mockResolvedValueOnce(mockStories);

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/preview`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(jiraClient.fetchStoriesForProject).toHaveBeenCalledWith(
        "PREVRT",
        expect.any(Object)
      );

      expect(data.stories).toEqual([
        {
          jiraKey: `PREVRT-${suffix}-1`,
          jiraId: `PREVRT-${suffix}-1`,
          summary: "Todo story",
          description: null,
          jiraStatus: "To Do",
          targetColumn: "todo",
          alreadyImported: false,
        },
        {
          jiraKey: `PREVRT-${suffix}-2`,
          jiraId: `PREVRT-${suffix}-2`,
          summary: "In progress story",
          description: null,
          jiraStatus: "In Progress",
          targetColumn: "in_progress",
          alreadyImported: false,
        },
        {
          jiraKey: `PREVRT-${suffix}-3`,
          jiraId: `PREVRT-${suffix}-3`,
          summary: "Code review story (misspelled JIRA status)",
          description: "Has a description",
          jiraStatus: "Code Revew",
          targetColumn: "code_review",
          alreadyImported: false,
        },
      ]);

      // Read-only: nothing should have been persisted to the DB.
      const persisted = await prisma.story.findMany({
        where: { jiraKey: { in: mockStories.map((s) => s.jiraKey) } },
      });
      expect(persisted).toHaveLength(0);
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("passes jiraStatusCategory through and uses it to compute the target column", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Preview Category Team",
        type: "JIRA",
        jiraProjectKey: "PREVCAT",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "preview-category@example.com",
        jiraApiToken: "preview-category-token",
      },
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const mockStories: StoryDTO[] = [
      makeStory({
        jiraKey: `PREVCAT-${suffix}-1`,
        jiraId: `PREVCAT-${suffix}-1`,
        summary: "Blocked story",
        jiraStatus: "Blocked",
        jiraStatusCategory: "indeterminate",
      }),
    ];

    vi.mocked(jiraClient.fetchStoriesForProject).mockResolvedValueOnce(mockStories);

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/preview`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.stories).toEqual([
        {
          jiraKey: `PREVCAT-${suffix}-1`,
          jiraId: `PREVCAT-${suffix}-1`,
          summary: "Blocked story",
          description: null,
          jiraStatus: "Blocked",
          jiraStatusCategory: "indeterminate",
          targetColumn: "in_progress",
          alreadyImported: false,
        },
      ]);
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("surfaces an unexpected JIRA fetch failure as a 500", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Preview Failure Team",
        type: "JIRA",
        jiraProjectKey: "PREVFAIL",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "preview-fail@example.com",
        jiraApiToken: "preview-fail-token",
      },
    });

    vi.mocked(jiraClient.fetchStoriesForProject).mockRejectedValueOnce(
      new Error("JIRA API error: 410 Gone")
    );

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/preview`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("410");
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("flags stories that already have active cards as alreadyImported", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const activeKey = `PREV-${suffix}-ACTIVE`;
    const archivedKey = `PREV-${suffix}-ARCHIVED`;
    const freshKey = `PREV-${suffix}-FRESH`;

    const project = await prisma.project.create({
      data: {
        name: `Dedup Preview Test ${suffix}`,
        type: "JIRA",
        jiraProjectKey: "PREV",
        jiraSiteUrl: "https://example.atlassian.net/",
        jiraEmail: "preview@example.com",
        jiraApiToken: "preview-token",
      },
    });

    const activeStory = await prisma.story.create({
      data: {
        jiraKey: activeKey,
        jiraId: `id-${activeKey}`,
        projectKey: "PREV",
        summary: "Has active card",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${activeKey}`,
        lastSyncedAt: new Date(),
      },
    });
    await prisma.workUnit.create({
      data: { storyId: activeStory.id, title: "Card", column: "todo", order: 0 },
    });

    const archivedStory = await prisma.story.create({
      data: {
        jiraKey: archivedKey,
        jiraId: `id-${archivedKey}`,
        projectKey: "PREV",
        summary: "Only archived cards",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${archivedKey}`,
        lastSyncedAt: new Date(),
      },
    });
    await prisma.workUnit.create({
      data: {
        storyId: archivedStory.id,
        title: "Archived card",
        column: "done",
        order: 0,
        archivedAt: new Date(),
      },
    });

    vi.mocked(jiraClient.fetchStoriesForProject).mockResolvedValueOnce([
      makeStory({ jiraKey: activeKey, jiraId: `id-${activeKey}` }),
      makeStory({ jiraKey: archivedKey, jiraId: `id-${archivedKey}` }),
      makeStory({ jiraKey: freshKey, jiraId: `id-${freshKey}` }),
    ]);

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/preview`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const byKey = Object.fromEntries(
        data.stories.map((s: { jiraKey: string; alreadyImported: boolean }) => [
          s.jiraKey,
          s.alreadyImported,
        ])
      );
      expect(byKey[activeKey]).toBe(true);
      expect(byKey[archivedKey]).toBe(false);
      expect(byKey[freshKey]).toBe(false);
    } finally {
      await prisma.workUnit.deleteMany({
        where: { storyId: { in: [activeStory.id, archivedStory.id] } },
      });
      await prisma.story.deleteMany({
        where: { id: { in: [activeStory.id, archivedStory.id] } },
      });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
