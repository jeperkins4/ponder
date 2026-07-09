/**
 * POST /api/projects/[projectId]/import/preview
 * Read-only preview of a JIRA import: fetches the project's filtered JIRA
 * stories and returns each with its computed target board column. Persists
 * nothing — the review UI (Task 5) renders this, and the process endpoint
 * (Task 4) does the actual write.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchStoriesForProject, type JiraConfig } from "@/lib/jira/client";
import { parseExcludedStatuses } from "@/lib/jira/jql";
import { jiraStatusToColumn } from "@/lib/columns";
import { findAlreadyImportedKeys } from "@/lib/importDedup";
import type { Column } from "@/lib/types";

export interface ImportPreviewStory {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  jiraStatusCategory?: "new" | "indeterminate" | "done";
  targetColumn: Column;
  alreadyImported: boolean;
}

export interface ImportPreviewResult {
  stories: ImportPreviewStory[];
  message?: string;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.type !== "JIRA" || !project.jiraProjectKey) {
      return NextResponse.json(
        { stories: [], message: "Project is not linked to JIRA" },
        { status: 200 }
      );
    }

    if (!project.jiraSiteUrl || !project.jiraEmail || !project.jiraApiToken) {
      return NextResponse.json(
        {
          stories: [],
          message: "JIRA credentials not configured. Add them in project settings.",
        },
        { status: 200 }
      );
    }

    const jiraConfig: JiraConfig = {
      siteUrl: project.jiraSiteUrl,
      email: project.jiraEmail,
      apiToken: project.jiraApiToken,
    };

    const jiraStories = await fetchStoriesForProject(
      project.jiraProjectKey,
      jiraConfig,
      parseExcludedStatuses(project.jiraExcludedStatuses)
    );

    const alreadyImportedKeys = await findAlreadyImportedKeys(
      jiraStories.map((dto) => dto.jiraKey),
      prisma
    );

    const stories: ImportPreviewStory[] = jiraStories.map((dto) => ({
      jiraKey: dto.jiraKey,
      jiraId: dto.jiraId,
      summary: dto.summary,
      description: dto.description,
      jiraStatus: dto.jiraStatus,
      jiraStatusCategory: dto.jiraStatusCategory,
      targetColumn: jiraStatusToColumn(dto.jiraStatus, dto.jiraStatusCategory),
      alreadyImported: alreadyImportedKeys.has(dto.jiraKey),
    }));

    const result: ImportPreviewResult = { stories };
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error building import preview:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch stories from JIRA";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
