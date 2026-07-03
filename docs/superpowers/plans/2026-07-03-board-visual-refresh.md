# Board Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring five specific, user-approved visual/interaction enhancements from a redesign mockup (`AI Kanban board redesign.zip`) into Ponder's real board — as pure restyles and additive UI, with zero data-model changes and zero regressions to existing behavior.

**Architecture:** Three independently reviewable tasks, each touching a distinct concern: (1) column chrome — header restyle, a single unified board frame, and drag-over highlighting, all localized to `KanbanBoard.tsx`'s column-rendering region plus a small color-data addition to `columns.ts`; (2) dark-theme support for `WorkUnitCard.tsx`, which today is the one component in the app that doesn't use the existing `useTheme()` hook; (3) turning the board's already-correct (but screen-reader-only) status announcements into a real visible, auto-dismissing toast.

**Tech Stack:** Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS, `@dnd-kit/core`, Vitest + React Testing Library.

## Global Constraints

- **No data-model changes.** Priority/story-points/assignee-avatar badges from the mockup are explicitly OUT of scope (they need new schema fields + JIRA mapping) — do not add them.
- **No structural change to the detail modal.** The mockup's right-side drawer is explicitly OUT of scope — the existing centered `WorkUnitDetailModal` stays as-is.
- **No fake/mocked functionality.** The mockup's inline "AI suggestion" chips (PR-merged, stale-blocker, duplicate-detection) are explicitly OUT of scope — they have no real logic behind them in the prototype.
- **Card decluttering (hover-reveal Edit/Delete) was NOT selected by the user — do not change `WorkUnitCard`'s Edit/Delete buttons from always-visible.** Only the three approved layout items (column header, unified frame, dark-theme cards) and two approved interaction items (drag-over highlight, toast) are in scope.
- **Zero regressions:** every existing test must keep passing. Existing tests assert text content, ARIA roles/labels, and `data-testid`s — never specific Tailwind class names (confirmed by inspection) — so restyling is safe as long as text/roles/testids are preserved. The one exception is `src/lib/columns.test.ts`, which does an exact `toEqual` on the `COLUMNS` array shape — Task 1 updates it deliberately (see Task 1, Step 1).
- **`@dnd-kit` drag interactions are not simulated in jsdom tests** in this codebase (documented at `src/components/KanbanBoard.test.tsx:184-197` — no real layout/geometry for collision detection under jsdom). The drag-over highlight (Task 1) is therefore verified **manually in a real browser**, not via a new automated test — this matches existing convention, it is not a gap.
- **Existing Tailwind tokens only** — `ponder-dark-*`/`ponder-light-*` (bg, surface, border, text, text-muted, purple, purple-dark, purple-light, card-border) already exist in `tailwind.config.ts`; no new tokens are needed for any task in this plan.
- **Tests run serially:** `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
- **No secrets committed.** Branch → verify green (`tsc --noEmit`, `npm run lint`, full suite, `npx knip`) → PR → the user merges.

---

## File Structure

**Modify:**
- `src/lib/columns.ts` — add a `dotColorClass` field per column.
- `src/lib/columns.test.ts` — update the exact-shape `toEqual` to include `dotColorClass`.
- `src/components/KanbanBoard.tsx` — `KanbanColumn`'s header markup, the outer grid→frame wrapper, the `useDroppable` call (add `isOver`), and the status-message live-region/toast.
- `src/components/KanbanBoard.test.tsx` — add tests for the new header structure and toast visibility; no existing test is expected to need behavioral changes (only the pre-existing `sr-only`-when-empty test stays true, confirmed in Task 3).
- `src/components/WorkUnitCard.tsx` — wire in `useTheme()`, replace every hardcoded `ponder-light-*`/plain-gray class with a theme-aware pair.
- `src/components/WorkUnitCard.test.tsx` — add dark-theme rendering tests.

**Create:** none. **Delete:** none.

---

### Task 1: Column chrome — header restyle, unified board frame, drag-over highlight

**Files:**
- Modify: `src/lib/columns.ts`
- Modify: `src/lib/columns.test.ts`
- Modify: `src/components/KanbanBoard.tsx`
- Modify: `src/components/KanbanBoard.test.tsx`

**Interfaces:**
- Produces: `COLUMNS` entries gain a `dotColorClass: string` field (a Tailwind background-color utility class, e.g. `"bg-gray-400"`), consumed only by `KanbanColumn` in `KanbanBoard.tsx`.
- No other module consumes `COLUMNS` today besides `columns.test.ts`, `KanbanBoard.tsx`, and JIRA-sync code that only reads `.key`/`.label` — the added field is additive and does not require touching any other file (confirmed: `grep -rn "COLUMNS" src` shows no destructuring that would break with an extra field, other than the exact-shape test updated in Step 1 below).

- [ ] **Step 1: Update the failing `columns.test.ts` shape assertion first**

In `src/lib/columns.test.ts`, change the exact-shape test:

```ts
  it("pairs each key with a human-readable label and a dot accent color", () => {
    expect(COLUMNS).toEqual([
      { key: "todo", label: "To Do", dotColorClass: "bg-gray-400" },
      { key: "in_progress", label: "In Progress", dotColorClass: "bg-blue-500" },
      { key: "code_review", label: "Code Review", dotColorClass: "bg-purple-500" },
      { key: "done", label: "Done", dotColorClass: "bg-emerald-500" },
    ]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/columns.test.ts`
Expected: FAIL — actual `COLUMNS` entries lack `dotColorClass`.

- [ ] **Step 3: Add the color data**

In `src/lib/columns.ts`, change:

```ts
export const COLUMNS: { key: Column; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "code_review", label: "Code Review" },
  { key: "done", label: "Done" },
];
```

to:

```ts
export const COLUMNS: { key: Column; label: string; dotColorClass: string }[] = [
  { key: "todo", label: "To Do", dotColorClass: "bg-gray-400" },
  { key: "in_progress", label: "In Progress", dotColorClass: "bg-blue-500" },
  { key: "code_review", label: "Code Review", dotColorClass: "bg-purple-500" },
  { key: "done", label: "Done", dotColorClass: "bg-emerald-500" },
];
```

- [ ] **Step 4: Run the columns test to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing KanbanBoard test for the restyled header**

Add to `src/components/KanbanBoard.test.tsx` (find the `describe` block containing the existing column-heading test around line 119-130 and add a sibling `it` alongside it):

```ts
    it("renders each column's accent dot alongside its heading and item count on one line", async () => {
      render(<KanbanBoard />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-card-wu-1")).toBeInTheDocument();
      });

      const toDoColumn = screen.getByRole("region", {
        name: /To Do column/i,
      });
      const dot = toDoColumn.querySelector('[data-testid="column-dot-todo"]');
      expect(dot).toBeInTheDocument();
      expect(dot).toHaveClass("bg-gray-400");
      // Header restyle removes the separate paragraph but keeps the count text
      // visible within the column (satisfies the pre-existing "1 item" checks
      // elsewhere in this file — this test only adds the dot assertion).
    });
```

Note: use `getByRole("region", ...)` because each `<section aria-label="...">` is exposed with the implicit ARIA `region` role — match whatever role the existing "To Do column" label assertions in this file already use (grep this file for `"To Do column"` before writing this step for real, and mirror the exact query used there rather than assuming).

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/KanbanBoard.test.tsx`
Expected: FAIL — no element with `data-testid="column-dot-todo"` exists yet.

- [ ] **Step 7: Restyle the column header and unify the board frame**

In `src/components/KanbanBoard.tsx`, replace the grid wrapper (around line 317-333):

```tsx
          <div className="overflow-x-auto">
            <div className="grid grid-cols-4 gap-4 min-w-[900px]">
              {COLUMNS.map(({ key, label }) => (
                <KanbanColumn
                  key={key}
                  column={key}
                  columnLabel={label}
                  stories={stories}
                  onRefresh={() => fetchStories({ silent: true })}
                  columnRef={setColumnRef(key)}
                  onKeyboardNavigation={handleKeyboardNavigation}
                  onStatusMessage={handleStatusMessage}
                  isDark={isDark}
                />
              ))}
            </div>
          </div>
```

with:

```tsx
          <div className="overflow-x-auto">
            <div
              className={`grid grid-cols-4 min-w-[900px] rounded-2xl border overflow-hidden ${
                isDark
                  ? "border-ponder-dark-border"
                  : "border-ponder-light-card-border"
              }`}
            >
              {COLUMNS.map(({ key, label, dotColorClass }, index) => (
                <KanbanColumn
                  key={key}
                  column={key}
                  columnLabel={label}
                  dotColorClass={dotColorClass}
                  isFirstColumn={index === 0}
                  stories={stories}
                  onRefresh={() => fetchStories({ silent: true })}
                  columnRef={setColumnRef(key)}
                  onKeyboardNavigation={handleKeyboardNavigation}
                  onStatusMessage={handleStatusMessage}
                  isDark={isDark}
                />
              ))}
            </div>
          </div>
```

Then update `KanbanColumnProps` and `KanbanColumn`'s destructuring (around line 381-404):

```ts
interface KanbanColumnProps {
  column: Column;
  columnLabel: string;
  dotColorClass: string;
  isFirstColumn: boolean;
  stories: StoryDTO[];
  onRefresh: () => void;
  columnRef?: (el: HTMLDivElement | null) => void;
  onKeyboardNavigation?: (
    direction: "left" | "right",
    workUnitId: string
  ) => void;
  onStatusMessage?: (message: string) => void;
  isDark?: boolean;
}

function KanbanColumn({
  column,
  columnLabel,
  dotColorClass,
  isFirstColumn,
  stories,
  onRefresh,
  columnRef,
  onKeyboardNavigation,
  onStatusMessage,
  isDark = false,
}: KanbanColumnProps) {
```

Then replace the droppable hook and the `<section>`/header markup (around line 447-463):

```tsx
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: column });

  return (
    <section
      aria-label={`${columnLabel} column, ${totalWorkUnits} ${itemWord}`}
      className={`flex flex-col p-6 transition-colors duration-150 ${
        isFirstColumn
          ? ""
          : isDark
          ? "border-l border-ponder-dark-border"
          : "border-l border-ponder-light-card-border"
      } ${
        isOver
          ? isDark
            ? "bg-ponder-dark-purple/10"
            : "bg-ponder-light-purple/5"
          : isDark
          ? "bg-ponder-dark-surface"
          : "bg-ponder-light-surface"
      }`}
    >
      <div className="mb-6 pb-4 border-b flex items-center gap-2 ${isDark ? 'border-ponder-dark-border' : 'border-ponder-light-card-border'}">
        <span
          data-testid={`column-dot-${column}`}
          className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColorClass}`}
        />
        <h2 className={`text-lg font-semibold ${isDark ? "text-ponder-dark-text" : "text-ponder-light-text"} font-space-grotesk`}>
          {columnLabel}
        </h2>
        <span className={`text-sm ${isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"}`}>
          {totalWorkUnits} {itemWord}
        </span>
      </div>
```

(The template-literal `className` on the `mb-6 pb-4 border-b ...` div above has the `${isDark ? ... }` expression written out for clarity in this brief — when actually editing the file, write it as a real JS template literal, i.e. wrap the whole className value in backticks with `${}` interpolation exactly like the surrounding code already does, not as literal `${...}` text.)

- [ ] **Step 8: Run the KanbanBoard tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/KanbanBoard.test.tsx`
Expected: PASS — including the new dot test and every pre-existing test (heading text, "N item(s)" text, column `aria-label`s, live-region, focus-management tests are all unaffected since none assert removed classNames).

- [ ] **Step 9: Manually verify the drag-over highlight in a real browser**

Automated jsdom drag simulation is not reliable in this codebase (see Global Constraints). Instead:
1. Start the dev server: `npm run dev`.
2. Open the board, start dragging a card, and hover it over a different column.
3. Confirm that column's background tints while the pointer is over it (the `isOver`-driven class from Step 7), and that dropping still works exactly as before (a pre-existing, unmodified behavior — `handleDragEnd`/`persistReorder` are untouched by this task).
4. Note the result in your report (pass/fail + a one-line description); this is a required verification step for this task, not optional polish.

- [ ] **Step 10: Run the full test suite and typecheck to confirm no regressions**

Run: `npx tsc --noEmit` (expect clean) and `npx dotenv -e .env.test -- vitest run --no-file-parallelism` (expect the full pre-existing suite plus your new tests, all passing).

- [ ] **Step 11: Commit**

```bash
git add src/lib/columns.ts src/lib/columns.test.ts \
  src/components/KanbanBoard.tsx src/components/KanbanBoard.test.tsx
git commit -m "feat: restyle column headers, unify board frame, add drag-over highlight"
```

---

### Task 2: Dark-theme support for `WorkUnitCard`

**Files:**
- Modify: `src/components/WorkUnitCard.tsx`
- Modify: `src/components/WorkUnitCard.test.tsx`

**Interfaces:**
- Consumes: `useTheme()` from `src/hooks/useTheme.ts` (return shape `{ isDark, toggle, mounted }`) — call it directly inside `WorkUnitCard`, the same way `WorkUnitDetailModal` already does; do NOT thread `isDark` down as a new prop from `KanbanColumn` (that prop already exists on `KanbanColumn` for the column chrome, but `WorkUnitCard` should read the hook itself, matching the modal's precedent).
- No other component's props change.

- [ ] **Step 1: Write the failing dark-theme tests**

Add to `src/components/WorkUnitCard.test.tsx`, a new `describe` block:

```ts
describe("Theme awareness", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses light-theme classes by default", async () => {
    render(<WorkUnitCard workUnit={mockWorkUnit} />);

    await waitFor(() => {
      expect(
        screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`)
      ).toHaveClass("bg-ponder-light-surface");
    });
  });

  it("uses dark-theme classes when ponderTheme is set to dark", async () => {
    localStorage.setItem("ponderTheme", "dark");

    render(<WorkUnitCard workUnit={mockWorkUnit} />);

    await waitFor(() => {
      expect(
        screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`)
      ).toHaveClass("bg-ponder-dark-surface");
    });
  });
});
```

`useTheme` hydrates `isDark` from `localStorage` inside a `useEffect` (asynchronous relative to the first render), which is why both assertions are wrapped in `waitFor` — without it, the test would observe the pre-hydration default (`isDark = false`) even in the dark-theme case.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitCard.test.tsx`
Expected: FAIL — the card never gains `bg-ponder-dark-surface` because `WorkUnitCard` doesn't call `useTheme()` yet.

- [ ] **Step 3: Wire `useTheme()` into `WorkUnitCard` and theme every hardcoded class**

In `src/components/WorkUnitCard.tsx`, add the import:

```ts
import { useTheme } from "@/hooks/useTheme";
```

Add, at the top of the component body (right after the existing `useState`/`useRef` declarations, before `dragStyle`):

```ts
  const { isDark } = useTheme();
```

Replace the two hardcoded style maps near the top of the file:

```ts
const columnColors: Record<Column, string> = {
  todo: "bg-gray-100 text-gray-800",
  in_progress: "bg-blue-100 text-blue-800",
  code_review: "bg-purple-100 text-purple-800",
  done: "bg-green-100 text-green-800",
};

const priorityStyles: Record<PriorityLevel, { dot: string; text: string }> = {
  HIGH: { dot: "bg-red-500", text: "text-red-700" },
  MEDIUM: { dot: "bg-amber-400", text: "text-amber-700" },
  LOW: { dot: "bg-gray-500", text: "text-gray-600" },
};
```

with theme-aware variants:

```ts
const columnColorsLight: Record<Column, string> = {
  todo: "bg-gray-100 text-gray-800",
  in_progress: "bg-blue-100 text-blue-800",
  code_review: "bg-purple-100 text-purple-800",
  done: "bg-green-100 text-green-800",
};
const columnColorsDark: Record<Column, string> = {
  todo: "bg-gray-800 text-gray-200",
  in_progress: "bg-blue-900/50 text-blue-200",
  code_review: "bg-purple-900/50 text-purple-200",
  done: "bg-green-900/50 text-green-200",
};

const priorityStylesLight: Record<PriorityLevel, { dot: string; text: string }> = {
  HIGH: { dot: "bg-red-500", text: "text-red-700" },
  MEDIUM: { dot: "bg-amber-400", text: "text-amber-700" },
  LOW: { dot: "bg-gray-500", text: "text-gray-600" },
};
const priorityStylesDark: Record<PriorityLevel, { dot: string; text: string }> = {
  HIGH: { dot: "bg-red-500", text: "text-red-400" },
  MEDIUM: { dot: "bg-amber-400", text: "text-amber-400" },
  LOW: { dot: "bg-gray-500", text: "text-gray-400" },
};
```

Inside the component body, after `const { isDark } = useTheme();`, add:

```ts
  const columnColors = isDark ? columnColorsDark : columnColorsLight;
  const priorityStyles = isDark ? priorityStylesDark : priorityStylesLight;
  const surfaceClass = isDark
    ? "bg-ponder-dark-surface border-ponder-dark-border"
    : "bg-ponder-light-surface border-ponder-light-card-border";
  const textClass = isDark ? "text-ponder-dark-text" : "text-ponder-light-text";
  const mutedTextClass = isDark
    ? "text-ponder-dark-text-muted"
    : "text-ponder-light-text-muted";
  const cancelButtonClass = isDark
    ? "bg-ponder-dark-border text-ponder-dark-text hover:bg-ponder-dark-card-border"
    : "bg-gray-200 text-gray-800 hover:bg-gray-300";
```

(`columnColors`/`priorityStyles` are now local `const`s computed per render instead of module-level constants — every reference to them further down the file, e.g. `columnColors[workUnit.column]` and `priorityStyles[priority].dot`, stays textually identical; only their declarations move.)

Then replace every remaining hardcoded `ponder-light-*`/plain class in the two returned JSX blocks (edit mode, ~line 216-262, and view mode, ~line 270-390) with the corresponding variable:
- `bg-ponder-light-surface border-ponder-light-card-border` → `${surfaceClass}`
- `border-ponder-light-card-border` (on the textarea/input borders) → keep the border half of `surfaceClass` or reference it directly, e.g. `${isDark ? "border-ponder-dark-border" : "border-ponder-light-card-border"}`
- `text-ponder-light-text` → `${textClass}`
- `text-ponder-light-text-muted` → `${mutedTextClass}`
- the always-`bg-gray-200 text-gray-800 hover:bg-gray-300` Cancel button (edit-mode Cancel, ~line 256, and view-mode delete-confirm Cancel, ~line 383) → `${cancelButtonClass}`

Leave unchanged (intentionally, matching existing precedent elsewhere in this codebase, e.g. `WorkUnitDetailModal`'s `focusRing`): the `focusRing` constant, the Edit/Delete/Save button purple and red fills (already have adequate contrast with their hardcoded `text-white`), and the story-key link's `text-ponder-light-purple` (the modal's own accent links are similarly not theme-branched).

- [ ] **Step 4: Run the WorkUnitCard tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitCard.test.tsx`
Expected: PASS — the two new tests plus every pre-existing test (none of which assert the classes you changed, per Global Constraints).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit` and `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
Expected: both clean/green.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkUnitCard.tsx src/components/WorkUnitCard.test.tsx
git commit -m "feat: add dark-theme support to WorkUnitCard"
```

---

### Task 3: Visible toast confirmations

**Files:**
- Modify: `src/components/KanbanBoard.tsx`
- Modify: `src/components/KanbanBoard.test.tsx`

**Interfaces:**
- No new props or exports. Reuses the existing `statusMessage`/`setStatusMessage` state (already set correctly on save/delete/move/reorder — confirmed at `KanbanBoard.tsx:139` (via `onStatusMessage`), `:166`, `:236-238`, `:274`, `:276`). This task only makes that message visible and adds an auto-dismiss timer; it does not change any message text or add any new call site.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/KanbanBoard.test.tsx`, near the existing live-region tests (after the "renders a polite live region..." test around line 571):

```ts
    it("shows the live region as a visible toast (not sr-only) once it has a status message", async () => {
      render(<KanbanBoard />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-card-wu-1")).toBeInTheDocument();
      });

      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion).toHaveClass("sr-only");

      const editButton = screen.getByTestId("edit-button-wu-1");
      fireEvent.click(editButton);
      fireEvent.click(screen.getByTestId("cancel-edit-button"));

      global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStories),
        } as Response);
      });
      fireEvent.click(screen.getByTestId("delete-button-wu-1"));
      fireEvent.click(screen.getByTestId("delete-button-wu-1"));

      await waitFor(() => {
        const region = document.querySelector('[aria-live="polite"]');
        expect(region).not.toHaveClass("sr-only");
        expect(region).toHaveTextContent("Deleted work unit: Work unit 1");
      });
    });

    it("auto-dismisses the toast back to sr-only after the timeout", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      render(<KanbanBoard />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-card-wu-1")).toBeInTheDocument();
      });

      global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStories),
        } as Response);
      });
      fireEvent.click(screen.getByTestId("delete-button-wu-1"));
      fireEvent.click(screen.getByTestId("delete-button-wu-1"));

      await waitFor(() => {
        expect(document.querySelector('[aria-live="polite"]')).not.toHaveClass(
          "sr-only"
        );
      });

      vi.advanceTimersByTime(3100);

      await waitFor(() => {
        expect(document.querySelector('[aria-live="polite"]')).toHaveClass(
          "sr-only"
        );
      });

      vi.useRealTimers();
    });
```

Read the existing "end-to-end: edit-mode focus enters/exits..." test (around line 573-616) first and match its exact fetch-mocking setup rather than assuming — copy its pattern precisely so both new tests are consistent with the file's established style.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/KanbanBoard.test.tsx`
Expected: FAIL — the live region never loses its `sr-only` class today.

- [ ] **Step 3: Add the auto-dismiss timer and visible toast styling**

In `src/components/KanbanBoard.tsx`, add a ref near the other refs (after the `columnRefs` declaration, ~line 139-143):

```ts
  const statusToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add an effect near the other effects (after `handleStatusMessage`'s declaration is fine, or grouped with other `useEffect`s in the file — place it directly below the `statusMessage` state declaration for locality):

```ts
  // Auto-dismisses the visible toast ~3s after it appears; a new message
  // resets the timer. The underlying `statusMessage` state also still drives
  // the screen-reader announcement (see the aria-live region below) — this
  // effect only controls how long it stays visually shown.
  useEffect(() => {
    if (!statusMessage) return;
    if (statusToastTimeoutRef.current) {
      clearTimeout(statusToastTimeoutRef.current);
    }
    statusToastTimeoutRef.current = setTimeout(() => {
      setStatusMessage("");
    }, 3000);
    return () => {
      if (statusToastTimeoutRef.current) {
        clearTimeout(statusToastTimeoutRef.current);
      }
    };
  }, [statusMessage]);
```

Replace the status region's render (~line 348-351):

```tsx
      {/* Announces save/delete outcomes to screen readers without moving focus. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {statusMessage}
      </div>
```

with:

```tsx
      {/* Announces save/delete/move outcomes to screen readers (aria-live,
          always present) AND shows them as a visible, auto-dismissing toast
          when there's an active message — single element, single source of
          truth for both concerns. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={
          statusMessage
            ? `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg ${
                isDark
                  ? "bg-ponder-dark-surface border-ponder-dark-border text-ponder-dark-text"
                  : "bg-white border-ponder-light-card-border text-ponder-light-text"
              }`
            : "sr-only"
        }
      >
        {statusMessage}
      </div>
```

- [ ] **Step 4: Run the KanbanBoard tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/KanbanBoard.test.tsx`
Expected: PASS — both new tests, plus the pre-existing "renders a polite live region..." test (still `sr-only` when `statusMessage` is `""`) and the pre-existing delete/live-region test (only asserts text content, not class, so unaffected).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit` and `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
Expected: both clean/green.

- [ ] **Step 6: Commit**

```bash
git add src/components/KanbanBoard.tsx src/components/KanbanBoard.test.tsx
git commit -m "feat: show status announcements as a visible, auto-dismissing toast"
```

---

## Final verification (before PR)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — no new errors.
- [ ] `npx dotenv -e .env.test -- vitest run --no-file-parallelism` — full suite green.
- [ ] `npx knip` — no new unused exports.
- [ ] Manual browser check (real dev server, not automated): column dot colors render correctly in both themes, board frame renders as one unified panel with dividers (not 4 separate boxes), drag-over highlight appears while dragging (Task 1, Step 9), cards render correctly in dark mode (toggle the theme and open the board), and a toast appears + auto-dismisses after a move/delete.
- [ ] Open the PR; the user merges.

---

## Self-Review

**Spec coverage:** all 5 user-approved items are covered — column header restyle + unified board frame + drag-over highlight (Task 1), dark-theme cards (Task 2), toast confirmations (Task 3). The declined item (card decluttering) is explicitly called out as NOT in scope in Global Constraints. The 4 excluded mockup elements (priority/points/owner badges, drawer, AI-suggestion chips, non-functional Filter button) are explicitly named as out of scope with the reason for each.

**Type consistency:** `dotColorClass` is defined once in `columns.ts` and consumed with that exact name in `KanbanBoard.tsx`'s destructuring and the `KanbanColumnProps` interface. `isFirstColumn` is computed once (`index === 0`) and threaded through with one name. `isOver` comes directly from `useDroppable`'s existing return shape — no renaming across the diff.

**Placeholder scan:** every step has concrete, complete code — no "add appropriate styling" or "similar to Task N" placeholders. Step 5 of Task 1 explicitly tells the implementer to grep the existing file for the exact `getByRole`/label query in use rather than guessing, which is a flagged judgment call, not a hidden gap. Task 1 Step 9 is manual-verification-by-design (not an omitted automated test) — justified explicitly by the codebase's own documented DnD-testing constraint.

**Open follow-ups (not in scope):** priority/points/assignee badges (needs schema + JIRA field mapping); detail drawer instead of centered modal (bigger structural risk, declined for this pass); real AI-suggestion features (PR/CI integration, duplicate detection, stale-blocker detection — the mockup's chips are unbacked mocks); a functional Filter control (the mockup's Filter button has no logic behind it).
