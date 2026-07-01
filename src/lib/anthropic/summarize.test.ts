/**
 * Unit tests for the Claude completion-summary service.
 * Every test injects a fake AnthropicLike client — no network calls, and
 * ANTHROPIC_API_KEY is never required.
 */

import { describe, it, expect, vi } from "vitest";
import { summarizeCompletedWork } from "@/lib/anthropic/summarize";
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

describe("summarizeCompletedWork", () => {
  const story = {
    summary: "Implement user login",
    description: "Users should be able to log in with email and password",
  };
  const workUnits = [
    { title: "Add login form", description: "Renders and submits credentials" },
    { title: "Add authentication API route", description: null },
  ];

  it("returns Claude's text response", async () => {
    const { client, create } = makeFakeClient({
      content: [{ type: "text", text: "Login was implemented end to end." }],
    });

    const result = await summarizeCompletedWork(story, workUnits, client);

    expect(result).toBe("Login was implemented end to end.");
    expect(create).toHaveBeenCalledTimes(1);
    const sentParams = create.mock.calls[0][0];
    const sentText = JSON.stringify(sentParams.messages);
    expect(sentText).toContain(story.summary);
    expect(sentText).toContain(workUnits[0].title);
    expect(sentText).toContain(workUnits[1].title);
  });

  it("uses the ANTHROPIC_BREAKDOWN_MODEL env var when set", async () => {
    const original = process.env.ANTHROPIC_BREAKDOWN_MODEL;
    process.env.ANTHROPIC_BREAKDOWN_MODEL = "claude-test-model";

    const { client, create } = makeFakeClient({
      content: [{ type: "text", text: "Summary." }],
    });

    await summarizeCompletedWork(story, workUnits, client);

    expect(create.mock.calls[0][0].model).toBe("claude-test-model");

    if (original === undefined) {
      delete process.env.ANTHROPIC_BREAKDOWN_MODEL;
    } else {
      process.env.ANTHROPIC_BREAKDOWN_MODEL = original;
    }
  });

  it("falls back to a deterministic sentence when Claude returns no text block", async () => {
    const { client } = makeFakeClient({ content: [] });

    const result = await summarizeCompletedWork(story, workUnits, client);

    expect(result).toContain("2 work units");
    expect(result).toContain(story.summary);
  });

  it("falls back when Claude returns an empty text block", async () => {
    const { client } = makeFakeClient({ content: [{ type: "text", text: "   " }] });

    const result = await summarizeCompletedWork(story, [workUnits[0]], client);

    expect(result).toContain("1 work unit");
  });
});
