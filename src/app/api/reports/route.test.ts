/**
 * Integration tests for GET /api/reports against the test database.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

describe("GET /api/reports", () => {
  it("returns all four sections", async () => {
    const req = new Request("http://localhost:3000/api/reports");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("completedWork.stories");
    expect(data).toHaveProperty("throughput.weeks");
    expect(data).toHaveProperty("statusSnapshot.columnTotals");
    expect(data).toHaveProperty("jiraTrail.events");
  });

  it("returns 400 for an invalid from date", async () => {
    const req = new Request("http://localhost:3000/api/reports?from=not-a-date");
    const res = await GET(req as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("from");
  });

  it("returns 400 for an invalid to date", async () => {
    const req = new Request("http://localhost:3000/api/reports?to=bogus");
    const res = await GET(req as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("to");
  });

  it("returns 400 when from is after to", async () => {
    const req = new Request(
      "http://localhost:3000/api/reports?from=2026-07-05&to=2026-07-01"
    );
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  it("returns empty sections for an unknown projectId", async () => {
    const req = new Request(
      "http://localhost:3000/api/reports?projectId=no-such-project"
    );
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.completedWork.totalCards).toBe(0);
    expect(data.statusSnapshot.stories).toEqual([]);
    expect(data.jiraTrail.events).toEqual([]);
  });

  it("passes projectId and range through to the queries", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports route", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-ROUTE");
    const story = await prisma.story.create({
      data: {
        jiraKey: key,
        jiraId: `id-${key}`,
        projectKey: "RPT",
        summary: `Story ${key}`,
        jiraStatus: "In Progress",
        url: `https://example.atlassian.net/browse/${key}`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Completed card",
          column: "done",
          order: 0,
          createdAt: new Date("2026-06-30T00:00:00.000Z"),
          completedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      });

      const req = new Request(
        `http://localhost:3000/api/reports?projectId=${project.id}&from=2026-06-29T00:00:00.000Z&to=2026-07-05T23:59:59.000Z`
      );
      const res = await GET(req as never);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.completedWork.totalCards).toBe(1);
      expect(data.completedWork.stories[0].jiraKey).toBe(key);
      expect(data.throughput.totalCompleted).toBe(1);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("includes a trends section with parallel arrays", async () => {
    const req = new Request("http://localhost:3000/api/reports?projectId=no-such-project");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trends).toBeDefined();
    expect(["day", "week"]).toContain(data.trends.granularity);
    const n = data.trends.buckets.length;
    expect(data.trends.created).toHaveLength(n);
    expect(data.trends.completed).toHaveLength(n);
    expect(data.trends.cumulativeCompleted).toHaveLength(n);
    expect(data.trends.wip).toHaveLength(n);
    expect(data.trends.activity.movedToQa).toHaveLength(n);
    expect(data.trends.activity.verifications).toHaveLength(n);
    expect(data.trends.activity.storyCompletions).toHaveLength(n);
  });
});
