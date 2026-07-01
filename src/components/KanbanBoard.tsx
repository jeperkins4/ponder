"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StoryDTO, WorkUnitDTO, Column, COLUMNS } from "@/lib/types";
import { WorkUnitCard } from "@/components/WorkUnitCard";
import { OnboardingTooltip } from "@/components/OnboardingTooltip";
import { useTheme } from "@/hooks/useTheme";

type ColumnRefMap = Record<Column, HTMLDivElement | null>;

const ONBOARDING_STORAGE_KEY = "boardOnboarded";

export interface KanbanBoardProps {
  /** Scopes the board to a single project's stories. Omit to load all stories
   * (used by the un-scoped /board route for backward compatibility). */
  projectId?: string;
}

export function KanbanBoard({ projectId }: KanbanBoardProps) {
  const { isDark } = useTheme();
  const [stories, setStories] = useState<StoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    // `?reset-onboarding=true` lets us re-trigger the tooltip for manual
    // testing without clearing localStorage by hand.
    const params = new URLSearchParams(window.location.search);
    const forceReset = params.get("reset-onboarding") === "true";

    const hasOnboarded = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (forceReset || !hasOnboarded) {
      setShowOnboarding(true);
    }
  }, []);

  const handleOnboardingDismiss = useCallback(() => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    setShowOnboarding(false);
  }, []);

  const storiesUrl = projectId
    ? `/api/stories?projectId=${projectId}`
    : "/api/stories";

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

  // One ref per column, pointing at the DOM node that holds that column's
  // work unit cards. Used by handleKeyboardNavigation to move focus between
  // columns when the user presses ArrowLeft/ArrowRight on a card.
  const columnRefs = useRef<ColumnRefMap>({
    todo: null,
    in_progress: null,
    done: null,
  });

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
      const currentColumnIndex = COLUMNS.findIndex((column) =>
        columnRefs.current[column]?.querySelector(cardSelector(currentUnitId))
      );
      if (currentColumnIndex === -1) return;

      const currentColumnEl = columnRefs.current[COLUMNS[currentColumnIndex]];
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

      const targetColumnEl = columnRefs.current[COLUMNS[targetColumnIndex]];
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
          <h1 className={`text-4xl font-bold ${isDark ? "text-ponder-dark-text" : "text-ponder-light-text"} font-space-grotesk`}>Kanban Board</h1>
          <p className={`${isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"} text-sm`}>Drag tasks between columns to track progress.</p>
          <p className={`${isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"} mt-2`}>
            {stories.length} {stories.length === 1 ? "story" : "stories"}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column}
              column={column}
              stories={stories}
              onRefresh={() => fetchStories({ silent: true })}
              columnRef={setColumnRef(column)}
              onKeyboardNavigation={handleKeyboardNavigation}
              onStatusMessage={handleStatusMessage}
              isDark={isDark}
            />
          ))}
        </div>
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

      {/* Announces save/delete outcomes to screen readers without moving focus. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {statusMessage}
      </div>

      <OnboardingTooltip
        isOpen={showOnboarding}
        onDismiss={handleOnboardingDismiss}
      />

      <main role="main" id="main-content" className={`min-h-screen ${isDark ? "bg-ponder-dark-bg" : "bg-gray-50"} p-8`}>
        <div className={`max-w-7xl mx-auto rounded-3xl border p-8 shadow-ponder-card ${
          isDark
            ? "bg-ponder-dark-bg border-ponder-dark-border"
            : "bg-ponder-light-bg border-ponder-light-card-border"
        }`}>
          {content}
        </div>
      </main>
    </>
  );
}

interface KanbanColumnProps {
  column: Column;
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
  stories,
  onRefresh,
  columnRef,
  onKeyboardNavigation,
  onStatusMessage,
  isDark = false,
}: KanbanColumnProps) {
  const columnLabel = {
    todo: "To Do",
    in_progress: "In Progress",
    done: "Done",
  }[column];

  // Get all work units in this column
  const workUnitsInColumn: WorkUnitDTO[] = [];

  stories.forEach((story) => {
    story.workUnits.forEach((wu) => {
      if (wu.column === column) {
        workUnitsInColumn.push(wu);
      }
    });
  });

  const totalWorkUnits = workUnitsInColumn.length;
  const itemWord = totalWorkUnits === 1 ? "item" : "items";

  return (
    <section
      aria-label={`${columnLabel} column, ${totalWorkUnits} ${itemWord}`}
      className={`rounded-xl border p-6 transition-all duration-200 ${
        isDark
          ? "bg-ponder-dark-surface border-ponder-dark-border hover:border-ponder-dark-purple hover:shadow-ponder-card-hover"
          : "bg-ponder-light-surface border-ponder-light-card-border hover:border-ponder-light-purple hover:shadow-ponder-card-hover"
      }`}
    >
      <div className={`mb-6 pb-4 border-b ${isDark ? "border-ponder-dark-border" : "border-ponder-light-card-border"}`}>
        <h2 className={`text-lg font-semibold ${isDark ? "text-ponder-dark-text" : "text-ponder-light-text"} font-space-grotesk`}>{columnLabel}</h2>
        <p className={`text-sm ${isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"} mt-1`}>
          {totalWorkUnits} {itemWord}
        </p>
      </div>

      <div className="space-y-4" ref={columnRef}>
        {workUnitsInColumn.length === 0 ? (
          <div className={`text-center py-8 ${isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted"} opacity-60`}>
            <p>No tasks</p>
          </div>
        ) : (
          workUnitsInColumn.map((workUnit) => (
            <WorkUnitCard
              key={workUnit.id}
              workUnit={workUnit}
              onDelete={onRefresh}
              onUpdate={onRefresh}
              onKeyboardNavigation={onKeyboardNavigation}
              onStatusMessage={onStatusMessage}
            />
          ))
        )}
      </div>
    </section>
  );
}
