/**
 * Attachment acceptance policy, shared by the upload API route and the
 * detail-modal client checks so the two can never drift apart.
 *
 * Images: any image/* MIME type. Videos: an explicit allowlist covering the
 * formats screen recorders actually produce (QuickTime on macOS, MP4/WebM
 * from browser/CLI recorders). Videos get a larger size budget than images —
 * a 10 MB cap fits ~20 seconds of screen recording, which is useless for
 * recorded test evidence.
 */

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024; // 250 MB

export const ALLOWED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export function isVideoMimeType(mimeType: string): boolean {
  return (ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isAllowedAttachmentMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/") || isVideoMimeType(mimeType);
}

export function maxBytesForMimeType(mimeType: string): number {
  return isVideoMimeType(mimeType) ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
}

export function attachmentSizeLimitLabel(mimeType: string): string {
  return isVideoMimeType(mimeType) ? "250 MB" : "10 MB";
}
