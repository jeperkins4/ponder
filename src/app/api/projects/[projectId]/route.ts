/**
 * GET /api/projects/[projectId] - Fetch a single project
 * PUT /api/projects/[projectId] - Update a project (name, jiraProjectKey)
 * DELETE /api/projects/[projectId] - Delete a project (cascades to its stories/work units)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { projectToDTO } from "@/lib/projectDto";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        _count: {
          select: { stories: true, workUnits: true },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(projectToDTO(project));
  } catch (error) {
    console.error("Error fetching project:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = await request.json();
    const { name, jiraProjectKey } = body;

    const existing = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(name !== undefined && { name }),
        ...(jiraProjectKey !== undefined && { jiraProjectKey }),
      },
      include: {
        _count: {
          select: { stories: true, workUnits: true },
        },
      },
    });

    return NextResponse.json(projectToDTO(project));
  } catch (error) {
    console.error("Error updating project:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const existing = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // The Project -> Story/WorkUnit foreign keys are ON DELETE SET NULL (and
    // WorkUnit -> Story is ON DELETE RESTRICT), so deleting a project would
    // otherwise just orphan its stories/work units rather than removing them.
    // Explicitly cascade the delete at the application level instead.
    await prisma.$transaction(async (tx) => {
      const stories = await tx.story.findMany({
        where: { projectId },
        select: { id: true },
      });
      const storyIds = stories.map((s) => s.id);

      await tx.workUnit.deleteMany({
        where: {
          OR: [{ projectId }, ...(storyIds.length > 0 ? [{ storyId: { in: storyIds } }] : [])],
        },
      });

      await tx.story.deleteMany({ where: { projectId } });

      await tx.project.delete({ where: { id: projectId } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
