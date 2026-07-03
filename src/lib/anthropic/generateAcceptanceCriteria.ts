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
import {
  buildContextUserBlock,
  CODEBASE_GROUNDING_INSTRUCTION,
} from "@/lib/anthropic/codebaseContext";

export type GeneratedAcceptance = {
  acceptanceCriteria: string;
  verification: string;
};

const TOOL_NAME = "record_acceptance";

const SYSTEM_PROMPT = `You are an expert software engineering lead writing crisp acceptance criteria and verification steps for a single unit of work.

Given the unit of work's title and description, produce BOTH of the following, and BOTH must be non-empty and distinct from each other:
- "acceptanceCriteria": a SHORT bulleted list (roughly 3-7 concise bullet lines) of the essential done-conditions. Do NOT restate the whole description — capture only the key testable outcomes. Keep it tight.
- "verification": 1-4 concrete steps for verifying it works (e.g. specific tests to run, manual checks, or QA steps). This is HOW you confirm the acceptance criteria are met — not a repeat of them.

Base them strictly on the given title and description; do not invent unrelated scope. You MUST provide a meaningful, non-empty "verification". Call the ${TOOL_NAME} tool with both fields. Do not respond with anything else.`;

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
  workUnit: { title: string; description: string | null; codebaseContext?: string },
  client?: AnthropicLike
): Promise<GeneratedAcceptance> {
  const anthropic = client ?? getAnthropicClient();
  const model = process.env.ANTHROPIC_BREAKDOWN_MODEL ?? "claude-sonnet-5";

  const base = workUnit.description
    ? `${workUnit.title}\n\n${workUnit.description}`
    : workUnit.title;
  const hasContext = Boolean(workUnit.codebaseContext && workUnit.codebaseContext.trim());
  const userContent = hasContext
    ? `${base}\n\n${buildContextUserBlock(workUnit.codebaseContext!.trim())}`
    : base;
  const system = hasContext
    ? `${SYSTEM_PROMPT}\n\n${CODEBASE_GROUNDING_INSTRUCTION}`
    : SYSTEM_PROMPT;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    system,
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
