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
  computeStoryQaReadiness,
  transitionStoryToQA,
  reportWorkUnitToQA,
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

describe("computeStoryQaReadiness", () => {
  it("returns false when there are no work units", () => {
    expect(computeStoryQaReadiness([])).toBe(false);
  });

  it("returns false when any work unit isn't done", () => {
    expect(
      computeStoryQaReadiness([
        { column: "done", movedToQaReportedAt: new Date() },
        { column: "code_review", movedToQaReportedAt: null },
      ])
    ).toBe(false);
  });

  it("returns false when any done work unit hasn't been reported", () => {
    expect(
      computeStoryQaReadiness([
        { column: "done", movedToQaReportedAt: new Date() },
        { column: "done", movedToQaReportedAt: null },
      ])
    ).toBe(false);
  });

  it("returns true when every work unit is done and reported", () => {
    expect(
      computeStoryQaReadiness([
        { column: "done", movedToQaReportedAt: new Date() },
        { column: "done", movedToQaReportedAt: new Date() },
      ])
    ).toBe(true);
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
      uploadAttachment: vi.fn(async () => {}),
      consolidateAcceptanceCriteria: vi.fn(async () => ({ acceptanceCriteria: "", verification: "" })),
      readAttachmentFile: vi.fn(async () => Buffer.from("fake bytes")),
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

  describe("completion comment: consolidated AC/verification + attachments", () => {
    it("includes consolidated Acceptance Criteria and Verification sections and uploads each work unit's attachments", async () => {
      const project = await makeJiraProject();
      const story = await makeStory({ projectId: project.id, jiraStatus: "In Progress" });
      const wu1 = await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Task 1",
          column: "done",
          order: 0,
          acceptanceCriteria: "AC for task 1",
          verification: "Verify task 1",
        },
      });
      const wu2 = await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Task 2",
          column: "done",
          order: 1,
          acceptanceCriteria: "AC for task 2",
          verification: "Verify task 2",
        },
      });
      await prisma.attachment.create({
        data: { workUnitId: wu1.id, filename: "screenshot1.png", mimeType: "image/png", size: 100 },
      });
      await prisma.attachment.create({
        data: { workUnitId: wu2.id, filename: "screenshot2.png", mimeType: "image/png", size: 200 },
      });

      const deps = fakeDeps({
        consolidateAcceptanceCriteria: vi.fn(async () => ({
          acceptanceCriteria: "Consolidated AC across both tasks.",
          verification: "Consolidated verification across both tasks.",
        })),
      });

      const result = await applyStoryStatusSync(story.id, prisma, deps);

      expect(result.transitioned).toBe(true);
      expect(result.commented).toBe(true);

      const [, commentBody] = (deps.addComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(commentBody).toContain("Acceptance Criteria");
      expect(commentBody).toContain("Consolidated AC across both tasks.");
      expect(commentBody).toContain("Verification");
      expect(commentBody).toContain("Consolidated verification across both tasks.");

      expect(deps.uploadAttachment).toHaveBeenCalledTimes(2);
      const uploadedFilenames = (deps.uploadAttachment as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[1].filename
      );
      expect(uploadedFilenames.sort()).toEqual(["screenshot1.png", "screenshot2.png"]);

      const updated = await prisma.story.findUnique({ where: { id: story.id } });
      expect(updated?.jiraStatus).toBe("Code Revew");
    });

    it("omits the Acceptance Criteria and Verification sections when consolidation returns empty strings", async () => {
      const project = await makeJiraProject();
      const story = await makeStory({ projectId: project.id, jiraStatus: "In Progress" });
      await prisma.workUnit.create({
        data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
      });

      const deps = fakeDeps();
      const result = await applyStoryStatusSync(story.id, prisma, deps);

      expect(result.commented).toBe(true);
      const [, commentBody] = (deps.addComment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(commentBody).not.toContain("Acceptance Criteria");
      expect(commentBody).not.toContain("Verification");
      expect(deps.uploadAttachment).not.toHaveBeenCalled();
    });

    it("does not throw and still transitions/updates locally when uploadAttachment rejects", async () => {
      const project = await makeJiraProject();
      const story = await makeStory({ projectId: project.id, jiraStatus: "In Progress" });
      const wu1 = await prisma.workUnit.create({
        data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
      });
      await prisma.attachment.create({
        data: { workUnitId: wu1.id, filename: "broken.png", mimeType: "image/png", size: 50 },
      });

      const deps = fakeDeps({
        uploadAttachment: vi.fn(async () => {
          throw new Error("JIRA attachment upload failed");
        }),
      });

      const result = await applyStoryStatusSync(story.id, prisma, deps);

      expect(result.transitioned).toBe(true);
      expect(result.commented).toBe(true);
      expect(deps.uploadAttachment).toHaveBeenCalledTimes(1);

      const updated = await prisma.story.findUnique({ where: { id: story.id } });
      expect(updated?.jiraStatus).toBe("Code Revew");
      expect(updated?.completionCommentPostedAt).not.toBeNull();
    });

    it("does not throw and still completes when consolidateAcceptanceCriteria rejects", async () => {
      const project = await makeJiraProject();
      const story = await makeStory({ projectId: project.id, jiraStatus: "In Progress" });
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Task 1",
          column: "done",
          order: 0,
          acceptanceCriteria: "AC",
          verification: "V",
        },
      });

      const deps = fakeDeps({
        consolidateAcceptanceCriteria: vi.fn(async () => {
          throw new Error("Claude down");
        }),
      });

      const result = await applyStoryStatusSync(story.id, prisma, deps);

      expect(result.transitioned).toBe(true);
      expect(result.commented).toBe(true);
      expect(deps.addComment).toHaveBeenCalledTimes(1);

      const updated = await prisma.story.findUnique({ where: { id: story.id } });
      expect(updated?.jiraStatus).toBe("Code Revew");
    });

    it("does not call uploadAttachment or consolidateAcceptanceCriteria for a non-completion move", async () => {
      const project = await makeJiraProject();
      const story = await makeStory({ projectId: project.id, jiraStatus: "To Do" });
      const wu1 = await prisma.workUnit.create({
        data: { storyId: story.id, title: "Task 1", column: "in_progress", order: 0 },
      });
      await prisma.attachment.create({
        data: { workUnitId: wu1.id, filename: "shot.png", mimeType: "image/png", size: 50 },
      });

      const deps = fakeDeps();
      const result = await applyStoryStatusSync(story.id, prisma, deps);

      expect(result.transitioned).toBe(true);
      expect(result.commented).toBe(false);
      expect(deps.uploadAttachment).not.toHaveBeenCalled();
      expect(deps.consolidateAcceptanceCriteria).not.toHaveBeenCalled();
    });

    it("does not repeat consolidation/uploads when completionCommentPostedAt is already set", async () => {
      const project = await makeJiraProject();
      const alreadyPosted = new Date("2026-01-01T00:00:00Z");
      const story = await makeStory({
        projectId: project.id,
        jiraStatus: "In Progress",
        completionCommentPostedAt: alreadyPosted,
      });
      const wu1 = await prisma.workUnit.create({
        data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
      });
      await prisma.attachment.create({
        data: { workUnitId: wu1.id, filename: "shot.png", mimeType: "image/png", size: 50 },
      });

      const deps = fakeDeps();
      const result = await applyStoryStatusSync(story.id, prisma, deps);

      expect(result.transitioned).toBe(true);
      expect(result.commented).toBe(false);
      expect(deps.uploadAttachment).not.toHaveBeenCalled();
      expect(deps.consolidateAcceptanceCriteria).not.toHaveBeenCalled();
    });
  });

  it("ignores archived work units when computing the desired status", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "To Do" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Active", column: "todo", order: 0 },
    });
    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Archived in-progress card",
        column: "in_progress",
        order: 1,
        archivedAt: new Date(),
      },
    });

    const deps = fakeDeps();
    const result = await applyStoryStatusSync(story.id, prisma, deps);

    // Only the active (non-archived, still-todo) work unit should count — if
    // the archived in_progress card were counted, this would transition to
    // "In Progress". It must not.
    expect(result.transitioned).toBe(false);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});

describe("transitionStoryToQA", () => {
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
        name: `QA Test Project ${testCounter}`,
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
        jiraKey: `TEAM-QA-${testCounter}`,
        jiraId: `9100${testCounter}`,
        projectKey: "TEAM",
        summary: "Test story",
        description: "A test story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/TEAM-QA-${testCounter}`,
        lastSyncedAt: new Date(),
        ...overrides,
      },
    });
  }

  function fakeQaDeps(
    overrides: Partial<Pick<ApplyStoryStatusSyncDeps, "getTransitions" | "transitionIssue">> = {}
  ) {
    return {
      getTransitions: vi.fn(async (): Promise<JiraTransition[]> => [
        { id: "2", name: "QA", to: { name: "QA", statusCategory: { key: "indeterminate" } } },
        { id: "3", name: "Code Revew", to: { name: "Code Revew", statusCategory: { key: "indeterminate" } } },
      ]),
      transitionIssue: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("transitions to QA when every work unit is done", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "done", order: 1 },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result).toEqual({ ok: true });
    expect(deps.transitionIssue).toHaveBeenCalledWith(story.jiraKey, "2", expect.any(Object));

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("QA");
  });

  it("returns an error without transitioning when a sibling work unit isn't done", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "code_review", order: 1 },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/done/i);
    }
    expect(deps.transitionIssue).not.toHaveBeenCalled();

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("Code Revew");
  });

  it("returns an error when the story has no work units", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });

    const result = await transitionStoryToQA(story.id, prisma, fakeQaDeps());

    expect(result.ok).toBe(false);
  });

  it("returns an error for a missing story", async () => {
    const result = await transitionStoryToQA("does-not-exist", prisma, fakeQaDeps());

    expect(result).toEqual({ ok: false, error: expect.stringContaining("not found") });
  });

  it("returns an error when the project has no JIRA credentials", async () => {
    const project = await prisma.project.create({
      data: { name: "No Creds Project", type: "STANDALONE" },
    });
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const result = await transitionStoryToQA(story.id, prisma, fakeQaDeps());

    expect(result.ok).toBe(false);
  });

  it("returns an error when no QA transition is available from the story's current status", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const deps = fakeQaDeps({
      getTransitions: vi.fn(async (): Promise<JiraTransition[]> => [
        { id: "3", name: "Code Revew", to: { name: "Code Revew", statusCategory: { key: "indeterminate" } } },
      ]),
    });
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/QA/);
    }
  });

  it("surfaces a JIRA API failure as an error result instead of throwing", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const deps = fakeQaDeps({
      transitionIssue: vi.fn(async () => {
        throw new Error("JIRA API error: 500");
      }),
    });

    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("500") });
  });

  it("ignores archived work units when checking whether every card is done", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Archived leftover",
        column: "in_progress",
        order: 1,
        archivedAt: new Date(),
      },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    // The archived work unit is still "in_progress", but since it's
    // archived it must not block the transition.
    expect(result).toEqual({ ok: true });
  });

  it("archives every one of the story's work units after a successful transition to QA", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu1 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    const wu2 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "done", order: 1 },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result).toEqual({ ok: true });

    const updated1 = await prisma.workUnit.findUnique({ where: { id: wu1.id } });
    const updated2 = await prisma.workUnit.findUnique({ where: { id: wu2.id } });
    expect(updated1?.archivedAt).not.toBeNull();
    expect(updated2?.archivedAt).not.toBeNull();
  });

  it("does not archive anything when the transition fails (a sibling isn't done)", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu1 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    const wu2 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "code_review", order: 1 },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result.ok).toBe(false);

    const updated1 = await prisma.workUnit.findUnique({ where: { id: wu1.id } });
    const updated2 = await prisma.workUnit.findUnique({ where: { id: wu2.id } });
    expect(updated1?.archivedAt).toBeNull();
    expect(updated2?.archivedAt).toBeNull();
  });
});

describe("reportWorkUnitToQA", () => {
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
        name: `Report Test Project ${testCounter}`,
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
        jiraKey: `TEAM-RPT-${testCounter}`,
        jiraId: `9200${testCounter}`,
        projectKey: "TEAM",
        summary: "Test story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/TEAM-RPT-${testCounter}`,
        lastSyncedAt: new Date(),
        ...overrides,
      },
    });
  }

  function fakeReportDeps(
    overrides: Partial<{
      getTransitions: ApplyStoryStatusSyncDeps["getTransitions"];
      transitionIssue: ApplyStoryStatusSyncDeps["transitionIssue"];
      addComment: ApplyStoryStatusSyncDeps["addComment"];
      uploadAttachment: ApplyStoryStatusSyncDeps["uploadAttachment"];
      readAttachmentFile: ApplyStoryStatusSyncDeps["readAttachmentFile"];
    }> = {}
  ) {
    return {
      getTransitions: vi.fn(async (): Promise<JiraTransition[]> => [
        { id: "2", name: "QA", to: { name: "QA", statusCategory: { key: "indeterminate" } } },
      ]),
      transitionIssue: vi.fn(async () => {}),
      addComment: vi.fn(async () => {}),
      uploadAttachment: vi.fn(async () => {}),
      readAttachmentFile: vi.fn(async () => Buffer.from("fake-image-bytes")),
      ...overrides,
    };
  }

  it("posts a comment built from the work unit's own fields, marks it reported, and does not transition when siblings aren't ready", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu1 = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 1",
        description: "Did the thing",
        acceptanceCriteria: "AC text",
        verification: "Verification text",
        column: "done",
        order: 0,
      },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "code_review", order: 1 },
    });

    const deps = fakeReportDeps();
    const result = await reportWorkUnitToQA(wu1.id, prisma, deps);

    expect(result).toEqual({ ok: true, transitioned: false });
    expect(deps.addComment).toHaveBeenCalledWith(
      story.jiraKey,
      expect.stringContaining("Task 1"),
      expect.any(Object)
    );
    expect(deps.addComment).toHaveBeenCalledWith(
      story.jiraKey,
      expect.stringContaining("AC text"),
      expect.any(Object)
    );
    expect(deps.transitionIssue).not.toHaveBeenCalled();

    const updated = await prisma.workUnit.findUnique({ where: { id: wu1.id } });
    expect(updated?.movedToQaReportedAt).not.toBeNull();
  });

  it("uploads the work unit's own attachments", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.attachment.create({
      data: { workUnitId: wu.id, filename: "shot.png", mimeType: "image/png", size: 123 },
    });

    const deps = fakeReportDeps();
    await reportWorkUnitToQA(wu.id, prisma, deps);

    expect(deps.readAttachmentFile).toHaveBeenCalledTimes(1);
    expect(deps.uploadAttachment).toHaveBeenCalledWith(
      story.jiraKey,
      expect.objectContaining({ filename: "shot.png", mimeType: "image/png" }),
      expect.any(Object)
    );
  });

  it("transitions and archives when this was the last sibling to be reported", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu1 = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 1",
        column: "done",
        order: 0,
        movedToQaReportedAt: new Date(),
      },
    });
    const wu2 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "done", order: 1 },
    });

    const deps = fakeReportDeps();
    const result = await reportWorkUnitToQA(wu2.id, prisma, deps);

    expect(result).toEqual({ ok: true, transitioned: true });
    expect(deps.transitionIssue).toHaveBeenCalledWith(story.jiraKey, "2", expect.any(Object));

    const updatedStory = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updatedStory?.jiraStatus).toBe("QA");

    const updatedWu1 = await prisma.workUnit.findUnique({ where: { id: wu1.id } });
    const updatedWu2 = await prisma.workUnit.findUnique({ where: { id: wu2.id } });
    expect(updatedWu1?.archivedAt).not.toBeNull();
    expect(updatedWu2?.archivedAt).not.toBeNull();
  });

  it("fails without marking reported when addComment rejects", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const deps = fakeReportDeps({
      addComment: vi.fn(async () => {
        throw new Error("JIRA API error: 500");
      }),
    });
    const result = await reportWorkUnitToQA(wu.id, prisma, deps);

    expect(result.ok).toBe(false);
    const updated = await prisma.workUnit.findUnique({ where: { id: wu.id } });
    expect(updated?.movedToQaReportedAt).toBeNull();
  });

  it("fails without marking reported when uploadAttachment rejects", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.attachment.create({
      data: { workUnitId: wu.id, filename: "shot.png", mimeType: "image/png", size: 123 },
    });

    const deps = fakeReportDeps({
      uploadAttachment: vi.fn(async () => {
        throw new Error("JIRA API error: 500");
      }),
    });
    const result = await reportWorkUnitToQA(wu.id, prisma, deps);

    expect(result.ok).toBe(false);
    const updated = await prisma.workUnit.findUnique({ where: { id: wu.id } });
    expect(updated?.movedToQaReportedAt).toBeNull();
  });

  it("returns an error for a missing work unit", async () => {
    const result = await reportWorkUnitToQA("does-not-exist", prisma, fakeReportDeps());
    expect(result.ok).toBe(false);
  });

  it("returns an error when the project has no JIRA credentials", async () => {
    const story = await makeStory();
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const result = await reportWorkUnitToQA(wu.id, prisma, fakeReportDeps());
    expect(result.ok).toBe(false);
  });
});
