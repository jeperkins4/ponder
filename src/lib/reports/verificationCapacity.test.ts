/**
 * Integration tests for getVerificationCapacity against the test database.
 * Deterministic windows always passed explicitly (from/to) except the
 * empty-report case. Bucketing mirrors trends: daily <=35-day span, else weekly.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { getVerificationCapacity } from "./verificationCapacity";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createProject() {
  return prisma.project.create({
    data: { name: `VCap ${Date.now()}-${Math.random()}`, type: "STANDALONE" },
  });
}

async function createStory(projectId: string) {
  const key = uniqueKey("VCAP");
  return prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "VCAP",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
      projectId,
    },
  });
}

async function cleanup(projectId: string) {
  await prisma.workUnit.deleteMany({ where: { story: { projectId } } });
  await prisma.story.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });
}

describe("getVerificationCapacity", () => {
  it("returns an empty report when the project has no cards", async () => {
    const project = await createProject();
    try {
      const report = await getVerificationCapacity(
        { projectId: project.id },
        prisma
      );
      expect(report.buckets).toEqual([]);
      expect(report.capacityRatio).toBeNull();
      expect(report.verifiedCompletionRate).toBeNull();
    } finally {
      await cleanup(project.id);
    }
  });

  it("buckets generated and verified counts and computes the capacity ratio", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      // Two cards generated July 1; one verified July 2, requested July 1.
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Verified card",
          column: "code_review",
          order: 0,
          createdAt: new Date("2026-07-01T10:00:00.000Z"),
          verificationRequestedAt: new Date("2026-07-01T12:00:00.000Z"),
          verifiedAt: new Date("2026-07-02T12:00:00.000Z"),
          verificationOutcome: "passed",
        },
      });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Unverified card",
          column: "in_progress",
          order: 1,
          createdAt: new Date("2026-07-01T11:00:00.000Z"),
        },
      });

      const report = await getVerificationCapacity(
        {
          projectId: project.id,
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-03T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.granularity).toBe("day");
      expect(report.buckets).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
      expect(report.generated).toEqual([2, 0, 0]);
      expect(report.verified).toEqual([0, 1, 0]);
      expect(report.totalGenerated).toBe(2);
      expect(report.totalVerified).toBe(1);
      expect(report.capacityRatio).toBe(0.5);
      // Requested July 1 12:00, verified July 2 12:00 -> in the queue at
      // the end of July 1 only.
      expect(report.queueDepth).toEqual([1, 0, 0]);
      // Lag: exactly 1 day.
      expect(report.avgVerificationLagDays).toBe(1);
      expect(report.medianVerificationLagDays).toBe(1);
    } finally {
      await cleanup(project.id);
    }
  });

  it("keeps a never-verified request in the queue and out of lag stats", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Stuck in queue",
          column: "code_review",
          order: 0,
          createdAt: new Date("2026-07-01T09:00:00.000Z"),
          verificationRequestedAt: new Date("2026-07-01T10:00:00.000Z"),
        },
      });

      const report = await getVerificationCapacity(
        {
          projectId: project.id,
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-03T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.queueDepth).toEqual([1, 1, 1]);
      expect(report.totalVerified).toBe(0);
      expect(report.capacityRatio).toBe(0);
      expect(report.avgVerificationLagDays).toBeNull();
    } finally {
      await cleanup(project.id);
    }
  });

  it("drops archived cards from the queue at the archive date", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Archived while awaiting",
          column: "code_review",
          order: 0,
          createdAt: new Date("2026-07-01T09:00:00.000Z"),
          verificationRequestedAt: new Date("2026-07-01T10:00:00.000Z"),
          archivedAt: new Date("2026-07-02T10:00:00.000Z"),
        },
      });

      const report = await getVerificationCapacity(
        {
          projectId: project.id,
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-03T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.queueDepth).toEqual([1, 0, 0]);
    } finally {
      await cleanup(project.id);
    }
  });

  it("computes the verified-completion rate over cards completed in the window", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      // Completed with a passed verification.
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Verified completion",
          column: "done",
          order: 0,
          createdAt: new Date("2026-07-01T09:00:00.000Z"),
          completedAt: new Date("2026-07-02T09:00:00.000Z"),
          verificationRequestedAt: new Date("2026-07-01T10:00:00.000Z"),
          verifiedAt: new Date("2026-07-01T20:00:00.000Z"),
          verificationOutcome: "passed",
        },
      });
      // Completed with no verification at all — accountability debt.
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Unverified completion",
          column: "done",
          order: 1,
          createdAt: new Date("2026-07-01T09:00:00.000Z"),
          completedAt: new Date("2026-07-02T10:00:00.000Z"),
        },
      });
      // Completed outside the window — excluded.
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Out of window",
          column: "done",
          order: 2,
          createdAt: new Date("2026-06-01T09:00:00.000Z"),
          completedAt: new Date("2026-06-02T09:00:00.000Z"),
          verificationOutcome: "passed",
        },
      });

      const report = await getVerificationCapacity(
        {
          projectId: project.id,
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-03T23:59:59.000Z"),
        },
        prisma
      );

      expect(report.completedInWindow).toBe(2);
      expect(report.completedVerified).toBe(1);
      expect(report.verifiedCompletionRate).toBe(0.5);
    } finally {
      await cleanup(project.id);
    }
  });

  it("switches to weekly buckets beyond a 35-day span", async () => {
    const project = await createProject();
    const story = await createStory(project.id);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Old card",
          column: "todo",
          order: 0,
          createdAt: new Date("2026-05-05T10:00:00.000Z"),
        },
      });

      const report = await getVerificationCapacity(
        {
          projectId: project.id,
          from: new Date("2026-05-01T00:00:00.000Z"),
          to: new Date("2026-07-01T00:00:00.000Z"),
        },
        prisma
      );

      expect(report.granularity).toBe("week");
      // 2026-05-01 falls in the Monday-start week of 2026-04-27.
      expect(report.buckets[0]).toBe("2026-04-27");
    } finally {
      await cleanup(project.id);
    }
  });
});
