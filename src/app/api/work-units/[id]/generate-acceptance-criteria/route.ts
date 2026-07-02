/**
 * POST /api/work-units/[id]/generate-acceptance-criteria
 *
 * (Re)generates the work unit's Acceptance Criteria and Verification from its
 * title + description using Claude, persists them, and returns the new values.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateAcceptanceCriteria } from "@/lib/anthropic/generateAcceptanceCriteria";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
      select: { id: true, title: true, description: true },
    });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }

    const { acceptanceCriteria, verification } = await generateAcceptanceCriteria({
      title: workUnit.title,
      description: workUnit.description,
    });

    const updated = await prisma.workUnit.update({
      where: { id },
      data: { acceptanceCriteria, verification },
      select: { acceptanceCriteria: true, verification: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error generating acceptance criteria:", error);
    return NextResponse.json(
      { error: "Failed to generate acceptance criteria" },
      { status: 500 }
    );
  }
}
