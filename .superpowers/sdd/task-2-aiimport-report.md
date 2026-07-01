# Task 2: Anthropic (Claude) story-breakdown service

Status: DONE

## Summary

Added a server-side, dependency-injectable Claude story-breakdown service. `breakDownStory`
forces structured output via a tool definition (`record_subtasks`) + a forced `tool_choice`,
parses the tool-use `input.subtasks`, and falls back to a single subtask mirroring the story
when zero subtasks come back (or the tool-use block is missing). No UI or route wiring —
that's Task 4 (import process endpoint) and Task 7 (completion summary).

## Signatures Task 4 (and Task 7) will import

```ts
// src/lib/anthropic/breakdown.ts
export type SubtaskDraft = {
  title: string;             // short description of the unit of work
  acceptanceCriteria: string;
  verification: string;
};

export async function breakDownStory(
  story: { summary: string; description: string | null },
  client?: AnthropicLike       // defaults to the real singleton via getAnthropicClient()
): Promise<SubtaskDraft[]>;

export function formatSubtaskDescription(d: SubtaskDraft): string;
// returns exactly: "{title}\n\nAcceptance Criteria:\n{acceptanceCriteria}\n\nVerification:\n{verification}"
```

```ts
// src/lib/anthropic/client.ts
export type AnthropicLike = {
  messages: {
    create(params: AnthropicMessageCreateParams): Promise<AnthropicMessageResponse>;
  };
};
export function getAnthropicClient(): AnthropicLike;
// Throws "ANTHROPIC_API_KEY is not set. Set it in the environment to use
// Claude-powered features." only when called (not at module load), and only
// when no client is injected.
```

## SDK / model details

- `@anthropic-ai/sdk`: `^0.109.0` added to `dependencies` (latest at time of writing; lockfile
  updated via `npm install @anthropic-ai/sdk@latest`).
- Model: `process.env.ANTHROPIC_BREAKDOWN_MODEL ?? "claude-sonnet-5"` (per plan's locked
  decision — not the general "always use Opus" default; this task explicitly names
  `claude-sonnet-5` as the fallback).
- `max_tokens: 2000` (non-streaming `client.messages.create`, well under the ~16K
  threshold where streaming would be required to avoid SDK HTTP timeouts).

## SDK-shape notes (confirmed via Context7, `/anthropics/anthropic-sdk-typescript`) — relevant to Task 7 too

- Tool definitions on `messages.create` are plain objects: `{ name, description, input_schema }`
  (JSON Schema). No decorator/helper needed for this manual (non-runner) pattern.
- To force a specific tool, pass `tool_choice: { type: "tool", name: "<tool name>" }` alongside
  the tool in `tools: [...]`.
- The response's `content` array can contain multiple block types; find the tool-use block by
  `block.type === "tool_use"` (and by `name` if multiple tools were offered), then read
  `block.input` (already-parsed JSON, not a string to `JSON.parse`).
- Structured-output docs also surfaced `output_config.format` + `client.messages.parse()`
  (Zod/JSON-Schema helpers) as an alternative GA path for schema-constrained output — **not**
  used here because the task spec explicitly requires the tool-use + forced `tool_choice`
  pattern. Task 7 (`summarizeCompletedWork`) should follow the same tool-use pattern for
  consistency, or use `output_config.format` if a plain summary string (not a tool call) is
  more natural there — either is compatible with the `AnthropicLike` shape as long as the
  return type stays within what `AnthropicMessageResponse` models (a `content` array).
- `AnthropicLike.messages.create` is declared with method-shorthand syntax (not an arrow-typed
  property) so TypeScript's method-bivariance applies, letting the real `Anthropic` client
  (superset surface) satisfy the narrow interface via a single explicit
  `as unknown as AnthropicLike` cast inside `getAnthropicClient()` — the only cast in the
  codebase; call sites and tests only ever see the minimal type.

## Tests

- `npx dotenv -e .env.test -- vitest run src/lib/anthropic/ --no-file-parallelism`: **5 passed**
  (5 test files: 1 — `breakdown.test.ts`).
  - Forced tool-use response → parsed drafts (2 subtasks), asserts prompt contains
    summary + description, asserts `tools`/`tool_choice` shape sent to the fake client.
  - Summary-only story (no description) still reaches the prompt.
  - Zero-subtasks fallback → one draft mirroring the story (`title === summary`).
  - Missing tool-use block entirely (model returned only `text`) → same fallback path.
  - `formatSubtaskDescription` exact output string.
  - No network calls; no fake test ever touches `ANTHROPIC_API_KEY`.
- Full suite serially (`npx dotenv -e .env.test -- vitest run --no-file-parallelism`):
  **286 passed** (baseline 281 + 5 new — exact match), 32 test files.
- `npx tsc --noEmit`: clean, no errors.

## Concerns

- None blocking. Two judgment calls worth flagging for reviewers:
  - The fallback subtask's `acceptanceCriteria`/`verification` text isn't specified by the
    plan beyond "title = summary" — I used `story.description` (when present) as the
    acceptance criteria and a generic manual-verification sentence otherwise. Task 4/7
    consumers should treat these as reasonable defaults, not a fixed contract.
  - `getAnthropicClient()` uses one `as unknown as AnthropicLike` cast to bridge the real SDK
    client to the minimal injectable type — intentional and isolated to that one function;
    documented above so Task 7's `summarize.ts` can reuse the same client without
    re-deriving the pattern.
