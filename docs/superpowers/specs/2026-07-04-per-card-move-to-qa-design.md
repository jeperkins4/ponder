# Per-Card Move-to-QA Reporting — Design

## Purpose

Today, clicking **Move to QA** on any Done card requires every sibling work unit of the story to already be Done, and immediately transitions the JIRA story to QA and archives all of them in one shot. There's no per-card evidence trail and no way to confirm individual sub-stories as they finish — it's all-or-nothing.

This changes Move-to-QA into a two-phase flow: every click posts that card's own evidence (acceptance criteria, verification, screenshots) to JIRA as a comment, and only the *last* sibling's click actually transitions the story and archives everything.

## Architecture & Data Flow

1. **Every click** on a Done card's Move-to-QA button is always allowed — there is no longer an "all siblings Done" precondition to click at all (the button already only renders on Done cards).
2. The click posts a JIRA comment built from that work unit's own `title`, `description`, `acceptanceCriteria`, and `verification` fields (no AI summarization — the fields are used as-is), and uploads that work unit's own attachments to the JIRA issue.
3. If the comment post or any attachment upload fails, the whole click fails: the error is surfaced to the user (matching today's existing Move-to-QA error pattern) and nothing is marked reported. The user can retry.
4. On success, the work unit's new `movedToQaReportedAt` timestamp is set.
5. Ponder then checks: are *all* of the story's active (non-archived) work units both `column === "done"` and have `movedToQaReportedAt` set? If yes — this was the last card — the existing transition logic runs: the JIRA story transitions to QA, and every active Done work unit (including this one) is archived, exactly as today. If no, the click just returns success as a per-card report; the story and its cards are otherwise untouched.

## Data Model

Add one field to `WorkUnit` (same nullable-timestamp pattern as `archivedAt`/`completedAt`):

```prisma
movedToQaReportedAt DateTime?
```

## API

`POST /api/work-units/[id]/move-to-qa` (existing endpoint, behavior changes):

- No longer pre-checks "all siblings Done" before doing anything.
- Posts the comment + uploads attachments for this work unit; on any failure, returns the existing error shape (422/500 as appropriate) and does not set `movedToQaReportedAt`.
- On success, sets `movedToQaReportedAt`, then checks story-wide readiness (all active work units Done AND reported). If ready, runs the existing JIRA-transition-to-QA + archive-all logic.
- Response body: `{ ok: true, transitioned: boolean }` — `transitioned: true` only when this click was the one that triggered the JIRA transition + archive.

`WorkUnitDTO` gains `movedToQaReportedAt: string | null`, serialized the same way as the other nullable timestamps, in every existing DTO-serialization spot.

## UI (`WorkUnitCard`, Done lane)

| State | Condition | Rendering |
|---|---|---|
| Idle | `movedToQaReportedAt` null | Enabled "Move to QA" button (unchanged) |
| Reported, not yet transitioned | `movedToQaReportedAt` set, card still present | Button replaced by a "Reported to JIRA ✓" badge; no further action on this card |
| Transitioned | last sibling's click triggered the transition | Card (and all its siblings) archived and removed from the board, exactly as today's existing archive-on-move-to-qa behavior |

Toast messaging (`onStatusMessage`) differs by outcome:
- Not yet transitioned: `"Reported <title> to JIRA — waiting on N more sub-stories"`
- Transitioned (this click was the last one): today's existing `"Moved <storyKey> to JIRA QA"`

## Error Handling

- Comment-post or attachment-upload failure: whole click fails, alert shown, nothing marked reported — same error-surfacing pattern as today's Move-to-QA (not the silent non-blocking pattern used by the automatic Code-Review-comment sync elsewhere in this codebase).
- A missing work unit or story: existing 404 handling, unchanged.
- Missing/incomplete JIRA credentials on the project: existing error, unchanged.

## Testing

- Unit tests for the new per-card reporting logic (comment content built from the four fields, attachment upload scoped to just this work unit, `movedToQaReportedAt` set only on success).
- Unit tests for the readiness check (all Done + all reported → transitions; missing either condition on any sibling → does not transition).
- Route tests covering: first click on a 2-work-unit story (reports, does not transition), second/last click (reports and transitions + archives), a failed comment post (nothing marked reported, error returned).
- Component tests for `WorkUnitCard`'s three states (idle/reported/gone-after-transition).

## Known Limitation (accepted)

A work unit that gets dragged back out of Done after being reported keeps its `movedToQaReportedAt` timestamp — if it's dragged back to Done later without going through any reset, it would already count as "reported" for the readiness check without a fresh comment reflecting whatever changed in between. This mirrors the existing accepted limitation for the Verify feature's stale-badge case; not addressed in this pass.
