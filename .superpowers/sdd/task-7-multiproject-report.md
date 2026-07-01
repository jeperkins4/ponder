# Task 7: Final Polish and Multi-Project Verification

**Status: DONE**

## Concern 1 — Duplicate `<h1>` + skip-link position

**Fix:** `KanbanBoard` (`src/components/KanbanBoard.tsx`) gained two optional props:

- `title?: string` — defaults to `"Kanban Board"`. Renders as the component's single `<h1>`.
- `headerActions?: React.ReactNode` — rendered in a flex row alongside the `<h1>`, inside
  KanbanBoard's own theme-aware container (`<main id="main-content">` → rounded card div).

The heading + `headerActions` row was moved out of the loading/error/loaded content switch so
it renders unconditionally (previously the `<h1>` only appeared once the board finished
loading, which was itself an accessibility footgun — the landmark heading should be stable).

`src/app/projects/[projectId]/board/page.tsx` no longer renders its own `<h1>`, wrapping
`<div>`, `ProjectSelector`, or `ImportFromJiraButton` outside of KanbanBoard. It now simply
returns:

```tsx
<KanbanBoard
  projectId={project.id}
  title={project.name}
  headerActions={
    <>
      <ProjectSelector projects={projects} currentProjectId={project.id} />
      {project.type === "JIRA" && <ImportFromJiraButton projectId={project.id} />}
    </>
  }
/>
```

**Confirmed:**
- Exactly one `<h1>` on the project board page (the project name), verified by the new
  `page.integration.test.tsx` which renders the *real* (unmocked) `KanbanBoard` and asserts
  `getAllByRole("heading", { level: 1 })` has length 1.
- The skip link (`Skip to main content` → `#main-content`) is still the first element inside
  KanbanBoard's returned fragment, and `<main id="main-content">` remains the sole `main`
  landmark — asserted in the same integration test.
- `/board` (unscoped route) is untouched aside from inheriting the new optional props with
  their defaults, so its existing default heading ("Kanban Board") and behavior are preserved.

## Concern 2 — Project chrome light-mode only

**Fix:** Moving the chrome into `headerActions` mostly solved this (it now lives inside
KanbanBoard's theme-aware container), but `ProjectSelector` and `ImportFromJiraButton`
themselves still hardcoded `ponder-light-*` tokens. Both now call `useTheme()` (the same hook
`KanbanBoard`/`TopNav` use) and switch to `ponder-dark-*` tokens for backgrounds, borders, and
text — toggle button, dropdown menu, "No projects yet" text, current-project highlight,
"+ New Project" link, and the Import button's background/error/success text. Focus-ring color
(`focus:ring-ponder-light-purple`) was deliberately left unconditional, matching the existing
convention in `TopNav.tsx` (it also keeps a single light-purple focus ring regardless of theme).

**Confirmed:** Added dark-mode tests to `ProjectSelector.test.tsx` (toggle bg, dropdown
highlight) and a new `ImportFromJiraButton.test.tsx` (button bg in light vs. dark). All pass.

One additional gap was found during review: the project board page's not-found fallback (shown
when `projectId` doesn't resolve to a project) was still a hardcoded-light inline block in the
server component, so it wasn't covered by the fix above and would render a light box in dark
mode. Since server components can't read `useTheme()` directly, this was extracted into a new
tiny client component, `src/components/ProjectNotFound.tsx`, which reads `useTheme()` and
switches `bg-ponder-dark-bg`/`text-ponder-dark-text-muted` the same way KanbanBoard does. The
page now returns `<ProjectNotFound />` instead of an inline `<main>`. New
`ProjectNotFound.test.tsx` covers the not-found message plus light/dark styling. This closes the
one remaining light-mode-only surface on the page.

## Full Suite / tsc

- `npx dotenv -e .env.test -- vitest run --no-file-parallelism`: **239/239 passing** (28 test
  files), up from the 222 baseline (+17 net new tests across
  `page.integration.test.tsx`, `KanbanBoard.test.tsx`, `ProjectSelector.test.tsx`,
  `ImportFromJiraButton.test.tsx`, and `ProjectNotFound.test.tsx`).
- `npx tsc --noEmit`: clean, no errors.

## Acceptance Criteria

1. Exactly one `<h1>` on `/projects/[projectId]/board` — confirmed via integration test.
2. Skip link present and first in tab order within `main` — confirmed (unchanged skip-link
   markup, now unambiguously first since page-level chrome no longer precedes it).
3. `ProjectSelector` + Import-from-JIRA (JIRA projects only) still present — confirmed for both
   JIRA and STANDALONE projects in the integration test.
4. Page renders correctly in light AND dark mode — confirmed via unit tests on
   `ProjectSelector`, `ImportFromJiraButton`, and `ProjectNotFound` (the not-found fallback);
   `KanbanBoard`'s own dark-mode tests (pre-existing) still pass.
5. All KanbanBoard features intact (keyboard nav, edit/delete, onboarding, empty/loading/error,
   ARIA landmarks) — the full pre-existing `KanbanBoard.test.tsx` suite (35 tests, all passing)
   covers this; no test was removed, only two heading queries were made more precise (see
   below).

## Notable Finding: pre-existing test looseness (fixed, not a regression risk)

Restructuring `KanbanBoard` so the `<h1>` renders unconditionally (rather than only once
loading finishes) exposed that three specs used an unqualified
`getByRole("heading", { name: /Kanban Board/i })` query. The onboarding tooltip's own heading
text is "Welcome to Kanban Board", which also matches that regex. Previously this "worked" only
because the `<h1>` didn't exist yet at the moment `waitFor` first found a single match (the
tooltip's heading), or because the render window meant they never coexisted long enough to
matter. With the `<h1>` now always mounted, both headings coexist and the unqualified query
became ambiguous (`Found multiple elements with the role "heading"`). Fixed by adding
`level: 1` to disambiguate in `src/components/KanbanBoard.test.tsx` (2 spots) and
`src/app/board/page.test.tsx` (1 spot). This is a corrected latent test-quality issue, not new
behavior — the underlying component always intended the h1 to be the "Kanban Board" heading.

## Files Changed

- `src/components/KanbanBoard.tsx` — `title`/`headerActions` props; heading moved above the
  loading/error/loaded switch.
- `src/components/ProjectSelector.tsx` — dark-mode theming via `useTheme()`.
- `src/components/ImportFromJiraButton.tsx` — dark-mode theming via `useTheme()`.
- `src/app/projects/[projectId]/board/page.tsx` — delegates all chrome into `KanbanBoard`.
- `src/app/projects/[projectId]/board/page.test.tsx` — updated `KanbanBoard` mock stub to
  render `title`/`headerActions` so existing assertions still hold.
- `src/app/projects/[projectId]/board/page.integration.test.tsx` — new, real-KanbanBoard DOM
  assertions (single h1, selector, conditional import button, skip link/main landmark).
- `src/components/KanbanBoard.test.tsx` — new title/headerActions tests; two heading queries
  disambiguated with `level: 1`.
- `src/app/board/page.test.tsx` — one heading query disambiguated with `level: 1`.
- `src/components/ProjectSelector.test.tsx` — new dark-mode tests.
- `src/components/ImportFromJiraButton.test.tsx` — new file (didn't previously exist):
  basic behavior + dark-mode tests.
- `src/components/ProjectNotFound.tsx` — new file: theme-aware not-found fallback, extracted
  from the page's inline (light-only) block.
- `src/components/ProjectNotFound.test.tsx` — new file: message + light/dark styling tests.

## Remaining Concerns

None blocking. Carried-forward, pre-existing item (not introduced by this task, already noted
by Task 4): the project-wide JIRA JQL sync has no pagination and silently truncates at ~50
issues for large projects — flagged in the progress log as a follow-up task, out of scope here
per the "do not modify sync lib" constraint.
