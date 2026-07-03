/**
 * Reads a local image file for MCP-driven attachment upload. This is the one
 * place in Ponder that reads the local filesystem directly — the MCP server
 * process IS the local agent's own machine, unlike the Next.js app server,
 * which stays repo/filesystem-agnostic (see docs/understand-anything-integration.md).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface LocalImage {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Reads `filePath` from disk and infers its MIME type from the file
 * extension (case-insensitive). Throws a descriptive error for an
 * unsupported extension; a missing/unreadable file surfaces Node's own
 * fs error unmodified.
 */
export async function readLocalImage(
  filePath: string,
  filenameOverride?: string
): Promise<LocalImage> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = EXTENSION_MIME_TYPES[ext];

  if (!mimeType) {
    const supported = Object.keys(EXTENSION_MIME_TYPES).join(", ");
    throw new Error(
      `Unsupported image extension "${ext || "(none)"}" for "${filePath}" — supported: ${supported}`
    );
  }

  const buffer = await readFile(filePath);
  const filename = filenameOverride ?? path.basename(filePath);

  return { buffer, filename, mimeType };
}
