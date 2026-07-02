/**
 * Claude-powered generator for a single work unit's Acceptance Criteria and
 * Verification, derived from its title + description. Used by the "Regenerate"
 * action in the work-unit detail modal. Forces structured output via a tool
 * call so the response is always parseable.
 */

import {
  getAnthropicClient,
  type AnthropicLike,
  type AnthropicToolUseBlock,
} from "@/lib/anthropic/client";

export type GeneratedAcceptance = {
  acceptanceCriteria: string;
  verification: string;
};

const TOOL_NAME = "record_acceptance";

const SYSTEM_PROMPT = `You are an expert software engineering lead writing crisp acceptance criteria and verification steps for a single unit of work.

Given the unit of work's title and description, produce:
- "acceptanceCriteria": concise, testable criteria describing when this unit of work is done (use short bullet-style lines).
- "verification": a concrete method for verifying it works (e.g. tests to run or checks to perform).

Base them strictly on the given title and description; do not invent unrelated scope. Call the ${TOOL_NAME} tool with the result. Do not respond with anything else.`;

const ACCEPTANCE_TOOL = {
  name: TOOL_NAME,
  description: "Record the acceptance criteria and verification for the work unit.",
  input_schema: {
    type: "object",
    properties: {
      acceptanceCriteria: {
        type: "string",
        description: "Concise, testable acceptance criteria for the unit of work.",
      },
      verification: {
        type: "string",
        description: "Concrete method for verifying the unit of work is complete.",
      },
    },
    required: ["acceptanceCriteria", "verification"],
  },
};

function isToolUseBlock(block: { type: string }): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

export async function generateAcceptanceCriteria(
  workUnit: { title: string; description: string | null },
  client?: AnthropicLike
): Promise<GeneratedAcceptance> {
  const anthropic = client ?? getAnthropicClient();
  const model = process.env.ANTHROPIC_BREAKDOWN_MODEL ?? "claude-sonnet-5";

  const userContent = workUnit.description
    ? `${workUnit.title}\n\n${workUnit.description}`
    : workUnit.title;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    tools: [ACCEPTANCE_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUseBlock = response.content.find(
    (block): block is AnthropicToolUseBlock =>
      isToolUseBlock(block) && block.name === TOOL_NAME
  );

  const input =
    toolUseBlock && typeof toolUseBlock.input === "object" && toolUseBlock.input !== null
      ? (toolUseBlock.input as Partial<GeneratedAcceptance>)
      : {};

  return {
    acceptanceCriteria:
      typeof input.acceptanceCriteria === "string" ? input.acceptanceCriteria : "",
    verification: typeof input.verification === "string" ? input.verification : "",
  };
}
