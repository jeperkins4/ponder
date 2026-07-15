import { describe, it, expect, vi } from "vitest";
import { PonderClient } from "./client";
import type { AttachmentDTO, ProjectWithStats, StoryDTO, WorkUnitDTO } from "@/lib/types";

function fakeFetch(response: {
  ok: boolean;
  status?: number;
  json?: unknown;
}) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.json,
  })) as unknown as typeof fetch;
}

describe("PonderClient", () => {
  const baseUrl = "http://localhost:3000";

  it("getProjects() requests GET <base>/api/projects and returns the parsed array", async () => {
    const projects: ProjectWithStats[] = [
      {
        id: "p1",
        name: "Project One",
        type: "STANDALONE",
        createdAt: new Date(),
        updatedAt: new Date(),
        hasApiToken: false,
        storyCount: 0,
        workUnitCount: 0,
      },
    ];
    const fetchImpl = fakeFetch({ ok: true, json: projects });
    const client = new PonderClient(baseUrl, fetchImpl);

    const result = await client.getProjects();

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual(projects);
  });

  it("getStories('p1') requests .../api/stories?projectId=p1", async () => {
    const stories: StoryDTO[] = [];
    const fetchImpl = fakeFetch({ ok: true, json: stories });
    const client = new PonderClient(baseUrl, fetchImpl);

    const result = await client.getStories("p1");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/stories?projectId=p1`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual(stories);
  });

  it("getEpics('p1') requests GET .../jira/epics and unwraps .epics", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: { epics: [{ key: "TEAM-1", name: "Big epic" }] },
    });
    const client = new PonderClient(baseUrl, fetchImpl);

    const result = await client.getEpics("p1");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/p1/jira/epics`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual([{ key: "TEAM-1", name: "Big epic" }]);
  });

  it("previewEpicImport('p1','TEAM-1') POSTs {epicKey} to the preview endpoint", async () => {
    const preview = { stories: [] };
    const fetchImpl = fakeFetch({ ok: true, json: preview });
    const client = new PonderClient(baseUrl, fetchImpl);

    const result = await client.previewEpicImport("p1", "TEAM-1");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/p1/import/preview`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ epicKey: "TEAM-1" }),
      })
    );
    expect(result).toEqual(preview);
  });

  it("processEpicImport posts items + epicKey + epicName when epicName is provided", async () => {
    const processResult = { storiesProcessed: 1, storiesSkipped: 0, workUnitsCreated: 1 };
    const fetchImpl = fakeFetch({ ok: true, json: processResult });
    const client = new PonderClient(baseUrl, fetchImpl);
    const items = [
      {
        jiraKey: "TEAM-101",
        jiraId: "10101",
        summary: "S",
        description: null,
        jiraStatus: "To Do",
        breakDown: false,
      },
    ];

    const result = await client.processEpicImport("p1", items, "TEAM-1", "Big epic");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/p1/import/process`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items, epicKey: "TEAM-1", epicName: "Big epic" }),
      })
    );
    expect(result).toEqual(processResult);
  });

  it("processEpicImport omits epicName from the body when not provided", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: { storiesProcessed: 0, storiesSkipped: 0, workUnitsCreated: 0 },
    });
    const client = new PonderClient(baseUrl, fetchImpl);

    await client.processEpicImport("p1", [], "TEAM-1");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/p1/import/process`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items: [], epicKey: "TEAM-1" }),
      })
    );
  });

  it("moveWorkUnit('w1','done') POSTs {column:'done', order:0} and returns the DTO", async () => {
    const workUnit: WorkUnitDTO = {
      id: "w1",
      storyId: "s1",
      title: "Title",
      description: null,
      acceptanceCriteria: null,
      verification: null,
      column: "done",
      order: 0,
      subNumber: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      archivedAt: null,
      movedToQaReportedAt: null,
      verificationRequestedAt: null,
      verifiedAt: null,
      verificationOutcome: null,
      verificationSummary: null,
    };
    const fetchImpl = fakeFetch({ ok: true, json: workUnit });
    const client = new PonderClient(baseUrl, fetchImpl);

    const result = await client.moveWorkUnit("w1", "done");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/work-units/w1/move`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ column: "done", order: 0 }),
      })
    );
    expect(result).toEqual(workUnit);
  });

  it("moveWorkUnit accepts an explicit order", async () => {
    const workUnit: WorkUnitDTO = {
      id: "w1",
      storyId: "s1",
      title: "Title",
      description: null,
      acceptanceCriteria: null,
      verification: null,
      column: "in_progress",
      order: 3,
      subNumber: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      archivedAt: null,
      movedToQaReportedAt: null,
      verificationRequestedAt: null,
      verifiedAt: null,
      verificationOutcome: null,
      verificationSummary: null,
    };
    const fetchImpl = fakeFetch({ ok: true, json: workUnit });
    const client = new PonderClient(baseUrl, fetchImpl);

    await client.moveWorkUnit("w1", "in_progress", 3);

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/work-units/w1/move`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ column: "in_progress", order: 3 }),
      })
    );
  });

  it("updateWorkUnit('w1',{title:'x'}) PATCHes .../api/work-units/w1", async () => {
    const workUnit: WorkUnitDTO = {
      id: "w1",
      storyId: "s1",
      title: "x",
      description: null,
      acceptanceCriteria: null,
      verification: null,
      column: "todo",
      order: 0,
      subNumber: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      archivedAt: null,
      movedToQaReportedAt: null,
      verificationRequestedAt: null,
      verifiedAt: null,
      verificationOutcome: null,
      verificationSummary: null,
    };
    const fetchImpl = fakeFetch({ ok: true, json: workUnit });
    const client = new PonderClient(baseUrl, fetchImpl);

    const result = await client.updateWorkUnit("w1", { title: "x" });

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/work-units/w1`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "x" }),
      })
    );
    expect(result).toEqual(workUnit);
  });

  it("regenerateAcceptance POSTs the context to the generate endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ acceptanceCriteria: "- a", verification: "run t" }),
      } as Response;
    }) as unknown as typeof fetch;

    const client = new PonderClient("http://ponder.test", fakeFetch);
    const result = await client.regenerateAcceptance("wu1", '{"domain":"Projects"}');

    expect(result).toEqual({ acceptanceCriteria: "- a", verification: "run t" });
    expect(calls[0].url).toBe(
      "http://ponder.test/api/work-units/wu1/generate-acceptance-criteria"
    );
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      codebaseContext: '{"domain":"Projects"}',
    });
  });

  it("regenerateAcceptance POSTs an empty body when no context is provided", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ acceptanceCriteria: "- a", verification: "run t" }),
      } as Response;
    }) as unknown as typeof fetch;

    const client = new PonderClient("http://ponder.test", fakeFetch);
    await client.regenerateAcceptance("wu1");

    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({});
  });

  it("throws with a message containing the status on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 404, json: {} });
    const client = new PonderClient(baseUrl, fetchImpl);

    await expect(client.getProjects()).rejects.toThrow(/404/);
  });

  it("addAttachment() POSTs a multipart body with the file to the attachments endpoint", async () => {
    const attachment: AttachmentDTO = {
      id: "a1",
      workUnitId: "w1",
      filename: "screenshot.png",
      mimeType: "image/png",
      size: 4,
      createdAt: "2026-07-02T00:00:00.000Z",
      jiraUploadedAt: null,
      url: "/api/attachments/a1",
    };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => attachment,
      } as Response;
    }) as unknown as typeof fetch;

    const client = new PonderClient("http://ponder.test", fetchImpl);
    const result = await client.addAttachment(
      "w1",
      Buffer.from("fake-bytes"),
      "screenshot.png",
      "image/png"
    );

    expect(result).toEqual(attachment);
    expect(calls[0].url).toBe(
      "http://ponder.test/api/work-units/w1/attachments"
    );
    expect(calls[0].init.method).toBe("POST");

    const body = calls[0].init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const file = body.get("file") as File;
    expect(file.name).toBe("screenshot.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(10);
  });

  it("addAttachment() throws with a message containing the status on a non-2xx response", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 413,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const client = new PonderClient("http://ponder.test", fetchImpl);

    await expect(
      client.addAttachment("w1", Buffer.from("x"), "big.png", "image/png")
    ).rejects.toThrow(/413/);
  });

  describe("reportVerification", () => {
    it("POSTs outcome/summary/verificationSteps and returns the updated work unit", async () => {
      const workUnit = { id: "w1", verificationOutcome: "passed" } as WorkUnitDTO;
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => workUnit,
      })) as unknown as typeof fetch;

      const client = new PonderClient("http://localhost:3000", fetchMock);
      const result = await client.reportVerification("w1", "passed", "Looks good", "1. Run it");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:3000/api/work-units/w1/report-verification",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ outcome: "passed", summary: "Looks good", verificationSteps: "1. Run it" }),
        })
      );
      expect(result).toEqual(workUnit);
    });
  });

  it("respects a custom baseUrl", async () => {
    const customBase = "http://example.com:9999";
    const fetchImpl = fakeFetch({ ok: true, json: [] });
    const client = new PonderClient(customBase, fetchImpl);

    await client.getProjects();

    expect(fetchImpl).toHaveBeenCalledWith(
      `${customBase}/api/projects`,
      expect.objectContaining({ method: "GET" })
    );
  });
});
