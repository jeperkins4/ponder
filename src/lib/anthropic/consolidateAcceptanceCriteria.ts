/**
 * Claude-powered acceptance-criteria consolidation service.
 * Rolls up a story's work units' individual acceptance-criteria/verification
 * notes into a single, concise pair of sections for the completion comment
 * posted to JIRA (see `applyStoryStatusSync`) — not a per-card dump.
 */

import { getAnthropicClient, type AnthropicLike, type AnthropicToolUseBlock } from "@/lib/anthropic/client";

export type ConsolidatableStory = {
  summary: string;
  description: string | null;
};

export type ConsolidatableWorkUnit = {
  title: string;
  acceptanceCriteria: string | null;
  verification: string | null;
};

export type ConsolidatedAcceptanceCriteria = {
  acceptanceCriteria: string;
  verification: string;
};

const TOOL_NAME = "record_consolidated_criteria";

const SYSTEM_PROMPT = `You are an engineering lead writing the final acceptance-criteria and verification sections for a JIRA story's completion comment.

Given the story and the acceptance-criteria/verification notes recorded on its individual work units, produce:
- "acceptanceCriteria": a SINGLE concise, consolidated acceptance-criteria list for the whole story (not a per-card dump — merge overlapping points, drop redundancy).
- "verification": a SINGLE concise summary of how the completed work was verified.

Call the ${TOOL_NAME} tool with both fields. Do not respond with anything else.`;

const CRITERIA_TOOL = {
  name: TOOL_NAME,
  description: "Record the consolidated acceptance criteria and verification summary for the story.",
  input_schema: {
    type: "object",
    properties: {
      acceptanceCriteria: {
        type: "string",
        description: "Single consolidated acceptance-criteria list for the whole story.",
      },
      verification: {
        type: "string",
        description: "Single consolidated verification summary for the whole story.",
      },
    },
    required: ["acceptanceCriteria", "verification"],
  },
};

function isToolUseBlock(block: { type: string }): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

/**
 * Consolidates a story's work units' acceptance-criteria/verification notes
 * into a single concise pair of strings using Claude. If none of the work
 * units have any acceptance-criteria or verification text, returns empty
 * strings without calling Claude.
 * @param story - The story (summary + description) the work belongs to
 * @param workUnits - The story's work units (title + acceptanceCriteria + verification)
 * @param client - Optional injectable Anthropic client (for tests)
 */
export async function consolidateAcceptanceCriteria(
  story: ConsolidatableStory,
  workUnits: ConsolidatableWorkUnit[],
  client?: AnthropicLike
): Promise<ConsolidatedAcceptanceCriteria> {
  const withNotes = workUnits.filter(
    (w) => (w.acceptanceCriteria && w.acceptanceCriteria.trim().length > 0) ||
      (w.verification && w.verification.trim().length > 0)
  );

  if (withNotes.length === 0) {
    return { acceptanceCriteria: "", verification: "" };
  }

  const anthropic = client ?? getAnthropicClient();
  const model = process.env.ANTHROPIC_BREAKDOWN_MODEL ?? "claude-sonnet-5";

  const workUnitLines = withNotes
    .map((w) => {
      const parts = [`- ${w.title}`];
      if (w.acceptanceCriteria) parts.push(`  Acceptance criteria: ${w.acceptanceCriteria}`);
      if (w.verification) parts.push(`  Verification: ${w.verification}`);
      return parts.join("\n");
    })
    .join("\n");

  const userContent = `Story: ${story.summary}\n${
    story.description ? `${story.description}\n` : ""
  }\nWork units:\n${workUnitLines}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    tools: [CRITERIA_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUseBlock = response.content.find(
    (block): block is AnthropicToolUseBlock => isToolUseBlock(block) && block.name === TOOL_NAME
  );

  const input =
    toolUseBlock && typeof toolUseBlock.input === "object" && toolUseBlock.input !== null
      ? (toolUseBlock.input as { acceptanceCriteria?: unknown; verification?: unknown })
      : undefined;

  return {
    acceptanceCriteria: typeof input?.acceptanceCriteria === "string" ? input.acceptanceCriteria : "",
    verification: typeof input?.verification === "string" ? input.verification : "",
  };
}
