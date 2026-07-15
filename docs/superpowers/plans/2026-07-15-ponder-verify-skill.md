# Ponder Verify Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a global `ponder-verify` skill that automates capturing and attaching verification evidence for Ponder's Code Review / Verify flow, plus the one small server-side change (`list_projects` exposing `githubRepos`) it depends on.

**Architecture:** A pure-prose Claude Code skill (no new server code, no new MCP tools) orchestrates three existing MCP tools (`list_projects`, `list_work_units`, `attach_image`, `report_verification`) plus `claude-in-chrome` browser tools. The only Ponder repo code change is surfacing an already-existing `githubRepos` field in one tool's text output.

**Tech Stack:** TypeScript, Vitest, the `ponder` MCP server (`src/mcp/*`), Claude Code skills (Markdown + YAML frontmatter), `claude-in-chrome` MCP tools.

## Global Constraints

- Scope is the existing Code Review / Verify flow ONLY — no auto-verification on Done, no new Claude Code hook, no new MCP tool for the capture→attach→report sequence.
- Skipped items (env/flow problems) must NEVER be reported via `report_verification` — only genuine pass/fail judgments call that tool.
- Work units are processed sequentially within a run — one browser tab/session, no parallelism, so state can't bleed between items.
- The skill installs globally at `~/.claude/skills/ponder-verify/`, sourced from this repo's `skills/ponder-verify/SKILL.md`.
- No non-browser (API/CLI-only) verification support in this iteration.
- Zero or multiple project matches on repo→project resolution both stop the run and report clearly — never guess.

---

### Task 1: Expose `githubRepos` in the `list_projects` MCP tool

**Files:**
- Modify: `src/mcp/tools.ts:24-39` (the `listProjects` function)
- Modify: `README-mcp.md:68` (the `list_projects` row in the tools reference table)
- Test: `src/mcp/tools.test.ts:30-52` (the `projects` fixture), `src/mcp/tools.test.ts:160-174` (the `listProjects` test)

**Interfaces:**
- Consumes: `ProjectWithStats` from `@/lib/types` (already has `githubRepos?: string`, a comma-separated `"owner/repo, owner/repo"` list — same format `src/lib/github/prGatedCompletion.ts:57-60` already parses with `.split(",").map((r) => r.trim()).filter(Boolean)`).
- Produces: `listProjects`'s formatted output line now includes `githubRepos: <value>` (or `githubRepos: —` when unset), matching the existing `jiraProjectKey: <value>` / `jiraProjectKey: —` convention on the same line. Task 2's skill instructions parse this exact text.

- [ ] **Step 1: Write the failing test**

Edit `src/mcp/tools.test.ts`. First, give project `p1` a `githubRepos` value in the shared fixture (around line 30-41):

```typescript
const projects: ProjectWithStats[] = [
  {
    id: "p1",
    name: "Project One",
    type: "JIRA",
    jiraProjectKey: "PONE",
    githubRepos: "acme/web-app, acme/web-app-mobile",
    createdAt: new Date(),
    updatedAt: new Date(),
    hasApiToken: true,
    storyCount: 2,
    workUnitCount: 5,
  },
  {
    id: "p2",
    name: "Project Two",
    type: "STANDALONE",
    createdAt: new Date(),
    updatedAt: new Date(),
    hasApiToken: false,
    storyCount: 0,
    workUnitCount: 0,
  },
];
```

(`p2` deliberately keeps no `githubRepos`, to cover the `—` fallback.)

Then extend the existing test (around line 160-174):

```typescript
describe("listProjects", () => {
  it("includes each project's name and counts", async () => {
    const client = fakeClient({ getProjects: async () => projects });

    const result = await listProjects(client);
    const text = result.content[0].text;

    expect(text).toContain("Project One");
    expect(text).toContain("stories: 2");
    expect(text).toContain("workUnits: 5");
    expect(text).toContain("Project Two");
    expect(text).toContain("stories: 0");
    expect(text).toContain("jiraProjectKey: PONE");
    expect(text).toContain("jiraProjectKey: —");
    expect(text).toContain("githubRepos: acme/web-app, acme/web-app-mobile");
    expect(text).toContain("githubRepos: —");
  });

  it("reports zero projects clearly", async () => {
    const client = fakeClient({ getProjects: async () => [] });

    const result = await listProjects(client);

    expect(result.content[0].text).toMatch(/no projects/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:ci -- src/mcp/tools.test.ts`
Expected: FAIL — the "includes each project's name and counts" test fails because the output text doesn't contain `githubRepos: acme/web-app, acme/web-app-mobile` or `githubRepos: —`.

- [ ] **Step 3: Implement the minimal change**

Edit `src/mcp/tools.ts:24-39`:

```typescript
/** List all projects with their story/work-unit stats. */
export async function listProjects(client: PonderClient): Promise<McpTextResult> {
  const projects = await client.getProjects();

  if (projects.length === 0) {
    return textResult("No projects found.");
  }

  const lines = projects.map((project) => {
    const jiraKey = project.jiraProjectKey ?? "—";
    const githubRepos = project.githubRepos ?? "—";
    return `- ${project.name} (id: ${project.id}, type: ${project.type}, jiraProjectKey: ${jiraKey}, githubRepos: ${githubRepos}, stories: ${project.storyCount}, workUnits: ${project.workUnitCount})`;
  });

  return textResult(
    `${projects.length} project(s):\n${lines.join("\n")}`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:ci -- src/mcp/tools.test.ts`
Expected: PASS (all tests in the file, including the two `listProjects` tests).

- [ ] **Step 5: Update the README table row**

Edit `README-mcp.md:68`:

```markdown
| `list_projects` | _(none)_ | List all Ponder projects with story/work-unit stats and configured GitHub repo(s) (`githubRepos`, used for `ponder-verify`'s repo→project matching). |
```

- [ ] **Step 6: Update the tool's own description string**

The MCP tool's `description` (what an LLM client sees when discovering the
tool, distinct from the README) is also stale. Edit `src/mcp/server.ts`
around line 44-46:

```typescript
  server.registerTool(
    "list_projects",
    {
      description:
        "List all Ponder projects with story/work-unit stats and configured GitHub repo(s) (githubRepos).",
    },
    async () => listProjects(client)
  );
```

- [ ] **Step 7: Full-suite check and commit**

Run: `npm run test:ci` (full suite) — expect all tests pass, no regressions.
Run: `npx tsc --noEmit` — expect no output (clean).
Run: `npm run lint` — expect 0 errors.

```bash
git add src/mcp/tools.ts src/mcp/tools.test.ts src/mcp/server.ts README-mcp.md
git commit -m "feat: expose githubRepos in list_projects MCP tool output

Needed for the upcoming ponder-verify skill to auto-match a home repo
to its Ponder project via git remote, the same githubRepos field
prGatedCompletion already uses for PR matching."
```

---

### Task 2: Create the `ponder-verify` skill and finish the docs

**Files:**
- Create: `skills/ponder-verify/SKILL.md`
- Modify: `README-mcp.md` (new install section after the `## Registration` section, i.e. after line 62; replace the pending-verification bullet at line 106)

**Interfaces:**
- Consumes: `mcp__ponder__list_projects` output format from Task 1 (`githubRepos: <value|—>` per line); `mcp__ponder__list_work_units` output format (unchanged, already ships): `- <title> (id: <id>, column: <column>, story: <jiraKey>) — verification steps: <text | "(missing — document them as you verify)">`; `mcp__ponder__attach_image({ workUnitId, filePath, filename? })`; `mcp__ponder__report_verification({ workUnitId, outcome: "passed"|"failed", summary, verificationSteps? })`; `claude-in-chrome` tools (`tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `computer`, `gif_creator`), loaded via `ToolSearch`.
- Produces: nothing consumed by later tasks — this is the terminal deliverable.

- [ ] **Step 1: Create the skill directory and file**

```bash
mkdir -p skills/ponder-verify
```

Create `skills/ponder-verify/SKILL.md`:

````markdown
---
name: ponder-verify
description: Automatically capture and attach verification evidence (screenshots or recordings) for Ponder work units pending verification, then report pass/fail. Use when asked to verify Ponder cards, process the Ponder verification queue, or run /ponder-verify.
---

# Ponder Verify

Automates the manual "capture evidence → attach → report" loop for Ponder's
Code Review / Verify flow (the `ponder` MCP server's `attach_image` and
`report_verification` tools). Ponder itself never drives a browser or runs
tests — this skill is the agent-side half of that flow, made repeatable
instead of improvised each time.

## Prerequisites

- The `ponder` MCP server is registered (`claude mcp list` shows `ponder`)
  and the Ponder app is running and reachable.
- This repo's dev server is running and reachable in a browser.
- The Ponder project for this repo has `githubRepos` set to include this
  repo's `owner/repo` (in the project's settings) — Step 1 below fails
  cleanly, with a clear message, if this isn't configured.

If any of these aren't true, stop and tell the user what's missing rather
than guessing.

## Step 1: Resolve the Ponder project for this repo

1. Get this repo's GitHub remote and normalize it to `owner/repo`:

   ```bash
   git remote get-url origin | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##'
   ```

2. Call `mcp__ponder__list_projects` (no args). Each line looks like:

   ```
   - Acme Web (id: proj-1, type: JIRA, jiraProjectKey: ACME, githubRepos: acme/web-app, acme/web-app-mobile, stories: 12, workUnits: 34)
   ```

   Parse `githubRepos` as a comma-separated list (trim whitespace from each
   entry). A project with none configured shows `githubRepos: —`.

3. Match the repo from step 1 against every project's `githubRepos` list.
   - **Zero matches:** stop. Tell the user which repos ARE configured
     (from the tool output) so they can fix the right project's
     `githubRepos`, or confirm they're in the wrong repo. Do not guess.
   - **More than one match:** stop. Today's data model implies one repo
     maps to one project — report the conflicting project names/ids and
     ask the user to fix `githubRepos` before continuing. Do not guess.
   - **Exactly one match:** that project's `id` is `PROJECT_ID` for the
     rest of this skill.

## Step 2: Fetch the pending-verification queue

Call `mcp__ponder__list_work_units` with
`{ projectId: PROJECT_ID, pendingVerification: true }`.

- If the result says no work units are pending verification, tell the user
  and stop — this is a normal, non-error outcome.
- Otherwise you get one line per pending item, e.g.:

  ```
  - Fix pagination bug (id: ck123abc, column: code_review, story: ACME-42) — verification steps: Open the board, go to page 2, confirm rows load
  ```

  or, when steps are missing:

  ```
  - Fix pagination bug (id: ck123abc, column: code_review, story: ACME-42) — verification steps: (missing — document them as you verify)
  ```

Keep this full list in mind — you'll process each item in order, one at a
time, in Step 3.

## Step 3: Process each item, sequentially

Do NOT parallelize this loop — it's one browser session/state at a time,
so one item's leftover state (login, scroll position, form data) can't
bleed into the next item's evidence.

### 3a. Load the browser tools (once, before the first item)

```
ToolSearch with query "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__gif_creator"
```

Call `tabs_context_mcp` once to see existing tabs, then `tabs_create_mcp`
for one fresh tab dedicated to this run. Reuse that same tab across every
item in the queue instead of opening a new one per item.

For each work unit in the queue, run 3b-3f below.

### 3b. Confirm the dev server is reachable

Navigate the tab to this repo's local dev server root (or the most
specific URL you can infer from the item's title/verification steps). If
the page fails to load (connection refused, timeout) —

**SKIP this item.** Record `{ title, id, reason: "dev server unreachable" }`
and move to the next item. Do NOT call `report_verification` for a skipped
item — an environment problem is not the same claim as "the code doesn't
work."

### 3c. Determine and drive the flow

Read the item's verification steps (or, if missing, use the title and
your own judgment of what change this card most likely represents).
Navigate and interact with the app to reproduce those steps.

If you cannot figure out what to check or where (steps missing AND the
title is too vague to infer a flow) — **SKIP this item** the same way as
3b, reason `"could not determine verification flow"`, and continue.

### 3d. Capture evidence

- **Single state check** (e.g. "confirm the button is disabled", "confirm
  the field shows X") → take one screenshot via the `computer` tool's
  screenshot action.
- **Multi-step interaction** (e.g. drag-and-drop, a multi-page flow, a
  sequence a still image can't prove) → use `gif_creator` to record the
  interaction instead.

Save the captured file to a scratch path, e.g.:

```bash
EVIDENCE_DIR=$(mktemp -d)
```

and pass `$EVIDENCE_DIR/<work-unit-id>.png` (or `.gif`) as the
target/output path to whichever capture tool you used.

If the capture tool itself fails (crashes, times out, produces nothing) —
**SKIP this item**, reason `"capture tool failed"`, and continue. Never
let one bad capture abort the whole run.

### 3e. Judge the result — do not rubber-stamp

Compare what you observed against the verification steps. This is a real
check, not a formality:

- The app shows the expected behavior → `outcome: "passed"`.
- The app shows a bug, an error, or behavior that contradicts the
  verification steps → `outcome: "failed"`. Attach evidence either way —
  a failure screenshot is exactly the kind of evidence Ponder needs.

### 3f. Attach and report

```
mcp__ponder__attach_image({
  workUnitId: <id>,
  filePath: "<path from 3d>"
})
```

```
mcp__ponder__report_verification({
  workUnitId: <id>,
  outcome: "passed" | "failed",
  summary: "<what you checked and what you observed, 1-3 sentences>",
  // only if this item's verification steps were missing going in:
  verificationSteps: "<the steps you actually ran>"
})
```

## Step 4: Final summary

After the loop, report to the user:

- N passed, M failed, K skipped
- For each skipped item: its title and the reason (from 3b/3c/3d)

This is the only output the user needs to see the run's outcome without
opening Ponder.
````

- [ ] **Step 2: Verify tool-name consistency**

Run: `grep -oE '"[a-z_]+"' src/mcp/server.ts | grep -E '"(list_projects|list_work_units|attach_image|report_verification)"' | sort -u`
Expected output (order may vary):
```
"attach_image"
"list_projects"
"list_work_units"
"report_verification"
```

Run: `grep -oE 'mcp__ponder__[a-z_]+' skills/ponder-verify/SKILL.md | sort -u`
Expected output:
```
mcp__ponder__attach_image
mcp__ponder__list_projects
mcp__ponder__list_work_units
mcp__ponder__report_verification
```
Confirm every tool name after the `mcp__ponder__` prefix in the second
list appears in the first list — this catches typos/drift between the
skill's instructions and the server's actual registered tool names.

- [ ] **Step 3: Add the install section to README-mcp.md**

Insert a new section into `README-mcp.md` immediately after the
`## Registration` section ends (after line 62, before the `## Tools
reference` heading at line 64):

`````markdown
## Automated verification (`ponder-verify` skill)

A global Claude Code skill that automates the Verify flow's evidence
capture: it resolves which Ponder project this repo maps to (via each
project's `githubRepos` setting), pulls the pending-verification queue,
drives the app in a browser to capture a screenshot or recording per
item, and reports pass/fail — instead of that loop being manually
improvised each time.

Install it once, globally (works from any repo afterward):

```bash
mkdir -p ~/.claude/skills/ponder-verify
cp /Users/john-perkins/Projects/Sphero/teamalliance/kanban/skills/ponder-verify/SKILL.md ~/.claude/skills/ponder-verify/SKILL.md
```

Generic form, for use on any machine:

```bash
mkdir -p ~/.claude/skills/ponder-verify
cp <path-to-ponder-repo>/skills/ponder-verify/SKILL.md ~/.claude/skills/ponder-verify/SKILL.md
```

**Before running it in a given repo:** make sure that repo's Ponder
project has `githubRepos` set to this repo's `owner/repo` (project
settings) — this is how the skill knows which project to work against.

Then, from any repo with the `ponder` MCP server registered and its own
dev server running:

```
/ponder-verify
```
`````

- [ ] **Step 4: Replace the manual-verification example prompt**

Edit `README-mcp.md:106`. Replace:

```markdown
- "List work units pending verification for project acme-web, verify each one, attach a screenshot or a recording of the test run, and report the result."
```

with:

```markdown
- Run `/ponder-verify` (see "Automated verification" above) to process the pending-verification queue for the current repo automatically.
```

- [ ] **Step 5: Full verification bar and commit**

Run: `npm run test:ci` (full suite) — expect all tests pass.
Run: `npx tsc --noEmit` — expect no output.
Run: `npm run lint` — expect 0 errors.
Run: `npm run knip` — expect no output (no new dead code/exports).

```bash
git add skills/ponder-verify/SKILL.md README-mcp.md
git commit -m "feat: add ponder-verify skill for automated verification evidence

Codifies the previously manual/ad-hoc screenshot-attach-report loop
into a repeatable global skill: resolves the current repo's Ponder
project via githubRepos, processes the pending-verification queue
sequentially, captures evidence via claude-in-chrome, and reports
pass/fail through the existing attach_image/report_verification tools."
```

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin docs/ponder-verify-skill-design
gh pr create --title "feat: add ponder-verify skill for automated verification evidence" --body "$(cat <<'EOF'
## Summary
- Exposes `githubRepos` in the `list_projects` MCP tool output (server-side change).
- Adds a global `ponder-verify` skill (`skills/ponder-verify/SKILL.md`) that automates the Verify flow's evidence capture: resolves the current repo's Ponder project via `githubRepos`, processes the pending-verification queue sequentially, captures screenshots/recordings via `claude-in-chrome`, and reports pass/fail via the existing `attach_image`/`report_verification` tools.
- Updates `README-mcp.md` with install instructions and an updated example.

Implements the design in `docs/superpowers/specs/2026-07-15-ponder-verify-skill-design.md` (PR #42).

## Test plan
- [x] `npm run test:ci -- src/mcp/tools.test.ts`
- [x] `npm run test:ci` (full suite)
- [x] `npx tsc --noEmit`
- [x] `npm run lint`
- [x] `npm run knip`
- [ ] Manual: run `/ponder-verify` against a real project with a pending-verification work unit; confirm the attachment and report land on the card, and that a deliberately-unreachable dev server produces a skip, not a false failure.
EOF
)"
```

Note: this reuses the `docs/ponder-verify-skill-design` branch (already open as PR #42, carrying only the design doc) — both tasks' commits land on that same branch/PR, since the skill and the spec that motivates it are one coherent unit of review.
