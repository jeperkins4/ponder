import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncAttachmentToJira, type SyncAttachmentToJiraDeps } from "./attachmentJiraSync";

describe("syncAttachmentToJira", () => {
  let testCounter = 0;

  beforeEach(async () => {
    await prisma.attachment.deleteMany({});
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    await prisma.project.deleteMany({});
    testCounter++;
  });

  async function makeJiraProject() {
    return prisma.project.create({
      data: {
        name: `Attachment Sync Test Project ${testCounter}`,
        type: "JIRA",
        jiraProjectKey: "SYNC",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "user@example.com",
        jiraApiToken: "token-123",
      },
    });
  }

  async function makeStoryAndWorkUnit(projectId?: string) {
    const story = await prisma.story.create({
      data: {
        jiraKey: `SYNC-${testCounter}`,
        jiraId: `8000${testCounter}`,
        projectKey: "SYNC",
        summary: "Test story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/SYNC-${testCounter}`,
        lastSyncedAt: new Date(),
        ...(projectId ? { projectId } : {}),
      },
    });
    const workUnit = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task", column: "todo", order: 0 },
    });
    return { story, workUnit };
  }

  function fakeDeps(overrides: Partial<SyncAttachmentToJiraDeps> = {}): SyncAttachmentToJiraDeps {
    return {
      uploadAttachment: vi.fn(async () => {}),
      readAttachmentFile: vi.fn(async () => Buffer.from("fake-bytes")),
      ...overrides,
    };
  }

  it("uploads the attachment and stamps jiraUploadedAt on success", async () => {
    const project = await makeJiraProject();
    const { story, workUnit } = await makeStoryAndWorkUnit(project.id);
    const attachment = await prisma.attachment.create({
      data: { workUnitId: workUnit.id, filename: "shot.png", mimeType: "image/png", size: 100 },
    });

    const deps = fakeDeps();
    const result = await syncAttachmentToJira(attachment.id, prisma, deps);

    expect(result).toEqual({ uploaded: true });
    expect(deps.readAttachmentFile).toHaveBeenCalledWith(attachment.id);
    expect(deps.uploadAttachment).toHaveBeenCalledWith(
      story.jiraKey,
      expect.objectContaining({ filename: "shot.png", mimeType: "image/png" }),
      expect.any(Object)
    );

    const updated = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(updated?.jiraUploadedAt).not.toBeNull();
  });

  it("skips and returns uploaded:false when the project has no JIRA credentials", async () => {
    const { workUnit } = await makeStoryAndWorkUnit();
    const attachment = await prisma.attachment.create({
      data: { workUnitId: workUnit.id, filename: "shot.png", mimeType: "image/png", size: 100 },
    });

    const deps = fakeDeps();
    const result = await syncAttachmentToJira(attachment.id, prisma, deps);

    expect(result.uploaded).toBe(false);
    expect(result.warning).toBeTruthy();
    expect(deps.uploadAttachment).not.toHaveBeenCalled();

    const updated = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(updated?.jiraUploadedAt).toBeNull();
  });

  it("does not throw and returns uploaded:false when uploadAttachment rejects", async () => {
    const project = await makeJiraProject();
    const { workUnit } = await makeStoryAndWorkUnit(project.id);
    const attachment = await prisma.attachment.create({
      data: { workUnitId: workUnit.id, filename: "shot.png", mimeType: "image/png", size: 100 },
    });

    const deps = fakeDeps({
      uploadAttachment: vi.fn(async () => {
        throw new Error("JIRA API error: 500");
      }),
    });

    const result = await syncAttachmentToJira(attachment.id, prisma, deps);

    expect(result.uploaded).toBe(false);
    expect(result.warning).toContain("500");

    const updated = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(updated?.jiraUploadedAt).toBeNull();
  });

  it("does not throw for a non-existent attachment", async () => {
    const deps = fakeDeps();
    const result = await syncAttachmentToJira("does-not-exist", prisma, deps);
    expect(result.uploaded).toBe(false);
    expect(deps.uploadAttachment).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
