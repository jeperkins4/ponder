/**
 * Unit tests for the Claude acceptance-criteria consolidation service.
 * Every test injects a fake AnthropicLike client — no network calls, and
 * ANTHROPIC_API_KEY is never required.
 */

import { describe, it, expect, vi } from "vitest";
import { consolidateAcceptanceCriteria } from "@/lib/anthropic/consolidateAcceptanceCriteria";
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

function toolResponse(input: Record<string, unknown>): AnthropicMessageResponse {
  return {
    content: [
      {
        type: "tool_use",
        id: "tool_1",
        name: "record_consolidated_criteria",
        input,
      },
    ],
  };
}

describe("consolidateAcceptanceCriteria", () => {
  const story = {
    summary: "Implement user login",
    description: "Users should be able to log in with email and password",
  };

  it("returns the consolidated AC/verification from Claude's tool call", async () => {
    const workUnits = [
      {
        title: "Add login form",
        acceptanceCriteria: "Form renders and validates required fields",
        verification: "Manually submit the form with valid/invalid input",
      },
      {
        title: "Add authentication API route",
        acceptanceCriteria: "Route returns 200 with a session cookie on valid credentials",
        verification: "curl the route with valid and invalid credentials",
      },
    ];

    const { client, create } = makeFakeClient(
      toolResponse({
        acceptanceCriteria: "Users can log in with email/password and receive a session.",
        verification: "Manually verified login form and API route with valid/invalid credentials.",
      })
    );

    const result = await consolidateAcceptanceCriteria(story, workUnits, client);

    expect(result.acceptanceCriteria).toBe(
      "Users can log in with email/password and receive a session."
    );
    expect(result.verification).toBe(
      "Manually verified login form and API route with valid/invalid credentials."
    );
    expect(create).toHaveBeenCalledTimes(1);
    const sentParams = create.mock.calls[0][0];
    const sentText = JSON.stringify(sentParams.messages);
    expect(sentText).toContain(story.summary);
    expect(sentText).toContain(workUnits[0].title);
    expect(sentText).toContain(workUnits[1].acceptanceCriteria);
  });

  it("uses the ANTHROPIC_BREAKDOWN_MODEL env var when set", async () => {
    const original = process.env.ANTHROPIC_BREAKDOWN_MODEL;
    process.env.ANTHROPIC_BREAKDOWN_MODEL = "claude-test-model";

    const { client, create } = makeFakeClient(
      toolResponse({ acceptanceCriteria: "AC", verification: "Verification" })
    );

    await consolidateAcceptanceCriteria(
      story,
      [{ title: "Task", acceptanceCriteria: "AC", verification: "V" }],
      client
    );

    expect(create.mock.calls[0][0].model).toBe("claude-test-model");

    if (original === undefined) {
      delete process.env.ANTHROPIC_BREAKDOWN_MODEL;
    } else {
      process.env.ANTHROPIC_BREAKDOWN_MODEL = original;
    }
  });

  it("returns empty strings and does not call Claude when no work unit has AC or verification", async () => {
    const { client, create } = makeFakeClient(toolResponse({ acceptanceCriteria: "x", verification: "y" }));

    const result = await consolidateAcceptanceCriteria(
      story,
      [
        { title: "Task 1", acceptanceCriteria: null, verification: null },
        { title: "Task 2", acceptanceCriteria: "", verification: "   " },
      ],
      client
    );

    expect(result).toEqual({ acceptanceCriteria: "", verification: "" });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns empty strings when Claude returns no tool_use block", async () => {
    const { client } = makeFakeClient({ content: [] });

    const result = await consolidateAcceptanceCriteria(
      story,
      [{ title: "Task", acceptanceCriteria: "AC", verification: "V" }],
      client
    );

    expect(result).toEqual({ acceptanceCriteria: "", verification: "" });
  });
});
