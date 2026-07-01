/**
 * Integration tests for POST /api/projects/[projectId]/sync
 * Tests actual Prisma client against test database; JIRA access is mocked at
 * the same module boundary used by src/lib/sync.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";
import * as jiraClient from "@/lib/jira/client";
import type { StoryDTO } from "@/lib/types";

vi.mock("@/lib/jira/client");

describe("POST /api/projects/[projectId]/sync", () => {
  it("returns 500 with an error message when the project does not exist", async () => {
    const req = new Request(
      "http://localhost:3000/api/projects/nonexistent/sync",
      { method: "POST" }
    );
    const res = await POST(req as never, {
      params: Promise.resolve({ projectId: "nonexistent" }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Project not found");
  });

  it("returns the not-linked message for a STANDALONE project without calling JIRA", async () => {
    const project = await prisma.project.create({
      data: { name: "Standalone Sync Test", type: "STANDALONE" },
    });

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/sync`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        created: 0,
        updated: 0,
        message: "Project is not linked to JIRA",
      });
      expect(jiraClient.fetchStoriesForProject).not.toHaveBeenCalled();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("creates stories for a JIRA project and links them via projectId", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Sync Route Team",
        type: "JIRA",
        jiraProjectKey: "SYNCRT",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "sync-route@example.com",
        jiraApiToken: "sync-route-token",
      },
    });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const jiraKey = `SYNCRT-${suffix}`;

    const mockStory: StoryDTO = {
      id: "mock-id",
      jiraKey,
      jiraId: jiraKey,
      projectKey: "SYNCRT",
      summary: "Synced via route",
      description: null,
      jiraStatus: "To Do",
      url: `https://example.atlassian.net/browse/${jiraKey}`,
      lastSyncedAt: new Date().toISOString(),
      completionCommentPostedAt: null,
      workUnits: [],
    };

    vi.mocked(jiraClient.fetchStoriesForProject).mockResolvedValueOnce([mockStory]);

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/sync`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ created: 1, updated: 0 });
      expect(jiraClient.fetchStoriesForProject).toHaveBeenCalledWith(
        "SYNCRT",
        expect.any(Object)
      );

      const stored = await prisma.story.findUnique({ where: { jiraKey } });
      expect(stored).not.toBeNull();
      expect(stored?.projectId).toBe(project.id);
    } finally {
      await prisma.story.deleteMany({ where: { jiraKey } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
