/**
 * Claude-powered story-breakdown service.
 * Decomposes a JIRA story into concrete, implementable subtasks using Claude,
 * forcing structured output via a tool definition so the response is always
 * parseable JSON rather than free-form text.
 */

import { getAnthropicClient, type AnthropicLike, type AnthropicToolUseBlock } from "@/lib/anthropic/client";
import {
  buildContextUserBlock,
  CODEBASE_GROUNDING_INSTRUCTION,
} from "@/lib/anthropic/codebaseContext";

export type SubtaskDraft = {
  title: string; // short description of the unit of work
  acceptanceCriteria: string;
  verification: string;
};

const TOOL_NAME = "record_subtasks";

const SYSTEM_PROMPT = `You are an expert software engineering lead breaking a user story down into implementable work.

Decompose the given story into 2 to 6 concrete, implementable subtasks. Each subtask must have:
- "title": a short, concise, imperative description of one unit of work
- "acceptanceCriteria": testable criteria describing when the subtask is done
- "verification": a concrete method for verifying the subtask works (e.g. a test to run or a check to perform)

Call the ${TOOL_NAME} tool with the full list of subtasks. Do not respond with anything else.`;

const SUBTASKS_TOOL = {
  name: TOOL_NAME,
  description: "Record the list of subtasks that decompose the story.",
  input_schema: {
    type: "object",
    properties: {
      subtasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short, imperative description of the unit of work.",
            },
            acceptanceCriteria: {
              type: "string",
              description: "Testable acceptance criteria for the subtask.",
            },
            verification: {
              type: "string",
              description: "Concrete method for verifying the subtask is complete.",
            },
          },
          required: ["title", "acceptanceCriteria", "verification"],
        },
      },
    },
    required: ["subtasks"],
  },
};

function isSubtaskDraft(value: unknown): value is SubtaskDraft {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.title === "string" &&
    typeof record.acceptanceCriteria === "string" &&
    typeof record.verification === "string"
  );
}

function isToolUseBlock(block: { type: string }): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

function fallbackDraft(story: { summary: string; description: string | null }): SubtaskDraft {
  return {
    title: story.summary,
    acceptanceCriteria:
      story.description && story.description.trim().length > 0
        ? story.description
        : `Completes the story: ${story.summary}`,
    verification: "Manually verify the story's requirements are met.",
  };
}

/**
 * Breaks a JIRA story down into 2-6 implementable subtasks using Claude.
 * Forces structured output via a tool call so the response is always
 * machine-parseable. Falls back to a single subtask mirroring the story if
 * Claude returns zero subtasks.
 */
export async function breakDownStory(
  story: { summary: string; description: string | null; codebaseContext?: string },
  client?: AnthropicLike
): Promise<SubtaskDraft[]> {
  const anthropic = client ?? getAnthropicClient();
  const model = process.env.ANTHROPIC_BREAKDOWN_MODEL ?? "claude-sonnet-5";

  const base = story.description ? `${story.summary}\n\n${story.description}` : story.summary;
  const hasContext = Boolean(story.codebaseContext && story.codebaseContext.trim());
  const userContent = hasContext
    ? `${base}\n\n${buildContextUserBlock(story.codebaseContext!.trim())}`
    : base;
  const system = hasContext
    ? `${SYSTEM_PROMPT}\n\n${CODEBASE_GROUNDING_INSTRUCTION}`
    : SYSTEM_PROMPT;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: userContent }],
    tools: [SUBTASKS_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUseBlock = response.content.find(
    (block): block is AnthropicToolUseBlock => isToolUseBlock(block) && block.name === TOOL_NAME
  );

  const rawSubtasks =
    toolUseBlock && typeof toolUseBlock.input === "object" && toolUseBlock.input !== null
      ? (toolUseBlock.input as { subtasks?: unknown }).subtasks
      : undefined;

  const subtasks = Array.isArray(rawSubtasks) ? rawSubtasks.filter(isSubtaskDraft) : [];

  if (subtasks.length === 0) {
    return [fallbackDraft(story)];
  }

  return subtasks;
}
