# PR-Gated Completion — Design

**Date:** 2026-07-05
**Status:** Approved

## Goal

A story advances to Code Review / Done when a pull request referencing it is opened, rather than on a manual board drag (the roadmap's "PR-gated completion"). Ponder polls GitHub during the existing Sync action; a PR whose branch name or title contains a story's JIRA key completes that story's cards and fires the existing JIRA write-back.

## Decisions made during brainstorming

- **Detection:** poll the GitHub REST API — works regardless of who or what opened the PR. No webhooks (Ponder runs on localhost), no MCP-only path.
- **Effect:** a matching PR moves **all of the story's active cards to Done**, which fires the existing completion trigger (`applyStoryStatusSync`: JIRA story → Code Revew + summary comment once all cards are done). The PR replaces the manual drag entirely.
- **Config:** repo list per project (`Project.githubRepos`, comma-separated `owner/repo`, editable in project settings); one `GITHUB_TOKEN` in `.env` serves all repos.
- **Timing:** runs as part of the existing Sync action — one button refreshes JIRA statuses and applies PR-gated completion. No dedicated button, no background interval.

## Included fix: `completedAt` is never stamped

Nothing in the app currently writes `WorkUnit.completedAt` — the move route only updates `column`/`order`. The completed-work and throughput reports (shipped 2026-07-05) therefore read a field that is always null on real data. Because PR-gated completion is exactly "move cards to Done," this design includes the shared fix: entering the `done` column stamps `completedAt`, leaving it clears it, and both the manual move route and the PR gate go through the same helper.

## Architecture

```
src/lib/github/
  client.ts             — fetchRecentPrs(repo, token): thin GitHub REST client
  prMatch.ts            — findPrForKey(jiraKey, prs): pure matcher
  prGatedCompletion.ts  — applyPrGatedCompletion(projectId): the gate
src/lib/completeMove.ts — shared column-move + completedAt stamping helper
  └── used by /api/work-units/[id]/move AND prGatedCompletion
src/lib/sync.ts         — syncStoriesForProject calls applyPrGatedCompletion
                          after the JIRA sync and merges its result
```

No new dependencies: the GitHub client is `fetch`-based.

## 1. Schema & settings

- `Project.githubRepos: String?` — comma-separated `owner/repo` entries (e.g. `sphero/team-alliance, sphero/shared-ui`). Nullable; null/empty means the feature is off for that project.
- Project settings page gains a "GitHub repositories" text input alongside the JIRA fields, saved through the existing project PUT route.
- `GITHUB_TOKEN` is read from `.env` server-side. It is never included in any API response or sent to the client (same posture as `jiraApiToken`).

## 2. GitHub client — `src/lib/github/client.ts`

`fetchRecentPrs(repo: string, token: string): Promise<PrSummary[] | { warning: string }>`

- One request per repo: `GET https://api.github.com/repos/{owner}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=100` with `Authorization: Bearer <token>` and `Accept: application/vnd.github+json`.
- Returns `PrSummary`: `{ number: number; title: string; headRef: string; state: "open" | "closed"; merged: boolean; url: string }`. `merged` derives from `merged_at !== null`; `url` from `html_url`; `headRef` from `head.ref`.
- Non-2xx responses (bad token, unknown repo, rate limit) return `{ warning: "<repo>: <status> <reason>" }` instead of throwing — one bad repo must not break sync. Network errors likewise.
- 100 most-recently-updated PRs per repo is the window; older PRs are assumed already handled (the gate is idempotent, so a missed ancient PR simply never fires — acceptable).

## 3. PR matcher — `src/lib/github/prMatch.ts`

`findPrForKey(jiraKey: string, prs: PrSummary[]): PrSummary | null` — pure.

- Case-insensitive match of the JIRA key against **branch name (`headRef`) or title**, on **word boundaries**: `COM-54` must not match `COM-540`. Boundary = start/end of string or any character that is not `[A-Za-z0-9]` (so `feature/COM-540-team-page`, `COM-540: Team page`, and `[COM-540]` all match; `COM-5401` does not).
- Only PRs that are **open or merged** count; closed-but-unmerged PRs are ignored.
- Returns the first match in the given order (the client returns most-recently-updated first).

## 4. Completion stamping — `src/lib/completeMove.ts`

`moveWorkUnitColumn(workUnitId, column, order, prismaClient?)` — the single shared write path for column moves:

- Updates `column` and `order`.
- Entering `done` (from any other column): sets `completedAt: new Date()` **only if not already set** (a card re-entering done keeps its original completion time).
- Leaving `done` (to any other column): clears `completedAt` to null.
- Moving within the same column: no `completedAt` change.
- Does NOT call `applyStoryStatusSync` — callers decide when to fire the trigger (the move route fires it per move, the PR gate fires it once per story after moving all cards).

The existing `POST /api/work-units/[id]/move` route switches its `prisma.workUnit.update` to this helper; behavior is otherwise unchanged (including its non-blocking `applyStoryStatusSync` call).

## 5. The gate — `src/lib/github/prGatedCompletion.ts`

`applyPrGatedCompletion(projectId: string, prismaClient?, deps?): Promise<PrGateResult>`

`PrGateResult = { cardsCompleted: number; storiesCompleted: number; warnings: string[] }`

Flow:

1. Load the project. If `githubRepos` is null/empty or `GITHUB_TOKEN` is unset → return zeros with no warnings (feature off, silent).
2. Load the project's stories having at least one active (`archivedAt: null`) card not in `done` — stories already all-done or fully archived are not candidates (idempotency by construction).
3. If no candidate stories → return zeros (skip the GitHub calls entirely).
4. Fetch each configured repo's PRs **once** (not per story); collect warnings from failed repos.
5. For each candidate story, `findPrForKey(story.jiraKey, allPrs)`. On a match:
   - Move every active non-done card to `done` via `moveWorkUnitColumn` (order preserved), stamping `completedAt`.
   - Create a `WorkNote` on each moved card: `Completed by PR #<number>: <url>`.
   - Call `applyStoryStatusSync(story.id, prisma)` **once** for the story — the same trigger a manual drag fires. Its own error handling applies (it never throws).
6. Return totals and warnings.

`deps` allows injecting the PR fetcher for tests (default: the real client), following the `ApplyStoryStatusSyncDeps` pattern in `statusTrigger.ts`.

## 6. Sync integration — `src/lib/sync.ts`

`syncStoriesForProject(projectId)` runs `applyPrGatedCompletion(projectId)` after the JIRA sync completes:

- `ProjectSyncResult.message` gains `· N card(s) completed by PRs` when `cardsCompleted > 0`.
- GitHub warnings are appended to the message (e.g. `· GitHub: sphero/team-alliance: 404 Not Found`).
- Any unexpected error from the gate is caught and reported as a warning — GitHub problems never fail the sync.
- Projects not linked to JIRA still short-circuit as today (the gate does not run for them; PR-gating is only meaningful for JIRA-backed stories).

## 7. Testing

- **prMatch (pure):** branch vs title matches, case-insensitivity, word-boundary (COM-54 vs COM-540 vs COM-5401), closed-unmerged excluded, merged included, first-match order, no-match → null.
- **client (stubbed fetch):** field mapping (headRef/merged/url), non-2xx → warning not throw, network error → warning.
- **completeMove (integration, test DB):** entering done stamps `completedAt`; re-entering keeps the original; leaving done clears it; same-column move leaves it untouched.
- **prGatedCompletion (integration, stubbed fetcher):** no-config silent skip; no-candidates skips GitHub calls; match moves all active cards + stamps + work-notes + fires `applyStoryStatusSync` once (stubbed deps assert call count); non-matching story untouched; repo warning propagates; re-run is a no-op.
- **move route:** existing tests keep passing; new cases for the completedAt stamp/clear through the route.
- **sync route:** message merging with cardsCompleted > 0 and with warnings.

All tests run via `npm test` / `npm run test:ci` only (see `vitest.setup.ts` guard).

## Out of scope

- Webhooks and background polling.
- Distinguishing PR opened vs merged (any open-or-merged PR gates; a two-stage lifecycle is a possible future enhancement).
- Per-card PR matching — matching is story-level (`jiraKey`); sub-card granularity would need a card-key convention in branches.
- Backfilling `completedAt` for historical cards (none exist — data was re-imported 2026-07-05).
- Storing PR linkage on the schema (`WorkNote` provenance is sufficient for v1).
