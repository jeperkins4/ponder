/**
 * Integration tests for POST /api/projects/[projectId]/test-connection
 * Tests actual Prisma client against test database; JIRA access is mocked at
 * the same module boundary used by other route tests
 * (src/app/api/projects/[projectId]/sync/route.test.ts).
 */

import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";
import * as jiraClient from "@/lib/jira/client";

vi.mock("@/lib/jira/client");

function makeRequest(projectId: string, body: unknown) {
  return new Request(
    `http://localhost:3000/api/projects/${projectId}/test-connection`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/projects/[projectId]/test-connection", () => {
  it("returns 404 when the project does not exist", async () => {
    const req = makeRequest("nonexistent", {});
    const res = await POST(req as never, {
      params: Promise.resolve({ projectId: "nonexistent" }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Project not found");
    expect(jiraClient.testJiraConnection).not.toHaveBeenCalled();
  });

  it("returns ok:false without calling JIRA when credentials are incomplete", async () => {
    const project = await prisma.project.create({
      data: { name: "Incomplete Creds Test", type: "JIRA", jiraProjectKey: "INC" },
    });

    try {
      const req = makeRequest(project.id, {
        jiraSiteUrl: "",
        jiraEmail: "",
        jiraApiToken: "",
      });
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        ok: false,
        error: "JIRA credentials are incomplete.",
      });
      expect(jiraClient.testJiraConnection).not.toHaveBeenCalled();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("calls testJiraConnection with body-supplied credentials and returns ok:true", async () => {
    const project = await prisma.project.create({
      data: { name: "Full Creds Test", type: "JIRA", jiraProjectKey: "FULL" },
    });

    vi.mocked(jiraClient.testJiraConnection).mockResolvedValueOnce({
      ok: true,
      displayName: "Jane Doe",
    });

    try {
      const req = makeRequest(project.id, {
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "user@example.com",
        jiraApiToken: "fresh-token",
      });
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true, displayName: "Jane Doe" });
      expect(jiraClient.testJiraConnection).toHaveBeenCalledWith({
        siteUrl: "https://example.atlassian.net",
        email: "user@example.com",
        apiToken: "fresh-token",
      });
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("falls back to the stored API token when the body's token is blank", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Stored Token Fallback Test",
        type: "JIRA",
        jiraProjectKey: "STORED",
        jiraSiteUrl: "https://stored.atlassian.net",
        jiraEmail: "stored@example.com",
        jiraApiToken: "stored-token",
      },
    });

    vi.mocked(jiraClient.testJiraConnection).mockResolvedValueOnce({
      ok: true,
      displayName: "Stored User",
    });

    try {
      // Body omits jiraApiToken entirely (as the settings UI does when the
      // user leaves the token field blank), and re-sends the same site
      // URL/email that are already stored.
      const req = makeRequest(project.id, {
        jiraSiteUrl: "https://stored.atlassian.net",
        jiraEmail: "stored@example.com",
      });
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true, displayName: "Stored User" });
      expect(jiraClient.testJiraConnection).toHaveBeenCalledWith({
        siteUrl: "https://stored.atlassian.net",
        email: "stored@example.com",
        apiToken: "stored-token",
      });
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("never echoes the API token back in the response", async () => {
    const project = await prisma.project.create({
      data: {
        name: "No Echo Test",
        type: "JIRA",
        jiraProjectKey: "ECHO",
        jiraSiteUrl: "https://echo.atlassian.net",
        jiraEmail: "echo@example.com",
        jiraApiToken: "super-secret-token",
      },
    });

    vi.mocked(jiraClient.testJiraConnection).mockResolvedValueOnce({
      ok: false,
      error: "HTTP 401 — check email/API token",
    });

    try {
      const req = makeRequest(project.id, {});
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      const data = await res.json();
      expect(JSON.stringify(data)).not.toContain("super-secret-token");
      expect(data).toEqual({
        ok: false,
        error: "HTTP 401 — check email/API token",
      });
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
