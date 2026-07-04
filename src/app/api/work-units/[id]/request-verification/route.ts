/**
 * POST /api/work-units/[id]/request-verification
 *
 * Marks a Code Review-lane work unit as awaiting AI-agent verification.
 * Clears any prior result so a fresh request always starts clean.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WorkUnitDTO } from "@/lib/types";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({ where: { id } });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }
    if (workUnit.column !== "code_review") {
      return NextResponse.json(
        { error: "Work unit must be in Code Review to request verification" },
        { status: 422 }
      );
    }

    const updated = await prisma.workUnit.update({
      where: { id },
      data: {
        verificationRequestedAt: new Date(),
        verifiedAt: null,
        verificationOutcome: null,
        verificationSummary: null,
      },
    });

    const dto: WorkUnitDTO = {
      id: updated.id,
      storyId: updated.storyId,
      title: updated.title,
      description: updated.description,
      acceptanceCriteria: updated.acceptanceCriteria,
      verification: updated.verification,
      column: updated.column as WorkUnitDTO["column"],
      order: updated.order,
      subNumber: updated.subNumber,
      createdAt: updated.createdAt.toISOString(),
      completedAt: updated.completedAt?.toISOString() ?? null,
      archivedAt: updated.archivedAt?.toISOString() ?? null,
      movedToQaReportedAt: updated.movedToQaReportedAt?.toISOString() ?? null,
      verificationRequestedAt: updated.verificationRequestedAt?.toISOString() ?? null,
      verifiedAt: updated.verifiedAt?.toISOString() ?? null,
      verificationOutcome: updated.verificationOutcome as WorkUnitDTO["verificationOutcome"],
      verificationSummary: updated.verificationSummary,
    };

    return NextResponse.json(dto);
  } catch (error) {
    console.error("Error requesting verification:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
