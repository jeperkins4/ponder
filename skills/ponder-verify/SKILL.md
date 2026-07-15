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
