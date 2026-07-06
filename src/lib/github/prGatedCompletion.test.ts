/**
 * Integration tests for applyPrGatedCompletion: real test database, stubbed
 * PR fetcher and story-sync trigger (deps injection). GITHUB_TOKEN is
 * stubbed per test via vi.stubEnv.
 */

import { describe, it, expect, vi, afterEach, type Mocked } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyPrGatedCompletion, type PrGateDeps } from "./prGatedCompletion";
import type { PrSummary } from "./client";

afterEach(() => {
  vi.unstubAllEnvs();
});

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function pr(overrides: Partial<PrSummary>): PrSummary {
  return {
    number: 7,
    title: "t",
    headRef: "b",
    state: "open",
    merged: false,
    url: "https://github.com/o/r/pull/7",
    ...overrides,
  };
}

function makeDeps(
  prsByRepo: Record<string, PrSummary[] | { warning: string }>
): Mocked<PrGateDeps> {
  return {
    fetchPrs: vi.fn(async (repo: string, _token: string) => prsByRepo[repo] ?? []),
    applyStorySync: vi.fn(
      async (_storyId: string, _prismaClient: PrismaClient): Promise<unknown> => ({
        transitioned: false,
        commented: false,
      })
    ),
  };
}

async function createProjectWithStory(opts: {
  githubRepos?: string | null;
  columns: string[]; // one active card per entry
}) {
  const project = await prisma.project.create({
    data: {
      name: `PRGate ${Date.now()}`,
      type: "JIRA",
      jiraProjectKey: "PRG",
      githubRepos: opts.githubRepos ?? null,
    },
  });
  const key = uniqueKey("PRG");
  const story = await prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "PRG",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
      projectId: project.id,
    },
  });
  for (const [i, column] of opts.columns.entries()) {
    await prisma.workUnit.create({
      data: { storyId: story.id, title: `Card ${i}`, column, order: i },
    });
  }
  return { project, story, key };
}

async function cleanup(projectId: string, storyId: string) {
  await prisma.workNote.deleteMany({ where: { workUnit: { storyId } } });
  await prisma.workUnit.deleteMany({ where: { storyId } });
  await prisma.story.delete({ where: { id: storyId } });
  await prisma.project.delete({ where: { id: projectId } });
}

describe("applyPrGatedCompletion", () => {
  it("silently returns zeros when the project has no githubRepos", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story } = await createProjectWithStory({ columns: ["todo"] });
    const deps = makeDeps({});
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result).toEqual({ cardsCompleted: 0, storiesCompleted: 0, warnings: [] });
      expect(deps.fetchPrs).not.toHaveBeenCalled();
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("silently returns zeros when GITHUB_TOKEN is unset", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const { project, story } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["todo"],
    });
    const deps = makeDeps({});
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result).toEqual({ cardsCompleted: 0, storiesCompleted: 0, warnings: [] });
      expect(deps.fetchPrs).not.toHaveBeenCalled();
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("skips the GitHub calls entirely when there are no candidate stories", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["done"], // all cards already done -> not a candidate
    });
    const deps = makeDeps({});
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result.cardsCompleted).toBe(0);
      expect(deps.fetchPrs).not.toHaveBeenCalled();
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("completes a matched story: cards to done + completedAt + work notes + one story sync", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story, key } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["todo", "in_progress"],
    });
    const deps = makeDeps({
      "o/r": [pr({ number: 42, headRef: `feature/${key}-x`, url: "https://github.com/o/r/pull/42" })],
    });
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);

      expect(result.cardsCompleted).toBe(2);
      expect(result.storiesCompleted).toBe(1);
      expect(result.warnings).toEqual([]);

      const units = await prisma.workUnit.findMany({
        where: { storyId: story.id },
        include: { workNotes: true },
        orderBy: { order: "asc" },
      });
      for (const unit of units) {
        expect(unit.column).toBe("done");
        expect(unit.completedAt).not.toBeNull();
        expect(unit.workNotes.map((n) => n.body)).toContain(
          "Completed by PR #42: https://github.com/o/r/pull/42"
        );
      }
      expect(deps.applyStorySync).toHaveBeenCalledTimes(1);
      // Not toHaveBeenCalledWith(story.id, prisma): vitest pretty-prints the
      // expected args eagerly, and loupe infinite-recurses on the
      // PrismaClient proxy while formatting the (unused, since this passes)
      // failure message. Assert the recorded args by reference instead —
      // same intent, no stack overflow.
      const [syncedStoryId, syncedClient] = deps.applyStorySync.mock.calls[0];
      expect(syncedStoryId).toBe(story.id);
      expect(syncedClient).toBe(prisma);
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("leaves non-matching stories untouched", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["todo"],
    });
    const deps = makeDeps({ "o/r": [pr({ headRef: "feature/OTHER-1" })] });
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result.cardsCompleted).toBe(0);
      const unit = await prisma.workUnit.findFirst({ where: { storyId: story.id } });
      expect(unit?.column).toBe("todo");
      expect(deps.applyStorySync).not.toHaveBeenCalled();
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("propagates per-repo warnings and still processes good repos", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story, key } = await createProjectWithStory({
      githubRepos: "bad/repo, o/r",
      columns: ["todo"],
    });
    const deps = makeDeps({
      "bad/repo": { warning: "bad/repo: 404 Not Found" },
      "o/r": [pr({ headRef: key })],
    });
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result.warnings).toEqual(["bad/repo: 404 Not Found"]);
      expect(result.cardsCompleted).toBe(1);
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("is a no-op on re-run (idempotent)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story, key } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["todo"],
    });
    const deps = makeDeps({ "o/r": [pr({ headRef: key })] });
    try {
      const first = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(first.cardsCompleted).toBe(1);

      const second = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(second.cardsCompleted).toBe(0);
      expect(second.storiesCompleted).toBe(0);

      const notes = await prisma.workNote.findMany({
        where: { workUnit: { storyId: story.id } },
      });
      expect(notes).toHaveLength(1); // no duplicate note from the re-run
    } finally {
      await cleanup(project.id, story.id);
    }
  });
});
