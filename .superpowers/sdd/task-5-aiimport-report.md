# Task 5: Import review UI ("review list, then process")

Status: DONE

## Files created/changed

- Created `src/components/ImportReview.tsx` — modal dialog (`role="dialog"`, `aria-modal`, `aria-labelledby`, Escape-to-close, focus trap/restore mirroring `OnboardingTooltip`). On mount, POSTs `/api/projects/[projectId]/import/preview`. Shows "Loading stories from JIRA…" while loading; on empty `stories`, shows `message` (or "No stories to import.") plus a Close button. Otherwise renders one row per story: an unchecked "Break down into subtasks" checkbox (labelled via `htmlFor`/`id`), the `jiraKey`, the `summary`, and a Ponder-styled badge showing the target-column label (via `COLUMNS`). Includes a "Select all / Select none" nice-to-have for the breakdown checkboxes. Header shows "Import N stories" plus a **Process** button. Process POSTs `/import/process` with `items` carrying each row's live `breakDown` flag; while in flight the button is disabled and "Processing… breaking down stories may take a moment." is shown. On success calls `onImported()` then `onClose()`; on error shows the message inline (`role="alert"`) and keeps the dialog open. Theme-aware via `useTheme` with Ponder tokens (`bg-ponder-{light,dark}-surface/purple/purple-light`, `text-ponder-*`, `border-ponder-*`).
- Created `src/components/ImportReview.test.tsx` — covers: loading state, per-row rendering (badge label + unchecked checkbox + labelled checkboxes), empty preview with provided/default message, toggling one row's checkbox and asserting the exact posted `items` payload (including the untouched row staying `false`), success path calling `onImported` then `onClose`, error path showing the alert and leaving the dialog open, and Escape-to-close.
- Modified `src/components/ImportFromJiraButton.tsx` — no longer POSTs `/sync` directly. Now manages `isReviewOpen` state; clicking the button opens `<ImportReview projectId={projectId} onClose={...} onImported={...} />`. Kept theme-aware (Ponder purple background) and the "Import from JIRA" label/testid unchanged.
- Modified `src/components/ImportFromJiraButton.test.tsx` — replaced the old `/sync`-behavior assertions with: opens the dialog and fires the preview `POST /import/preview` request on click, and closing via the review's Close button.
- Modified `src/components/KanbanBoard.tsx` — added a `window` event listener for `"ponder-jira-import-complete"` that triggers a silent `fetchStories` refetch.

### How the board refresh is wired (deviation from the literal spec wording, documented)

The spec suggested threading an `onImported`/refresh prop through `board/page.tsx`'s `headerActions` down from `KanbanBoard`. That path doesn't work: `board/page.tsx` is a Server Component, and Next.js App Router forbids passing functions as props across the server→client boundary (only serializable values/JSX may cross). Changing `headerActions` to a render-prop function would pass a function server→client and fail at runtime — a failure mode neither `tsc` nor the existing mocked `page.test.tsx` would catch, since that test stubs out `KanbanBoard` entirely.

Instead, `ImportFromJiraButton` dispatches a `window` `Event("ponder-jira-import-complete")` when `ImportReview`'s `onImported` fires, and `KanbanBoard` listens for that event to do a silent refetch — mirroring the existing `THEME_EVENT` cross-instance-sync pattern already used in `src/hooks/useTheme.ts`. `board/page.tsx` required no changes. Verified end-to-end via the existing (unmocked) `page.integration.test.tsx`, which renders the real `KanbanBoard` + `ImportFromJiraButton` tree and still passes.

## Tests

- `npx dotenv -e .env.test -- vitest run src/components/ImportReview.test.tsx src/components/ImportFromJiraButton.test.tsx --no-file-parallelism` → **12 passed** (7 ImportReview + 5 ImportFromJiraButton).
- Full suite serially: `npx dotenv -e .env.test -- vitest run --no-file-parallelism` → **304 passed**, 35 files (baseline 297 + 7 new ImportReview tests; ImportFromJiraButton kept 5 tests, rewritten for new behavior).
- `npx tsc --noEmit` → clean, no errors.

## Concerns

- None blocking. The known "re-importing a story creates duplicate cards" limitation was left untouched per instructions (backend behavior, not addressed here); the review UI does not attempt to flag already-imported stories since the preview payload has no such signal today.
- Only files relevant to this task were staged for commit; several unrelated pre-existing untracked report/progress files from other tasks were left untouched.

## Commit

Commit hash: (see below, filled after `git commit`)
