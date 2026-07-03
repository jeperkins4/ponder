import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/statusTrigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/statusTrigger")>();
  return { ...actual, transitionStoryToQA: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/move-to-qa/route";
import { transitionStoryToQA } from "@/lib/statusTrigger";

describe("POST /api/work-units/[id]/move-to-qa", () => {
  let workUnitId: string;
  let storyId: string;
  let counter = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    counter++;
    const story = await prisma.story.create({
      data: {
        jiraKey: `MVQA-${counter}`,
        jiraId: `9200${counter}`,
        projectKey: "MVQA",
        summary: "Story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/MVQA-${counter}`,
        lastSyncedAt: new Date(),
      },
    });
    storyId = story.id;
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task", column: "done", order: 0 },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("returns 200 and calls transitionStoryToQA with the work unit's storyId on success", async () => {
    vi.mocked(transitionStoryToQA).mockResolvedValueOnce({ ok: true });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
    expect(transitionStoryToQA).toHaveBeenCalledWith(storyId, expect.anything());
  });

  it("returns 422 with the error message when transitionStoryToQA reports failure", async () => {
    vi.mocked(transitionStoryToQA).mockResolvedValueOnce({
      ok: false,
      error: "All work units for this story must be Done before moving it to QA",
    });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("must be Done");
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "does-not-exist" }),
    });

    expect(res.status).toBe(404);
    expect(transitionStoryToQA).not.toHaveBeenCalled();
  });
});
