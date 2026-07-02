/**
 * POST /api/work-units/reorder
 *
 * Persists a @dnd-kit drag result: the full ordered id list for every column
 * touched by the drag. Handles both within-column reordering (one column in
 * the body) and cross-column moves (two columns — the source the card left,
 * and the destination it landed in).
 *
 * The JIRA status write-back (`applyStoryStatusSync`) is triggered after the
 * transaction commits, same as the single-card move endpoint — a pure
 * within-column reorder never changes any work unit's `column`, so
 * `computeDesiredJiraStatus` sees no change and no-ops; a cross-column move
 * does change a column, which is exactly what should trigger a JIRA sync.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COLUMNS } from "@/lib/columns";
import { applyStoryStatusSync } from "@/lib/statusTrigger";

const VALID_COLUMNS: Set<string> = new Set(COLUMNS.map((c) => c.key));

type ReorderBody = {
  movedId: string;
  columns: Record<string, string[]>;
};

function isValidBody(body: unknown): body is ReorderBody {
  if (!body || typeof body !== "object") return false;
  const { movedId, columns } = body as Record<string, unknown>;
  if (typeof movedId !== "string" || movedId.length === 0) return false;
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) {
    return false;
  }
  return Object.entries(columns as Record<string, unknown>).every(
    ([column, ids]) =>
      VALID_COLUMNS.has(column) &&
      Array.isArray(ids) &&
      ids.every((id) => typeof id === "string" && id.length > 0)
  );
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed request body" },
        { status: 400 }
      );
    }

    if (!isValidBody(body)) {
      return NextResponse.json(
        {
          error:
            "Malformed request body: expected { movedId: string; columns: Record<string, string[]> }",
        },
        { status: 400 }
      );
    }

    const { movedId, columns } = body;

    const movedUnit = await prisma.workUnit.findUnique({
      where: { id: movedId },
    });
    if (!movedUnit) {
      return NextResponse.json(
        { error: "Work unit not found" },
        { status: 404 }
      );
    }

    await prisma.$transaction(
      Object.entries(columns).flatMap(([column, ids]) =>
        ids.map((id, index) =>
          prisma.workUnit.update({
            where: { id },
            data: { column, order: index },
          })
        )
      )
    );

    // Sync JIRA status from the board (non-blocking): applyStoryStatusSync
    // never throws internally, but this try/catch is load-bearing
    // belt-and-suspenders — the reorder must return 200 to the client
    // regardless of JIRA/Claude availability. A pure within-column reorder
    // leaves every work unit's column unchanged, so computeDesiredJiraStatus
    // sees nothing to sync and this is naturally a no-op in that case.
    try {
      await applyStoryStatusSync(movedUnit.storyId, prisma);
    } catch (syncError) {
      console.warn("Non-blocking JIRA status sync failure:", syncError);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error reordering work units:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
