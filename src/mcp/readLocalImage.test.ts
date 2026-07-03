import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readLocalImage } from "@/mcp/readLocalImage";

describe("readLocalImage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ponder-readLocalImage-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
  ])("infers %s as %s and reads the file's bytes", async (ext, expectedMime) => {
    const filePath = path.join(dir, `screenshot${ext}`);
    await writeFile(filePath, "fake-bytes");

    const result = await readLocalImage(filePath);

    expect(result.mimeType).toBe(expectedMime);
    expect(result.filename).toBe(`screenshot${ext}`);
    expect(result.buffer.toString()).toBe("fake-bytes");
  });

  it("infers the extension case-insensitively", async () => {
    const filePath = path.join(dir, "Screenshot.PNG");
    await writeFile(filePath, "fake-bytes");

    const result = await readLocalImage(filePath);

    expect(result.mimeType).toBe("image/png");
  });

  it("uses filenameOverride instead of the file's basename when provided", async () => {
    const filePath = path.join(dir, "screenshot.png");
    await writeFile(filePath, "fake-bytes");

    const result = await readLocalImage(filePath, "before-fix.png");

    expect(result.filename).toBe("before-fix.png");
  });

  it("throws a clear error for an unsupported extension", async () => {
    const filePath = path.join(dir, "notes.txt");
    await writeFile(filePath, "not an image");

    await expect(readLocalImage(filePath)).rejects.toThrow(/unsupported/i);
  });

  it("propagates the filesystem error for a missing file", async () => {
    const filePath = path.join(dir, "does-not-exist.png");

    await expect(readLocalImage(filePath)).rejects.toThrow(/ENOENT|no such file/i);
  });
});
