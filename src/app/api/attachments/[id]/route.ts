/**
 * GET /api/attachments/[id] - Serve an attachment's bytes with its stored mimeType.
 *   Honors single-range `Range: bytes=...` requests (206) so <video> elements
 *   can seek; malformed/unsatisfiable ranges get 416 per RFC 9110.
 * DELETE /api/attachments/[id] - Delete an attachment's row and file
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteAttachmentFile, readAttachmentFile } from "@/lib/attachmentStorage";

/**
 * Parses a single-range `bytes=start-end` header against a resource of
 * `size` bytes. Returns null for a header we don't support (multiple
 * ranges, other units) — the caller then serves the full body with 200,
 * which is always a valid response to a Range request. Returns
 * "unsatisfiable" for a syntactically valid range outside the resource.
 */
function parseByteRange(
  header: string,
  size: number
): { start: number; end: number } | "unsatisfiable" | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;

  let start: number;
  let end: number;
  if (match[1] === "") {
    // Suffix range: last N bytes.
    const suffixLength = Number(match[2]);
    if (suffixLength === 0) return "unsatisfiable";
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const attachment = await prisma.attachment.findUnique({
      where: { id },
    });

    if (!attachment) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 }
      );
    }

    let data: Buffer;
    try {
      data = await readAttachmentFile(id);
    } catch {
      return NextResponse.json(
        { error: "Attachment file not found" },
        { status: 404 }
      );
    }

    const baseHeaders = {
      "Content-Type": attachment.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    };

    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, data.length);
      if (range === "unsatisfiable") {
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes */${data.length}`,
          },
        });
      }
      if (range) {
        return new NextResponse(
          new Uint8Array(data.subarray(range.start, range.end + 1)),
          {
            status: 206,
            headers: {
              ...baseHeaders,
              "Content-Range": `bytes ${range.start}-${range.end}/${data.length}`,
              "Content-Length": String(range.end - range.start + 1),
            },
          }
        );
      }
      // Unsupported range form (e.g. multiple ranges): fall through to 200.
    }

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(data.length),
      },
    });
  } catch (error) {
    console.error("Error serving attachment:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const attachment = await prisma.attachment.findUnique({
      where: { id },
    });

    if (!attachment) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 }
      );
    }

    await prisma.attachment.delete({ where: { id } });
    await deleteAttachmentFile(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting attachment:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
