# Equilibrium Meter (Gamification) — Design

## Purpose

Ponder's kanban harness surfaces real signals today — verification outcomes,
WIP via columns, staleness via timestamps — but nothing turns them into
feedback a developer actually feels moment to moment. Four recurring
frictions go unaddressed by the UI: verification gets skipped or rushed under
time pressure, WIP sprawls across too many open work units at once,
decomposition quality (well-specified vs. vague work units) has no visible
signal, and stale/blocked work sits quietly with no pressure to unstick it.

This adds a lightweight gamification layer — the **Equilibrium Meter** — that
turns those four signals into one glanceable, continuously-computed score,
framed through two intentional two-player tensions rather than a single
undifferentiated "productivity score":

- **Speed vs. Rigor** — you vs. the AI agent. The agent is structurally
  biased toward decomposing fast and calling work done; you're biased toward
  thoroughness. Fed by decomposition quality and verification rigor.
- **Present vs. Future** — you vs. future-you. Starting more work now feels
  good; finishing what's started is what future-you needs. Fed by WIP level
  and staleness.

A fifth signal, **churn** (work that had to be redone — regardless of
whether the miss was technical or a scoping problem), acts as a damper on
the composite score rather than a fifth parallel axis: it's the lagging
indicator that checks whether the other four (leading) signals were honest.

Nash equilibrium is used as a framing device, not a literally-computed
payoff-matrix engine (per explicit design decision — see Non-Goals): the
meter reads "balanced" only when neither side of each tension is being
maximized at the other's expense.

This is Phase 1 of a two-phase concept. Phase 1 is fully single-instance —
you, the AI agent (as a role, not a tracked identity), and your own history.
Phase 2 (cross-dev multiplayer/leaderboard) is a deliberate future
follow-up, not designed here.

## Non-Goals

- **No literal game-theory engine.** No payoff matrices, no computed
  equilibrium point, no strategy simulation. The meter is a weighted
  formula, not a solver.
- **No enforcement.** The meter never blocks or gates an action (no
  soft-block on pulling new work, no hard-stop on move-to-QA). Pure
  feedback layer, per explicit decision.
- **No cross-dev multiplayer in this iteration.** No accounts, no
  cross-instance sync, no leaderboard. That's Phase 2, requiring its own
  identity/privacy design — noted below, not scoped here.
- **No configurable thresholds/weights UI.** WIP limit, staleness window,
  churn weight, axis weighting, etc. are hardcoded constants for v1, per
  explicit decision to ship the simplest version first.
- **No JIRA description writes.** All new tracking (reopen counters, linked
  follow-ups) is local-only or read-only against JIRA — consistent with
  Ponder's standing invariant of never modifying the original issue content.
- **No large badge catalog.** A small, curated set (5 badges) for v1, not an
  extensible achievement system.

## Data Model

```prisma
model WorkUnit {
  // ...existing fields...
  reopenCount    Int       @default(0)   // times moved backward through columns after advancing
  lastReopenedAt DateTime?
}

model Story {
  // ...existing fields...
  reopenCount        Int       @default(0)  // times jiraStatus regressed to an earlier workflow stage
  lastReopenedAt      DateTime?
  linkedFollowUpKeys  String?                // comma-separated JIRA keys of issues linking back to
                                              // this story, created after it reached a terminal status
}

model MeterSnapshot {
  id            String   @id @default(cuid())
  date          DateTime @unique   // day granularity
  decomposition Int
  rigor         Int
  wip           Int
  staleness     Int
  churnEvents   Int
  overall       Int
  band          String   // "equilibrium" | "drifting" | "out"
  createdAt     DateTime @default(now())
}

model Badge {
  id       String   @id @default(cuid())
  key      String   @unique
  earnedAt DateTime @default(now())
}
```

No changes to `Project`, `WorkNote`, or `Attachment`. No new tables for
churn events themselves — churn is derived on read from
`WorkUnit.reopenCount`, `WorkUnit.verificationOutcome`, `Story.reopenCount`,
and `Story.linkedFollowUpKeys`, not logged as a separate event stream.

## Signal Computation

Each of the four leading axes is a continuous 0–100 score (`100 − penalty`,
penalty scaling smoothly past a threshold, floored at 0):

| Axis | Window | Computation |
|---|---|---|
| Decomposition quality | Live snapshot of open (non-done, non-archived) work units | % with both `acceptanceCriteria` and `verification` populated |
| Verification rigor | Rolling 14 days of work units that reached QA | % with `verificationRequestedAt` set **and** ≥1 attachment before/at QA |
| WIP | Live snapshot | Count of non-archived `in_progress` work units vs. target limit (default 3); 100 at/under, decays past it |
| Staleness | Live snapshot of open work units | % with no activity (no new `WorkNote`/`Attachment`/column move) in the last 5 days |

**Churn events** (rolling 14-day window), each counted once per occurrence:
- Work unit's `verificationOutcome` becomes `"failed"`
- Work unit's `reopenCount` increments (column regression)
- Story's `reopenCount` increments (JIRA status regression)
- A new entry appears in `Story.linkedFollowUpKeys`

**Composite formula:**

```
overall = round( average(decomposition, rigor, wip, staleness) × churnDamper )
churnDamper = clamp(1 − 0.08 × churnEventsInWindow, floor = 0.15, ceiling = 1.0)
```

The damper floors at 0.15 rather than 0 — a churny stretch should read as
clearly bad, but shouldn't pin the meter at absolute zero, which would stop
signaling direction (improving vs. worsening) and undercut the harness's
purpose.

**Bands:** 80–100 "In Equilibrium" (green) · 50–79 "Drifting" (yellow) ·
0–49 "Out of Equilibrium" (red).

All thresholds (WIP limit = 3, staleness window = 5 days, churn weight =
0.08, damper floor = 0.15) are named constants in one module, not
per-project settings, per Non-Goals.

## Churn Detection

Three new detection points, each a small addition to existing code paths —
no new background jobs or polling:

1. **Work unit column regression** — `src/app/api/work-units/[id]/move/route.ts`.
   When the destination column's rank is lower than the current column's
   rank (todo=0, in_progress=1, done=2), increment `reopenCount` and stamp
   `lastReopenedAt` as part of the same update.
2. **Story status regression** — `src/lib/sync.ts`. When upserting a story,
   compare the incoming `jiraStatus`'s rank (using the project's
   `jiraSyncStatuses` ordering, already parsed by `parseSyncStatuses`)
   against the currently stored status's rank. If it moved backward,
   increment `Story.reopenCount` and stamp `lastReopenedAt`.
3. **Linked follow-up story** — `src/lib/jira/client.ts` + `src/lib/sync.ts`.
   Add `issuelinks` to the fields requested from JIRA's search API (not
   currently fetched). During sync, for stories that have reached a
   terminal status (have `completionCommentPostedAt` set), check
   `issuelinks` for issues created after that timestamp; append any new
   linked keys to `linkedFollowUpKeys` (dedup against what's already
   stored).

Verification failure requires no new detection — `verificationOutcome`
already transitions to `"failed"` via the existing report-verification flow.

## Badges & Streaks

**Streaks** (live, resettable, computed on read — no dedicated storage):
- *Rigor streak* — consecutive resolved work units (ordered by
  `completedAt`/`verifiedAt` descending) with `verificationOutcome:
  "passed"` and `reopenCount: 0`.
- *Balance streak* — consecutive `MeterSnapshot` rows (most recent first) in
  the green band.

**Badges** (persisted permanently once earned in `Badge`, small curated set):
- *In Equilibrium* — meter reaches the green band for the first time.
- *Steady Week* — 7 consecutive daily snapshots in green.
- *Clean Run* — 10 consecutive work units resolved with zero churn.
- *Quick Unstick* — a work unit stale 5+ days (per the staleness threshold
  above) gets resolved cleanly (`verificationOutcome: "passed"`,
  `reopenCount: 0`) within 48 hours of its next `WorkNote`/`Attachment`/
  column-move activity.
- *Right-Sized Backlog* — decomposition axis at 100 **and** WIP axis ≥80
  simultaneously — both sides of the speed/rigor tension healthy at once.

`MeterSnapshot` rows are computed lazily: the first time the widget or its
detail panel is requested on a given day and no snapshot exists for that
date, compute and persist one. No cron job — consistent with the rest of
the app's request-driven-computation pattern.

## UI

A compact, always-visible meter widget in the board header: current overall
score, band color, no separate stats page (per explicit decision — "both"
was considered and declined). Clicking it opens a popover/panel showing:

- The four axis scores (small bars or numbers)
- Current churn event count and damper factor for the window
- Active streaks
- The badge case — earned badges shown, unearned ones greyed with their
  unlock condition visible
- A small trend sparkline sourced from `MeterSnapshot` history

## Phase 2 (Roadmap Note — Not Designed Here)

Cross-dev multiplayer (you vs. other devs, eventually) is explicitly out of
scope for this spec. When picked up later it will need its own design
covering: identity/accounts, a cross-instance sync/aggregation service for
comparing meter/badge data across separate Ponder instances, and a privacy
model for what's shared (near-certainly opt-in sharing of meter/badge data
only — never JIRA content, consistent with the existing write-back
invariant and the standing preference against a cross-project global
board).

## Testing

Follows the project's existing verification bar (Vitest via `.env.test`,
`tsc --noEmit`, lint, knip, all clean before a PR):

- Pure-function unit tests for each axis formula and the composite/damper
  math, using mock data — no database needed for these.
- Unit tests for the three new churn-detection hooks: move-route column
  regression, sync-engine status regression, and linked-issue parsing.
- Unit tests for badge-award logic, specifically idempotency (a badge is
  never awarded twice).
- Component test for the header widget rendering across all three bands
  (green/yellow/red) and the empty state (no snapshots yet).
