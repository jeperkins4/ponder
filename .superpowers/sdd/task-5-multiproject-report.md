# Task 5: Extract KanbanBoard component and add per-project board route — Report

**Status: DONE_WITH_CONCERNS**

## Approach

Extracted the fully-featured inline board UI from `src/app/board/page.tsx`
(Ponder styling, columns, keyboard nav, ARIA, onboarding, theme-awareness)
verbatim into a new reusable client component, `src/components/KanbanBoard.tsx`,
accepting `{ projectId?: string }`. `/board` now renders `<KanbanBoard />` with
no `projectId` (unscoped, backward compatible). A new server component,
`src/app/projects/[projectId]/board/page.tsx`, looks up the project via
`prisma.project.findUnique`, renders a not-found state if missing, and
otherwise renders the project name, a `<ProjectSelector>`, a conditional
"Import from JIRA" button (JIRA-type projects only, POST
`/api/projects/[projectId]/sync`), and `<KanbanBoard projectId={project.id} />`.

Per the multi-project controller's own note in
`.superpowers/sdd/multiproject-progress.md` (Task 5 must be rewritten from the
plan's literal text, since the plan assumed a `KanbanBoard` that didn't exist
yet and a `/board` redirect stub that would have discarded the Ponder UI), I
followed the extract-first approach it prescribes rather than the plan's
literal steps.

## Preserved features (confirmed present + tested in `KanbanBoard.test.tsx`)

- Fetch `/api/stories` (or `/api/stories?projectId=X` when scoped) and group
  WorkUnits into todo/in_progress/done columns — tested.
- `WorkUnitCard` rendering with edit/delete/save/cancel, 2-step delete
  confirm — tested (`renders Edit and Delete buttons`, end-to-end edit/delete
  test).
- Keyboard navigation (Enter=edit, Delete=remove, ArrowLeft/Right=move focus
  between columns) via `handleKeyboardNavigation` + column refs — tested
  (`Keyboard column navigation` describe block, 6 tests, moved verbatim).
- ARIA: `<main id="main-content">`, skip link, `<section aria-label>` column
  landmarks, `aria-live="polite"` status region, focus management — tested
  (`Accessibility landmarks` describe block, 5 tests).
- `OnboardingTooltip` (first-visit, localStorage `boardOnboarded`) — tested
  (`Onboarding tooltip` describe block, 4 tests).
- Ponder theme styling via `useTheme`, light/dark tokens — tested (new
  `Theme awareness` describe block: dark-mode class applied when
  `ponderTheme=dark` in localStorage, light-mode class by default).
- Empty/loading/error states — tested (`handles loading state`,
  `handles error state`, `displays 'No tasks' when a column is empty`).

## Change from the original: removed the board's own theme toggle button

`TopNav` (already wired into the root layout, confirmed via
`src/components/TopNav.test.tsx`) now provides the single global theme
toggle. Per the task instructions, `KanbanBoard` no longer renders its own
`theme-toggle-button` — a test (`does not render its own theme toggle
button`) asserts this. The board remains theme-responsive: it still calls
`useTheme()` and applies `isDark`-driven classes, which pick up toggles
broadcast by TopNav's `useTheme` instance via the shared
`ponder-theme-change` custom event / `storage` event. `TopNav.test.tsx`
(pre-existing, untouched) already covers toggle-and-persist behavvior, so no
coverage was lost by removing the duplicate button.

## Files created

- `src/components/KanbanBoard.tsx` — extracted board UI + `KanbanColumn`, `projectId` prop
- `src/components/KanbanBoard.test.tsx` — 32 tests (all behavior from the old page test, plus a project-scoped-fetch test and the theme-awareness tests replacing the removed toggle-button tests)
- `src/components/ImportFromJiraButton.tsx` — small client component, POSTs to `/api/projects/[projectId]/sync`, Ponder-styled loading/success/error states (same UX pattern as the existing `src/app/components/SyncButton.tsx`, scoped to a project instead of the global env-based sync)
- `src/app/projects/[projectId]/board/page.tsx` — server component (async `params`, `not-found` state, heading, `ProjectSelector`, conditional `ImportFromJiraButton`, `KanbanBoard`)
- `src/app/projects/[projectId]/board/page.test.tsx` — 5 tests (heading + scoped KanbanBoard, ProjectSelector rendered, Import button shown for JIRA / hidden for STANDALONE, not-found state); mocks `@/lib/prisma` and stubs `@/components/KanbanBoard` (which does its own live `fetch` and is exhaustively covered by its own suite)

## Files changed

- `src/app/board/page.tsx` — now a ~10-line wrapper: `export default function Board() { return <KanbanBoard />; }`
- `src/app/board/page.test.tsx` — slimmed to 3 smoke tests (renders heading via KanbanBoard, fetches unscoped `/api/stories`, loading state); full behavioral coverage moved to `KanbanBoard.test.tsx` so no coverage was dropped

## Not touched (per constraints)

- Prisma schema, `src/lib/sync.ts`, `src/app/api/stories/route.ts`,
  `src/app/api/projects/**` routes — untouched (Tasks 1-4's work, reused as-is).
- `/projects/new` and `/projects/[projectId]/settings` — not created/modified
  by this task; they already existed on disk from Task 6 (parallel work) by
  the time this task ran, confirmed via the full serial test run below.

## Tests

Targeted run (new/adapted files):
`npx dotenv -e .env.test -- vitest run src/components/KanbanBoard.test.tsx src/app/board/page.test.tsx "src/app/projects/[projectId]/board/page.test.tsx" src/components/ProjectSelector.test.tsx --no-file-parallelism`
→ **51/51 passing** (4 test files).

Full suite, serial: `npx dotenv -e .env.test -- vitest run --no-file-parallelism`
→ **222/222 passing**, 25 test files (includes Task 6's project-form tests,
which were present and green).

`npx tsc --noEmit` → clean, no errors.

## Concerns

All preserved-feature checks above are backed by passing tests, `tsc` is
clean, and the full pre-existing suite (222 tests across 25 files) passes
with no regressions. Two things worth flagging for Task 7 verification
rather than silently fixing (neither blocks, both are judgment calls a
reviewer should confirm):

- **Double `<h1>` and skip-link placement on the new project board page.**
  `src/app/projects/[projectId]/board/page.tsx` renders the project name
  (`<h1>{project.name}</h1>`) plus `ProjectSelector` and the sync button
  *outside* and *before* `KanbanBoard`'s own `<main>`/skip-link/`<h1>Kanban
  Board</h1>`. Result: two `<h1>` elements on that page, and KanbanBoard's
  "Skip to main content" link no longer sits at the very top of the page (the
  project chrome precedes it), so it skips less than it did on `/board`. This
  follows directly from the task spec ("renders the project name as a
  heading" *and* "renders ... `<KanbanBoard>` for the board itself" as a
  separate preserved unit), so I did not restructure it, but a stricter WCAG
  pass might want a single `<h1>` and the skip link moved above the new
  chrome.
- **Project-page chrome is light-mode-only.** The heading, `ProjectSelector`,
  and this task's new `ImportFromJiraButton` are theme-aware where the design
  calls for Ponder purple accents, but `ProjectSelector` (Task 3/6 code, not
  touched here) hardcodes light-palette classes (`text-ponder-light-text`,
  etc.) with no `isDark` branch, and my page wrapper follows the same
  light-only convention already used by `src/app/projects/page.tsx`. So on
  this new route, `KanbanBoard` itself still fully respects dark mode, but the
  surrounding project chrome above it won't switch with the rest of the app.
  Flagging rather than fixing since `ProjectSelector` is out of this task's
  file ownership and the existing projects list page has the same gap.
