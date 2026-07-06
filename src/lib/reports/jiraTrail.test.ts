/**
 * Integration tests for getJiraTrail against the test database.
 * Events derive from existing timestamps (no event table): Move-to-QA
 * reports, verification outcomes, story completion comments. Archived cards
 * are included — Move-to-QA archives the cards it reports on.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { getJiraTrail } from "./jiraTrail";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

describe("getJiraTrail", () => {
  it("returns an empty report when there are no events", async () => {
    const report = await getJiraTrail({ projectId: "no-such-project" }, prisma);
    expect(report).toEqual({ events: [] });
  });

  it("merges all three event types, newest first, including archived cards", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports trail", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-TRAIL");
    const story = await prisma.story.create({
      data: {
        jiraKey: key,
        jiraId: `id-${key}`,
        projectKey: "RPT",
        summary: `Story ${key}`,
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/${key}`,
        lastSyncedAt: new Date(),
        completionCommentPostedAt: new Date("2026-07-03T10:00:00.000Z"),
        projectId: project.id,
      },
    });
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "QA-reported card",
          column: "done",
          order: 0,
          movedToQaReportedAt: new Date("2026-07-01T10:00:00.000Z"),
          archivedAt: new Date("2026-07-01T10:00:00.000Z"),
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Verified card",
          column: "code_review",
          order: 1,
          verifiedAt: new Date("2026-07-02T10:00:00.000Z"),
          verificationOutcome: "passed",
        },
      });

      const report = await getJiraTrail({ projectId: project.id }, prisma);

      expect(report.events).toEqual([
        {
          type: "story_completed",
          jiraKey: key,
          detail: `Story ${key}`,
          timestamp: "2026-07-03T10:00:00.000Z",
        },
        {
          type: "verification",
          jiraKey: key,
          detail: "Verified card",
          timestamp: "2026-07-02T10:00:00.000Z",
          outcome: "passed",
        },
        {
          type: "moved_to_qa",
          jiraKey: key,
          detail: "QA-reported card",
          timestamp: "2026-07-01T10:00:00.000Z",
        },
      ]);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("applies the date range to each event's own timestamp", async () => {
    const project = await prisma.project.create({
      data: { name: "Reports trail range", type: "STANDALONE" },
    });
    const key = uniqueKey("RPT-TRAIL-RANGE");
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
          title: "Old QA report",
          column: "done",
          order: 0,
          movedToQaReportedAt: new Date("2026-06-01T10:00:00.000Z"),
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Recent QA report",
          column: "done",
          order: 1,
          movedToQaReportedAt: new Date("2026-07-01T10:00:00.000Z"),
        },
      });

      const report = await getJiraTrail(
        { projectId: project.id, from: new Date("2026-06-15T00:00:00.000Z") },
        prisma
      );

      expect(report.events.map((e) => e.detail)).toEqual(["Recent QA report"]);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
