/**
 * Anthropic (Claude) API client
 * Lazily-constructed singleton — the API key is only read (and validated) the
 * first time a caller actually needs the client, not at module load time, so
 * builds/tests never require ANTHROPIC_API_KEY to be set.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * A single content block we care about in a Claude message response.
 * Real responses can include other block types (text, thinking, etc.); we
 * only need to recognize tool_use blocks, so anything else is left untyped.
 */
export type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type AnthropicContentBlock =
  | AnthropicToolUseBlock
  | { type: string; [key: string]: unknown };

export type AnthropicMessageResponse = {
  content: AnthropicContentBlock[];
};

export type AnthropicMessageParam = {
  role: "user" | "assistant";
  content: string;
};

export type AnthropicToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type AnthropicMessageCreateParams = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessageParam[];
  tools?: AnthropicToolDefinition[];
  tool_choice?: { type: "tool"; name: string } | { type: "auto" } | { type: "any" };
};

/**
 * The minimal subset of the Anthropic Messages API this codebase depends on.
 * Kept narrow and dependency-free of SDK-internal types so tests can inject a
 * plain fake object without constructing a real client.
 */
export type AnthropicLike = {
  messages: {
    create(params: AnthropicMessageCreateParams): Promise<AnthropicMessageResponse>;
  };
};

let cachedClient: AnthropicLike | null = null;

/**
 * Returns a lazily-constructed singleton Anthropic client.
 * Throws a clear error if ANTHROPIC_API_KEY is unset — but only when this is
 * actually called, so module load, builds, and tests that inject their own
 * client never require the key.
 */
export function getAnthropicClient(): AnthropicLike {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Set it in the environment to use Claude-powered features."
    );
  }

  // The real SDK client's surface is a superset of AnthropicLike; narrow it
  // explicitly here so callers only ever see the minimal, test-friendly type.
  cachedClient = new Anthropic({ apiKey }) as unknown as AnthropicLike;
  return cachedClient;
}
