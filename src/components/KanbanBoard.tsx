"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { StoryDTO, WorkUnitDTO, Column } from "@/lib/types";
import { COLUMNS } from "@/lib/columns";
import {
  buildColumnOrder,
  computeReorderedColumns,
  applyColumnOrder,
  ColumnOrderMap,
} from "@/lib/dndReorder";
import { WorkUnitCard } from "@/components/WorkUnitCard";
import { useTheme } from "@/hooks/useTheme";

type ColumnRefMap = Record<Column, HTMLDivElement | null>;

// Prefer the droppable the pointer is actually over (cursor-based), falling back
// to closest-corners only when the pointer isn't within any droppable. This
// makes dragging a card *back* to an earlier/shorter lane reliable: the target
// is chosen by where the cursor is, not by the dragged card's rectangle (which
// keeps overlapping the source column with closestCorners alone).
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

export interface KanbanBoardProps {
  /** Scopes the board to a single project's stories. */
  projectId: string;
  /** Heading text for the board's single `<h1>`. Defaults to "Kanban Board".
   * The project board page passes the project's name here instead of
   * rendering its own separate heading, so the page ends up with exactly one
   * `<h1>` (this one). */
  title?: string;
  /** Optional chrome (e.g. ProjectSelector, ImportFromJiraButton) rendered
   * alongside the heading, inside KanbanBoard's own theme-aware container.
   * Lets callers inject page-level actions without duplicating a heading or
   * landmark region. */
  headerActions?: React.ReactNode;
}

export function KanbanBoard({
  projectId,
  title = "Kanban Board",
  headerActions,
}: KanbanBoardProps) {
  const { isDark } = useTheme();
  const [stories, setStories] = useState<StoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

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

  const storiesUrl = `/api/stories?projectId=${projectId}`;

  const fetchStories = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        if (!opts?.silent) setLoading(true);
        setError(null);
        const response = await fetch(storiesUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch stories: ${response.statusText}`);
        }
        const data: StoryDTO[] = await response.json();
        setStories(data);
      } catch (err) {
        console.error("Error fetching stories:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [storiesUrl]
  );

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  // ImportFromJiraButton lives inside `headerActions`, a separate element
  // tree from this component's own state, so it has no direct handle on
  // `fetchStories`. It broadcasts this DOM event instead (mirroring the
  // THEME_EVENT pattern in useTheme.ts) once an import finishes; refetch
  // silently so newly created cards show up without a loading flash.
  useEffect(() => {
    const handleImportComplete = (event: Event) => {
      fetchStories({ silent: true });
      const detail = (event as CustomEvent).detail as
        | { storiesProcessed: number; storiesSkipped: number }
        | undefined;
      if (detail) {
        const imported = `${detail.storiesProcessed} imported`;
        setStatusMessage(
          detail.storiesSkipped > 0
            ? `${imported}, ${detail.storiesSkipped} already on board`
            : imported
        );
      }
    };
    window.addEventListener("ponder-jira-import-complete", handleImportComplete);
    return () =>
      window.removeEventListener("ponder-jira-import-complete", handleImportComplete);
  }, [fetchStories]);

  // One ref per column, pointing at the DOM node that holds that column's
  // work unit cards. Used by handleKeyboardNavigation to move focus between
  // columns when the user presses ArrowLeft/ArrowRight on a card.
  const columnRefs = useRef<ColumnRefMap>({
    todo: null,
    in_progress: null,
    code_review: null,
    done: null,
  });

  const statusToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setColumnRef = useCallback(
    (column: Column) => (el: HTMLDivElement | null) => {
      columnRefs.current[column] = el;
    },
    []
  );

  // Passed down to every WorkUnitCard so save/delete actions can announce a
  // status update via the page-level aria-live region below.
  const handleStatusMessage = useCallback((message: string) => {
    setStatusMessage(message);
  }, []);

  const handleKeyboardNavigation = useCallback(
    (direction: "left" | "right", currentUnitId: string) => {
      const cardSelector = (id: string) =>
        `[data-testid="work-unit-card-${id}"]`;

      // Find which column currently contains the focused card.
      const currentColumnIndex = COLUMNS.findIndex(({ key }) =>
        columnRefs.current[key]?.querySelector(cardSelector(currentUnitId))
      );
      if (currentColumnIndex === -1) return;

      const currentColumnEl =
        columnRefs.current[COLUMNS[currentColumnIndex].key];
      const cardsInCurrentColumn = Array.from(
        currentColumnEl?.querySelectorAll<HTMLElement>(
          '[data-testid^="work-unit-card-"]'
        ) ?? []
      );
      const currentIndex = cardsInCurrentColumn.findIndex(
        (el) => el.matches(cardSelector(currentUnitId))
      );

      const targetColumnIndex =
        direction === "left" ? currentColumnIndex - 1 : currentColumnIndex + 1;

      // Already at the leftmost/rightmost column: no-op.
      if (targetColumnIndex < 0 || targetColumnIndex >= COLUMNS.length) {
        return;
      }

      const targetColumnEl =
        columnRefs.current[COLUMNS[targetColumnIndex].key];
      const cardsInTargetColumn = Array.from(
        targetColumnEl?.querySelectorAll<HTMLElement>(
          '[data-testid^="work-unit-card-"]'
        ) ?? []
      );
      if (cardsInTargetColumn.length === 0) return;

      const targetIndex = Math.min(
        Math.max(currentIndex, 0),
        cardsInTargetColumn.length - 1
      );
      cardsInTargetColumn[targetIndex]?.focus();
    },
    []
  );

  // @dnd-kit sensors: PointerSensor requires an 8px pointer movement before
  // a drag activates, so a plain click (mousedown+mouseup with ~0 movement)
  // still reaches the card's onClick (opens the detail modal) and the
  // Edit/Delete buttons/JIRA-key link instead of being swallowed by drag
  // start. KeyboardSensor makes dragging (and thus reordering) available
  // without a pointer; its start/end keys are Space only (not Enter) so it
  // doesn't collide with the card's own Enter-opens-modal keyboard handling.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    })
  );

  // Persists a completed drag (from `handleDragEnd`, below): posts the
  // affected columns' full ordered id lists to the reorder endpoint — which
  // also triggers the server-side JIRA status write-back on a cross-column
  // move — then silently refreshes to reconcile with the server.
  const persistReorder = useCallback(
    async (movedId: string, columns: Partial<ColumnOrderMap>) => {
      try {
        const res = await fetch("/api/work-units/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ movedId, columns }),
        });
        if (!res.ok) throw new Error(`Failed to reorder: ${res.statusText}`);
      } catch (err) {
        console.error("Error reordering work unit:", err);
        setStatusMessage(
          err instanceof Error ? err.message : "Failed to reorder work unit"
        );
      } finally {
        // Reconciles local state with the server either way: confirms the
        // optimistic update on success, and reverts it on failure.
        fetchStories({ silent: true });
      }
    },
    [fetchStories]
  );

  // @dnd-kit drop handler: computes the new card ordering via the pure
  // `computeReorderedColumns` helper, applies it to local state
  // optimistically (so the UI updates immediately), then persists it.
  // Handles both within-column reordering and cross-column moves.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      const columnOrder = buildColumnOrder(stories);
      const result = computeReorderedColumns(columnOrder, activeId, overId);
      if (result.changedColumns.length === 0) return;

      const movedUnit = stories
        .flatMap((s) => s.workUnits)
        .find((w) => w.id === activeId);

      setStories((prev) => applyColumnOrder(prev, result.columns));

      if (movedUnit) {
        if (result.changedColumns.length > 1) {
          const toColumn = result.changedColumns[1];
          const label = COLUMNS.find((c) => c.key === toColumn)?.label ?? toColumn;
          setStatusMessage(`Moved "${movedUnit.title}" to ${label}`);
        } else {
          setStatusMessage(`Reordered "${movedUnit.title}"`);
        }
      }

      const affectedColumns: Partial<ColumnOrderMap> = Object.fromEntries(
        result.changedColumns.map((key) => [key, result.columns[key]])
      );
      persistReorder(activeId, affectedColumns);
    },
    [stories, persistReorder]
  );

  let content: JSX.Element;

  if (loading) {
    content = (
      <div className="text-center">
        <p className={`text-lg ${isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"}`}>Loading kanban board...</p>
      </div>
    );
  } else if (error) {
    content = (
      <div className="text-center">
        <p className="text-lg text-red-600">Error: {error}</p>
      </div>
    );
  } else {
    content = (
      <>
        <div className="mb-8">
          <p className={`${isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"} text-sm`}>
            {stories.length} {stories.length === 1 ? "story" : "stories"}
          </p>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          onDragEnd={handleDragEnd}
        >
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
        </DndContext>
      </>
    );
  }

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-blue-700 focus:shadow-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
      >
        Skip to main content
      </a>

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

      <main role="main" id="main-content" className={`min-h-screen ${isDark ? "bg-ponder-dark-bg" : "bg-gray-50"} p-8`}>
        <div className={`max-w-7xl mx-auto rounded-3xl border p-8 shadow-ponder-card ${
          isDark
            ? "bg-ponder-dark-bg border-ponder-dark-border"
            : "bg-ponder-light-bg border-ponder-light-card-border"
        }`}>
          <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
            <h1 className={`text-4xl font-bold ${isDark ? "text-ponder-dark-text" : "text-ponder-light-text"} font-space-grotesk`}>
              {title}
            </h1>
            {headerActions && (
              <div className="flex items-center gap-3 flex-wrap">
                {headerActions}
              </div>
            )}
          </div>
          {content}
        </div>
      </main>
    </>
  );
}

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
  // Get all work units in this column, keeping a handle on the parent story
  // so each card can show which JIRA issue it was decomposed from.
  const workUnitsInColumn: {
    workUnit: WorkUnitDTO;
    storyKey: string;
    storyUrl: string;
  }[] = [];

  stories.forEach((story) => {
    story.workUnits.forEach((wu) => {
      if (wu.column === column) {
        // The sub-story suffix is a stored, stable field (WorkUnit.subNumber)
        // set at creation time — it never renumbers when a sibling is
        // deleted. Ponder-local only; JIRA only ever sees the bare
        // story.jiraKey.
        const storyKey =
          wu.subNumber != null ? `${story.jiraKey}-${wu.subNumber}` : story.jiraKey;
        workUnitsInColumn.push({
          workUnit: wu,
          storyKey,
          storyUrl: story.url,
        });
      }
    });
  });

  // Sort by `order` ascending so dragged/reordered cards render in their
  // persisted position; ties (equal `order`) break on id for a stable,
  // deterministic render order — mirrors `buildColumnOrder` in dndReorder.ts.
  workUnitsInColumn.sort(
    (a, b) =>
      a.workUnit.order - b.workUnit.order ||
      a.workUnit.id.localeCompare(b.workUnit.id)
  );

  const totalWorkUnits = workUnitsInColumn.length;
  const itemWord = totalWorkUnits === 1 ? "item" : "items";
  const cardIds = workUnitsInColumn.map(({ workUnit }) => workUnit.id);

  // Registers the whole column body as a droppable target (id = the column
  // key) so a card can be dropped into an empty column, or below the last
  // card, and still resolve to this column.
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
      <div
        className={`mb-6 pb-4 border-b flex items-center gap-2 ${
          isDark ? "border-ponder-dark-border" : "border-ponder-light-card-border"
        }`}
      >
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

      <div
        className="space-y-4 flex-1 min-h-[120px]"
        ref={(el) => {
          columnRef?.(el);
          setDroppableRef(el);
        }}
      >
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {workUnitsInColumn.length === 0 ? (
            <div className={`text-center py-8 ${isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"} opacity-60`}>
              <p>No tasks</p>
            </div>
          ) : (
            workUnitsInColumn.map(({ workUnit, storyKey, storyUrl }) => (
              <WorkUnitCard
                key={workUnit.id}
                workUnit={workUnit}
                storyKey={storyKey}
                storyUrl={storyUrl}
                onDelete={onRefresh}
                onUpdate={onRefresh}
                onKeyboardNavigation={onKeyboardNavigation}
                onStatusMessage={onStatusMessage}
              />
            ))
          )}
        </SortableContext>
      </div>
    </section>
  );
}
