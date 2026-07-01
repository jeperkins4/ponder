/**
 * Unit tests for the Claude story-breakdown service.
 * Every test injects a fake AnthropicLike client — no network calls, and
 * ANTHROPIC_API_KEY is never required.
 */

import { describe, it, expect, vi } from "vitest";
import { breakDownStory, formatSubtaskDescription, type SubtaskDraft } from "@/lib/anthropic/breakdown";
import type {
  AnthropicLike,
  AnthropicMessageCreateParams,
  AnthropicMessageResponse,
} from "@/lib/anthropic/client";

function makeFakeClient(response: AnthropicMessageResponse) {
  const create = vi.fn(async (_params: AnthropicMessageCreateParams) => response);
  const client: AnthropicLike = { messages: { create } };
  return { client, create };
}

describe("breakDownStory", () => {
  it("returns the parsed subtask drafts from a forced tool-use response", async () => {
    const subtasks: SubtaskDraft[] = [
      {
        title: "Add login form",
        acceptanceCriteria: "Form renders and submits email/password",
        verification: "Run the component test suite",
      },
      {
        title: "Add authentication API route",
        acceptanceCriteria: "Route returns 200 with a session on valid credentials",
        verification: "Run the integration test for the login route",
      },
    ];

    const { client, create } = makeFakeClient({
      content: [
        { type: "tool_use", id: "toolu_01", name: "record_subtasks", input: { subtasks } },
      ],
    });

    const story = {
      summary: "Implement user login",
      description: "Users should be able to log in with email and password",
    };

    const result = await breakDownStory(story, client);

    expect(result).toEqual(subtasks);
    expect(result.length).toBeGreaterThanOrEqual(2);

    expect(create).toHaveBeenCalledTimes(1);
    const sentParams = create.mock.calls[0][0];
    const sentText = JSON.stringify(sentParams.messages);
    expect(sentText).toContain(story.summary);
    expect(sentText).toContain(story.description);

    // Structured output is forced via a tool definition + tool_choice.
    expect(sentParams.tools?.[0]?.name).toBe("record_subtasks");
    expect(sentParams.tool_choice).toEqual({ type: "tool", name: "record_subtasks" });
  });

  it("sends the story summary even when there is no description", async () => {
    const { client, create } = makeFakeClient({
      content: [
        {
          type: "tool_use",
          id: "toolu_02",
          name: "record_subtasks",
          input: {
            subtasks: [
              {
                title: "Do the thing",
                acceptanceCriteria: "The thing is done",
                verification: "Check the thing",
              },
              {
                title: "Verify the thing",
                acceptanceCriteria: "The thing works",
                verification: "Run a smoke test",
              },
            ],
          },
        },
      ],
    });

    await breakDownStory({ summary: "Do the thing", description: null }, client);

    const sentParams = create.mock.calls[0][0];
    const sentText = JSON.stringify(sentParams.messages);
    expect(sentText).toContain("Do the thing");
  });

  it("falls back to a single subtask mirroring the story when Claude returns zero subtasks", async () => {
    const { client } = makeFakeClient({
      content: [
        { type: "tool_use", id: "toolu_03", name: "record_subtasks", input: { subtasks: [] } },
      ],
    });

    const story = { summary: "Fix the flaky test", description: "It fails intermittently in CI" };
    const result = await breakDownStory(story, client);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe(story.summary);
    expect(result[0].acceptanceCriteria.length).toBeGreaterThan(0);
    expect(result[0].verification.length).toBeGreaterThan(0);
  });

  it("falls back to a single subtask when the tool-use block is missing entirely", async () => {
    const { client } = makeFakeClient({
      content: [{ type: "text", text: "I could not decompose this story." }],
    });

    const story = { summary: "Unclear story", description: null };
    const result = await breakDownStory(story, client);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe(story.summary);
  });
});

describe("formatSubtaskDescription", () => {
  it("formats the draft into the exact expected description", () => {
    const draft: SubtaskDraft = {
      title: "Add login form",
      acceptanceCriteria: "Form renders and submits email/password",
      verification: "Run the component test suite",
    };

    expect(formatSubtaskDescription(draft)).toBe(
      "Add login form\n\n" +
        "Acceptance Criteria:\n" +
        "Form renders and submits email/password\n\n" +
        "Verification:\n" +
        "Run the component test suite"
    );
  });
});
