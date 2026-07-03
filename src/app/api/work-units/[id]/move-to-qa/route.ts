/**
 * POST /api/work-units/[id]/move-to-qa
 *
 * Explicitly transitions the work unit's parent JIRA story to "QA". Only
 * succeeds when every one of the story's work units is Done — see
 * transitionStoryToQA for the full rule.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transitionStoryToQA } from "@/lib/statusTrigger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
      select: { id: true, storyId: true },
    });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }

    const result = await transitionStoryToQA(workUnit.storyId, prisma);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error moving story to QA:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
