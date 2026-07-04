/**
 * GET /api/stories
 * List stories with their work units. Accepts an optional `?projectId=`
 * query param to filter to a single project; omitting it returns all
 * stories (backward compatible with pre-multi-project callers).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Column, StoryDTO } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId");

    const stories = await prisma.story.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        // A story is visible unless it has work units AND every one of them
        // is archived. Stories with zero work units remain visible (that's
        // pre-existing, out-of-scope behavior for this filter).
        OR: [
          { workUnits: { none: {} } },
          { workUnits: { some: { archivedAt: null } } },
        ],
      },
      include: {
        workUnits: {
          where: { archivedAt: null },
          orderBy: { order: "asc" },
        },
      },
    });

    // Convert Prisma models to DTOs
    const storyDTOs: StoryDTO[] = stories.map((story) => ({
      id: story.id,
      jiraKey: story.jiraKey,
      jiraId: story.jiraId,
      projectKey: story.projectKey,
      summary: story.summary,
      description: story.description,
      jiraStatus: story.jiraStatus,
      url: story.url,
      lastSyncedAt: story.lastSyncedAt.toISOString(),
      completionCommentPostedAt: story.completionCommentPostedAt?.toISOString() ?? null,
      workUnits: story.workUnits.map((wu) => ({
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
        verificationRequestedAt: wu.verificationRequestedAt?.toISOString() ?? null,
        verifiedAt: wu.verifiedAt?.toISOString() ?? null,
        verificationOutcome: wu.verificationOutcome as "passed" | "failed" | null,
        verificationSummary: wu.verificationSummary,
      })),
    }));

    return NextResponse.json(storyDTOs);
  } catch (error) {
    console.error("Error fetching stories:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
