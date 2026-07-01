/**
 * GET /api/work-units/[id] - Fetch single work unit
 * PATCH /api/work-units/[id] - Update work unit
 * DELETE /api/work-units/[id] - Delete work unit
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Column, WorkUnitDTO } from "@/lib/types";

// Helper to convert Prisma WorkUnit to DTO
function workUnitToDTO(wu: {
  id: string;
  storyId: string;
  title: string;
  description: string | null;
  column: string;
  order: number;
  createdAt: Date;
  completedAt: Date | null;
}): WorkUnitDTO {
  return {
    id: wu.id,
    storyId: wu.storyId,
    title: wu.title,
    description: wu.description,
    column: wu.column as Column,
    order: wu.order,
    createdAt: wu.createdAt.toISOString(),
    completedAt: wu.completedAt?.toISOString() ?? null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
    });

    if (!workUnit) {
      return NextResponse.json(
        { error: "Work unit not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(workUnitToDTO(workUnit));
  } catch (error) {
    console.error("Error fetching work unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, column, order } = body;

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

    // Build update data (only update provided fields)
    const updateData: {
      title?: string;
      description?: string | null;
      column?: string;
      order?: number;
    } = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (column !== undefined) updateData.column = column;
    if (order !== undefined) updateData.order = order;

    const updated = await prisma.workUnit.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(workUnitToDTO(updated));
  } catch (error) {
    console.error("Error updating work unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await prisma.workUnit.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Work unit not found" },
        { status: 404 }
      );
    }

    await prisma.workUnit.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting work unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
