import { describe, it, expect, vi } from "vitest";
import {
  listProjects,
  listStories,
  listWorkUnits,
  markDone,
  moveWorkUnit,
  regenerateAcceptance,
  updateWorkUnit,
} from "./tools";
import type { PonderClient } from "./client";
import type { ProjectWithStats, StoryDTO, WorkUnitDTO } from "@/lib/types";

function fakeClient(overrides: Partial<PonderClient>): PonderClient {
  return overrides as PonderClient;
}

const projects: ProjectWithStats[] = [
  {
    id: "p1",
    name: "Project One",
    type: "JIRA",
    jiraProjectKey: "PONE",
    createdAt: new Date(),
    updatedAt: new Date(),
    hasApiToken: true,
    storyCount: 2,
    workUnitCount: 5,
  },
  {
    id: "p2",
    name: "Project Two",
    type: "STANDALONE",
    createdAt: new Date(),
    updatedAt: new Date(),
    hasApiToken: false,
    storyCount: 0,
    workUnitCount: 0,
  },
];

const stories: StoryDTO[] = [
  {
    id: "s1",
    jiraKey: "PONE-1",
    jiraId: "10001",
    projectKey: "PONE",
    summary: "Do the thing",
    description: null,
    jiraStatus: "In Progress",
    url: "https://example.atlassian.net/browse/PONE-1",
    lastSyncedAt: new Date().toISOString(),
    completionCommentPostedAt: null,
    workUnits: [
      {
        id: "w1",
        storyId: "s1",
        title: "Task A",
        description: null,
        acceptanceCriteria: null,
        verification: null,
        column: "todo",
        order: 0,
        subNumber: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
      {
        id: "w2",
        storyId: "s1",
        title: "Task B",
        description: null,
        acceptanceCriteria: null,
        verification: null,
        column: "todo",
        order: 1,
        subNumber: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
      {
        id: "w3",
        storyId: "s1",
        title: "Task C",
        description: null,
        acceptanceCriteria: null,
        verification: null,
        column: "in_progress",
        order: 0,
        subNumber: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
      {
        id: "w4",
        storyId: "s1",
        title: "Task D",
        description: null,
        acceptanceCriteria: null,
        verification: null,
        column: "code_review",
        order: 0,
        subNumber: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    ],
  },
  {
    id: "s2",
    jiraKey: "PONE-2",
    jiraId: "10002",
    projectKey: "PONE",
    summary: "Do another thing",
    description: null,
    jiraStatus: "To Do",
    url: "https://example.atlassian.net/browse/PONE-2",
    lastSyncedAt: new Date().toISOString(),
    completionCommentPostedAt: null,
    workUnits: [],
  },
];

describe("listProjects", () => {
  it("includes each project's name and counts", async () => {
    const client = fakeClient({ getProjects: async () => projects });

    const result = await listProjects(client);
    const text = result.content[0].text;

    expect(text).toContain("Project One");
    expect(text).toContain("stories: 2");
    expect(text).toContain("workUnits: 5");
    expect(text).toContain("Project Two");
    expect(text).toContain("stories: 0");
    expect(text).toContain("jiraProjectKey: PONE");
    expect(text).toContain("jiraProjectKey: —");
  });

  it("reports zero projects clearly", async () => {
    const client = fakeClient({ getProjects: async () => [] });

    const result = await listProjects(client);

    expect(result.content[0].text).toMatch(/no projects/i);
  });
});

describe("listStories", () => {
  it("includes each story's jiraKey, status, and per-column breakdown", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listStories(client, { projectId: "p1" });
    const text = result.content[0].text;

    expect(text).toContain("PONE-1");
    expect(text).toContain("In Progress");
    expect(text).toContain("todo: 2");
    expect(text).toContain("in_progress: 1");
    expect(text).toContain("code_review: 1");
    expect(text).toContain("PONE-2");
    expect(text).toContain("To Do");
  });

  it("returns a clear message when there are no stories", async () => {
    const client = fakeClient({ getStories: async () => [] });

    const result = await listStories(client, { projectId: "p1" });

    expect(result.content[0].text).toMatch(/no stories/i);
  });
});

describe("listWorkUnits", () => {
  it("lists every work unit with its id and parent jiraKey", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listWorkUnits(client, { projectId: "p1" });
    const text = result.content[0].text;

    expect(text).toContain("w1");
    expect(text).toContain("Task A");
    expect(text).toContain("PONE-1");
    expect(text).toContain("w4");
    expect(text).toContain("Task D");
  });

  it("filters to a single column when provided", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listWorkUnits(client, {
      projectId: "p1",
      column: "code_review",
    });
    const text = result.content[0].text;

    expect(text).toContain("Task D");
    expect(text).not.toContain("Task A");
    expect(text).not.toContain("Task B");
    expect(text).not.toContain("Task C");
  });

  it("returns an error mentioning valid columns for an invalid column", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listWorkUnits(client, {
      projectId: "p1",
      column: "bogus",
    });
    const text = result.content[0].text;

    expect(text).toMatch(/invalid column/i);
    expect(text).toContain("todo");
    expect(text).toContain("in_progress");
    expect(text).toContain("code_review");
    expect(text).toContain("done");
  });
});

const movedWorkUnit: WorkUnitDTO = {
  id: "w1",
  storyId: "s1",
  title: "Task A",
  description: null,
  acceptanceCriteria: null,
  verification: null,
  column: "in_progress",
  order: 0,
  subNumber: null,
  createdAt: new Date().toISOString(),
  completedAt: null,
};

describe("moveWorkUnit", () => {
  it("calls client.moveWorkUnit with the right args and confirms", async () => {
    const moveWorkUnitMock = vi.fn(async () => movedWorkUnit);
    const client = fakeClient({ moveWorkUnit: moveWorkUnitMock });

    const result = await moveWorkUnit(client, {
      workUnitId: "w1",
      column: "in_progress",
      order: 2,
    });
    const text = result.content[0].text;

    expect(moveWorkUnitMock).toHaveBeenCalledWith("w1", "in_progress", 2);
    expect(text).toContain("Task A");
    expect(text).toContain("in_progress");
  });

  it("returns an error naming valid columns for an invalid column, without calling the client", async () => {
    const moveWorkUnitMock = vi.fn(async () => movedWorkUnit);
    const client = fakeClient({ moveWorkUnit: moveWorkUnitMock });

    const result = await moveWorkUnit(client, {
      workUnitId: "w1",
      column: "bogus",
    });
    const text = result.content[0].text;

    expect(text).toMatch(/invalid column/i);
    expect(text).toContain("todo");
    expect(text).toContain("in_progress");
    expect(text).toContain("code_review");
    expect(text).toContain("done");
    expect(moveWorkUnitMock).not.toHaveBeenCalled();
  });

  it("returns an error-text result when the client throws", async () => {
    const client = fakeClient({
      moveWorkUnit: vi.fn(async () => {
        throw new Error("Ponder API error: 404 POST /api/work-units/w1/move");
      }),
    });

    const result = await moveWorkUnit(client, {
      workUnitId: "w1",
      column: "in_progress",
    });
    const text = result.content[0].text;

    expect(text).toMatch(/error/i);
    expect(text).toContain("404");
  });
});

describe("markDone", () => {
  it("calls client.moveWorkUnit with column 'done'", async () => {
    const moveWorkUnitMock = vi.fn(async () => ({
      ...movedWorkUnit,
      column: "done" as const,
    }));
    const client = fakeClient({ moveWorkUnit: moveWorkUnitMock });

    const result = await markDone(client, { workUnitId: "w1" });
    const text = result.content[0].text;

    expect(moveWorkUnitMock).toHaveBeenCalledWith("w1", "done", undefined);
    expect(text).toContain("done");
  });
});

describe("updateWorkUnit", () => {
  it("calls client.updateWorkUnit with just a title when only title is provided", async () => {
    const updateWorkUnitMock = vi.fn(async () => ({
      ...movedWorkUnit,
      title: "New title",
    }));
    const client = fakeClient({ updateWorkUnit: updateWorkUnitMock });

    const result = await updateWorkUnit(client, {
      workUnitId: "w1",
      title: "New title",
    });
    const text = result.content[0].text;

    expect(updateWorkUnitMock).toHaveBeenCalledWith("w1", { title: "New title" });
    expect(text).toContain("New title");
  });

  it("returns an error when neither title nor description is provided, without calling the client", async () => {
    const updateWorkUnitMock = vi.fn(async () => movedWorkUnit);
    const client = fakeClient({ updateWorkUnit: updateWorkUnitMock });

    const result = await updateWorkUnit(client, { workUnitId: "w1" });
    const text = result.content[0].text;

    expect(text).toMatch(/error/i);
    expect(updateWorkUnitMock).not.toHaveBeenCalled();
  });

  it("returns an error-text result when the client throws", async () => {
    const client = fakeClient({
      updateWorkUnit: vi.fn(async () => {
        throw new Error("Ponder API error: 500 PATCH /api/work-units/w1");
      }),
    });

    const result = await updateWorkUnit(client, {
      workUnitId: "w1",
      title: "New title",
    });
    const text = result.content[0].text;

    expect(text).toMatch(/error/i);
    expect(text).toContain("500");
  });
});

describe("regenerateAcceptance", () => {
  it("regenerateAcceptance returns a text summary of the new AC/verification", async () => {
    const fakeClient = {
      regenerateAcceptance: async (id: string, ctx?: string) => {
        expect(id).toBe("wu1");
        expect(ctx).toBe('{"domain":"Projects"}');
        return { acceptanceCriteria: "- a", verification: "run t" };
      },
    } as unknown as PonderClient;

    const result = await regenerateAcceptance(fakeClient, {
      workUnitId: "wu1",
      codebaseContext: '{"domain":"Projects"}',
    });
    expect(result.content[0].text).toContain("Acceptance Criteria");
    expect(result.content[0].text).toContain("run t");
  });

  it("returns an error-text result when the client throws", async () => {
    const fakeClient = {
      regenerateAcceptance: async () => {
        throw new Error("Ponder API error: 500 POST /api/work-units/wu1/generate-acceptance-criteria");
      },
    } as unknown as PonderClient;

    const result = await regenerateAcceptance(fakeClient, { workUnitId: "wu1" });
    const text = result.content[0].text;

    expect(text).toMatch(/error/i);
    expect(text).toContain("500");
  });
});
