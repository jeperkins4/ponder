/**
 * Integration tests for work-unit move endpoint
 * Tests actual Prisma client against test database
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/statusTrigger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/statusTrigger")>(
    "@/lib/statusTrigger"
  );
  return {
    ...actual,
    applyStoryStatusSync: vi.fn(async () => {
      throw new Error("simulated JIRA sync failure");
    }),
  };
});

import { POST } from "@/app/api/work-units/[id]/move/route";

describe("Work Unit Move Endpoint", () => {
  let storyId: string;
  let workUnitId: string;
  let testCounter = 0;

  beforeEach(async () => {
    // Clear both tables before each test
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});

    testCounter++;

    // Create a test story with unique jiraKey for each test
    const story = await prisma.story.create({
      data: {
        jiraKey: `MOVE-${testCounter}`,
        jiraId: `2000${testCounter}`,
        projectKey: "MOVE",
        summary: "Test story for move endpoint",
        description: "A test story for move endpoint tests",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/MOVE-${testCounter}`,
        lastSyncedAt: new Date(),
      },
    });
    storyId = story.id;

    // Create a test work unit
    const workUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "Test work unit",
        description: "A work unit for move tests",
        column: "todo",
        order: 0,
      },
    });
    workUnitId = workUnit.id;
  });

  it("POST should move work unit to different column", async () => {
    const req = new Request("http://localhost/api/work-units/test-id/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        column: "in_progress",
        order: 1,
      }),
    });

    const res = await POST(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(workUnitId);
    expect(body.column).toBe("in_progress");
    expect(body.order).toBe(1);
    expect(body.title).toBe("Test work unit"); // Other properties should be unchanged
    expect(body.storyId).toBe(storyId);
  });

  it("POST should reorder work unit within same column", async () => {
    const req = new Request("http://localhost/api/work-units/test-id/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        column: "todo",
        order: 5,
      }),
    });

    const res = await POST(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(workUnitId);
    expect(body.column).toBe("todo");
    expect(body.order).toBe(5);
  });

  it("POST should move work unit to done column", async () => {
    const req = new Request("http://localhost/api/work-units/test-id/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        column: "done",
        order: 10,
      }),
    });

    const res = await POST(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.column).toBe("done");
    expect(body.order).toBe(10);
  });

  it("POST should return 404 for non-existent work unit", async () => {
    const req = new Request("http://localhost/api/work-units/non-existent/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        column: "in_progress",
        order: 1,
      }),
    });

    const res = await POST(req as never, {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Work unit not found");
  });

  it("POST should return 400 for missing column", async () => {
    const req = new Request("http://localhost/api/work-units/test-id/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: 1,
      }),
    });

    const res = await POST(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Missing required fields");
  });

  it("POST should return 400 for missing order", async () => {
    const req = new Request("http://localhost/api/work-units/test-id/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        column: "in_progress",
      }),
    });

    const res = await POST(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Missing required fields");
  });

  it("POST still returns 200 when the JIRA status sync throws", async () => {
    // applyStoryStatusSync is mocked (module-level, above) to always reject —
    // simulating a JIRA/Claude outage. The move must still succeed.
    const req = new Request("http://localhost/api/work-units/test-id/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        column: "in_progress",
        order: 1,
      }),
    });

    const res = await POST(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.column).toBe("in_progress");
  });

  afterAll(async () => {
    // Properly close database connections
    await prisma.$disconnect();
  });
});
