# Task 6: Optimize Bundle Size to <500 KB Gzipped

## Status
DONE

## Note on this file
A prior/parallel pass at this task left a shallower report at this same path (a "quick audit"
that never ran `npm run build`, claimed `react-beautiful-dnd` was already absent from
`package.json`, and reported "139 passed, 6 failed" tests). That report's numbers don't match the
actual repo state or a clean test run and are superseded by this one, which reflects real
`npm run build` output, real `npm install` package removal, and a serial (non-flaky) test run.

## Commits
- (pending — see below)

## Bundle Size: Honest Baseline

**The spec's "1.87 MB" figure could not be reproduced or verified.** `npm run build` did not
complete at all on `main` at the start of this task — it failed during static generation with:

```
Error: <Html> should not be imported outside of pages/_document.
Error occurred prerendering page "/404".
```

This is a pre-existing Next.js App Router issue (no `not-found.tsx` was defined, and Next's
implicit 404-page generation hit a known bug against this Next 15.5.19 setup). It reproduced on a
clean `.next` before any dependency or config was touched, so it is not something this task
introduced — but it means the "1.87 MB" number in the spec is stale and unverifiable. It almost
certainly predates Tasks 1-2, which removed `react-beautiful-dnd` usage from `WorkUnitCard`;
`grep` confirmed zero imports of `react-beautiful-dnd`/`Draggable`/`DragDropContext`/`Droppable`
anywhere in `src/` before any change was made here.

**Flagging prominently, not as a footnote:** this build breakage is a pipeline hole that Tasks 7
and 9 (verify states / final verification) will also hit unless they run on top of this task's
fix. `npm test` never caught it because vitest doesn't invoke `next build`.

**Fix applied (out of this task's named file list, called out explicitly):** added
`src/app/not-found.tsx` (styled to match the existing Tailwind design system, with a link back to
`/`). This is the standard Next.js remedy for this class of prerender error and is required
before any bundle size number can be measured at all. No dependency or config change fixed it —
only defining an explicit not-found page did.

## Bundle Size: Before/After This Task's Changes

Once the build was unblocked, gzip size was measured across every JS chunk in
`.next/static/chunks` (there is no single `main-*.js` in the App Router — chunks are split per
route plus shared chunks — so gzip was summed across all of them, which is conservative/
over-counting since no single page download includes every chunk):

| State | Total gzip JS |
|---|---|
| Before removing `react-beautiful-dnd` / `@types/react-beautiful-dnd` | 227.8 KB |
| After removing them + `next.config.js` compression + dead-import cleanup | 225.7 KB |

**The dependency removal moved almost nothing** (227.8 KB → 225.7 KB, ~2 KB) because
`react-beautiful-dnd` was never imported anywhere in `src/` — Tasks 1-2 had already removed all
usage, so webpack's module graph never pulled it into the client bundle in the first place
(confirmed by grepping the compiled `.next/static/chunks/**` output for `beautiful-dnd` /
`Draggable` / `DragDropContext` both before and after removal — clean both times). Removing the
`package.json` entries is correct hygiene (`npm install` dropped 15 packages from `node_modules`,
~2 MB) but was not what was inflating any client bundle.

Both numbers are **well under the 500 KB target** (225.7 KB = 45% of budget). The largest route
(`/board`) is 106 KB First Load JS per Next's own reporting; shared framework chunks (React +
Next runtime) account for ~102 KB of that.

## Changes Made

1. **`next.config.js`** — added `compress: true` (explicit gzip for server HTTP responses). Did
   **not** add `swcMinify: true` — Next.js 15.5.19 rejects it as an unrecognized config key (SWC
   minification is on by default and no longer configurable). Did not add
   `@next/bundle-analyzer` since it isn't an existing dependency and wasn't needed to hit the
   target — adding a new devDependency for a one-time measurement wasn't justified.
2. **`package.json`** — removed `react-beautiful-dnd` and `@types/react-beautiful-dnd` (confirmed
   zero imports anywhere in `src/` via grep before removal, and confirmed zero references in
   compiled `.next/static/chunks/**` output after removal). `npm install` dropped 15 packages.
   All other dependencies (`cuid`, `pg`, `@prisma/*`) were confirmed in active use (server-side
   only — `src/lib/jira/client.ts`, `src/lib/prisma.ts` — so they never affected client bundle
   size regardless of usage).
3. **`src/lib/sync.ts`** — removed one genuinely-unused type import (`StoryDTO`), found via a
   manual unused-import sweep across `src/`. Server-side file, no client bundle impact, but dead
   code.
4. **`src/app/not-found.tsx`** (new, not in the original file list) — required to get `npm run
   build` to complete at all; see above.
5. **`src/app/board/page.tsx`** — no change needed. Confirmed no `Draggable`/`DragDropContext`
   imports present (Tasks 1-2 already removed dnd usage from `WorkUnitCard`).

## Tests
- `npm test -- --run --no-file-parallelism`: **145/145 passing**, all 15 test files — matches
  Task 5's documented baseline exactly.
- `npx tsc --noEmit`: clean, no type errors.
- `npm run build`: succeeds (was previously failing on `main` — see above).

## Dependencies Removed
- `react-beautiful-dnd` (^13.1.1) — zero imports in `src/`, confirmed absent from compiled output
  before removal too (never actually bundled).
- `@types/react-beautiful-dnd` (^13.1.8) — types-only, same reasoning.

No other dependencies flagged as risky-to-remove; nothing else in `package.json` looked unused.

## Concerns
1. **Spec's "1.87 MB" baseline is unverifiable** — the build didn't run at all on `main` before
   this task. Treat any bundle-size number predating this task's `not-found.tsx` fix as
   unreliable; use 225.7 KB (or 227.8 KB pre-cleanup) as the trustworthy baseline going forward.
2. **`src/app/not-found.tsx` is a new file outside this task's named scope.** Flagging here so
   Tasks 7/9 diffs don't show it as an unexplained addition — it's foundational (build-blocking
   fix), already landed, and should not be re-added or reverted.
3. Same pre-existing test flake noted in Task 5's report (parallel Postgres-backed test files
   racing on shared DB state) applies here too — not reproduced in this report since tests were
   run serially (`--no-file-parallelism`), consistent with Task 5's documented workaround. A
   competing report at this same path (pre-existing, now superseded) hit that exact flake
   ("139 passed, 6 failed") by running tests in parallel — further evidence it's a test-runner
   race, not a Task 6 regression.
4. This task's report file collided with a parallel/duplicate pass at the same task (see "Note on
   this file" above). Pipeline owner may want to dedupe the dispatch so Task 6 doesn't run twice.
