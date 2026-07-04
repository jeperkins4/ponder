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

  it("serializes archivedAt as null for a non-archived work unit", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: `ARCH-${suffix}`,
        jiraId: `ARCH-${suffix}`,
        projectKey: "ARCH",
        summary: "Archive field story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/ARCH-${suffix}`,
        lastSyncedAt: new Date(),
      },
    });
    const workUnit = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Archive field work unit",
        column: "todo",
        order: 1,
      },
    });

    try {
      const req = new NextRequest("http://localhost:3000/api/stories");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      const foundStory = data.find((s: { id: string }) => s.id === story.id);
      expect(foundStory).toBeDefined();
      const foundWorkUnit = foundStory.workUnits.find(
        (wu: { id: string }) => wu.id === workUnit.id
      );
      expect(foundWorkUnit.archivedAt).toBeNull();
      expect(foundWorkUnit.verificationRequestedAt).toBeNull();
      expect(foundWorkUnit.verifiedAt).toBeNull();
      expect(foundWorkUnit.verificationOutcome).toBeNull();
      expect(foundWorkUnit.verificationSummary).toBeNull();
    } finally {
      await prisma.workUnit.delete({ where: { id: workUnit.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("excludes archived work units from a story's workUnits array", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: `ARCHWU-${suffix}`,
        jiraId: `ARCHWU-${suffix}`,
        projectKey: "ARCHWU",
        summary: "Archived work unit story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/ARCHWU-${suffix}`,
        lastSyncedAt: new Date(),
      },
    });
    const activeWU = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Active", column: "done", order: 0 },
    });
    const archivedWU = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Archived", column: "done", order: 1, archivedAt: new Date() },
    });

    try {
      const res = await GET(new NextRequest("http://localhost:3000/api/stories"));
      const data = await res.json();
      const returnedStory = data.find((s: { id: string }) => s.id === story.id);

      const returnedIds = returnedStory.workUnits.map((w: { id: string }) => w.id);
      expect(returnedIds).toContain(activeWU.id);
      expect(returnedIds).not.toContain(archivedWU.id);
    } finally {
      await prisma.workUnit.delete({ where: { id: activeWU.id } });
      await prisma.workUnit.delete({ where: { id: archivedWU.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("excludes a story entirely once every one of its work units is archived", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: `FULLARCH-${suffix}`,
        jiraId: `FULLARCH-${suffix}`,
        projectKey: "FULLARCH",
        summary: "Fully archived story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/FULLARCH-${suffix}`,
        lastSyncedAt: new Date(),
      },
    });
    const archivedWU = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Archived", column: "done", order: 0, archivedAt: new Date() },
    });

    try {
      const res = await GET(new NextRequest("http://localhost:3000/api/stories"));
      const data = await res.json();

      expect(data.find((s: { id: string }) => s.id === story.id)).toBeUndefined();
    } finally {
      await prisma.workUnit.delete({ where: { id: archivedWU.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });
});
