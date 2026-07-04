/**
 * Integration tests for work-unit API endpoints
 * Tests actual Prisma client against test database
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/route";
import { GET, PATCH, DELETE } from "@/app/api/work-units/[id]/route";

describe("Work Unit API Endpoints", () => {
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
        jiraKey: `TEST-${testCounter}`,
        jiraId: `1000${testCounter}`,
        projectKey: "TEST",
        summary: "Test story",
        description: "A test story for work unit tests",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/TEST-${testCounter}`,
        lastSyncedAt: new Date(),
      },
    });
    storyId = story.id;
  });

  it("POST should create a work unit and return the story with updated workUnits", async () => {
    const req = new Request("http://localhost/api/work-units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyId,
        title: "First work unit",
        description: "Do something",
        column: "todo",
        order: 0,
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe(storyId);
    expect(body.jiraKey).toBe("TEST-1");
    expect(body.workUnits).toHaveLength(1);
    expect(body.workUnits[0].title).toBe("First work unit");
    expect(body.workUnits[0].description).toBe("Do something");
    expect(body.workUnits[0].column).toBe("todo");
    expect(body.workUnits[0].order).toBe(0);

    // Save the work unit ID for later tests
    workUnitId = body.workUnits[0].id;
  });

  it("GET should fetch a single work unit by ID", async () => {
    // First create a work unit
    const workUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "Test work unit",
        description: "A test work unit",
        column: "in_progress",
        order: 1,
      },
    });
    workUnitId = workUnit.id;

    const req = new Request("http://localhost/api/work-units/test-id", {
      method: "GET",
    });

    const res = await GET(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(workUnitId);
    expect(body.storyId).toBe(storyId);
    expect(body.title).toBe("Test work unit");
    expect(body.description).toBe("A test work unit");
    expect(body.column).toBe("in_progress");
    expect(body.order).toBe(1);
    expect(body.movedToQaReportedAt).toBeNull();
  });

  it("GET should return 404 for non-existent work unit", async () => {
    const req = new Request("http://localhost/api/work-units/non-existent", {
      method: "GET",
    });

    const res = await GET(req as never, {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Work unit not found");
  });

  it("PATCH should update a work unit with partial data", async () => {
    // Create a work unit
    const workUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "Original title",
        description: "Original description",
        column: "todo",
        order: 0,
      },
    });
    workUnitId = workUnit.id;

    const req = new Request("http://localhost/api/work-units/test-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Updated title",
        column: "in_progress",
      }),
    });

    const res = await PATCH(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(workUnitId);
    expect(body.title).toBe("Updated title");
    expect(body.description).toBe("Original description"); // Should remain unchanged
    expect(body.column).toBe("in_progress");
    expect(body.order).toBe(0); // Should remain unchanged
  });

  it("PATCH should update acceptanceCriteria and verification", async () => {
    const workUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "Needs AC/verification",
        description: null,
        column: "todo",
        order: 0,
      },
    });
    workUnitId = workUnit.id;

    const req = new Request("http://localhost/api/work-units/test-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        acceptanceCriteria: "Given/when/then criteria",
        verification: "Run the integration suite",
      }),
    });

    const res = await PATCH(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(workUnitId);
    expect(body.acceptanceCriteria).toBe("Given/when/then criteria");
    expect(body.verification).toBe("Run the integration suite");
    expect(body.title).toBe("Needs AC/verification"); // Should remain unchanged

    const persisted = await prisma.workUnit.findUnique({ where: { id: workUnitId } });
    expect(persisted?.acceptanceCriteria).toBe("Given/when/then criteria");
    expect(persisted?.verification).toBe("Run the integration suite");
  });

  it("PATCH should return 404 for non-existent work unit", async () => {
    const req = new Request("http://localhost/api/work-units/non-existent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New title" }),
    });

    const res = await PATCH(req as never, {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Work unit not found");
  });

  it("DELETE should remove a work unit", async () => {
    // Create a work unit
    const workUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "To be deleted",
        description: "This will be deleted",
        column: "done",
        order: 2,
      },
    });
    workUnitId = workUnit.id;

    const req = new Request("http://localhost/api/work-units/test-id", {
      method: "DELETE",
    });

    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify it's actually deleted
    const deletedWorkUnit = await prisma.workUnit.findUnique({
      where: { id: workUnitId },
    });
    expect(deletedWorkUnit).toBeNull();
  });

  it("DELETE should return 404 for non-existent work unit", async () => {
    const req = new Request("http://localhost/api/work-units/non-existent", {
      method: "DELETE",
    });

    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Work unit not found");
  });

  it("POST should return 400 for missing required fields", async () => {
    const req = new Request("http://localhost/api/work-units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyId,
        title: "Incomplete work unit",
        // Missing column and order
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Missing required fields");
  });

  it("POST should handle creation of multiple work units for a story", async () => {
    // Create first work unit
    const req1 = new Request("http://localhost/api/work-units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyId,
        title: "First unit",
        column: "todo",
        order: 0,
      }),
    });

    const res1 = await POST(req1 as never);
    expect(res1.status).toBe(201);
    let body = await res1.json();
    expect(body.workUnits).toHaveLength(1);

    // Create second work unit
    const req2 = new Request("http://localhost/api/work-units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyId,
        title: "Second unit",
        column: "in_progress",
        order: 1,
      }),
    });

    const res2 = await POST(req2 as never);
    expect(res2.status).toBe(201);
    body = await res2.json();
    expect(body.workUnits).toHaveLength(2);
    expect(body.workUnits[0].title).toBe("First unit");
    expect(body.workUnits[1].title).toBe("Second unit");
  });

  afterAll(async () => {
    // Properly close database connections
    await prisma.$disconnect();
  });
});
