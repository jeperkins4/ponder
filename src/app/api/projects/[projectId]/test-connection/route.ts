/**
 * POST /api/projects/[projectId]/test-connection
 *
 * Validates a set of JIRA credentials for a project without persisting
 * anything. Body fields (`jiraSiteUrl`, `jiraEmail`, `jiraApiToken`) are
 * merged with the project's stored credentials: any body field that is
 * missing or blank falls back to the value already stored on the project.
 * This lets the settings UI test a connection while leaving the API token
 * field blank (since the stored token is never sent back to the client).
 *
 * A failed connection test is a normal result, not a server error: this
 * always responds 200 with `{ ok: boolean, error?, displayName? }`. The raw
 * API token is never echoed back in the response.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { testJiraConnection } from "@/lib/jira/client";

function firstNonBlank(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const siteUrl = firstNonBlank(body.jiraSiteUrl, project.jiraSiteUrl);
    const email = firstNonBlank(body.jiraEmail, project.jiraEmail);
    const apiToken = firstNonBlank(body.jiraApiToken, project.jiraApiToken);

    if (!siteUrl || !email || !apiToken) {
      return NextResponse.json(
        { ok: false, error: "JIRA credentials are incomplete." },
        { status: 200 }
      );
    }

    const result = await testJiraConnection({ siteUrl, email, apiToken });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error testing JIRA connection:", error);
    const message =
      error instanceof Error ? error.message : "Failed to test JIRA connection";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
