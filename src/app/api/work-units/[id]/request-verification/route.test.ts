import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/request-verification/route";

describe("POST /api/work-units/[id]/request-verification", () => {
  let workUnitId: string;
  let counter = 0;

  beforeEach(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    counter++;
    const story = await prisma.story.create({
      data: {
        jiraKey: `RQV-${counter}`,
        jiraId: `9300${counter}`,
        projectKey: "RQV",
        summary: "Story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/RQV-${counter}`,
        lastSyncedAt: new Date(),
      },
    });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task", column: "code_review", order: 0 },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("sets verificationRequestedAt and clears any prior result", async () => {
    await prisma.workUnit.update({
      where: { id: workUnitId },
      data: {
        verifiedAt: new Date(),
        verificationOutcome: "failed",
        verificationSummary: "old run",
      },
    });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verificationRequestedAt).not.toBeNull();
    expect(data.verifiedAt).toBeNull();
    expect(data.verificationOutcome).toBeNull();
    expect(data.verificationSummary).toBeNull();
  });

  it("returns 422 when the work unit is not in code_review", async () => {
    await prisma.workUnit.update({ where: { id: workUnitId }, data: { column: "in_progress" } });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/code review/i);
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "does-not-exist" }),
    });

    expect(res.status).toBe(404);
  });
});
