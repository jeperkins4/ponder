/**
 * Integration tests for POST /api/projects/[projectId]/import/process
 * Tests actual Prisma client against test database; Claude breakdown is
 * mocked at the module boundary (@/lib/anthropic/breakdown) so no test
 * ever calls the Anthropic network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";
import * as breakdown from "@/lib/anthropic/breakdown";

vi.mock("@/lib/anthropic/breakdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic/breakdown")>();
  return { ...actual, breakDownStory: vi.fn() };
});

describe("POST /api/projects/[projectId]/import/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the project does not exist", async () => {
    const req = new Request(
      "http://localhost:3000/api/projects/nonexistent/import/process",
      { method: "POST", body: JSON.stringify({ items: [] }) }
    );
    const res = await POST(req as never, {
      params: Promise.resolve({ projectId: "nonexistent" }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("not found");
  });

  it("breakDown:true creates N work units in the mapped column with structured AC/verification, and upserts the Story", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Process Route Team",
        type: "JIRA",
        jiraProjectKey: "PROC",
        jiraSiteUrl: "https://example.atlassian.net/",
        jiraEmail: "process-route@example.com",
        jiraApiToken: "process-route-token",
      },
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const jiraKey = `PROC-${suffix}-1`;

    const drafts = [
      { title: "Subtask A", acceptanceCriteria: "A done", verification: "Run test A" },
      { title: "Subtask B", acceptanceCriteria: "B done", verification: "Run test B" },
      { title: "Subtask C", acceptanceCriteria: "C done", verification: "Run test C" },
    ];
    vi.mocked(breakdown.breakDownStory).mockResolvedValueOnce(drafts);

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/process`,
        {
          method: "POST",
          body: JSON.stringify({
            items: [
              {
                jiraKey,
                jiraId: jiraKey,
                summary: "Story needing breakdown",
                description: "Some description",
                jiraStatus: "Code Revew",
                breakDown: true,
              },
            ],
          }),
        }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ storiesProcessed: 1, workUnitsCreated: 3 });

      expect(breakdown.breakDownStory).toHaveBeenCalledWith({
        summary: "Story needing breakdown",
        description: "Some description",
      });

      const story = await prisma.story.findUnique({ where: { jiraKey } });
      expect(story).not.toBeNull();
      expect(story?.jiraId).toBe(jiraKey);
      expect(story?.projectKey).toBe("PROC");
      expect(story?.projectId).toBe(project.id);
      expect(story?.summary).toBe("Story needing breakdown");
      expect(story?.jiraStatus).toBe("Code Revew");
      expect(story?.url).toBe(`https://example.atlassian.net/browse/${jiraKey}`);

      const workUnits = await prisma.workUnit.findMany({
        where: { storyId: story!.id },
        orderBy: { order: "asc" },
      });
      expect(workUnits).toHaveLength(3);
      expect(workUnits.map((w) => w.title)).toEqual(["Subtask A", "Subtask B", "Subtask C"]);
      expect(workUnits.every((w) => w.column === "code_review")).toBe(true);
      expect(workUnits.map((w) => w.order)).toEqual([0, 1, 2]);
      expect(workUnits[0].description).toBeNull();
      expect(workUnits[0].acceptanceCriteria).toBe("A done");
      expect(workUnits[0].verification).toBe("Run test A");
      expect(workUnits[1].acceptanceCriteria).toBe("B done");
      expect(workUnits[1].verification).toBe("Run test B");
      expect(workUnits[2].acceptanceCriteria).toBe("C done");
      expect(workUnits[2].verification).toBe("Run test C");
    } finally {
      await prisma.workUnit.deleteMany({ where: { story: { jiraKey } } });
      await prisma.story.deleteMany({ where: { jiraKey } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("breakDown:false creates exactly one work unit titled with the summary", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Process Route Team 2",
        type: "JIRA",
        jiraProjectKey: "PROC2",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "process-route2@example.com",
        jiraApiToken: "process-route2-token",
      },
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const jiraKey = `PROC2-${suffix}-1`;

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/process`,
        {
          method: "POST",
          body: JSON.stringify({
            items: [
              {
                jiraKey,
                jiraId: jiraKey,
                summary: "Simple story",
                description: null,
                jiraStatus: "To Do",
                breakDown: false,
              },
            ],
          }),
        }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ storiesProcessed: 1, workUnitsCreated: 1 });
      expect(breakdown.breakDownStory).not.toHaveBeenCalled();

      const story = await prisma.story.findUnique({ where: { jiraKey } });
      expect(story).not.toBeNull();

      const workUnits = await prisma.workUnit.findMany({ where: { storyId: story!.id } });
      expect(workUnits).toHaveLength(1);
      expect(workUnits[0].title).toBe("Simple story");
      expect(workUnits[0].column).toBe("todo");
      expect(workUnits[0].order).toBe(0);
      expect(workUnits[0].acceptanceCriteria).toBeNull();
      expect(workUnits[0].verification).toBeNull();
    } finally {
      await prisma.workUnit.deleteMany({ where: { story: { jiraKey } } });
      await prisma.story.deleteMany({ where: { jiraKey } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("maps jiraStatus to the correct column for both breakdown paths", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Process Route Column Mapping",
        type: "JIRA",
        jiraProjectKey: "PROC3",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "process-route3@example.com",
        jiraApiToken: "process-route3-token",
      },
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const keyReview = `PROC3-${suffix}-1`;
    const keyTodo = `PROC3-${suffix}-2`;

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/process`,
        {
          method: "POST",
          body: JSON.stringify({
            items: [
              {
                jiraKey: keyReview,
                jiraId: keyReview,
                summary: "Code review story",
                description: null,
                jiraStatus: "Code Revew",
                breakDown: false,
              },
              {
                jiraKey: keyTodo,
                jiraId: keyTodo,
                summary: "Todo story",
                description: null,
                jiraStatus: "To Do",
                breakDown: false,
              },
            ],
          }),
        }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ storiesProcessed: 2, workUnitsCreated: 2 });

      const reviewStory = await prisma.story.findUnique({ where: { jiraKey: keyReview } });
      const todoStory = await prisma.story.findUnique({ where: { jiraKey: keyTodo } });

      const reviewUnits = await prisma.workUnit.findMany({ where: { storyId: reviewStory!.id } });
      const todoUnits = await prisma.workUnit.findMany({ where: { storyId: todoStory!.id } });

      expect(reviewUnits[0].column).toBe("code_review");
      expect(todoUnits[0].column).toBe("todo");
    } finally {
      await prisma.workUnit.deleteMany({ where: { story: { jiraKey: { in: [keyReview, keyTodo] } } } });
      await prisma.story.deleteMany({ where: { jiraKey: { in: [keyReview, keyTodo] } } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("falls back to a single card if breakdown throws, and still counts the story as processed", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Process Route Failure",
        type: "JIRA",
        jiraProjectKey: "PROCF",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "process-route-fail@example.com",
        jiraApiToken: "process-route-fail-token",
      },
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const jiraKey = `PROCF-${suffix}-1`;

    vi.mocked(breakdown.breakDownStory).mockRejectedValueOnce(new Error("Claude API error"));

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/process`,
        {
          method: "POST",
          body: JSON.stringify({
            items: [
              {
                jiraKey,
                jiraId: jiraKey,
                summary: "Story with failing breakdown",
                description: null,
                jiraStatus: "To Do",
                breakDown: true,
              },
            ],
          }),
        }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ storiesProcessed: 1, workUnitsCreated: 1 });

      const story = await prisma.story.findUnique({ where: { jiraKey } });
      const workUnits = await prisma.workUnit.findMany({ where: { storyId: story!.id } });
      expect(workUnits).toHaveLength(1);
      expect(workUnits[0].title).toBe("Story with failing breakdown");
      expect(workUnits[0].acceptanceCriteria).toBeNull();
      expect(workUnits[0].verification).toBeNull();
    } finally {
      await prisma.workUnit.deleteMany({ where: { story: { jiraKey } } });
      await prisma.story.deleteMany({ where: { jiraKey } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("re-processing the same jiraKey updates the existing Story instead of creating a duplicate", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Process Route Upsert Update",
        type: "JIRA",
        jiraProjectKey: "PROCU",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "process-route-upsert@example.com",
        jiraApiToken: "process-route-upsert-token",
      },
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const jiraKey = `PROCU-${suffix}-1`;

    const makeReq = (summary: string, jiraStatus: string) =>
      new Request(`http://localhost:3000/api/projects/${project.id}/import/process`, {
        method: "POST",
        body: JSON.stringify({
          items: [
            {
              jiraKey,
              jiraId: jiraKey,
              summary,
              description: null,
              jiraStatus,
              breakDown: false,
            },
          ],
        }),
      });

    try {
      const res1 = await POST(makeReq("Original summary", "To Do") as never, {
        params: Promise.resolve({ projectId: project.id }),
      });
      expect(res1.status).toBe(200);

      const res2 = await POST(makeReq("Updated summary", "Code Revew") as never, {
        params: Promise.resolve({ projectId: project.id }),
      });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2).toEqual({ storiesProcessed: 1, workUnitsCreated: 1 });

      const stories = await prisma.story.findMany({ where: { jiraKey } });
      expect(stories).toHaveLength(1);
      expect(stories[0].summary).toBe("Updated summary");
      expect(stories[0].jiraStatus).toBe("Code Revew");

      // Card creation isn't deduplicated on re-import — both passes each add
      // their own card for the (single) Story row.
      const workUnits = await prisma.workUnit.findMany({ where: { storyId: stories[0].id } });
      expect(workUnits).toHaveLength(2);
    } finally {
      await prisma.workUnit.deleteMany({ where: { story: { jiraKey } } });
      await prisma.story.deleteMany({ where: { jiraKey } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
