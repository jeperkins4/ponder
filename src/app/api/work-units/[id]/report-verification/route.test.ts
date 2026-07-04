import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/report-verification/route";

function postWith(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/work-units/[id]/report-verification", () => {
  let workUnitId: string;
  let counter = 0;

  beforeEach(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    counter++;
    const story = await prisma.story.create({
      data: {
        jiraKey: `RPV-${counter}`,
        jiraId: `9400${counter}`,
        projectKey: "RPV",
        summary: "Story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/RPV-${counter}`,
        lastSyncedAt: new Date(),
      },
    });
    const wu = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task",
        column: "code_review",
        order: 0,
        verificationRequestedAt: new Date(),
      },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("records a passed outcome, clears the pending request, and fills empty verification steps", async () => {
    const res = await POST(
      postWith({ outcome: "passed", summary: "Ran the repro steps; screenshot attached.", verificationSteps: "1. npm run dev\n2. Click X" }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verificationOutcome).toBe("passed");
    expect(data.verificationSummary).toBe("Ran the repro steps; screenshot attached.");
    expect(data.verificationRequestedAt).toBeNull();
    expect(data.verifiedAt).not.toBeNull();
    expect(data.verification).toBe("1. npm run dev\n2. Click X");
  });

  it("records a failed outcome", async () => {
    const res = await POST(
      postWith({ outcome: "failed", summary: "Repro still shows the bug." }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verificationOutcome).toBe("failed");
    expect(data.verificationSummary).toBe("Repro still shows the bug.");
  });

  it("does not overwrite existing verification steps", async () => {
    await prisma.workUnit.update({ where: { id: workUnitId }, data: { verification: "Existing steps" } });

    const res = await POST(
      postWith({ outcome: "passed", summary: "ok", verificationSteps: "New steps" }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    const data = await res.json();
    expect(data.verification).toBe("Existing steps");
  });

  it("returns 400 for a missing or invalid outcome", async () => {
    const res = await POST(
      postWith({ outcome: "maybe", summary: "ok" }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/outcome/i);
  });

  it("returns 400 for a missing summary", async () => {
    const res = await POST(
      postWith({ outcome: "passed" }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(
      postWith({ outcome: "passed", summary: "ok" }),
      { params: Promise.resolve({ id: "does-not-exist" }) }
    );

    expect(res.status).toBe(404);
  });
});
