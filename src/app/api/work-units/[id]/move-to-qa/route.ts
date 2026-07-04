/**
 * POST /api/work-units/[id]/move-to-qa
 *
 * Posts this work unit's own evidence (title/description/acceptanceCriteria/
 * verification, its own attachments) to its parent story's JIRA issue as a
 * comment, then marks it reported. Once every one of the story's active work
 * units is both Done and reported, this also transitions the JIRA story to
 * QA and archives them all — see `reportWorkUnitToQA` for the full rule.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportWorkUnitToQA } from "@/lib/statusTrigger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }

    const result = await reportWorkUnitToQA(id, prisma);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({ ok: true, transitioned: !!result.transitioned });
  } catch (error) {
    console.error("Error reporting work unit to QA:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
