/**
 * Integration tests for GET /api/stories
 * Tests actual Prisma client against test database.
 *
 * Story is a table shared with other test files (work-units.test.ts,
 * projects/route.test.ts, move.test.ts) that may run in the same suite, so
 * these tests avoid blanket deleteMany and instead create/clean up their own
 * uniquely-keyed rows, matching the pattern in
 * src/app/api/projects/route.test.ts.
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

describe("GET /api/stories", () => {
  it("filters stories by ?projectId=", async () => {
    const project = await prisma.project.create({
      data: { name: "Filter Test Project", type: "STANDALONE" },
    });
    const otherProject = await prisma.project.create({
      data: { name: "Other Project", type: "STANDALONE" },
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const inProject = await prisma.story.create({
      data: {
        jiraKey: `FILT-${suffix}-1`,
        jiraId: `FILT-${suffix}-1`,
        projectKey: "FILT",
        summary: "In project story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/FILT-${suffix}-1`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    const inOtherProject = await prisma.story.create({
      data: {
        jiraKey: `FILT-${suffix}-2`,
        jiraId: `FILT-${suffix}-2`,
        projectKey: "FILT",
        summary: "Other project story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/FILT-${suffix}-2`,
        lastSyncedAt: new Date(),
        projectId: otherProject.id,
      },
    });

    try {
      const req = new NextRequest(
        `http://localhost:3000/api/stories?projectId=${project.id}`
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(inProject.id);
      expect(data.find((s: { id: string }) => s.id === inOtherProject.id)).toBeUndefined();
    } finally {
      await prisma.story.delete({ where: { id: inProject.id } });
      await prisma.story.delete({ where: { id: inOtherProject.id } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.project.delete({ where: { id: otherProject.id } });
    }
  });

  it("returns all stories (including unfiltered ones) when no ?projectId= is given", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: `NOFILT-${suffix}`,
        jiraId: `NOFILT-${suffix}`,
        projectKey: "NOFILT",
        summary: "No filter story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/NOFILT-${suffix}`,
        lastSyncedAt: new Date(),
      },
    });

    try {
      const req = new NextRequest("http://localhost:3000/api/stories");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.some((s: { id: string }) => s.id === story.id)).toBe(true);
    } finally {
      await prisma.story.delete({ where: { id: story.id } });
    }
  });
});
