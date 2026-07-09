/**
 * Integration tests for Project CRUD API endpoints
 * Tests actual Prisma client against test database
 */

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "./route";
import {
  GET as GET_ONE,
  PUT,
  DELETE,
} from "./[projectId]/route";

beforeEach(async () => {
  // Only clear the Project table here. Story/WorkUnit are shared with other
  // test files (work-units.test.ts, move.test.ts) that run concurrently
  // against the same test database; blanket-deleting those tables here would
  // race with them. Tests below that create their own Story/WorkUnit rows
  // use unique keys and clean up after themselves instead.
  await prisma.project.deleteMany({});
});

describe("POST /api/projects", () => {
  it("should create a new JIRA project", async () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Team A",
        type: "JIRA",
        jiraProjectKey: "TEAM",
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Team A");
    expect(data.type).toBe("JIRA");
    expect(data.jiraProjectKey).toBe("TEAM");
    expect(data.storyCount).toBe(0);
    expect(data.workUnitCount).toBe(0);
  });

  it("should create a standalone project", async () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Personal",
        type: "STANDALONE",
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.type).toBe("STANDALONE");
    expect(data.jiraProjectKey).toBeFalsy();
  });

  it("should ignore jiraProjectKey for standalone projects", async () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Personal",
        type: "STANDALONE",
        jiraProjectKey: "SHOULD_NOT_BE_SAVED",
      }),
    });
    const res = await POST(req as never);
    const data = await res.json();
    expect(data.jiraProjectKey).toBeFalsy();
  });

  it("should return 400 if name is missing", async () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "STANDALONE" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("should return 400 if type is missing", async () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Team A" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("should return 400 if type is invalid", async () => {
    const req = new Request("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Team A", type: "BOGUS" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/projects", () => {
  it("should list all projects", async () => {
    await prisma.project.create({
      data: { name: "Team A", type: "STANDALONE" },
    });

    const req = new Request("http://localhost:3000/api/projects");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("Team A");
  });

  it("should include story/work-unit stats", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "STANDALONE" },
    });
    const uniqueKey = `PROJSTATS-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: uniqueKey,
        jiraId: uniqueKey,
        projectKey: "PROJ",
        summary: "A story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${uniqueKey}`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    const workUnit = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        projectId: project.id,
        title: "A work unit",
        column: "todo",
        order: 0,
      },
    });

    try {
      const req = new Request("http://localhost:3000/api/projects");
      const res = await GET(req as never);
      const data = await res.json();
      expect(data[0].storyCount).toBe(1);
      expect(data[0].workUnitCount).toBe(1);
    } finally {
      // Clean up explicitly (rows are shared tables with other test files,
      // so avoid a blanket deleteMany).
      await prisma.workUnit.delete({ where: { id: workUnit.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("should return an empty array when there are no projects", async () => {
    const req = new Request("http://localhost:3000/api/projects");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it("does not count archived work units in workUnitCount", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "STANDALONE" },
    });
    const uniqueKey = `PROJSTATSARCH-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: uniqueKey,
        jiraId: uniqueKey,
        projectKey: "PROJ",
        summary: "Story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${uniqueKey}`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    const activeWU = await prisma.workUnit.create({
      data: { storyId: story.id, projectId: project.id, title: "Active", column: "todo", order: 0 },
    });
    const archivedWU = await prisma.workUnit.create({
      data: { storyId: story.id, projectId: project.id, title: "Archived", column: "done", order: 1, archivedAt: new Date() },
    });

    try {
      const req = new Request("http://localhost:3000/api/projects");
      const res = await GET(req as never);
      const data = await res.json();
      const returned = data.find((p: { id: string }) => p.id === project.id);

      expect(returned.workUnitCount).toBe(1);
    } finally {
      await prisma.workUnit.delete({ where: { id: activeWU.id } });
      await prisma.workUnit.delete({ where: { id: archivedWU.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });
});

describe("GET /api/projects/[projectId]", () => {
  it("should fetch a project by ID", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "STANDALONE" },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`);
    const res = await GET_ONE(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(project.id);
    expect(data.name).toBe("Team A");
    expect(data.hasApiToken).toBe(false);
    expect(data.jiraApiToken).toBeUndefined();
  });

  it("should include hasApiToken/jiraSiteUrl/jiraEmail but never the raw token", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Team A",
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraSiteUrl: "https://acme.atlassian.net",
        jiraEmail: "user@acme.com",
        jiraApiToken: "super-secret-token",
      },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`);
    const res = await GET_ONE(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jiraSiteUrl).toBe("https://acme.atlassian.net");
    expect(data.jiraEmail).toBe("user@acme.com");
    expect(data.hasApiToken).toBe(true);
    expect(data.jiraApiToken).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("super-secret-token");
  });

  it("should return 404 if project not found", async () => {
    const req = new Request("http://localhost:3000/api/projects/nonexistent");
    const res = await GET_ONE(req as never, {
      params: Promise.resolve({ projectId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  it("does not count archived work units in workUnitCount", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "STANDALONE" },
    });
    const uniqueKey = `PROJSTATSARCH1-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: uniqueKey,
        jiraId: uniqueKey,
        projectKey: "PROJ",
        summary: "Story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${uniqueKey}`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    const activeWU = await prisma.workUnit.create({
      data: { storyId: story.id, projectId: project.id, title: "Active", column: "todo", order: 0 },
    });
    const archivedWU = await prisma.workUnit.create({
      data: { storyId: story.id, projectId: project.id, title: "Archived", column: "done", order: 1, archivedAt: new Date() },
    });

    try {
      const req = new Request(`http://localhost:3000/api/projects/${project.id}`);
      const res = await GET_ONE(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });
      const data = await res.json();

      expect(data.workUnitCount).toBe(1);
    } finally {
      await prisma.workUnit.delete({ where: { id: activeWU.id } });
      await prisma.workUnit.delete({ where: { id: archivedWU.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });
});

describe("PUT /api/projects/[projectId]", () => {
  it("should update a project", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "JIRA", jiraProjectKey: "TEAM" },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Team B", jiraProjectKey: "TEAMB" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Team B");
    expect(data.jiraProjectKey).toBe("TEAMB");
  });

  it("should return 404 if project not found", async () => {
    const req = new Request("http://localhost:3000/api/projects/nonexistent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Team B" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  it("should store jiraSiteUrl, jiraEmail, and jiraApiToken and report hasApiToken without leaking the raw token", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "JIRA", jiraProjectKey: "TEAM" },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jiraSiteUrl: "https://acme.atlassian.net",
        jiraEmail: "user@acme.com",
        jiraApiToken: "super-secret-token",
      }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jiraSiteUrl).toBe("https://acme.atlassian.net");
    expect(data.jiraEmail).toBe("user@acme.com");
    expect(data.hasApiToken).toBe(true);
    expect(data.jiraApiToken).toBeUndefined();

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.jiraApiToken).toBe("super-secret-token");
  });

  it("should leave the existing token untouched when jiraApiToken is missing from the body", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Team A",
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraSiteUrl: "https://acme.atlassian.net",
        jiraEmail: "user@acme.com",
        jiraApiToken: "original-token",
      },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.jiraApiToken).toBe("original-token");
  });

  it("should leave the existing token untouched when jiraApiToken is an empty string", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Team A",
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraApiToken: "original-token",
      },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jiraApiToken: "" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasApiToken).toBe(true);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.jiraApiToken).toBe("original-token");
  });

  it("should replace the token when a new non-empty jiraApiToken is provided", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Team A",
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraApiToken: "original-token",
      },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jiraApiToken: "new-token" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.jiraApiToken).toBe("new-token");
  });

  it("should store githubRepos when provided", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "JIRA", jiraProjectKey: "TEAM" },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubRepos: "sphero/team-alliance, sphero/shared-ui" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.githubRepos).toBe("sphero/team-alliance, sphero/shared-ui");

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.githubRepos).toBe("sphero/team-alliance, sphero/shared-ui");
  });

  it("should leave githubRepos untouched when omitted from the body", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Team A",
        type: "JIRA",
        jiraProjectKey: "TEAM",
        githubRepos: "sphero/team-alliance",
      },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.githubRepos).toBe("sphero/team-alliance");
  });

  it("should store jiraExcludedStatuses when provided (including empty string)", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "JIRA", jiraProjectKey: "TEAM" },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jiraExcludedStatuses: "" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.jiraExcludedStatuses).toBe("");
  });

  it("should default jiraExcludedStatuses to QA on creation and preserve it when omitted from PUT", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "JIRA", jiraProjectKey: "TEAM" },
    });
    expect(project.jiraExcludedStatuses).toBe("QA");

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    await PUT(req as never, { params: Promise.resolve({ projectId: project.id }) });

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.jiraExcludedStatuses).toBe("QA");
  });
});

describe("DELETE /api/projects/[projectId]", () => {
  it("should delete a project", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "STANDALONE" },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);

    const deleted = await prisma.project.findUnique({
      where: { id: project.id },
    });
    expect(deleted).toBeNull();
  });

  it("should cascade-delete stories and work units", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "STANDALONE" },
    });
    const uniqueKey = `PROJCASCADE-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: uniqueKey,
        jiraId: uniqueKey,
        projectKey: "PROJ",
        summary: "A story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${uniqueKey}`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        projectId: project.id,
        title: "A work unit",
        column: "todo",
        order: 0,
      },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);

    const remainingStories = await prisma.story.findMany({
      where: { projectId: project.id },
    });
    const remainingWorkUnits = await prisma.workUnit.findMany({
      where: { projectId: project.id },
    });
    expect(remainingStories).toHaveLength(0);
    expect(remainingWorkUnits).toHaveLength(0);
  });

  it("should return 404 if project not found", async () => {
    const req = new Request("http://localhost:3000/api/projects/nonexistent", {
      method: "DELETE",
    });
    const res = await DELETE(req as never, {
      params: Promise.resolve({ projectId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });
});
