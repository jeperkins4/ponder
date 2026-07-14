/**
 * Integration tests for GET /api/projects/[projectId]/jira/epics
 * Tests actual Prisma client against the test database; JIRA access is
 * mocked at the same module boundary used by the sibling import routes.
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";
import * as jiraClient from "@/lib/jira/client";

vi.mock("@/lib/jira/client");

describe("GET /api/projects/[projectId]/jira/epics", () => {
  it("returns 404 when the project does not exist", async () => {
    const req = new Request(
      "http://localhost:3000/api/projects/nonexistent/jira/epics"
    );
    const res = await GET(req as never, {
      params: Promise.resolve({ projectId: "nonexistent" }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("not found");
    expect(jiraClient.fetchEpicsForProject).not.toHaveBeenCalled();
  });

  it("returns an empty list with a message for a STANDALONE project, without calling JIRA", async () => {
    const project = await prisma.project.create({
      data: { name: "Standalone Epics Test", type: "STANDALONE" },
    });

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/jira/epics`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        epics: [],
        message: "Project is not linked to JIRA",
      });
      expect(jiraClient.fetchEpicsForProject).not.toHaveBeenCalled();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("returns an empty list with a message for a JIRA project missing credentials", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Incomplete Creds Epics Test",
        type: "JIRA",
        jiraProjectKey: "EPIC",
        jiraSiteUrl: "https://example.atlassian.net",
      },
    });

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/jira/epics`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        epics: [],
        message: "JIRA credentials not configured. Add them in project settings.",
      });
      expect(jiraClient.fetchEpicsForProject).not.toHaveBeenCalled();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("returns the epics fetched for the project's JIRA key", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Epics Route Team",
        type: "JIRA",
        jiraProjectKey: "EPICRT",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "epics-route@example.com",
        jiraApiToken: "epics-route-token",
      },
    });

    vi.mocked(jiraClient.fetchEpicsForProject).mockResolvedValueOnce([
      { key: "EPICRT-1", name: "First epic" },
      { key: "EPICRT-2", name: "Second epic" },
    ]);

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/jira/epics`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        epics: [
          { key: "EPICRT-1", name: "First epic" },
          { key: "EPICRT-2", name: "Second epic" },
        ],
      });
      expect(jiraClient.fetchEpicsForProject).toHaveBeenCalledWith(
        "EPICRT",
        expect.any(Object)
      );
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("surfaces an unexpected JIRA fetch failure as a 500", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Epics Route Failure",
        type: "JIRA",
        jiraProjectKey: "EPICFAIL",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "epics-fail@example.com",
        jiraApiToken: "epics-fail-token",
      },
    });

    vi.mocked(jiraClient.fetchEpicsForProject).mockRejectedValueOnce(
      new Error("JIRA API error: 401 Unauthorized")
    );

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/jira/epics`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("401");
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
