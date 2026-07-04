# Verify Button (Code Review Lane) — Design

## Purpose

Cards in the **Code Review** column need a way to request AI-driven verification (run a test, capture a screenshot as proof) before a human relies on the review being real. Ponder itself never runs tests or captures screenshots — that logic lives in the target repo, executed by an AI agent (e.g. Claude Code) connected to Ponder via MCP. Ponder's job is to track the request/result state and surface it on the card.

## Architecture & Data Flow

1. User clicks **Verify** on a Code Review card.
2. Ponder marks the work unit as "verification requested" (REST call).
3. Separately, the user runs an AI agent in the target repo. The agent:
   - calls Ponder's MCP server to discover pending verification requests,
   - runs whatever test/repro steps apply (writing them down if the card doesn't have them yet),
   - captures a screenshot and attaches it via the existing `attach_image` MCP tool,
   - reports the outcome (`passed`/`failed`) and a summary back via a new `report_verification` MCP tool.
4. Ponder's card updates to show a Verified/Failed badge; the screenshot and summary are visible from the card's detail modal.

Ponder does not poll or push to the agent — the agent is expected to be run manually by the user, side-channel, same as today's Move-to-QA / mark-done MCP flows.

## Data Model

Add four fields to `WorkUnit` (mirroring the existing nullable-timestamp pattern used by `archivedAt`/`completedAt`):

```prisma
verificationRequestedAt DateTime?
verifiedAt               DateTime?
verificationOutcome      String?   // "passed" | "failed"
verificationSummary      String?
```

The existing `verification String?` field (verification steps/instructions) is reused as-is. If it's empty when the agent runs, the agent documents the steps it used and Ponder stores them there.

## REST API

- **`POST /api/work-units/[id]/request-verification`**
  Sets `verificationRequestedAt = now()`; clears `verifiedAt`, `verificationOutcome`, `verificationSummary` from any prior run.
  - 404 if the work unit doesn't exist.
  - 422 if the work unit's `column !== "code_review"`.
  - 200 with the updated `WorkUnitDTO` on success.

- **`POST /api/work-units/[id]/report-verification`**
  Body: `{ outcome: "passed" | "failed", summary: string, verificationSteps?: string }`.
  Sets `verifiedAt = now()`, `verificationOutcome`, `verificationSummary`; clears `verificationRequestedAt`. If `verificationSteps` is provided and the work unit's `verification` field is currently empty, fills it in.
  - 404 if the work unit doesn't exist.
  - 400 if `outcome` is missing or not one of the two valid values, or `summary` is missing.
  - 200 with the updated `WorkUnitDTO` on success.

`WorkUnitDTO` gains the four new fields, serialized the same way `archivedAt`/`completedAt` are (ISO string or `null`).

## MCP Surface

- **`list_work_units`** gains an optional `pendingVerification?: boolean` arg. When true, filters to work units where `verificationRequestedAt` is set and `verifiedAt` is null, and includes each one's `verification` text in the output (or a note that it's missing, so the agent knows to document steps as it goes).
- **New tool: `report_verification(workUnitId, outcome, summary, verificationSteps?)`** — thin wrapper over `POST /api/work-units/[id]/report-verification`, following the existing pattern of `moveWorkUnit`/`markDone`/`updateWorkUnit` in `src/mcp/tools.ts`.

Screenshot evidence goes through the *existing* `attach_image` tool — no new upload path.

## UI (`WorkUnitCard`, Code Review lane only)

| State | Condition | Rendering |
|---|---|---|
| Idle | no request yet | Enabled "Verify" button (styled like the existing Move-to-QA button) |
| Pending | `verificationRequestedAt` set, `verifiedAt` null | Disabled button reading "Verifying…" |
| Passed | `verificationOutcome === "passed"` | Button replaced by a green "Verified ✓ `<date>`" badge; no re-verify affordance |
| Failed | `verificationOutcome === "failed"` | Red "Verification failed" badge (summary as title/tooltip); "Verify" button reappears, enabled, for retry |

`WorkUnitDetailModal` shows the verification summary/outcome next to the existing Acceptance Criteria/Verification fields. The screenshot renders as a thumbnail via the existing attachments feature — no new UI required there.

**Known limitation (accepted for v1):** if a card leaves Code Review and later returns (e.g. dragged back to In Progress for more work, then forward again), a prior Verified/Failed badge persists even though the underlying code has changed. Not clearing verification state on column exit is a deliberate simplicity trade-off; revisit if it causes real confusion.

## Error Handling

- `request-verification` on a card not in `code_review` → 422, surfaced as an alert in the UI (matches the existing Move-to-QA error-handling pattern).
- `report-verification` with an invalid/missing `outcome` or missing `summary` → 400, returned as `{ error: string }`.
- Both endpoints 404 cleanly if the work unit doesn't exist (e.g. archived or deleted between request and report).

## Testing

- Unit tests for both new API routes (success, 404, 422/400 paths) following the existing `move-to-qa` route test style.
- Unit tests for the two MCP tool changes (`listWorkUnits` with `pendingVerification`, new `reportVerification`) following the existing `tools.test.ts` patterns.
- Component tests for `WorkUnitCard`'s four verification states (idle/pending/passed/failed), following the existing Move-to-QA button test coverage.
- Migration + Prisma schema test coverage consistent with the `archivedAt` migration precedent.
