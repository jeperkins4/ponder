/**
 * GET /api/projects/[projectId]/jira/epics
 * Read-only list of a JIRA project's epics (key + name), used to populate
 * the epic picker in the import review UI. Never persists anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchEpicsForProject, type JiraConfig } from "@/lib/jira/client";

export interface JiraEpicsResult {
  epics: { key: string; name: string }[];
  message?: string;
}

export async function GET(
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
        { epics: [], message: "Project is not linked to JIRA" },
        { status: 200 }
      );
    }

    if (!project.jiraSiteUrl || !project.jiraEmail || !project.jiraApiToken) {
      return NextResponse.json(
        {
          epics: [],
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

    const epics = await fetchEpicsForProject(project.jiraProjectKey, jiraConfig);

    const result: JiraEpicsResult = { epics };
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error fetching JIRA epics:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch epics from JIRA";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
