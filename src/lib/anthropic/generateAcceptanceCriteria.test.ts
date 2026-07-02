/**
 * Unit tests for the single-work-unit AC/Verification generator.
 * Injects a fake AnthropicLike client — no network, no ANTHROPIC_API_KEY needed.
 */

import { describe, it, expect, vi } from "vitest";
import { generateAcceptanceCriteria } from "@/lib/anthropic/generateAcceptanceCriteria";
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

describe("generateAcceptanceCriteria", () => {
  it("returns the AC/verification from a forced tool-use response", async () => {
    const { client, create } = makeFakeClient({
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "record_acceptance",
          input: {
            acceptanceCriteria: "- Region checkbox list renders\n- Removal shows a warning modal",
            verification: "Manually toggle regions; run the region-assignment test.",
          },
        },
      ],
    });

    const result = await generateAcceptanceCriteria(
      { title: "Region Definition and Assignment", description: "Admins assign regions to events." },
      client
    );

    expect(result.acceptanceCriteria).toContain("Region checkbox list renders");
    expect(result.verification).toContain("region-assignment test");
    // The title + description are sent to the model.
    const sent = create.mock.calls[0][0];
    const userMsg = String(sent.messages[0].content);
    expect(userMsg).toContain("Region Definition and Assignment");
    expect(userMsg).toContain("Admins assign regions");
  });

  it("returns empty strings when the tool output is missing", async () => {
    const { client } = makeFakeClient({ content: [{ type: "text", text: "no tool call" }] });
    const result = await generateAcceptanceCriteria(
      { title: "Something", description: null },
      client
    );
    expect(result).toEqual({ acceptanceCriteria: "", verification: "" });
  });
});
