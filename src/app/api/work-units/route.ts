/**
 * POST /api/work-units
 * Create a new work unit
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Column, StoryDTO } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storyId, title, description, column, order } = body;

    // Validate required fields
    if (!storyId || !title || !column || order === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: storyId, title, column, order" },
        { status: 400 }
      );
    }

    // Create the work unit
    await prisma.workUnit.create({
      data: {
        storyId,
        title,
        description: description || null,
        column,
        order,
      },
    });

    // Return the updated story with all work units
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: {
        workUnits: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!story) {
      return NextResponse.json(
        { error: "Story not found" },
        { status: 404 }
      );
    }

    // Convert Prisma model to DTO
    const storyDTO: StoryDTO = {
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
    };

    return NextResponse.json(storyDTO, { status: 201 });
  } catch (error) {
    console.error("Error creating work unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
