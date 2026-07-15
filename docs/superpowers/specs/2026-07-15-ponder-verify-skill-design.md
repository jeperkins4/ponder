# Automatic Verification Evidence (`ponder-verify` skill) — Design

## Purpose

Today, capturing and attaching verification evidence (screenshots/recordings for
a Code Review card) is entirely manual and side-channel: per the
[Verify Button design](2026-07-04-verify-button-design.md), "the agent is
expected to be run manually by the user" and evidence capture is just an
example prompt in `README-mcp.md`, faithfully improvised each time. Nothing
codifies *how* to capture evidence, *when* to skip vs. fail an item, or
*which* Ponder project a given "home" repo (the repo the agent is actually
coding in) maps to.

This adds a global Claude Code skill, `ponder-verify`, that codifies the full
loop — resolve project → fetch the pending-verification queue → drive the
browser to capture evidence → attach + report — as a single repeatable,
on-demand command usable from any repo, not just Ponder's own.

Scope is deliberately narrow: this only automates evidence capture for the
**existing Code Review / Verify flow**. It does not change what happens at
Done, and it does not add a new trigger (hook) — that's a possible follow-up,
not part of this design.

## Non-Goals

- No auto-verification on card move to Done, or anywhere outside the existing
  Verify flow.
- No Claude Code hook (e.g. Stop hook) that fires without being asked — this
  is an explicit, on-demand skill invocation only.
- No new MCP tool for the capture→attach→report sequence — the skill
  orchestrates the existing `list_work_units`, `attach_image`, and
  `report_verification` tools rather than collapsing them into one call,
  since the judgment calls (screenshot vs. recording, pass vs. fail, skip vs.
  attempt) belong in the skill's instructions, not a mechanical tool.
- No support for non-browser (API/CLI-only) verification in this iteration —
  home repos are assumed to be browser-drivable web apps.

## Architecture & Data Flow

```
Home repo (any project, Claude Code + ponder MCP registered)
  |
  |  /ponder-verify
  v
1. Resolve project
   - `git remote get-url origin` in the current repo
   - list_projects (MCP) -> parse each project's githubRepos
   - match current remote against githubRepos
   - no match (0 or >1 projects) -> stop, tell the user which repos
     are configured, do not guess

2. Fetch queue
   - list_work_units(projectId, pendingVerification: true)
   - empty -> report "nothing pending", stop

3. For each pending work unit, SEQUENTIALLY (one browser session/state
   at a time — a prior item's state must not bleed into the next):
   a. Read verification steps / title / description for what to check
   b. Confirm the dev server is reachable
      -> unreachable: SKIP, record why, continue
   c. Drive the flow via claude-in-chrome
      - single state check -> screenshot
      - multi-step interaction -> gif_creator recording
      -> can't determine/drive the flow: SKIP, record why, continue
   d. Judge the result against the verification steps — not a rubber
      stamp. A UI showing the bug is a FAILED verification; evidence
      is attached either way.
   e. attach_image(workUnitId, capturedFile)
   f. report_verification(workUnitId, outcome, summary)

4. Final summary: N passed, M failed, K skipped (with reasons)
```

Ponder itself remains passive in this flow, consistent with the Verify
Button design's original architecture: "Ponder itself never runs tests or
captures screenshots... Ponder does not poll or push to the agent." This
design only replaces *ad hoc, manually-improvised* agent behavior with a
*codified, repeatable* one — it doesn't change Ponder's role.

## Ponder-Side Changes

Only one server-side change is needed. Everything else the skill needs
already exists.

- **`list_projects` MCP tool** (`src/mcp/tools.ts`): include `githubRepos` in
  each project's formatted output line (it's already on the `Project` model
  and used server-side by `prGatedCompletion` for PR matching — this just
  surfaces it to the MCP client). Example line becomes:
  `- Acme Web (id: proj-1, type: JIRA, jiraProjectKey: ACME, githubRepos: acme/web-app, stories: 12, workUnits: 34)`
  Projects with no `githubRepos` configured show `githubRepos: —`, matching
  the existing `jiraProjectKey: —` convention for unset fields.

No schema changes, no new REST endpoints, no new MCP tools. `list_work_units`
already includes each pending item's `verification` text (or a note that
it's missing) per the original Verify Button design; `attach_image` already
accepts `.gif` alongside images and video, so multi-step recordings need no
new upload/storage support.

## The `ponder-verify` Skill

- **Location:** `skills/ponder-verify/SKILL.md` in this repo (new top-level
  `skills/` directory — distinct from `docs/superpowers/`, since this is a
  distributable artifact, not a design record).
- **Install:** global, user-level (`~/.claude/skills/ponder-verify/`),
  mirroring the existing global MCP server registration in `README-mcp.md`.
  A copy or symlink from the checked-out Ponder repo — exact mechanism
  (copy vs. symlink, any install script) is a plan-time detail.
- **Invocation:** on-demand only, e.g. `/ponder-verify`, run from within a
  home repo with the `ponder` MCP server already registered.
- **Prerequisites documented in the skill:** `ponder` MCP server registered,
  Ponder app running (existing prerequisite, per `README-mcp.md`), the
  target project's `githubRepos` field set to match this repo's remote,
  home repo's dev server running before invocation.

## Error Handling

| Condition | Behavior |
|---|---|
| No project's `githubRepos` matches current remote | Stop immediately; list configured repos so the user can fix `githubRepos` or confirm they're in the wrong repo. |
| More than one project matches | Stop; ask rather than guess (today's data model implies one repo per project, so this signals a config problem). |
| No pending-verification work units | Report "nothing pending", stop cleanly (not an error). |
| Dev server unreachable for a given item | Skip that item, record the reason, continue to the next. |
| Can't determine/drive the verification flow for an item | Skip, record the reason, continue. |
| `claude-in-chrome` capture tool failure mid-item | Same as above — skip and continue, never abort the whole run over one bad item. |
| `attach_image` JIRA upload fails | Already handled server-side (attachment saves locally, `jiraUploadedAt` stays null) — skill just relays what the tool reports, nothing new needed. |
| Verification steps reveal the change doesn't work | Not an error — `report_verification` with `outcome: "failed"`, evidence attached showing the failure. |

Skipped items are **never** reported as failed verifications — an
environment problem (server down, ambiguous flow) is not the same claim as
"the code doesn't work," and conflating them would produce misleading
Failed badges on cards that were never actually checked.

## Testing

- `tools.test.ts`: update the `listProjects` test(s) to assert `githubRepos`
  (and the `—` fallback for unset) appears in the formatted output line.
- The skill itself is agent-driven, not unit-testable in the traditional
  sense. Verification is manual: once implemented, run `/ponder-verify`
  against a real project with a pending-verification work unit and confirm
  the attachment + report land correctly on the card, and that a
  deliberately-unreachable dev server produces a skip (not a false failure).

## Documentation

- `README-mcp.md`: new install section for `ponder-verify`, mirroring the
  existing `claude mcp add` instructions.
- `README-mcp.md`'s "Example prompts" entry about verifying pending work
  units is replaced with a pointer to `/ponder-verify`.
