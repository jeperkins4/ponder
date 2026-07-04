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
import { readLocalImage } from "./readLocalImage";

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
  args: { projectId: string; column?: string; pendingVerification?: boolean }
): Promise<McpTextResult> {
  const validColumns = COLUMNS.map((c) => c.key);

  if (args.column !== undefined && !validColumns.includes(args.column as Column)) {
    return textResult(
      `Invalid column "${args.column}". Valid columns: ${validColumns.join(", ")}.`
    );
  }

  const stories = await client.getStories(args.projectId);
  const column = args.column as Column | undefined;

  const rows: {
    id: string;
    title: string;
    column: Column;
    jiraKey: string;
    verification: string | null;
  }[] = [];
  for (const story of stories) {
    for (const workUnit of story.workUnits) {
      if (column && workUnit.column !== column) continue;
      if (args.pendingVerification) {
        if (!workUnit.verificationRequestedAt || workUnit.verifiedAt) continue;
      }
      rows.push({
        id: workUnit.id,
        title: workUnit.title,
        column: workUnit.column,
        jiraKey: story.jiraKey,
        verification: workUnit.verification,
      });
    }
  }

  if (rows.length === 0) {
    if (args.pendingVerification) {
      return textResult(`No work units pending verification for project ${args.projectId}.`);
    }
    return textResult(
      column
        ? `No work units in column "${column}" for project ${args.projectId}.`
        : `No work units found for project ${args.projectId}.`
    );
  }

  const lines = rows.map((row) => {
    const verificationNote = args.pendingVerification
      ? ` — verification steps: ${row.verification ?? "(missing — document them as you verify)"}`
      : "";
    return `- ${row.title} (id: ${row.id}, column: ${row.column}, story: ${row.jiraKey})${verificationNote}`;
  });

  return textResult(`${rows.length} work unit(s):\n${lines.join("\n")}`);
}

/**
 * Move a work unit to a column (and optional order). Moving to a working
 * lane or Done triggers Ponder's server-side JIRA status write-back
 * (In Progress, or Code Revew + a summary comment) — this tool does not
 * reimplement that, it just calls the move endpoint.
 */
export async function moveWorkUnit(
  client: PonderClient,
  args: { workUnitId: string; column: string; order?: number }
): Promise<McpTextResult> {
  const validColumns = COLUMNS.map((c) => c.key);

  if (!validColumns.includes(args.column as Column)) {
    return textResult(
      `Invalid column "${args.column}". Valid columns: ${validColumns.join(", ")}.`
    );
  }

  try {
    const workUnit = await client.moveWorkUnit(
      args.workUnitId,
      args.column as Column,
      args.order
    );
    return textResult(
      `Moved "${workUnit.title}" (id: ${workUnit.id}) to column "${workUnit.column}".`
    );
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Convenience wrapper over moveWorkUnit that moves a work unit to Done. Once
 * all of a story's work units are Done, Ponder's server-side write-back may
 * drive the linked JIRA issue to Code Revew (+ a summary comment).
 */
export async function markDone(
  client: PonderClient,
  args: { workUnitId: string }
): Promise<McpTextResult> {
  return moveWorkUnit(client, { workUnitId: args.workUnitId, column: "done" });
}

/** Update a work unit's title and/or description. */
export async function updateWorkUnit(
  client: PonderClient,
  args: { workUnitId: string; title?: string; description?: string }
): Promise<McpTextResult> {
  if (args.title === undefined && args.description === undefined) {
    return textResult(
      "Error: at least one of title or description must be provided."
    );
  }

  const patch: { title?: string; description?: string } = {};
  if (args.title !== undefined) patch.title = args.title;
  if (args.description !== undefined) patch.description = args.description;

  try {
    const workUnit = await client.updateWorkUnit(args.workUnitId, patch);
    return textResult(
      `Updated work unit "${workUnit.title}" (id: ${workUnit.id}).`
    );
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Regenerate a work unit's AC/verification, optionally grounded in a graph slice. */
export async function regenerateAcceptance(
  client: PonderClient,
  args: { workUnitId: string; codebaseContext?: string }
): Promise<McpTextResult> {
  try {
    const { acceptanceCriteria, verification } = await client.regenerateAcceptance(
      args.workUnitId,
      args.codebaseContext
    );
    return textResult(
      `Regenerated work unit ${args.workUnitId}.\n\n` +
        `Acceptance Criteria:\n${acceptanceCriteria}\n\n` +
        `Verification:\n${verification}`
    );
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Attach a local image file (e.g. a screenshot) to a work unit as evidence. */
export async function attachImage(
  client: PonderClient,
  args: { workUnitId: string; filePath: string; filename?: string }
): Promise<McpTextResult> {
  try {
    const { buffer, filename, mimeType } = await readLocalImage(
      args.filePath,
      args.filename
    );
    const attachment = await client.addAttachment(
      args.workUnitId,
      buffer,
      filename,
      mimeType
    );
    return textResult(
      `Attached "${attachment.filename}" (${attachment.mimeType}, ${attachment.size} bytes) to work unit ${args.workUnitId}.`
    );
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Report the outcome of an AI-agent verification run (see the Verify button). */
export async function reportVerification(
  client: PonderClient,
  args: {
    workUnitId: string;
    outcome: "passed" | "failed";
    summary: string;
    verificationSteps?: string;
  }
): Promise<McpTextResult> {
  try {
    const workUnit = await client.reportVerification(
      args.workUnitId,
      args.outcome,
      args.summary,
      args.verificationSteps
    );
    return textResult(
      `Recorded verification result "${args.outcome}" for work unit ${workUnit.id}.`
    );
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
