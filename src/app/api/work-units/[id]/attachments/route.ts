/**
 * GET /api/work-units/[id]/attachments - List a work unit's attachments (chronological)
 * POST /api/work-units/[id]/attachments - Upload an image or video attachment to a work unit
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAttachmentFile } from "@/lib/attachmentStorage";
import {
  attachmentSizeLimitLabel,
  isAllowedAttachmentMimeType,
  maxBytesForMimeType,
} from "@/lib/attachmentPolicy";
import { AttachmentDTO } from "@/lib/types";
import { syncAttachmentToJira } from "@/lib/attachmentJiraSync";

// Helper to convert Prisma Attachment to DTO
function attachmentToDTO(attachment: {
  id: string;
  workUnitId: string;
  filename: string;
  mimeType: string;
  size: number;
  jiraUploadedAt: Date | null;
  createdAt: Date;
}): AttachmentDTO {
  return {
    id: attachment.id,
    workUnitId: attachment.workUnitId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    jiraUploadedAt: attachment.jiraUploadedAt?.toISOString() ?? null,
    createdAt: attachment.createdAt.toISOString(),
    url: `/api/attachments/${attachment.id}`,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
    });

    if (!workUnit) {
      return NextResponse.json(
        { error: "Work unit not found" },
        { status: 404 }
      );
    }

    const attachments = await prisma.attachment.findMany({
      where: { workUnitId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(attachments.map(attachmentToDTO));
  } catch (error) {
    console.error("Error fetching attachments:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
    });

    if (!workUnit) {
      return NextResponse.json(
        { error: "Work unit not found" },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "A file must be provided under the 'file' field" },
        { status: 400 }
      );
    }

    const mimeType = file.type;
    if (!isAllowedAttachmentMimeType(mimeType)) {
      return NextResponse.json(
        { error: "Only image and video attachments are allowed" },
        { status: 400 }
      );
    }

    const size = file.size;
    if (size > maxBytesForMimeType(mimeType)) {
      return NextResponse.json(
        {
          error: `File exceeds the ${attachmentSizeLimitLabel(mimeType)} attachment size limit`,
        },
        { status: 413 }
      );
    }

    const filename = file instanceof File ? file.name : "attachment";

    const created = await prisma.attachment.create({
      data: {
        workUnitId: id,
        filename,
        mimeType,
        size,
      },
    });

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeAttachmentFile(created.id, buffer);
    } catch (writeError) {
      // Don't leave an orphan row if the disk write failed.
      await prisma.attachment.delete({ where: { id: created.id } });
      throw writeError;
    }

    await syncAttachmentToJira(created.id, prisma);
    const finalAttachment = await prisma.attachment.findUnique({ where: { id: created.id } });

    return NextResponse.json(attachmentToDTO(finalAttachment ?? created), { status: 201 });
  } catch (error) {
    console.error("Error creating attachment:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
