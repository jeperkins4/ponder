/**
 * GET /api/projects - List all projects (with story/work-unit stats)
 * POST /api/projects - Create a new project
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { projectToDTO } from "@/lib/projectDto";

const VALID_TYPES = ["JIRA", "STANDALONE"];

export async function GET(_request: NextRequest) {
  try {
    const projects = await prisma.project.findMany({
      include: {
        _count: {
          select: { stories: true, workUnits: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(projects.map(projectToDTO));
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, jiraProjectKey, jiraSiteUrl, jiraEmail, jiraApiToken } = body;

    // Validate required fields
    if (!name || !type) {
      return NextResponse.json(
        { error: "Missing required fields: name, type" },
        { status: 400 }
      );
    }

    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Invalid type. Must be JIRA or STANDALONE" },
        { status: 400 }
      );
    }

    const project = await prisma.project.create({
      data: {
        name,
        type,
        // jiraProjectKey/jiraSiteUrl/jiraEmail/jiraApiToken only apply to JIRA-type projects
        jiraProjectKey: type === "JIRA" ? (jiraProjectKey ?? null) : null,
        jiraSiteUrl: type === "JIRA" ? (jiraSiteUrl ?? null) : null,
        jiraEmail: type === "JIRA" ? (jiraEmail ?? null) : null,
        jiraApiToken: type === "JIRA" ? (jiraApiToken ?? null) : null,
      },
      include: {
        _count: {
          select: { stories: true, workUnits: true },
        },
      },
    });

    return NextResponse.json(projectToDTO(project), { status: 201 });
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
