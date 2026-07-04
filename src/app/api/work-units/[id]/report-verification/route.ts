/**
 * POST /api/work-units/[id]/report-verification
 *
 * Records the result of an AI-agent verification run (see the "Verify"
 * button / request-verification endpoint). Called by the report_verification
 * MCP tool, never directly by the browser UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WorkUnitDTO } from "@/lib/types";

const VALID_OUTCOMES = ["passed", "failed"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { outcome, summary, verificationSteps } = body ?? {};

    if (!VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: `outcome must be one of: ${VALID_OUTCOMES.join(", ")}` },
        { status: 400 }
      );
    }
    if (typeof summary !== "string" || summary.trim() === "") {
      return NextResponse.json({ error: "summary is required" }, { status: 400 });
    }

    const workUnit = await prisma.workUnit.findUnique({ where: { id } });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }

    const updated = await prisma.workUnit.update({
      where: { id },
      data: {
        verifiedAt: new Date(),
        verificationOutcome: outcome,
        verificationSummary: summary,
        verificationRequestedAt: null,
        ...(typeof verificationSteps === "string" && !workUnit.verification
          ? { verification: verificationSteps }
          : {}),
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
      verificationRequestedAt: updated.verificationRequestedAt?.toISOString() ?? null,
      verifiedAt: updated.verifiedAt?.toISOString() ?? null,
      verificationOutcome: updated.verificationOutcome as WorkUnitDTO["verificationOutcome"],
      verificationSummary: updated.verificationSummary,
    };

    return NextResponse.json(dto);
  } catch (error) {
    console.error("Error reporting verification:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
