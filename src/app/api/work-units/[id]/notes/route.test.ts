/**
 * Integration tests for work-unit notes endpoint
 * Tests actual Prisma client against test database
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/work-units/[id]/notes/route";

describe("Work Unit Notes Endpoint", () => {
  let storyId: string;
  let workUnitId: string;
  let otherWorkUnitId: string;
  let testCounter = 0;

  beforeEach(async () => {
    // Clear tables before each test (children first for FK safety)
    await prisma.workNote.deleteMany({});
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});

    testCounter++;

    const story = await prisma.story.create({
      data: {
        jiraKey: `NOTES-${testCounter}`,
        jiraId: `3000${testCounter}`,
        projectKey: "NOTES",
        summary: "Test story for notes endpoint",
        description: "A test story for notes endpoint tests",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/NOTES-${testCounter}`,
        lastSyncedAt: new Date(),
      },
    });
    storyId = story.id;

    const workUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "Test work unit",
        description: "A work unit for notes tests",
        column: "todo",
        order: 0,
      },
    });
    workUnitId = workUnit.id;

    const otherWorkUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "Other work unit",
        description: "A second work unit, notes should not leak into it",
        column: "todo",
        order: 1,
      },
    });
    otherWorkUnitId = otherWorkUnit.id;
  });

  describe("POST", () => {
    it("creates a note and returns 201 with the DTO", async () => {
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "Talked to QA, repro confirmed." }),
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(201);

      const dto = await res.json();
      expect(dto.body).toBe("Talked to QA, repro confirmed.");
      expect(dto.workUnitId).toBe(workUnitId);
      expect(typeof dto.id).toBe("string");
      expect(dto.id.length).toBeGreaterThan(0);
      expect(typeof dto.createdAt).toBe("string");
      expect(new Date(dto.createdAt).toString()).not.toBe("Invalid Date");

      const persisted = await prisma.workNote.findUnique({
        where: { id: dto.id },
      });
      expect(persisted).not.toBeNull();
      expect(persisted?.workUnitId).toBe(workUnitId);
      expect(persisted?.body).toBe("Talked to QA, repro confirmed.");
    });

    it("returns 404 for a non-existent work unit and creates no note", async () => {
      const req = new Request(
        "http://localhost/api/work-units/non-existent/notes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "orphan note" }),
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: "non-existent-id" }),
      });
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBeTruthy();

      const count = await prisma.workNote.count();
      expect(count).toBe(0);
    });

    it("returns 400 for an empty body and creates no note", async () => {
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "" }),
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBeTruthy();

      const count = await prisma.workNote.count();
      expect(count).toBe(0);
    });

    it("returns 400 for a whitespace-only body and creates no note", async () => {
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "   \n\t  " }),
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBeTruthy();

      const count = await prisma.workNote.count();
      expect(count).toBe(0);
    });
  });

  describe("GET", () => {
    it("returns notes for a work unit in chronological order", async () => {
      const first = await prisma.workNote.create({
        data: { workUnitId, body: "First note" },
      });
      // Ensure distinct createdAt ordering even on fast clocks.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await prisma.workNote.create({
        data: { workUnitId, body: "Second note" },
      });

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/notes`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(200);

      const notes = await res.json();
      expect(notes).toHaveLength(2);
      expect(notes[0].id).toBe(first.id);
      expect(notes[0].body).toBe("First note");
      expect(notes[1].id).toBe(second.id);
      expect(notes[1].body).toBe("Second note");
    });

    it("returns an empty array when the work unit has no notes", async () => {
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/notes`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(200);

      const notes = await res.json();
      expect(notes).toEqual([]);
    });

    it("returns 404 for a non-existent work unit", async () => {
      const req = new Request(
        "http://localhost/api/work-units/non-existent/notes"
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ id: "non-existent-id" }),
      });
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("scopes notes to their work unit", async () => {
      await prisma.workNote.create({
        data: { workUnitId, body: "Belongs to WU-A" },
      });
      await prisma.workNote.create({
        data: { workUnitId: otherWorkUnitId, body: "Belongs to WU-B" },
      });

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/notes`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(200);

      const notes = await res.json();
      expect(notes).toHaveLength(1);
      expect(notes[0].body).toBe("Belongs to WU-A");
    });
  });

  afterAll(async () => {
    // Properly close database connections
    await prisma.$disconnect();
  });
});
