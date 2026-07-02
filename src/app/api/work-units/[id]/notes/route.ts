/**
 * GET /api/work-units/[id]/notes - List a work unit's notes (chronological)
 * POST /api/work-units/[id]/notes - Append a note to a work unit
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WorkNoteDTO } from "@/lib/types";

// Helper to convert Prisma WorkNote to DTO
function workNoteToDTO(note: {
  id: string;
  workUnitId: string;
  body: string;
  createdAt: Date;
}): WorkNoteDTO {
  return {
    id: note.id,
    workUnitId: note.workUnitId,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
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

    const notes = await prisma.workNote.findMany({
      where: { workUnitId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(notes.map(workNoteToDTO));
  } catch (error) {
    console.error("Error fetching work notes:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { body: noteBody } = body;

    if (typeof noteBody !== "string" || noteBody.trim().length === 0) {
      return NextResponse.json(
        { error: "Note body must not be empty" },
        { status: 400 }
      );
    }

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
    });

    if (!workUnit) {
      return NextResponse.json(
        { error: "Work unit not found" },
        { status: 404 }
      );
    }

    const created = await prisma.workNote.create({
      data: {
        workUnitId: id,
        body: noteBody.trim(),
      },
    });

    return NextResponse.json(workNoteToDTO(created), { status: 201 });
  } catch (error) {
    console.error("Error creating work note:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
