/**
 * Integration tests for the single-attachment endpoint (serve + delete)
 * Tests actual Prisma client against test database and a temp uploads dir
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, access } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { prisma } from "@/lib/prisma";
import { writeAttachmentFile } from "@/lib/attachmentStorage";
import { GET, DELETE } from "@/app/api/attachments/[id]/route";

describe("Attachment Endpoint", () => {
  let storyId: string;
  let workUnitId: string;
  let testCounter = 0;
  let uploadsDir: string;
  let originalUploadsDir: string | undefined;

  beforeAll(async () => {
    originalUploadsDir = process.env.UPLOADS_DIR;
    uploadsDir = await mkdtemp(path.join(tmpdir(), "attachment-serve-test-"));
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
    await prisma.attachment.deleteMany({});
    await prisma.workNote.deleteMany({});
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});

    testCounter++;

    const story = await prisma.story.create({
      data: {
        jiraKey: `SERVE-${testCounter}`,
        jiraId: `5000${testCounter}`,
        projectKey: "SERVE",
        summary: "Test story for attachment serve endpoint",
        description: "A test story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/SERVE-${testCounter}`,
        lastSyncedAt: new Date(),
      },
    });
    storyId = story.id;

    const workUnit = await prisma.workUnit.create({
      data: {
        storyId,
        title: "Test work unit",
        column: "todo",
        order: 0,
      },
    });
    workUnitId = workUnit.id;
  });

  async function createAttachment(bytes = [1, 2, 3, 4]) {
    const attachment = await prisma.attachment.create({
      data: {
        workUnitId,
        filename: "shot.png",
        mimeType: "image/png",
        size: bytes.length,
      },
    });
    await writeAttachmentFile(attachment.id, Buffer.from(bytes));
    return attachment;
  }

  describe("GET", () => {
    it("serves the bytes with the stored Content-Type", async () => {
      const attachment = await createAttachment([137, 80, 78, 71]);

      const req = new Request(`http://localhost/api/attachments/${attachment.id}`);
      const res = await GET(req as never, {
        params: Promise.resolve({ id: attachment.id }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");

      const buf = Buffer.from(await res.arrayBuffer());
      expect(Array.from(buf)).toEqual([137, 80, 78, 71]);
    });

    it("returns 404 when the attachment row does not exist", async () => {
      const req = new Request("http://localhost/api/attachments/non-existent");
      const res = await GET(req as never, {
        params: Promise.resolve({ id: "non-existent" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when the row exists but the file is missing on disk", async () => {
      const attachment = await prisma.attachment.create({
        data: {
          workUnitId,
          filename: "orphan.png",
          mimeType: "image/png",
          size: 4,
        },
      });

      const req = new Request(`http://localhost/api/attachments/${attachment.id}`);
      const res = await GET(req as never, {
        params: Promise.resolve({ id: attachment.id }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE", () => {
    it("removes the row and the file", async () => {
      const attachment = await createAttachment();
      const filePath = path.join(uploadsDir, attachment.id);
      await expect(access(filePath)).resolves.not.toThrow();

      const req = new Request(`http://localhost/api/attachments/${attachment.id}`, {
        method: "DELETE",
      });
      const res = await DELETE(req as never, {
        params: Promise.resolve({ id: attachment.id }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ ok: true });

      const persisted = await prisma.attachment.findUnique({
        where: { id: attachment.id },
      });
      expect(persisted).toBeNull();

      await expect(access(filePath)).rejects.toThrow();
    });

    it("returns 404 for a missing attachment", async () => {
      const req = new Request("http://localhost/api/attachments/non-existent", {
        method: "DELETE",
      });
      const res = await DELETE(req as never, {
        params: Promise.resolve({ id: "non-existent" }),
      });
      expect(res.status).toBe(404);
    });
  });
});
