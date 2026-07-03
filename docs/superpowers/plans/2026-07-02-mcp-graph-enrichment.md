# Understand-Anything Graph Enrichment (MCP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Ponder's Claude-powered decomposition and AC/verification generation optionally consume a slice of an [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) `knowledge-graph.json`, so cards get implementation plans and verification steps grounded in the real target codebase.

**Architecture:** "Caller-supplies-context" (option A). Ponder stays **repo-agnostic** — it never reads `.understand-anything/` from disk. The graph lives in the target repo; Claude Code (driving Ponder's MCP server from inside that repo) reads `knowledge-graph.json`, performs the *locate* step (picks the relevant subgraph for the story), and passes it to Ponder as a plain `codebaseContext` string. Ponder threads that string into the existing Claude calls (`breakDownStory`, `generateAcceptanceCriteria`). When no context is supplied (the web-UI import path), behavior is byte-for-byte identical to today.

**Tech Stack:** Next.js 15 App Router (route handlers), TypeScript, Prisma 7 + PostgreSQL, `@anthropic-ai/sdk` (tool-forced structured output, model `claude-sonnet-5`), `@modelcontextprotocol/sdk` (McpServer over stdio, zod from `zod/v3`), Vitest.

## Global Constraints

- **Backward compatible:** `codebaseContext` is optional on every function, route, and tool. When absent or empty, the prompt, model, `max_tokens`, and tool schema are exactly as today — existing tests must pass unchanged.
- **Ponder never reads the graph from disk:** no `fs` access to `.understand-anything/`, no per-project `graphPath`. The MCP caller supplies the already-located slice as a string. (Deterministic server-side retrieval is explicit future work, not this plan.)
- **Anti-hallucination guardrail (required):** when `codebaseContext` is present, the system prompt MUST instruct Claude to ground strictly in the files/layers/tests listed and to NOT invent files, modules, or tests absent from the provided context.
- **Signatures:** add `codebaseContext?: string` as a field on the existing first argument object (`story` / `workUnit`). Do NOT add positional params — this keeps every existing call site and test unchanged.
- **Model:** unchanged — `process.env.ANTHROPIC_BREAKDOWN_MODEL ?? "claude-sonnet-5"`, `max_tokens: 2000`. Tool-forced (`tool_choice`) unchanged.
- **MCP idioms:** import `z` from `"zod/v3"`; `registerTool` `inputSchema` is a raw `ZodRawShape` (not `z.object(...)`); tool handlers return `McpTextResult`.
- **Tests run serially:** `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
- **No secrets committed.** Branch → verify green (`tsc --noEmit`, `npm run lint`, full suite) → PR → the user merges.

---

## File Structure

**Modify:**
- `src/lib/anthropic/generateAcceptanceCriteria.ts` — accept `codebaseContext?` on the `workUnit` arg; append it to the user message and add the grounding instruction to the system prompt.
- `src/lib/anthropic/generateAcceptanceCriteria.test.ts` — add a context test.
- `src/app/api/work-units/[id]/generate-acceptance-criteria/route.ts` — read optional `codebaseContext` from the POST body; pass it through.
- `src/app/api/work-units/[id]/generate-acceptance-criteria/route.test.ts` — add a body-context test.
- `src/mcp/client.ts` — add `regenerateAcceptance(id, codebaseContext?)`.
- `src/mcp/tools.ts` — add `regenerateAcceptance` handler.
- `src/mcp/server.ts` — register the `regenerate_acceptance` tool.
- `src/mcp/client.test.ts`, `src/mcp/tools.test.ts`, `src/mcp/server.test.ts` — cover the new client method / handler / tool.
- `src/lib/anthropic/breakdown.ts` — accept `codebaseContext?` on the `story` arg (same pattern as Task 1).
- `src/lib/anthropic/breakdown.test.ts` — add a context test.
- `src/app/api/projects/[projectId]/import/process/route.ts` — accept optional per-item `codebaseContext`; pass it to `breakDownStory`.
- `src/app/api/projects/[projectId]/import/process/route.test.ts` — add a context test.

**Create:**
- `src/lib/anthropic/codebaseContext.ts` — shared prompt fragments (header + grounding instruction) reused by both generators, so the guardrail wording lives in one place.
- `src/lib/anthropic/codebaseContext.test.ts` — assert the fragments contain the guardrail.
- `docs/understand-anything-integration.md` — how to wire a repo's `knowledge-graph.json` into Ponder via Claude Code + the MCP tool, including the *locate* prompt pattern.

**Delete:**
- `scripts/ua-experiment.ts` — throwaway A/B experiment; remove as part of Task 1's commit.

---

### Task 1: Shared context fragments + `generateAcceptanceCriteria` support

**Files:**
- Create: `src/lib/anthropic/codebaseContext.ts`
- Create: `src/lib/anthropic/codebaseContext.test.ts`
- Modify: `src/lib/anthropic/generateAcceptanceCriteria.ts`
- Modify: `src/lib/anthropic/generateAcceptanceCriteria.test.ts`
- Delete: `scripts/ua-experiment.ts`

**Interfaces:**
- Produces: `buildContextUserBlock(codebaseContext: string): string` and `CODEBASE_GROUNDING_INSTRUCTION: string` from `codebaseContext.ts`.
- Produces: `generateAcceptanceCriteria(workUnit: { title: string; description: string | null; codebaseContext?: string }, client?: AnthropicLike)` — new optional field; return type `GeneratedAcceptance` unchanged.

- [ ] **Step 1: Write the failing test for the shared fragments**

Create `src/lib/anthropic/codebaseContext.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildContextUserBlock,
  CODEBASE_GROUNDING_INSTRUCTION,
} from "@/lib/anthropic/codebaseContext";

describe("codebaseContext fragments", () => {
  it("wraps the context in a labelled block", () => {
    const block = buildContextUserBlock('{"domain":"Projects"}');
    expect(block).toContain("CODEBASE CONTEXT");
    expect(block).toContain('{"domain":"Projects"}');
  });

  it("grounding instruction forbids inventing files", () => {
    expect(CODEBASE_GROUNDING_INSTRUCTION.toLowerCase()).toContain("do not invent");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/anthropic/codebaseContext.test.ts`
Expected: FAIL — module `codebaseContext` not found.

- [ ] **Step 3: Create the shared fragments**

Create `src/lib/anthropic/codebaseContext.ts`:

```ts
/**
 * Shared prompt fragments for grounding Claude output in a slice of an
 * Understand-Anything knowledge graph. Used by both the story-breakdown and
 * single-work-unit AC generators so the anti-hallucination guardrail wording
 * lives in exactly one place.
 */

const CONTEXT_HEADER =
  "CODEBASE CONTEXT (from the Understand-Anything knowledge graph). " +
  "These are real files, layers, and tests from the target codebase:";

/**
 * The system-prompt clause added whenever codebase context is supplied.
 * Steers Claude to cite real paths/tests AND forbids fabricating any that are
 * not present in the provided slice (grounded-but-wrong is worse than generic).
 */
export const CODEBASE_GROUNDING_INSTRUCTION =
  "A CODEBASE CONTEXT section is included with the work. Ground the acceptance " +
  "criteria and verification in the ACTUAL files, architectural layers, and " +
  "tests it lists — reference real file paths and test commands where relevant. " +
  "Do NOT invent files, modules, functions, or tests that are not present in the " +
  "provided context; when unsure, stay general rather than fabricate a path.";

/** Wraps a raw context string in the labelled block appended to the user message. */
export function buildContextUserBlock(codebaseContext: string): string {
  return `${CONTEXT_HEADER}\n${codebaseContext}`;
}
```

- [ ] **Step 4: Run the fragment test to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/anthropic/codebaseContext.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for context in `generateAcceptanceCriteria`**

Add to `src/lib/anthropic/generateAcceptanceCriteria.test.ts` (inside the existing `describe`):

```ts
  it("appends codebase context to the user message and grounds the system prompt", async () => {
    const { client, create } = makeFakeClient({
      content: [
        {
          type: "tool_use",
          id: "toolu_2",
          name: "record_acceptance",
          input: { acceptanceCriteria: "- x", verification: "run y" },
        },
      ],
    });

    await generateAcceptanceCriteria(
      {
        title: "Archive a project",
        description: "Soft-archive without deleting.",
        codebaseContext: '{"domain":"Projects","nodes":[{"path":"prisma/schema.prisma#Project"}]}',
      },
      client
    );

    const sent = create.mock.calls[0][0];
    const userMsg = String(sent.messages[0].content);
    expect(userMsg).toContain("CODEBASE CONTEXT");
    expect(userMsg).toContain("prisma/schema.prisma#Project");
    expect(String(sent.system).toLowerCase()).toContain("do not invent");
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/anthropic/generateAcceptanceCriteria.test.ts`
Expected: FAIL — user message lacks "CODEBASE CONTEXT" (context not yet threaded).

- [ ] **Step 7: Thread context through `generateAcceptanceCriteria`**

In `src/lib/anthropic/generateAcceptanceCriteria.ts`, add the import and update the function. Add near the other imports:

```ts
import {
  buildContextUserBlock,
  CODEBASE_GROUNDING_INSTRUCTION,
} from "@/lib/anthropic/codebaseContext";
```

Change the signature and the userContent/system construction:

```ts
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
  // ...unchanged below (toolUseBlock extraction + return)...
}
```

- [ ] **Step 8: Run the generator tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/anthropic/generateAcceptanceCriteria.test.ts`
Expected: PASS — 3 tests (the two originals still pass; `system` still equals `SYSTEM_PROMPT` when no context).

- [ ] **Step 9: Remove the throwaway experiment script**

Run: `git rm scripts/ua-experiment.ts`

- [ ] **Step 10: Commit**

```bash
git add src/lib/anthropic/codebaseContext.ts src/lib/anthropic/codebaseContext.test.ts \
  src/lib/anthropic/generateAcceptanceCriteria.ts src/lib/anthropic/generateAcceptanceCriteria.test.ts
git commit -m "feat: optional codebase-graph context for AC/verification generation"
```

---

### Task 2: Accept `codebaseContext` in the regenerate route

**Files:**
- Modify: `src/app/api/work-units/[id]/generate-acceptance-criteria/route.ts`
- Test: `src/app/api/work-units/[id]/generate-acceptance-criteria/route.test.ts`

**Interfaces:**
- Consumes: `generateAcceptanceCriteria` with the `codebaseContext` field (Task 1).
- Produces: `POST` reads optional `{ codebaseContext?: string }` from the JSON body; a missing/invalid body leaves it `undefined`. Response shape unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/app/api/work-units/[id]/generate-acceptance-criteria/route.test.ts`:

```ts
  it("passes codebaseContext from the request body to the generator", async () => {
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codebaseContext: '{"domain":"Projects"}' }),
      }) as never,
      { params: Promise.resolve({ id: workUnitId }) }
    );
    expect(res.status).toBe(200);
    expect(generateAcceptanceCriteria).toHaveBeenCalledWith({
      title: "Region Definition",
      description: "Admins assign regions",
      codebaseContext: '{"domain":"Projects"}',
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/work-units/[id]/generate-acceptance-criteria/route.test.ts"`
Expected: FAIL — generator called without `codebaseContext`.

- [ ] **Step 3: Read the optional body in the route**

In `src/app/api/work-units/[id]/generate-acceptance-criteria/route.ts`, rename `_request` to `request` and parse an optional body before loading the work unit:

```ts
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Optional JSON body: { codebaseContext?: string }. The web UI sends no
    // body; MCP/agent callers may include a located knowledge-graph slice.
    let codebaseContext: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.codebaseContext === "string") {
        codebaseContext = body.codebaseContext;
      }
    } catch {
      // No body or invalid JSON — proceed without context (unchanged behavior).
    }

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
      select: { id: true, title: true, description: true },
    });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }

    const { acceptanceCriteria, verification } = await generateAcceptanceCriteria({
      title: workUnit.title,
      description: workUnit.description,
      codebaseContext,
    });
    // ...unchanged below (update + return)...
```

Note: the existing 404 and success tests pass a body-less `Request`; `request.json()` throws, is caught, and `codebaseContext` stays `undefined` — the generator is then called with `codebaseContext: undefined`, which the existing `toHaveBeenCalledWith({ title, description })` assertion still matches (an explicit `undefined` property equals an absent one under Vitest's `toHaveBeenCalledWith`).

- [ ] **Step 4: Run the route tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/work-units/[id]/generate-acceptance-criteria/route.test.ts"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/work-units/[id]/generate-acceptance-criteria/route.ts" \
  "src/app/api/work-units/[id]/generate-acceptance-criteria/route.test.ts"
git commit -m "feat: accept optional codebaseContext in the regenerate-AC route"
```

---

### Task 3: `regenerate_acceptance` MCP tool

**Files:**
- Modify: `src/mcp/client.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`
- Test: `src/mcp/client.test.ts`, `src/mcp/tools.test.ts`, `src/mcp/server.test.ts`

**Interfaces:**
- Consumes: the regenerate route accepting `codebaseContext` (Task 2).
- Produces: `PonderClient.regenerateAcceptance(id: string, codebaseContext?: string): Promise<{ acceptanceCriteria: string; verification: string }>`.
- Produces: `regenerateAcceptance(client, { workUnitId, codebaseContext }): Promise<McpTextResult>`.
- Produces: MCP tool `regenerate_acceptance` with `inputSchema { workUnitId: z.string(), codebaseContext: z.string().optional() }`.

- [ ] **Step 1: Write the failing client test**

Add to `src/mcp/client.test.ts` (follow the existing fake-`fetch` pattern in that file):

```ts
  it("regenerateAcceptance POSTs the context to the generate endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ acceptanceCriteria: "- a", verification: "run t" }),
      } as Response;
    }) as unknown as typeof fetch;

    const client = new PonderClient("http://ponder.test", fakeFetch);
    const result = await client.regenerateAcceptance("wu1", '{"domain":"Projects"}');

    expect(result).toEqual({ acceptanceCriteria: "- a", verification: "run t" });
    expect(calls[0].url).toBe(
      "http://ponder.test/api/work-units/wu1/generate-acceptance-criteria"
    );
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      codebaseContext: '{"domain":"Projects"}',
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/client.test.ts`
Expected: FAIL — `regenerateAcceptance` is not a function.

- [ ] **Step 3: Add the client method**

In `src/mcp/client.ts`, add (after `updateWorkUnit`):

```ts
  async regenerateAcceptance(
    id: string,
    codebaseContext?: string
  ): Promise<{ acceptanceCriteria: string; verification: string }> {
    return this.request<{ acceptanceCriteria: string; verification: string }>(
      "POST",
      `/api/work-units/${encodeURIComponent(id)}/generate-acceptance-criteria`,
      codebaseContext !== undefined ? { codebaseContext } : {}
    );
  }
```

- [ ] **Step 4: Run the client test to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tool-handler test**

Add to `src/mcp/tools.test.ts` (match the file's existing fake-`PonderClient` style):

```ts
  it("regenerateAcceptance returns a text summary of the new AC/verification", async () => {
    const fakeClient = {
      regenerateAcceptance: async (id: string, ctx?: string) => {
        expect(id).toBe("wu1");
        expect(ctx).toBe('{"domain":"Projects"}');
        return { acceptanceCriteria: "- a", verification: "run t" };
      },
    } as unknown as PonderClient;

    const result = await regenerateAcceptance(fakeClient, {
      workUnitId: "wu1",
      codebaseContext: '{"domain":"Projects"}',
    });
    expect(result.content[0].text).toContain("Acceptance Criteria");
    expect(result.content[0].text).toContain("run t");
  });
```

Add `regenerateAcceptance` to the import from `./tools` at the top of the test file.

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/tools.test.ts`
Expected: FAIL — `regenerateAcceptance` not exported from `./tools`.

- [ ] **Step 7: Add the tool handler**

In `src/mcp/tools.ts`, add:

```ts
/** Regenerate a work unit's AC/verification, optionally grounded in a graph slice. */
export async function regenerateAcceptance(
  client: PonderClient,
  args: { workUnitId: string; codebaseContext?: string }
): Promise<McpTextResult> {
  const { acceptanceCriteria, verification } = await client.regenerateAcceptance(
    args.workUnitId,
    args.codebaseContext
  );
  return textResult(
    `Regenerated work unit ${args.workUnitId}.\n\n` +
      `Acceptance Criteria:\n${acceptanceCriteria}\n\n` +
      `Verification:\n${verification}`
  );
}
```

- [ ] **Step 8: Run the tool test to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/tools.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing server-registration test**

Add to `src/mcp/server.test.ts` (match how that file asserts registered tools — it inspects the server built by `createServer`):

```ts
  it("registers the regenerate_acceptance tool", () => {
    const server = createServer({} as PonderClient);
    // Uses the same registration-inspection helper the other tests in this
    // file use; assert the tool name is present.
    expect(registeredToolNames(server)).toContain("regenerate_acceptance");
  });
```

If `src/mcp/server.test.ts` has no `registeredToolNames` helper, follow the existing pattern in that file for asserting a tool is registered (e.g. it may spy on `registerTool`); mirror it for `regenerate_acceptance` rather than introducing a new helper.

- [ ] **Step 10: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/server.test.ts`
Expected: FAIL — tool not registered.

- [ ] **Step 11: Register the tool**

In `src/mcp/server.ts`, add `regenerateAcceptance` to the import from `./tools`, then register it alongside the others:

```ts
  server.registerTool(
    "regenerate_acceptance",
    {
      description:
        "(Re)generate a work unit's acceptance criteria and verification with Claude. " +
        "Pass codebaseContext (a located slice of the repo's Understand-Anything " +
        "knowledge-graph.json) to ground the output in real files, layers, and tests.",
      inputSchema: {
        workUnitId: z.string(),
        codebaseContext: z.string().optional(),
      },
    },
    async ({ workUnitId, codebaseContext }) =>
      regenerateAcceptance(client, { workUnitId, codebaseContext })
  );
```

- [ ] **Step 12: Run the MCP suite to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/`
Expected: PASS — all MCP tests green.

- [ ] **Step 13: Commit**

```bash
git add src/mcp/client.ts src/mcp/tools.ts src/mcp/server.ts \
  src/mcp/client.test.ts src/mcp/tools.test.ts src/mcp/server.test.ts
git commit -m "feat: add regenerate_acceptance MCP tool with codebase-graph context"
```

---

### Task 4: Context support in `breakDownStory` + import/process route

**Files:**
- Modify: `src/lib/anthropic/breakdown.ts`, `src/lib/anthropic/breakdown.test.ts`
- Modify: `src/app/api/projects/[projectId]/import/process/route.ts`, `.../import/process/route.test.ts`

**Interfaces:**
- Consumes: `buildContextUserBlock`, `CODEBASE_GROUNDING_INSTRUCTION` (Task 1).
- Produces: `breakDownStory(story: { summary: string; description: string | null; codebaseContext?: string }, client?)`.
- Produces: `ImportProcessItem` gains optional `codebaseContext?: string`, passed to `breakDownStory`.

- [ ] **Step 1: Write the failing breakdown test**

Add to `src/lib/anthropic/breakdown.test.ts` (mirror its existing fake-client capture pattern):

```ts
  it("appends codebase context and grounds the system prompt when provided", async () => {
    const { client, create } = makeFakeClient({
      content: [
        {
          type: "tool_use",
          id: "toolu_9",
          name: "record_subtasks",
          input: { subtasks: [{ title: "t", acceptanceCriteria: "ac", verification: "v" }] },
        },
      ],
    });

    await breakDownStory(
      { summary: "Archive a project", description: "soft archive", codebaseContext: '{"domain":"Projects"}' },
      client
    );

    const sent = create.mock.calls[0][0];
    expect(String(sent.messages[0].content)).toContain("CODEBASE CONTEXT");
    expect(String(sent.system).toLowerCase()).toContain("do not invent");
  });
```

If `breakdown.test.ts` lacks a `makeFakeClient` helper, reuse the exact helper shape from `generateAcceptanceCriteria.test.ts` (a `vi.fn` returning the given response), defined locally in this test file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/anthropic/breakdown.test.ts`
Expected: FAIL — user message lacks "CODEBASE CONTEXT".

- [ ] **Step 3: Thread context through `breakDownStory`**

In `src/lib/anthropic/breakdown.ts`, add the import:

```ts
import {
  buildContextUserBlock,
  CODEBASE_GROUNDING_INSTRUCTION,
} from "@/lib/anthropic/codebaseContext";
```

Update the signature and user/system construction (mirroring Task 1):

```ts
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
  // ...unchanged below...
}
```

Note: the `fallbackDraft(story)` call at the end still receives the same `story` object; the extra `codebaseContext` field is harmless there.

- [ ] **Step 4: Run the breakdown tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/anthropic/breakdown.test.ts`
Expected: PASS — existing tests plus the new one.

- [ ] **Step 5: Write the failing import/process test**

Add to `src/app/api/projects/[projectId]/import/process/route.test.ts` (this suite already mocks `breakDownStory`; assert it receives the per-item context). Following the file's existing mock/setup:

```ts
  it("forwards a per-item codebaseContext to breakDownStory", async () => {
    // breakDownStory is mocked in this suite to return one subtask.
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              jiraKey: "COM-1",
              jiraId: "1",
              summary: "S",
              description: "D",
              jiraStatus: "To Do",
              breakDown: true,
              codebaseContext: '{"domain":"Projects"}',
            },
          ],
        }),
      }) as never,
      { params: Promise.resolve({ projectId }) }
    );
    expect(res.status).toBe(200);
    expect(breakDownStory).toHaveBeenCalledWith({
      summary: "S",
      description: "D",
      codebaseContext: '{"domain":"Projects"}',
    });
  });
```

Use the same `projectId` setup and `breakDownStory` mock import the existing tests in this file use.

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/projects/[projectId]/import/process/route.test.ts"`
Expected: FAIL — `breakDownStory` called without `codebaseContext`.

- [ ] **Step 7: Thread context through the route**

In `src/app/api/projects/[projectId]/import/process/route.ts`, add the optional field to the interface:

```ts
export interface ImportProcessItem {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  breakDown: boolean;
  codebaseContext?: string;
}
```

And pass it in the `breakDownStory` call:

```ts
        drafts = await breakDownStory({
          summary: item.summary,
          description: item.description,
          codebaseContext: item.codebaseContext,
        });
```

- [ ] **Step 8: Run the import/process tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/projects/[projectId]/import/process/route.test.ts"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/anthropic/breakdown.ts src/lib/anthropic/breakdown.test.ts \
  "src/app/api/projects/[projectId]/import/process/route.ts" \
  "src/app/api/projects/[projectId]/import/process/route.test.ts"
git commit -m "feat: optional codebase-graph context for story breakdown at import"
```

---

### Task 5: Integration docs

**Files:**
- Create: `docs/understand-anything-integration.md`

**Interfaces:**
- Consumes: the `regenerate_acceptance` MCP tool (Task 3) and the `codebaseContext` params (Tasks 1–4). No code; documents the end-to-end wiring.

- [ ] **Step 1: Write the integration guide**

Create `docs/understand-anything-integration.md` covering, concretely:

1. **What & why** — one paragraph: Ponder can ground card AC/verification in a repo's Understand-Anything `knowledge-graph.json`; Ponder stays repo-agnostic (the MCP caller supplies the slice).
2. **Prerequisites** — the target repo has `.understand-anything/knowledge-graph.json` committed; Ponder's MCP server is configured in that repo's Claude Code (link `README`/MCP setup docs).
3. **The locate step (prompt pattern)** — the exact instruction to give Claude Code, e.g.:
   > "Read `.understand-anything/knowledge-graph.json`. For work unit `<id>` (title: `<t>`), select only the nodes (files, layers, tests) in the domain(s) this work touches — keep paths, layer labels, summaries, importMap, and relevant test files; drop everything else. Then call the Ponder MCP `regenerate_acceptance` tool with that JSON slice as `codebaseContext`."
4. **Worked example** — a `regenerate_acceptance` call with a small slice and the resulting grounded AC/verification (reuse the archive-a-project example from the validation experiment).
5. **Guardrails & limits** — the anti-hallucination instruction Ponder injects; keep the slice small (token budget); this is agent-driven (web-UI import does not enrich); deterministic server-side retrieval is future work.

- [ ] **Step 2: Verify the doc references only shipped surface**

Run: `git grep -n "regenerate_acceptance" src/mcp/server.ts`
Expected: the tool name appears — confirming the doc's tool reference is real.

- [ ] **Step 3: Commit**

```bash
git add docs/understand-anything-integration.md
git commit -m "docs: how to wire Understand-Anything graph context into Ponder via MCP"
```

---

## Final verification (before PR)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — no new errors.
- [ ] `npx dotenv -e .env.test -- vitest run --no-file-parallelism` — full suite green.
- [ ] `npx knip` — no new unused exports (the new `codebaseContext.ts` exports are used by both generators; `regenerateAcceptance` is used by `server.ts`).
- [ ] Open the PR; the user merges.

---

## Self-Review

**Spec coverage:**
- Optional graph context in AC generation → Task 1. In story breakdown → Task 4. ✅
- Reaches the proven path (regenerate) end-to-end → Tasks 2 (route) + 3 (MCP tool). ✅
- Reaches the decomposition path → Task 4 (route). ✅
- Anti-hallucination guardrail (the advisor's key risk) → Task 1 `CODEBASE_GROUNDING_INSTRUCTION`, asserted in Tasks 1 & 4. ✅
- Ponder stays repo-agnostic → no `fs`/`graphPath`; context is a caller-supplied string (Global Constraints; Task 5 documents the caller doing the locate). ✅
- Backward compatibility → `codebaseContext` optional everywhere; `system`/`userContent` identical when absent; existing tests unchanged (Tasks 1–4 preserve originals). ✅

**Type consistency:** `codebaseContext?: string` is the field name on `workUnit` (Task 1/2), `story` (Task 4), `ImportProcessItem` (Task 4), the client method (Task 3), the tool args (Task 3), and the MCP `inputSchema` (Task 3) — one name throughout. `buildContextUserBlock` / `CODEBASE_GROUNDING_INSTRUCTION` are defined in Task 1 and consumed by Tasks 1 & 4 with matching signatures. `regenerateAcceptance` return type `{ acceptanceCriteria; verification }` is identical across client (Task 3 step 3), handler (step 7), and route response (Task 2).

**Placeholder scan:** every code step includes concrete code; test steps include real assertions; no "TBD"/"add error handling"/"similar to Task N". The only prose-described steps are Task 5 (a docs file, content enumerated) and the two server/breakdown test steps that defer to an existing helper pattern in the target test file — flagged explicitly rather than inventing a helper that may clash.

**Open follow-ups (not in scope):** deterministic server-side graph retrieval (so the web-UI import path can enrich without an agent); caching/locating heuristics; measuring quality lift across many stories (this plan ships the capability; the earlier n=1 experiment justified building it).
