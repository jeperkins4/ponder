# Grounding acceptance criteria in Understand-Anything

Ponder can generate acceptance criteria and verification steps that cite a
target repo's **real** files, architectural layers, and tests instead of
generic prose — by grounding the Claude call in a slice of that repo's
Understand-Anything knowledge graph
(`.understand-anything/knowledge-graph.json`). Ponder itself stays
repo-agnostic: it never reads that file from disk. The MCP *caller* — Claude
Code, running inside the target repo — reads the graph, picks the relevant
slice for the work unit at hand, and passes it to Ponder as a plain string.
Today the one agent-driven entry point for this is the `regenerate_acceptance`
MCP tool.

## Prerequisites

- The target repo has already run `/understand` (or equivalent) and has
  `.understand-anything/knowledge-graph.json` committed.
- Ponder's MCP server is registered with Claude Code in that repo. See the
  [MCP integration section of the README](../README.md#mcp-integration--drive-ponder-from-claude-code)
  (and [`README-mcp.md`](../README-mcp.md) for the full tool reference) for
  the `claude mcp add ponder ...` setup.

## The "locate" step

There is no automatic retrieval — an agent has to read the graph and cut it
down to a small, relevant slice before calling Ponder. Give Claude Code a
prompt along these lines:

> Read `.understand-anything/knowledge-graph.json`. For work unit `<id>`
> (title: `<title>`), select only the nodes (files, layers, tests) in the
> domain(s) this work touches — keep paths, layer labels, summaries,
> `importMap`, and relevant test files; drop everything else. Then call the
> Ponder MCP `regenerate_acceptance` tool with that JSON slice as
> `codebaseContext`.

The important part is the "drop everything else" instruction: `codebaseContext`
is passed straight through into the Claude prompt for the work unit, so an
oversized slice burns tokens and dilutes the signal instead of improving it.

## Worked example

Say the work unit is "Archive a project." Claude Code reads the graph, keeps
just the `Project` model and drops the rest, and calls the tool:

```jsonc
// regenerate_acceptance tool call
{
  "workUnitId": "ck123abc",
  "codebaseContext": "{\"domain\":\"Projects\",\"nodes\":[{\"path\":\"prisma/schema.prisma#Project\"}]}"
}
```

`regenerate_acceptance` is registered in
[`src/mcp/server.ts`](../src/mcp/server.ts) with this description and input
schema:

> "(Re)generate a work unit's acceptance criteria and verification with
> Claude. Pass codebaseContext (a located slice of the repo's
> Understand-Anything knowledge-graph.json) to ground the output in real
> files, layers, and tests."

```ts
inputSchema: {
  workUnitId: z.string(),
  codebaseContext: z.string().optional(),
}
```

With the slice above, the generated acceptance criteria and verification
reference the real schema location instead of a generic "add an `archived`
flag somewhere," e.g.:

- **Acceptance criteria:** "A project can be archived by setting a soft-delete
  flag on the `Project` model (`prisma/schema.prisma#Project`) without
  deleting its rows; archived projects are excluded from the default board
  view."
- **Verification:** "Confirm the schema change via `npx prisma migrate dev`,
  then check that an archived project's work units still exist in the
  database but no longer render on `/projects/[projectId]`."

## Guardrails & limits

- **Anti-hallucination instruction.** Whenever `codebaseContext` is present,
  Ponder appends `CODEBASE_GROUNDING_INSTRUCTION`
  (defined in [`src/lib/anthropic/codebaseContext.ts`](../src/lib/anthropic/codebaseContext.ts))
  to the system prompt: it tells Claude to ground the AC/verification in the
  actual files, layers, and tests supplied, and explicitly **not** to invent
  files, modules, functions, or tests absent from the context — staying
  general is preferred over fabricating a path. The same instruction and the
  same `buildContextUserBlock` wrapper are shared by both consumers of
  `codebaseContext`: `generateAcceptanceCriteria` and `breakDownStory`.
- **Keep the slice small.** `codebaseContext` is inlined into the prompt
  verbatim — there's no summarization or truncation on Ponder's side, so the
  "locate" step doing a good job of pruning the graph is what keeps this
  affordable and on-topic.
- **This is agent-driven, not automatic.** The web UI's "✨ Regenerate
  acceptance criteria & verification" button and the JIRA import path
  (`src/app/api/projects/[projectId]/import/process/route.ts`) both accept an
  optional `codebaseContext`, but nothing in the web UI currently reads or
  supplies the knowledge graph — the `generate-acceptance-criteria` route
  (`src/app/api/work-units/[id]/generate-acceptance-criteria/route.ts`) sends
  no body from the browser. Enrichment only happens when an agent (via
  MCP) does the locate step and passes a slice explicitly. There is currently
  no MCP tool that triggers import or story breakdown with context — those
  code paths accept `codebaseContext`, but `regenerate_acceptance` is the
  only shipped entry point that an agent can call today.
- **Future work.** Deterministic, server-side graph retrieval (so the web-UI
  import path could enrich without an agent in the loop) is not implemented
  yet — it's a follow-up, not part of this integration.
