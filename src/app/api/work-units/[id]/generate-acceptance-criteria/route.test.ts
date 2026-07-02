/**
 * Integration tests for the AC/verification generation endpoint.
 * Uses the real test DB; the Claude generator is mocked (no network).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/anthropic/generateAcceptanceCriteria", () => ({
  generateAcceptanceCriteria: vi.fn(async () => ({
    acceptanceCriteria: "Generated AC",
    verification: "Generated verification",
  })),
}));

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/generate-acceptance-criteria/route";
import { generateAcceptanceCriteria } from "@/lib/anthropic/generateAcceptanceCriteria";

describe("POST /api/work-units/[id]/generate-acceptance-criteria", () => {
  let workUnitId: string;
  let counter = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    counter++;
    const story = await prisma.story.create({
      data: {
        jiraKey: `GEN-${counter}`,
        jiraId: `9000${counter}`,
        projectKey: "GEN",
        summary: "Story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/GEN-${counter}`,
        lastSyncedAt: new Date(),
      },
    });
    const wu = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Region Definition",
        description: "Admins assign regions",
        column: "code_review",
        order: 0,
      },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("generates, persists, and returns the AC/verification", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      acceptanceCriteria: "Generated AC",
      verification: "Generated verification",
    });

    // Generator was called with the work unit's title + description.
    expect(generateAcceptanceCriteria).toHaveBeenCalledWith({
      title: "Region Definition",
      description: "Admins assign regions",
    });

    // Persisted.
    const wu = await prisma.workUnit.findUnique({ where: { id: workUnitId } });
    expect(wu?.acceptanceCriteria).toBe("Generated AC");
    expect(wu?.verification).toBe("Generated verification");
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
    expect(generateAcceptanceCriteria).not.toHaveBeenCalled();
  });
});
