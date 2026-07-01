# Task 3 Report: Create project selection UI

**Status:** DONE

## Files created

- `src/components/ProjectSelector.tsx` — `'use client'` dropdown. Toggle button shows
  the current project's name (or "Select project"), `aria-label="Switch project"`,
  `aria-haspopup="true"`, `aria-expanded`. Opens a menu listing all projects as links to
  `/projects/[id]/board` (`aria-current="page"` marks the current one, with a
  visually-hidden "(current)" suffix), plus a trailing "+ New Project" link to
  `/projects/new`. Closes on outside click and on Escape. Uses
  `focus:ring-2 focus:ring-ponder-light-purple focus:outline-none` on every interactive
  element and Ponder tokens (`bg-ponder-light-surface`, `border-ponder-light-card-border`,
  `text-ponder-light-text[-muted]`, `bg-ponder-light-purple[-light/-dark]`) throughout.
  **Note:** an earlier draft used `role="listbox"`/`role="option"`/`aria-selected`, which
  a review caught as a WCAG 4.1.2 mismatch (this is a nav menu of links, not a true
  listbox with arrow-key selection) — corrected to plain links + `aria-current="page"`
  before finalizing.
- `src/components/ProjectSelector.test.tsx` — 11 tests: closed-by-default/opens on
  click, current-project label on the toggle, placeholder when no current project,
  per-project links with correct `href`s, current-project highlighting
  (`aria-current="page"`), New Project link, empty-project-list handling, Escape closes
  menu, and accessibility checks (button semantics, aria attributes, focus ring, menu
  labeling).
- `src/app/projects/page.tsx` — server component. Fetches
  `prisma.project.findMany({ include: { _count: { select: { stories, workUnits } } } })`
  directly, maps through the existing `projectToDTO` helper (from Task 2), and renders:
  "Projects" heading, a "New Project" button linking to `/projects/new`, and a responsive
  card grid. Each card links to `/projects/[id]/board`, shows the project name and either
  `JIRA Project: {key}` or `Standalone project`. Empty state renders "No projects yet.
  Create one to get started." instead of the grid. Ponder styling throughout
  (`bg-ponder-light-bg`, card surface/border/shadow tokens, focus rings).
- `src/app/projects/page.test.tsx` — 3 tests, mocking `@/lib/prisma` via `vi.mock`
  (per the task's guidance to prefer this over a `fetchProjects` helper that doesn't
  exist): renders heading + New Project button, empty state, and per-project cards
  (JIRA key vs. standalone label, correct `href`s) — invoking the async server component
  directly (`render(await ProjectsPage())`), which is a supported pattern for RSCs that
  are just async functions returning JSX.

## Tests

- Target command `npx dotenv -e .env.test -- npx vitest run src/app/projects/page.test.tsx
  src/components/ProjectSelector.test.tsx --no-file-parallelism`: **14/14 passing**
  (11 ProjectSelector + 3 ProjectsPage).
- Full suite, serial (`npx dotenv -e .env.test -- npx vitest run --no-file-parallelism`):
  **192/193 passing**. The one failure (`src/lib/jira/client.test.ts` >
  `fetchStoriesForProject` > "builds a JQL query scoped to the project key without an
  assignee filter") is **pre-existing and unrelated** — `git status` shows `src/lib/jira/
  client.ts` and `src/lib/jira/jql.ts` as modified-but-uncommitted, which is Task 4's
  parallel in-progress refactor of story sync (per the progress doc, Task 4 owns
  `sync.ts`/JIRA client changes and is running concurrently). I did not touch those files.
  All tests in files I created or could plausibly affect pass.
- `npx tsc --noEmit`: clean, no type errors.

## Concerns

- None specific to this task's scope. `npm run lint` (`next lint`) prompted an
  interactive one-time ESLint config migration (Next 15/ESLint 10 mismatch, unrelated to
  this change) rather than running non-interactively, so I relied on `tsc --noEmit` (clean)
  plus the existing test suite for verification instead.
- `/projects/new` and `/projects/[id]/board` do not exist yet (owned by Tasks 4/5/6 per
  the progress doc) — links to them are correct per the deliverable but will 404 until
  those tasks land. This is expected given the parallel task split.
- A JIRA-type project with a null `jiraProjectKey` (allowed by the Task 2 POST endpoint)
  would have rendered `JIRA Project: undefined`; fixed with a `?? "(no key set)"`
  fallback in `src/app/projects/page.tsx`.

## Commit

Committed as `feat: add project selection UI (list page + selector)`, staging only
`src/components/ProjectSelector.tsx`, `src/components/ProjectSelector.test.tsx`,
`src/app/projects/page.tsx`, `src/app/projects/page.test.tsx`, and this report — not
`multiproject-progress.md` (orchestrator-managed) and not Task 4's uncommitted
`src/lib/jira/client.ts`/`jql.ts` changes.
