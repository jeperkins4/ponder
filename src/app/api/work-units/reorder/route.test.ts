/**
 * Integration tests for the /api/work-units/reorder endpoint.
 * Tests actual Prisma client against test database (real Postgres, not mocked).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/statusTrigger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/statusTrigger")>(
    "@/lib/statusTrigger"
  );
  return {
    ...actual,
    applyStoryStatusSync: vi.fn(actual.applyStoryStatusSync),
  };
});

import { applyStoryStatusSync } from "@/lib/statusTrigger";
import { POST } from "@/app/api/work-units/reorder/route";

function postReorder(body: unknown) {
  const req = new Request("http://localhost/api/work-units/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as never);
}

describe("Work Unit Reorder Endpoint", () => {
  let storyId: string;
  let testCounter = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});

    testCounter++;
    const story = await prisma.story.create({
      data: {
        jiraKey: `REORDER-${testCounter}`,
        jiraId: `3000${testCounter}`,
        projectKey: "REORDER",
        summary: "Test story for reorder endpoint",
        description: "A test story for reorder endpoint tests",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/REORDER-${testCounter}`,
        lastSyncedAt: new Date(),
      },
    });
    storyId = story.id;
  });

  async function makeWorkUnit(column: string, order: number, title: string) {
    return prisma.workUnit.create({
      data: { storyId, title, column, order },
    });
  }

  it("reorders work units within the same column", async () => {
    const a = await makeWorkUnit("todo", 0, "A");
    const b = await makeWorkUnit("todo", 1, "B");
    const c = await makeWorkUnit("todo", 2, "C");

    // Move A to the end: [B, C, A]
    const res = await postReorder({
      movedId: a.id,
      columns: { todo: [b.id, c.id, a.id] },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const [updatedA, updatedB, updatedC] = await Promise.all(
      [a.id, b.id, c.id].map((id) =>
        prisma.workUnit.findUniqueOrThrow({ where: { id } })
      )
    );
    expect(updatedB.column).toBe("todo");
    expect(updatedB.order).toBe(0);
    expect(updatedC.column).toBe("todo");
    expect(updatedC.order).toBe(1);
    expect(updatedA.column).toBe("todo");
    expect(updatedA.order).toBe(2);
  });

  it("moves a work unit across columns, updating column and order for both lists", async () => {
    const a = await makeWorkUnit("todo", 0, "A");
    const d = await makeWorkUnit("in_progress", 0, "D");

    const res = await postReorder({
      movedId: a.id,
      columns: {
        todo: [],
        in_progress: [d.id, a.id],
      },
    });

    expect(res.status).toBe(200);

    const updatedA = await prisma.workUnit.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(updatedA.column).toBe("in_progress");
    expect(updatedA.order).toBe(1);

    const updatedD = await prisma.workUnit.findUniqueOrThrow({
      where: { id: d.id },
    });
    expect(updatedD.column).toBe("in_progress");
    expect(updatedD.order).toBe(0);
  });

  it("triggers the JIRA status sync for the moved story on a cross-column move", async () => {
    const a = await makeWorkUnit("todo", 0, "A");

    await postReorder({
      movedId: a.id,
      columns: { todo: [], in_progress: [a.id] },
    });

    // Compare only the storyId argument — asserting equality against the
    // full `prisma` client object crashes vitest's failure-diff printer on
    // its circular internal references.
    expect(applyStoryStatusSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyStoryStatusSync).mock.calls[0][0]).toBe(storyId);
  });

  it("still calls the sync for a pure within-column reorder, which then no-ops (no column changed)", async () => {
    const a = await makeWorkUnit("todo", 0, "A");
    const b = await makeWorkUnit("todo", 1, "B");

    await postReorder({
      movedId: a.id,
      columns: { todo: [b.id, a.id] },
    });

    // applyStoryStatusSync is still invoked (reorder endpoint always calls it
    // for the moved card's story)...
    expect(applyStoryStatusSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyStoryStatusSync).mock.calls[0][0]).toBe(storyId);

    // ...but since every work unit's column is unchanged (still all "todo"),
    // computeDesiredJiraStatus/applyStoryStatusSync sees nothing to sync: the
    // story's jiraStatus is untouched.
    const story = await prisma.story.findUniqueOrThrow({
      where: { id: storyId },
    });
    expect(story.jiraStatus).toBe("To Do");
  });

  it("never fails the request when the JIRA status sync throws", async () => {
    vi.mocked(applyStoryStatusSync).mockRejectedValueOnce(
      new Error("simulated JIRA sync failure")
    );

    const a = await makeWorkUnit("todo", 0, "A");

    const res = await postReorder({
      movedId: a.id,
      columns: { todo: [], in_progress: [a.id] },
    });

    expect(res.status).toBe(200);
    const updatedA = await prisma.workUnit.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(updatedA.column).toBe("in_progress");
  });

  it("returns 404 when movedId does not reference an existing work unit", async () => {
    const res = await postReorder({
      movedId: "non-existent-id",
      columns: { todo: ["non-existent-id"] },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Work unit not found");
  });

  it("returns 400 when movedId is missing", async () => {
    const res = await postReorder({ columns: { todo: [] } });
    expect(res.status).toBe(400);
  });

  it("returns 400 when columns is missing", async () => {
    const a = await makeWorkUnit("todo", 0, "A");
    const res = await postReorder({ movedId: a.id });
    expect(res.status).toBe(400);
  });

  it("returns 400 when columns contains a non-array value", async () => {
    const a = await makeWorkUnit("todo", 0, "A");
    const res = await postReorder({
      movedId: a.id,
      columns: { todo: "not-an-array" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when columns contains an unknown column key", async () => {
    const a = await makeWorkUnit("todo", 0, "A");
    const res = await postReorder({
      movedId: a.id,
      columns: { bogus_column: [a.id] },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed (non-JSON) body", async () => {
    const req = new Request("http://localhost/api/work-units/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
