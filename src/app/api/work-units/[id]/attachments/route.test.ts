/**
 * Integration tests for work-unit attachments endpoint
 * Tests actual Prisma client against test database and a temp uploads dir
 *
 * Runs under the Node environment (rather than the project-default jsdom)
 * because jsdom's FormData/Request classes aren't recognized by undici's
 * Request constructor, which silently stringifies multipart bodies instead
 * of setting a multipart/form-data Content-Type.
 */

// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/work-units/[id]/attachments/route";

vi.mock("@/lib/jira/writeback", () => ({
  uploadAttachment: vi.fn(async () => {}),
  // syncAttachmentToJira pulls in statusTrigger.ts, which statically imports
  // these other named exports from the same module. The brief's mock factory
  // only stubbed uploadAttachment (the only one this route path calls), which
  // left the other three undefined and made the module fail to load. They're
  // never invoked on this code path — stubbed only so the import resolves.
  getTransitions: vi.fn(),
  transitionIssue: vi.fn(),
  addComment: vi.fn(),
  getIssueStatus: vi.fn(),
}));

import { uploadAttachment } from "@/lib/jira/writeback";

describe("Work Unit Attachments Endpoint", () => {
  let storyId: string;
  let workUnitId: string;
  let testCounter = 0;
  let uploadsDir: string;
  let originalUploadsDir: string | undefined;

  beforeAll(async () => {
    originalUploadsDir = process.env.UPLOADS_DIR;
    uploadsDir = await mkdtemp(path.join(tmpdir(), "attachments-test-"));
    process.env.UPLOADS_DIR = uploadsDir;
  });

  afterAll(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
    if (originalUploadsDir === undefined) {
      delete process.env.UPLOADS_DIR;
    } else {
      process.env.UPLOADS_DIR = originalUploadsDir;
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear tables before each test (children first for FK safety)
    await prisma.attachment.deleteMany({});
    await prisma.workNote.deleteMany({});
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});

    testCounter++;

    const story = await prisma.story.create({
      data: {
        jiraKey: `ATT-${testCounter}`,
        jiraId: `4000${testCounter}`,
        projectKey: "ATT",
        summary: "Test story for attachments endpoint",
        description: "A test story for attachments endpoint tests",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/ATT-${testCounter}`,
        lastSyncedAt: new Date(),
      },
    });
    storyId = story.id;

    const workUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "Test work unit",
        description: "A work unit for attachments tests",
        column: "todo",
        order: 0,
      },
    });
    workUnitId = workUnit.id;
  });

  function pngFile(name = "screenshot.png", bytes = [137, 80, 78, 71]) {
    return new File([new Uint8Array(bytes)], name, { type: "image/png" });
  }

  describe("POST", () => {
    it("uploads an image, returns 201 with the DTO, and writes the file to disk", async () => {
      const formData = new FormData();
      formData.append("file", pngFile());

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        {
          method: "POST",
          body: formData,
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(201);

      const dto = await res.json();
      expect(dto.workUnitId).toBe(workUnitId);
      expect(dto.filename).toBe("screenshot.png");
      expect(dto.mimeType).toBe("image/png");
      expect(dto.size).toBe(4);
      expect(dto.url).toBe(`/api/attachments/${dto.id}`);
      expect(typeof dto.createdAt).toBe("string");

      const persisted = await prisma.attachment.findUnique({
        where: { id: dto.id },
      });
      expect(persisted).not.toBeNull();
      expect(persisted?.workUnitId).toBe(workUnitId);

      const filePath = path.join(uploadsDir, dto.id);
      const fileBytes = await readFile(filePath);
      expect(Array.from(fileBytes)).toEqual([137, 80, 78, 71]);
    });

    it("returns 400 for a non-image file and creates no row or file", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["hello"], "notes.txt", { type: "text/plain" })
      );

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        {
          method: "POST",
          body: formData,
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(400);

      const count = await prisma.attachment.count();
      expect(count).toBe(0);
    });

    it("returns 400 when no file is present", async () => {
      const formData = new FormData();

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        {
          method: "POST",
          body: formData,
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(400);

      const count = await prisma.attachment.count();
      expect(count).toBe(0);
    });

    it("returns 404 for a non-existent work unit and creates no row", async () => {
      const formData = new FormData();
      formData.append("file", pngFile());

      const req = new Request(
        "http://localhost/api/work-units/non-existent/attachments",
        {
          method: "POST",
          body: formData,
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: "non-existent-id" }),
      });
      expect(res.status).toBe(404);

      const count = await prisma.attachment.count();
      expect(count).toBe(0);
    });

    it("rejects an oversized file and creates no row", async () => {
      const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
      const formData = new FormData();
      formData.append(
        "file",
        new File([oversized], "huge.png", { type: "image/png" })
      );

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        {
          method: "POST",
          body: formData,
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(413);

      const count = await prisma.attachment.count();
      expect(count).toBe(0);
    });

    it("uploads a video, returns 201, and writes the file to disk", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File([new Uint8Array([0, 0, 0, 24])], "test-run.mp4", {
          type: "video/mp4",
        })
      );

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        {
          method: "POST",
          body: formData,
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(201);

      const dto = await res.json();
      expect(dto.filename).toBe("test-run.mp4");
      expect(dto.mimeType).toBe("video/mp4");

      const fileBytes = await readFile(path.join(uploadsDir, dto.id));
      expect(Array.from(fileBytes)).toEqual([0, 0, 0, 24]);
    });

    it("accepts a video larger than the 10 MB image cap", async () => {
      const elevenMb = new Uint8Array(11 * 1024 * 1024);
      const formData = new FormData();
      formData.append(
        "file",
        new File([elevenMb], "recording.webm", { type: "video/webm" })
      );

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        {
          method: "POST",
          body: formData,
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(201);

      const dto = await res.json();
      expect(dto.mimeType).toBe("video/webm");
      expect(dto.size).toBe(11 * 1024 * 1024);
    });

    it("uploads the attachment to JIRA immediately and reflects jiraUploadedAt in the response", async () => {
      vi.mocked(uploadAttachment).mockClear();
      const project = await prisma.project.create({
        data: {
          name: "JIRA Attachments Test Project",
          type: "JIRA",
          jiraProjectKey: "ATT",
          jiraSiteUrl: "https://example.atlassian.net",
          jiraEmail: "user@example.com",
          jiraApiToken: "token-123",
        },
      });
      await prisma.story.update({ where: { id: storyId }, data: { projectId: project.id } });

      const formData = new FormData();
      formData.append("file", pngFile());
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        { method: "POST", body: formData }
      );

      const res = await POST(req as never, { params: Promise.resolve({ id: workUnitId }) });
      expect(res.status).toBe(201);

      const dto = await res.json();
      expect(dto.jiraUploadedAt).not.toBeNull();
      expect(uploadAttachment).toHaveBeenCalledTimes(1);

      const persisted = await prisma.attachment.findUnique({ where: { id: dto.id } });
      expect(persisted?.jiraUploadedAt).not.toBeNull();

      // Story.projectId has no onDelete cascade — detach before deleting the
      // project, or this throws a foreign-key constraint violation.
      await prisma.story.update({ where: { id: storyId }, data: { projectId: null } });
      await prisma.project.delete({ where: { id: project.id } });
    });

    it("still returns 201 with jiraUploadedAt null when the JIRA upload fails", async () => {
      vi.mocked(uploadAttachment).mockRejectedValueOnce(new Error("JIRA API error: 500"));
      const project = await prisma.project.create({
        data: {
          name: "JIRA Attachments Failure Test Project",
          type: "JIRA",
          jiraProjectKey: "ATT",
          jiraSiteUrl: "https://example.atlassian.net",
          jiraEmail: "user@example.com",
          jiraApiToken: "token-123",
        },
      });
      await prisma.story.update({ where: { id: storyId }, data: { projectId: project.id } });

      const formData = new FormData();
      formData.append("file", pngFile());
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        { method: "POST", body: formData }
      );

      const res = await POST(req as never, { params: Promise.resolve({ id: workUnitId }) });
      expect(res.status).toBe(201);

      const dto = await res.json();
      expect(dto.jiraUploadedAt).toBeNull();

      const persisted = await prisma.attachment.findUnique({ where: { id: dto.id } });
      expect(persisted).not.toBeNull();

      // Story.projectId has no onDelete cascade — detach before deleting the
      // project, or this throws a foreign-key constraint violation.
      await prisma.story.update({ where: { id: storyId }, data: { projectId: null } });
      await prisma.project.delete({ where: { id: project.id } });
    });

    it("returns jiraUploadedAt null and never calls uploadAttachment for a non-JIRA-linked work unit", async () => {
      vi.mocked(uploadAttachment).mockClear();
      const formData = new FormData();
      formData.append("file", pngFile());
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        { method: "POST", body: formData }
      );

      const res = await POST(req as never, { params: Promise.resolve({ id: workUnitId }) });
      const dto = await res.json();
      expect(dto.jiraUploadedAt).toBeNull();
      expect(uploadAttachment).not.toHaveBeenCalled();
    });

    it("rejects a video MIME type outside the allowlist", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File([new Uint8Array([1])], "clip.avi", { type: "video/x-msvideo" })
      );

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        {
          method: "POST",
          body: formData,
        }
      );

      const res = await POST(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "Only image and video attachments are allowed"
      );
    });
  });

  describe("GET", () => {
    it("lists attachments for a work unit in chronological order", async () => {
      const formData1 = new FormData();
      formData1.append("file", pngFile("first.png"));
      const req1 = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        { method: "POST", body: formData1 }
      );
      await POST(req1 as never, { params: Promise.resolve({ id: workUnitId }) });

      await new Promise((resolve) => setTimeout(resolve, 5));

      const formData2 = new FormData();
      formData2.append("file", pngFile("second.png"));
      const req2 = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        { method: "POST", body: formData2 }
      );
      await POST(req2 as never, { params: Promise.resolve({ id: workUnitId }) });

      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(200);

      const attachments = await res.json();
      expect(attachments).toHaveLength(2);
      expect(attachments[0].filename).toBe("first.png");
      expect(attachments[1].filename).toBe("second.png");
    });

    it("returns an empty array when the work unit has no attachments", async () => {
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ id: workUnitId }),
      });
      expect(res.status).toBe(200);

      const attachments = await res.json();
      expect(attachments).toEqual([]);
    });

    it("returns 404 for a non-existent work unit", async () => {
      const req = new Request(
        "http://localhost/api/work-units/non-existent/attachments"
      );
      const res = await GET(req as never, {
        params: Promise.resolve({ id: "non-existent-id" }),
      });
      expect(res.status).toBe(404);
    });
  });
});
