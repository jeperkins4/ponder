/**
 * Claude-powered completion-summary service.
 * Produces a short prose summary of a story's completed work, used as the
 * lead-in for the JIRA comment posted when a story's board cards all reach
 * "done" (see `applyStoryStatusSync`).
 */

import { getAnthropicClient, type AnthropicLike } from "@/lib/anthropic/client";

export type SummarizableStory = {
  summary: string;
  description: string | null;
};

export type SummarizableWorkUnit = {
  title: string;
  description: string | null;
};

const SYSTEM_PROMPT = `You are an engineering lead writing a short status-update comment on a JIRA story.

Given the story and the list of work units that were completed, write a SHORT prose summary
(2 to 4 sentences) of the work that was done. Write in plain prose, no headings, no bullet
lists (the caller appends a bullet list of work-unit titles separately). Do not mention JIRA,
Ponder, or this prompt. Respond with ONLY the summary text.`;

/**
 * Summarizes the completed work for a story using Claude, for use in the
 * completion comment posted to JIRA. Falls back to a simple, deterministic
 * sentence if Claude returns an empty response.
 * @param story - The story (summary + description) the work belongs to
 * @param workUnits - The completed work units (title + description)
 * @param client - Optional injectable Anthropic client (for tests)
 * @returns A short plain-text prose summary
 */
export async function summarizeCompletedWork(
  story: SummarizableStory,
  workUnits: SummarizableWorkUnit[],
  client?: AnthropicLike
): Promise<string> {
  const anthropic = client ?? getAnthropicClient();
  const model = process.env.ANTHROPIC_BREAKDOWN_MODEL ?? "claude-sonnet-5";

  const workUnitLines = workUnits
    .map((w) => `- ${w.title}${w.description ? `: ${w.description}` : ""}`)
    .join("\n");

  const userContent = `Story: ${story.summary}\n${
    story.description ? `${story.description}\n` : ""
  }\nCompleted work units:\n${workUnitLines}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find(
    (block): block is { type: "text"; text: string } =>
      block.type === "text" && typeof (block as { text?: unknown }).text === "string"
  );

  const summary = textBlock?.text.trim();

  return summary && summary.length > 0
    ? summary
    : `Completed ${workUnits.length} work unit${workUnits.length === 1 ? "" : "s"} for "${story.summary}".`;
}
