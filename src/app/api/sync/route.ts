/**
 * POST /api/sync
 * Manually trigger sync from JIRA
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncStoriesFromJira, type SyncResult } from "@/lib/sync";
import type { JiraConfig } from "@/lib/jira/client";

export async function POST(request: NextRequest) {
  try {
    // Extract project keys from request body, or default to env
    let projectKeys: string[];

    try {
      const body = await request.json();
      projectKeys = body.projectKeys;
    } catch {
      // If body is not JSON or empty, use env
      projectKeys = undefined as any;
    }

    // If not provided in body, get from env
    if (!projectKeys || projectKeys.length === 0) {
      const envKeys = process.env.JIRA_PROJECT_KEYS;
      if (!envKeys) {
        return NextResponse.json(
          { error: "No project keys provided and JIRA_PROJECT_KEYS not set" },
          { status: 400 }
        );
      }
      projectKeys = envKeys.split(",").map((key) => key.trim());
    }

    // Build JIRA config from environment
    const jiraConfig: JiraConfig = {
      siteUrl: process.env.JIRA_SITE_URL!,
      email: process.env.JIRA_EMAIL!,
      apiToken: process.env.JIRA_API_TOKEN!,
    };

    // Validate JIRA config
    if (!jiraConfig.siteUrl || !jiraConfig.email || !jiraConfig.apiToken) {
      return NextResponse.json(
        { error: "JIRA configuration incomplete (missing siteUrl, email, or apiToken)" },
        { status: 500 }
      );
    }

    // Perform sync
    const result: SyncResult = await syncStoriesFromJira(projectKeys, jiraConfig, prisma);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error syncing stories:", error);
    return NextResponse.json(
      { error: "Failed to sync stories from JIRA" },
      { status: 500 }
    );
  }
}
