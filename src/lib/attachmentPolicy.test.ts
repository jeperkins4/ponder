import { describe, it, expect } from "vitest";
import {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  attachmentSizeLimitLabel,
  isAllowedAttachmentMimeType,
  isVideoMimeType,
  maxBytesForMimeType,
} from "./attachmentPolicy";

describe("attachmentPolicy", () => {
  it("allows any image MIME type", () => {
    expect(isAllowedAttachmentMimeType("image/png")).toBe(true);
    expect(isAllowedAttachmentMimeType("image/webp")).toBe(true);
    expect(isAllowedAttachmentMimeType("image/svg+xml")).toBe(true);
  });

  it("allows only the video allowlist", () => {
    expect(isAllowedAttachmentMimeType("video/mp4")).toBe(true);
    expect(isAllowedAttachmentMimeType("video/webm")).toBe(true);
    expect(isAllowedAttachmentMimeType("video/quicktime")).toBe(true);
    expect(isAllowedAttachmentMimeType("video/x-msvideo")).toBe(false);
  });

  it("rejects non-media MIME types", () => {
    expect(isAllowedAttachmentMimeType("application/pdf")).toBe(false);
    expect(isAllowedAttachmentMimeType("text/plain")).toBe(false);
    expect(isAllowedAttachmentMimeType("")).toBe(false);
  });

  it("gives videos the 250 MB cap and everything else the 10 MB cap", () => {
    expect(maxBytesForMimeType("video/mp4")).toBe(VIDEO_MAX_BYTES);
    expect(maxBytesForMimeType("image/png")).toBe(IMAGE_MAX_BYTES);
    expect(VIDEO_MAX_BYTES).toBe(250 * 1024 * 1024);
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("labels the size limit per type for error messages", () => {
    expect(attachmentSizeLimitLabel("video/webm")).toBe("250 MB");
    expect(attachmentSizeLimitLabel("image/gif")).toBe("10 MB");
  });

  it("classifies video MIME types", () => {
    expect(isVideoMimeType("video/quicktime")).toBe(true);
    expect(isVideoMimeType("image/png")).toBe(false);
  });
});
