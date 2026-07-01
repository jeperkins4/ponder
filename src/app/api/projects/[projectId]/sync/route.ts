/**
 * POST /api/projects/[projectId]/sync
 * Trigger a JIRA sync scoped to a single project, filtered by that
 * project's jiraProjectKey.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncStoriesForProject } from "@/lib/sync";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const result = await syncStoriesForProject(projectId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error syncing project stories:", error);
    const message =
      error instanceof Error ? error.message : "Failed to sync stories from JIRA";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
