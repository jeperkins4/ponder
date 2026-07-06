/**
 * POST /api/work-units/[id]/move - Move work unit to column and reorder
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Column, WorkUnitDTO } from "@/lib/types";
import { applyStoryStatusSync } from "@/lib/statusTrigger";
import { moveWorkUnitColumn } from "@/lib/completeMove";

// Helper to convert Prisma WorkUnit to DTO
function workUnitToDTO(wu: {
  id: string;
  storyId: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  verification: string | null;
  column: string;
  order: number;
  subNumber: number | null;
  createdAt: Date;
  completedAt: Date | null;
  archivedAt: Date | null;
  movedToQaReportedAt: Date | null;
  verificationRequestedAt: Date | null;
  verifiedAt: Date | null;
  verificationOutcome: string | null;
  verificationSummary: string | null;
}): WorkUnitDTO {
  return {
    id: wu.id,
    storyId: wu.storyId,
    title: wu.title,
    description: wu.description,
    acceptanceCriteria: wu.acceptanceCriteria,
    verification: wu.verification,
    column: wu.column as Column,
    order: wu.order,
    subNumber: wu.subNumber,
    createdAt: wu.createdAt.toISOString(),
    completedAt: wu.completedAt?.toISOString() ?? null,
    archivedAt: wu.archivedAt?.toISOString() ?? null,
    movedToQaReportedAt: wu.movedToQaReportedAt?.toISOString() ?? null,
    verificationRequestedAt: wu.verificationRequestedAt?.toISOString() ?? null,
    verifiedAt: wu.verifiedAt?.toISOString() ?? null,
    verificationOutcome: wu.verificationOutcome as "passed" | "failed" | null,
    verificationSummary: wu.verificationSummary,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { column, order } = body;

    // Validate required fields
    if (!column || order === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: column and order" },
        { status: 400 }
      );
    }

    // Verify work unit exists
    const existing = await prisma.workUnit.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Work unit not found" },
        { status: 404 }
      );
    }

    // Update the work unit with new column and order (stamps/clears
    // completedAt on entering/leaving done — see src/lib/completeMove.ts).
    const updated = await moveWorkUnitColumn(id, column, order, prisma);

    // Sync JIRA status from the board (non-blocking): applyStoryStatusSync
    // never throws internally, but this try/catch is load-bearing belt-and-
    // suspenders — the move must return 200 to the client regardless of
    // JIRA/Claude availability.
    try {
      await applyStoryStatusSync(existing.storyId, prisma);
    } catch (syncError) {
      console.warn("Non-blocking JIRA status sync failure:", syncError);
    }

    return NextResponse.json(workUnitToDTO(updated));
  } catch (error) {
    console.error("Error moving work unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
