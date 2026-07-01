/**
 * GET /api/stories
 * List all stories with their work units
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Column, StoryDTO } from "@/lib/types";

export async function GET(_request: NextRequest) {
  try {
    const stories = await prisma.story.findMany({
      include: {
        workUnits: {
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
        column: wu.column as Column,
        order: wu.order,
        createdAt: wu.createdAt.toISOString(),
        completedAt: wu.completedAt?.toISOString() ?? null,
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
