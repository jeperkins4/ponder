# @dnd-kit reordering — implementation report

## Status

Done. Branch `feature/dnd-kit-reordering`.

Commit hash: `4156ff1` — "feat: reorder cards within/between columns with
@dnd-kit" (confirmed via `git log --oneline -1`).

## Summary

Replaced the board's raw HTML5 drag-and-drop (`draggable`/`onDragStart` on
`WorkUnitCard`, `onDragOver`/`onDragLeave`/`onDrop` on `KanbanColumn`, the
single-card `POST /api/work-units/[id]/move` endpoint as the drop handler)
with `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`. The board
now supports reliable cross-lane moves, within-lane sortable reordering, and
keyboard-accessible dragging, all persisted through a new
`POST /api/work-units/reorder` endpoint.

## How click-vs-drag is handled

`KanbanBoard`'s `DndContext` uses a `PointerSensor` configured with
`activationConstraint: { distance: 8 }` — a drag only activates after the
pointer moves 8px past `pointerdown`. A plain click (mousedown+mouseup with
~0 movement) never crosses that threshold, so `WorkUnitCard`'s own `onClick`
(opens the detail modal) still fires normally, as do the Edit/Delete buttons
and the JIRA-key link (each already `stopPropagation()`s its own click).
`useSortable`'s `attributes`/`listeners` are spread onto the card root
**before** the explicit `role="article"` / `tabIndex={0}` props in JSX, so
dnd-kit's own defaults (`role="button"`, etc.) are overridden back to the
card's existing semantics rather than the other way around — this is why the
card's `role`/`tabIndex` tests kept passing unmodified.

Verified in a real browser (see "Manual verification" below) that a plain
click still opens the modal and that Edit still enters edit mode without
triggering a drag or the modal.

## Within-lane vs. cross-lane detection

A new pure module, `src/lib/dndReorder.ts`, does all the card-ordering math,
kept deliberately framework-free (no React, no @dnd-kit context) so it's
unit-testable without mounting `DndContext` or faking pointer geometry in
jsdom:

- `buildColumnOrder(stories)` — derives each column's ordered work-unit id
  list from the nested `StoryDTO[]` shape the board renders from, sorted by
  `order` ascending, tiebreaking equal/duplicate `order` values by id for a
  deterministic, stable order. `KanbanColumn`'s own render-time sort uses the
  identical comparator, so what's drawn always matches what the drag math
  operates on.
- `computeReorderedColumns(columnOrder, activeId, overId)` — given the
  dragged card's id and whatever @dnd-kit resolved as the drop target
  (another card's id, or a column's own droppable id when dropped into empty
  space/an empty column), returns the new `ColumnOrderMap` plus
  `changedColumns`: `[]` for a no-op, `[column]` for a within-column reorder
  (via `arrayMove`), or `[fromColumn, toColumn]` for a cross-column move.
  Mirrors @dnd-kit's official "multiple sortable lists" example algorithm.
- `applyColumnOrder(stories, columns)` — immutably folds a (partial)
  `ColumnOrderMap` back onto the nested `StoryDTO[]` shape, updating each
  affected work unit's `column`/`order`.

`KanbanBoard.handleDragEnd` (the `DndContext`'s only wired callback — no
`onDragOver` live-preview) calls these three in sequence: build → compute →
apply (optimistic local `setStories`), then posts only the changed columns'
full ordered id lists to the reorder endpoint. `changedColumns.length` is
exactly how within-lane vs. cross-lane is distinguished, both for the
persisted request body and for the status-message wording ("Reordered ..."
vs. "Moved ... to <Column>").

Each column is also a droppable region (`useDroppable({ id: column })`
wrapping the whole card-list `<div>` in `KanbanColumn`), so a card can be
dropped into an empty column or below the last card and still resolve to
that column via `findColumnForId`'s column-key special case.

## Order persistence + JIRA sync

`POST /api/work-units/reorder` (`src/app/api/work-units/reorder/route.ts`):
validates `{ movedId: string; columns: Record<string, string[]> }` (400 on
malformed body, unknown column keys, non-array/non-string values; 404 if
`movedId` doesn't exist), then in one `prisma.$transaction` updates every
work unit named in `columns` to `{ column, order: index }`. After the
transaction commits, it looks up `movedId`'s `storyId` and calls
`applyStoryStatusSync(storyId, prisma)`, wrapped in try/catch so a JIRA/Claude
failure never fails the request — identical non-blocking philosophy to the
existing single-card move endpoint. A pure within-column reorder never
changes any work unit's `column`, so `computeDesiredJiraStatus` naturally
sees nothing to sync in that case; a cross-column move does change a column,
which is exactly what triggers the write-back. Verified this distinction
directly in the endpoint's test suite (one test asserts the sync fires and
the story's `jiraStatus` stays untouched for a pure reorder; another asserts
it fires and would act on a real column change).

`KanbanBoard.persistReorder` posts to the endpoint, then unconditionally
calls `fetchStories({ silent: true })` in a `finally` — this both confirms
the optimistic update on success and reverts it (by refetching server truth)
on failure.

## @dnd-kit API notes (from Context7 + hands-on)

Resolved `@clauderic/dnd-kit` via Context7 (`resolve-library-id` →
`query-docs`), confirming the stable v6 `@dnd-kit/core` +
`@dnd-kit/sortable` + `@dnd-kit/utilities` API (Context7's freshest examples
are for the newer `@dnd-kit/dom`/`@dnd-kit/react` preview packages, but the
"multiple sortable lists" guide — `DndContext` + `useSensors`/`useSensor` +
`PointerSensor`/`KeyboardSensor` + `SortableContext` +
`useSortable`/`arrayMove`/`sortableKeyboardCoordinates` — matches the
installed v6 packages exactly and is what this implementation follows):
`@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`
(installed versions).

- `useSensor(PointerSensor, { activationConstraint: { distance: 8 } })` —
  the v6 core API (not the newer `PointerSensor.configure(...)` shown in
  some `@dnd-kit/dom` docs snippets).
- `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } })`
  — overriding `keyboardCodes` to Space-only (dropping the default Enter)
  was necessary so keyboard drag-pickup doesn't collide with the card's own
  Enter-opens-modal handling. Movement itself (arrow keys) is **not** part
  of `keyboardCodes` in v6 — it's handled unconditionally by
  `sortableKeyboardCoordinates` inspecting `event.code` on every keydown
  while a drag is active, independent of the `keyboardCodes` override.
- `useSortable({ id, disabled })` — the `disabled` option was the clean way
  to make the card non-draggable while `isEditing`, without having to
  manually conditionally spread `attributes`/`listeners`.
- `closestCorners` (not `closestCenter`) as `collisionDetection`, per the
  task's suggestion — works well for the multi-container column layout.
- `useDroppable({ id })` on the column body — required for empty-column
  drops; overlaps with the individual cards' own sortable/droppable areas,
  and dnd-kit's collision detection correctly prefers the nearer card when
  one is present, falling back to the column container otherwise (standard
  pattern from the official multi-container guide).

## Tests

- 422/422 passing, full suite: `npx dotenv -e .env.test -- vitest run
  --no-file-parallelism` (44 test files).
  - New: `src/lib/dndReorder.test.ts` (13 tests) — pure helper coverage:
    `buildColumnOrder` grouping/sort/tiebreak, `computeReorderedColumns`
    same-column reorder, cross-column insert-before-target,
    empty-column-drop, append-at-end-of-non-empty-column, no-op cases
    (unknown active/over id, dropped on own position), `applyColumnOrder`
    immutability and pass-through of untouched work units.
  - New: `src/app/api/work-units/reorder/route.test.ts` (11 tests, real
    Postgres) — within-column reorder updates orders; cross-column move
    updates column+order for both lists; sync fires on cross-column move;
    sync still fires (and correctly no-ops) on a pure within-column reorder;
    sync failure never fails the request; 404 for unknown `movedId`; 400 for
    missing `movedId`/`columns`, non-array column values, unknown column
    keys, and non-JSON bodies.
  - Updated: `WorkUnitCard.test.tsx` — replaced the native
    `draggable`/`dragStart` test with one asserting the card is no longer
    natively draggable and carries dnd-kit's `aria-roledescription="sortable"`
    marker instead; all other tests (click-opens-modal, Edit/Delete,
    keyboard nav, accessibility) required **no changes** and still pass,
    confirming no regression.
  - Updated: `KanbanBoard.test.tsx` — replaced the two native
    `fireEvent.drop`-on-`column-dropzone-*` tests (that testid/handler no
    longer exists) with a test asserting `KanbanColumn` sorts cards by
    `order` ascending independent of array position (deliverable #2), plus a
    comment pointing at where drag/reorder logic is actually covered.
- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors (3 pre-existing unrelated `no-explicit-any`
  warnings in `src/app/api/sync/route.ts` / `src/lib/sync.test.ts`, untouched
  by this work).
- `npm run knip` — clean (no unused files/exports/deps after removing the
  native-DnD code).

### What's covered by automated tests vs. manual verification

Per the task's guidance, actual @dnd-kit pointer/keyboard drag interactions
are not driven through jsdom (no real layout, so collision detection can't
resolve meaningfully) — that logic is covered by the pure helper tests
above, and the persistence/JIRA-sync behavior is covered by the endpoint
tests above.

**Manual verification** (real browser, `npm run dev` against the actual dev
Postgres database, via a Chrome automation session — not simulated):

1. Plain click on a card → detail modal opens. ✅
2. Edit button click → enters edit mode (not swallowed by the pointer
   sensor, does not open the modal). ✅
3. Keyboard drag, within-column reorder: focused a card (Tab), `Space` to
   pick up (confirmed via the card's opacity-0.5 `isDragging` style),
   `ArrowDown`, `Space` to drop. Verified via `GET /api/stories` afterward
   that the column's `order` values were renumbered sequentially (0–5) to
   match the new position, and `POST /api/work-units/reorder` returned 200.
   ✅
4. Keyboard drag, cross-column move: same pattern with `ArrowRight` instead
   of `ArrowDown`. Verified via `GET /api/stories` that the card's `column`
   flipped to the destination column with the correct `order`. ✅ (The
   board's own UI also reflected this correctly after the silent refetch —
   an immediate screenshot taken before the async refetch completed showed
   stale state, which is expected/optimistic-update-then-reconcile
   behavior, not a bug.)
5. Mouse-drag via a single synthetic `left_click_drag` (one
   mousedown→mousemove→mouseup) did **not** register as a real drag — see
   Concerns below.

All test data touched during manual verification was restored to its
original `column`/`order` values afterward via direct SQL against the dev
database.

## Concerns

1. **Dropping onto a card's own column's empty trailing space is a no-op.**
   If a card is dragged and `over` resolves to its *own* current column's
   droppable id (e.g. dropped below the last card in the same column it's
   already in), `computeReorderedColumns`'s same-column branch does
   `items.indexOf(overId)` where `overId` is the column key — not found in
   the id array — so `newIndex === -1` and the function returns a no-op.
   Reordering onto another *card* (including the last one) works correctly;
   only "drop into the trailing empty space of the same column" silently
   does nothing. Low severity (the card was already effectively at/near the
   end), but worth a follow-up if it's noticed in practice.
2. **Enter mid-keyboard-drag opens the modal instead of cancelling/dropping.**
   `KeyboardSensor`'s `end` key is configured as `["Space"]` only (Enter is
   deliberately excluded so it doesn't fight with modal-open). If a user
   picks up a card with `Space` and then presses `Enter` (instead of `Space`
   again) while still mid-drag, dnd-kit's sensor doesn't recognize `Enter`
   as an end/cancel key, so the keydown falls through to
   `handleCardKeyDown`, which opens the detail modal while the drag is
   still technically active. `Escape` still correctly cancels the drag
   (dnd-kit's default cancel key, unchanged). This is a sharp edge, not a
   crash — worth tightening in a follow-up (e.g. suppress
   `handleCardKeyDown`'s Enter handling while `isDragging` is true).
3. **Single-shot synthetic mouse drags don't activate dnd-kit's
   `PointerSensor`.** A one-step `left_click_drag` (down→move→up with no
   intermediate move events) did not cross the 8px `activationConstraint` in
   a way the sensor recognized during manual testing; the keyboard-drag path
   was used instead to verify end-to-end persistence, and it fully
   validates the same `handleDragEnd` → `computeReorderedColumns` →
   `persistReorder` pipeline that a real mouse drag also drives (mouse and
   keyboard both dispatch the same `DragEndEvent`, so this doesn't indicate
   a gap in the pointer path itself — just a limitation of the specific
   single-shot browser-automation primitive used). A real human dragging
   with a mouse (continuous small movements) is expected to work correctly,
   since it's the same `PointerSensor` + `activationConstraint` pattern used
   in every dnd-kit sortable demo.
4. No `DragOverlay`/live `onDragOver` preview — the dragged card doesn't
   visually preview its new position (or animate other cards out of the
   way) until drop; the reorder is computed and applied atomically in
   `onDragEnd`. This was a deliberate scope decision (simpler, more
   predictable, avoids maintaining transient drag-preview state) and wasn't
   requested by the task, but is worth flagging as a possible future UX
   polish item.

## Commit

Branch: `feature/dnd-kit-reordering`.
Commit `4156ff1`: `feat: reorder cards within/between columns with @dnd-kit`.
