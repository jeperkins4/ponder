/**
 * Unit tests for the story status sync service (JIRA write-back).
 * Story/WorkUnit setup uses the real test Postgres via Prisma; JIRA and
 * Claude are mocked via injected `deps`.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import {
  applyStoryStatusSync,
  computeDesiredJiraStatus,
  type ApplyStoryStatusSyncDeps,
} from "./statusTrigger";
import type { JiraTransition } from "@/lib/jira/transitions";

describe("computeDesiredJiraStatus", () => {
  it("returns null when there are no work units", () => {
    expect(computeDesiredJiraStatus([])).toBeNull();
  });

  it("returns null when every work unit is still todo", () => {
    expect(
      computeDesiredJiraStatus([{ column: "todo" }, { column: "todo" }])
    ).toBeNull();
  });

  it('returns "In Progress" when any work unit is in a working lane', () => {
    expect(
      computeDesiredJiraStatus([{ column: "todo" }, { column: "in_progress" }])
    ).toBe("In Progress");

    expect(
      computeDesiredJiraStatus([{ column: "todo" }, { column: "code_review" }])
    ).toBe("In Progress");
  });

  it('returns "Code Revew" when every work unit is done', () => {
    expect(
      computeDesiredJiraStatus([{ column: "done" }, { column: "done" }])
    ).toBe("Code Revew");
  });
});

describe("applyStoryStatusSync", () => {
  let testCounter = 0;

  beforeEach(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    await prisma.project.deleteMany({});
    testCounter++;
  });

  async function makeJiraProject() {
    return prisma.project.create({
      data: {
        name: `Test Project ${testCounter}`,
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "user@example.com",
        jiraApiToken: "token-123",
      },
    });
  }

  async function makeStory(overrides: Partial<Parameters<typeof prisma.story.create>[0]["data"]> = {}) {
    return prisma.story.create({
      data: {
        jiraKey: `TEAM-${testCounter}`,
        jiraId: `9000${testCounter}`,
        projectKey: "TEAM",
        summary: "Test story",
        description: "A test story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/TEAM-${testCounter}`,
        lastSyncedAt: new Date(),
        ...overrides,
      },
    });
  }

  function fakeDeps(overrides: Partial<ApplyStoryStatusSyncDeps> = {}): ApplyStoryStatusSyncDeps {
    return {
      getTransitions: vi.fn(async (): Promise<JiraTransition[]> => [
        { id: "11", name: "Start Progress", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
        { id: "21", name: "Send to Review", to: { name: "Code Revew", statusCategory: { key: "indeterminate" } } },
      ]),
      transitionIssue: vi.fn(async () => {}),
      addComment: vi.fn(async () => {}),
      summarizeCompletedWork: vi.fn(async () => "Claude summary of the completed work."),
      ...overrides,
    };
  }

  it("transitions to In Progress with no comment when the first card leaves To Do", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "To Do" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "in_progress", order: 0 },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "todo", order: 1 },
    });

    const deps = fakeDeps();
    const result = await applyStoryStatusSync(story.id, prisma, deps);

    expect(result.transitioned).toBe(true);
    expect(result.commented).toBe(false);
    expect(deps.transitionIssue).toHaveBeenCalledWith(story.jiraKey, "11", expect.any(Object));
    expect(deps.addComment).not.toHaveBeenCalled();

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("In Progress");
    expect(updated?.completionCommentPostedAt).toBeNull();
  });

  it("transitions to Code Revew and posts a comment with the summary and work-unit titles when all cards are done", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "In Progress" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "done", order: 1 },
    });

    const deps = fakeDeps();
    const result = await applyStoryStatusSync(story.id, prisma, deps);

    expect(result.transitioned).toBe(true);
    expect(result.commented).toBe(true);
    expect(deps.transitionIssue).toHaveBeenCalledWith(story.jiraKey, "21", expect.any(Object));
    expect(deps.addComment).toHaveBeenCalledTimes(1);

    const [, commentBody] = (deps.addComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(commentBody).toContain("Claude summary of the completed work.");
    expect(commentBody).toContain("• Task 1");
    expect(commentBody).toContain("• Task 2");

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("Code Revew");
    expect(updated?.completionCommentPostedAt).not.toBeNull();
  });

  it("does nothing when the story is already at the desired status", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "In Progress" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "in_progress", order: 0 },
    });

    const deps = fakeDeps();
    const result = await applyStoryStatusSync(story.id, prisma, deps);

    expect(result.transitioned).toBe(false);
    expect(result.commented).toBe(false);
    expect(deps.getTransitions).not.toHaveBeenCalled();
    expect(deps.transitionIssue).not.toHaveBeenCalled();
  });

  it("does nothing when every card is still todo", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "To Do" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "todo", order: 0 },
    });

    const deps = fakeDeps();
    const result = await applyStoryStatusSync(story.id, prisma, deps);

    expect(result.transitioned).toBe(false);
    expect(deps.getTransitions).not.toHaveBeenCalled();

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("To Do");
  });

  it("does not throw and makes no local change when no matching transition exists", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "To Do" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "in_progress", order: 0 },
    });

    const deps = fakeDeps({ getTransitions: vi.fn(async () => []) });

    const result = await applyStoryStatusSync(story.id, prisma, deps);

    expect(result.transitioned).toBe(false);
    expect(result.warning).toBeTruthy();
    expect(deps.transitionIssue).not.toHaveBeenCalled();

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("To Do");
  });

  it("does not throw when getTransitions rejects", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "To Do" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "in_progress", order: 0 },
    });

    const deps = fakeDeps({
      getTransitions: vi.fn(async () => {
        throw new Error("network down");
      }),
    });

    await expect(applyStoryStatusSync(story.id, prisma, deps)).resolves.toMatchObject({
      transitioned: false,
      commented: false,
    });

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("To Do");
  });

  it("does not throw when transitionIssue rejects", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "To Do" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "in_progress", order: 0 },
    });

    const deps = fakeDeps({
      transitionIssue: vi.fn(async () => {
        throw new Error("JIRA down");
      }),
    });

    await expect(applyStoryStatusSync(story.id, prisma, deps)).resolves.toMatchObject({
      transitioned: false,
    });

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("To Do");
  });

  it("does not re-post the completion comment when completionCommentPostedAt is already set", async () => {
    const project = await makeJiraProject();
    const alreadyPosted = new Date("2026-01-01T00:00:00Z");
    const story = await makeStory({
      projectId: project.id,
      jiraStatus: "In Progress",
      completionCommentPostedAt: alreadyPosted,
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const deps = fakeDeps();
    const result = await applyStoryStatusSync(story.id, prisma, deps);

    expect(result.transitioned).toBe(true);
    expect(result.commented).toBe(false);
    expect(deps.addComment).not.toHaveBeenCalled();

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("Code Revew");
    expect(updated?.completionCommentPostedAt?.toISOString()).toBe(alreadyPosted.toISOString());
  });

  it("warns and returns without writing back when the project has no JIRA credentials configured", async () => {
    const project = await prisma.project.create({
      data: { name: "Standalone project", type: "STANDALONE" },
    });
    const story = await makeStory({ projectId: project.id, jiraStatus: "To Do" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "in_progress", order: 0 },
    });

    const deps = fakeDeps();
    const result = await applyStoryStatusSync(story.id, prisma, deps);

    expect(result.transitioned).toBe(false);
    expect(result.warning).toBeTruthy();
    expect(deps.getTransitions).not.toHaveBeenCalled();
  });

  it("does not throw for a non-existent story", async () => {
    const deps = fakeDeps();
    await expect(
      applyStoryStatusSync("non-existent-id", prisma, deps)
    ).resolves.toMatchObject({ transitioned: false, commented: false });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
