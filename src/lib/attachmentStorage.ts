/**
 * Filesystem storage helpers for work-unit attachments.
 *
 * Files are stored on disk keyed by attachment id (no extension needed,
 * since mimeType is recorded in the Attachment row). Only metadata lives
 * in Postgres; binary content never touches the database.
 *
 * Storage root resolves from UPLOADS_DIR, falling back to
 * <cwd>/data/uploads. Tests should set process.env.UPLOADS_DIR to a
 * temp directory before importing/using this module and clean it up
 * in teardown so they don't pollute the real uploads directory.
 */

import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads");
}

function attachmentPath(id: string): string {
  return path.join(getUploadsDir(), id);
}

/** Write attachment bytes to disk, creating the uploads directory if needed. */
export async function writeAttachmentFile(
  id: string,
  data: Buffer
): Promise<void> {
  const dir = getUploadsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(attachmentPath(id), data);
}

/** Read attachment bytes from disk. Throws if the file does not exist. */
export async function readAttachmentFile(id: string): Promise<Buffer> {
  return readFile(attachmentPath(id));
}

/** Delete attachment bytes from disk. No-op (does not throw) if missing. */
export async function deleteAttachmentFile(id: string): Promise<void> {
  await rm(attachmentPath(id), { force: true });
}
