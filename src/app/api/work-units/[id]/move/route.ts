/**
 * POST /api/work-units/[id]/move - Move work unit to column and reorder
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Column, WorkUnitDTO } from "@/lib/types";
import { checkAndUpdateStoryStatus } from "@/lib/statusTrigger";

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { column, order } = body;

    // Validate required fields
    if (!column || order === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: column and order" },
        { status: 400 }
      );
    }

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

    // Update the work unit with new column and order
    const updated = await prisma.workUnit.update({
      where: { id },
      data: {
        column,
        order,
      },
    });

    // Check if all work units for this story are now done
    await checkAndUpdateStoryStatus(existing.storyId, prisma);

    return NextResponse.json(workUnitToDTO(updated));
  } catch (error) {
    console.error("Error moving work unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
