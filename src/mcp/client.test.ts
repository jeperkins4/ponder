import { describe, it, expect, vi } from "vitest";
import { PonderClient } from "./client";
import type { ProjectWithStats, StoryDTO, WorkUnitDTO } from "@/lib/types";

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

  it("throws with a message containing the status on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 404, json: {} });
    const client = new PonderClient(baseUrl, fetchImpl);

    await expect(client.getProjects()).rejects.toThrow(/404/);
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
