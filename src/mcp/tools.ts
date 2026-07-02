/**
 * Ponder MCP tool handlers.
 *
 * Pure, testable functions of the form `(client, args) => Promise<result>`.
 * Each is a thin read wrapper around PonderClient — no business logic lives
 * here beyond formatting a plain-text summary for the LLM client.
 */

import { COLUMNS } from "@/lib/columns";
import type { Column, StoryDTO } from "@/lib/types";
import type { PonderClient } from "./client";

export interface McpTextResult {
  [x: string]: unknown;
  content: [{ type: "text"; text: string }];
}

function textResult(text: string): McpTextResult {
  return { content: [{ type: "text", text }] };
}

/** List all projects with their story/work-unit stats. */
export async function listProjects(client: PonderClient): Promise<McpTextResult> {
  const projects = await client.getProjects();

  if (projects.length === 0) {
    return textResult("No projects found.");
  }

  const lines = projects.map((project) => {
    const jiraKey = project.jiraProjectKey ?? "—";
    return `- ${project.name} (id: ${project.id}, type: ${project.type}, jiraProjectKey: ${jiraKey}, stories: ${project.storyCount}, workUnits: ${project.workUnitCount})`;
  });

  return textResult(
    `${projects.length} project(s):\n${lines.join("\n")}`
  );
}

function columnBreakdown(story: StoryDTO): string {
  const counts = new Map<Column, number>();
  for (const workUnit of story.workUnits) {
    counts.set(workUnit.column, (counts.get(workUnit.column) ?? 0) + 1);
  }

  return COLUMNS.filter((c) => (counts.get(c.key) ?? 0) > 0)
    .map((c) => `${c.key}: ${counts.get(c.key)}`)
    .join(", ") || "no work units";
}

/** List stories (with a per-column work-unit breakdown) for a project. */
export async function listStories(
  client: PonderClient,
  args: { projectId: string }
): Promise<McpTextResult> {
  const stories = await client.getStories(args.projectId);

  if (stories.length === 0) {
    return textResult(`No stories found for project ${args.projectId}.`);
  }

  const lines = stories.map(
    (story) =>
      `- ${story.jiraKey}: ${story.summary} [${story.jiraStatus}] — ${columnBreakdown(story)}`
  );

  return textResult(`${stories.length} story(ies):\n${lines.join("\n")}`);
}

/**
 * List work units across a project's stories, optionally filtered to a
 * single column.
 */
export async function listWorkUnits(
  client: PonderClient,
  args: { projectId: string; column?: string }
): Promise<McpTextResult> {
  const validColumns = COLUMNS.map((c) => c.key);

  if (args.column !== undefined && !validColumns.includes(args.column as Column)) {
    return textResult(
      `Invalid column "${args.column}". Valid columns: ${validColumns.join(", ")}.`
    );
  }

  const stories = await client.getStories(args.projectId);
  const column = args.column as Column | undefined;

  const rows: { id: string; title: string; column: Column; jiraKey: string }[] = [];
  for (const story of stories) {
    for (const workUnit of story.workUnits) {
      if (column && workUnit.column !== column) continue;
      rows.push({
        id: workUnit.id,
        title: workUnit.title,
        column: workUnit.column,
        jiraKey: story.jiraKey,
      });
    }
  }

  if (rows.length === 0) {
    return textResult(
      column
        ? `No work units in column "${column}" for project ${args.projectId}.`
        : `No work units found for project ${args.projectId}.`
    );
  }

  const lines = rows.map(
    (row) => `- ${row.title} (id: ${row.id}, column: ${row.column}, story: ${row.jiraKey})`
  );

  return textResult(`${rows.length} work unit(s):\n${lines.join("\n")}`);
}
