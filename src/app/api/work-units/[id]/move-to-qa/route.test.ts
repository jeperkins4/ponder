import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/statusTrigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/statusTrigger")>();
  return { ...actual, reportWorkUnitToQA: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/move-to-qa/route";
import { reportWorkUnitToQA } from "@/lib/statusTrigger";

describe("POST /api/work-units/[id]/move-to-qa", () => {
  let workUnitId: string;
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
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task", column: "done", order: 0 },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("returns 200 with transitioned: false and calls reportWorkUnitToQA with the work unit's id", async () => {
    vi.mocked(reportWorkUnitToQA).mockResolvedValueOnce({ ok: true, transitioned: false });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, transitioned: false });
    expect(reportWorkUnitToQA).toHaveBeenCalledWith(workUnitId, expect.anything());
  });

  it("returns 200 with transitioned: true when this was the last sibling reported", async () => {
    vi.mocked(reportWorkUnitToQA).mockResolvedValueOnce({ ok: true, transitioned: true });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, transitioned: true });
  });

  it("returns 422 with the error message when reportWorkUnitToQA reports failure", async () => {
    vi.mocked(reportWorkUnitToQA).mockResolvedValueOnce({
      ok: false,
      error: "JIRA API error: 500",
    });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("JIRA API error");
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "does-not-exist" }),
    });

    expect(res.status).toBe(404);
    expect(reportWorkUnitToQA).not.toHaveBeenCalled();
  });
});
