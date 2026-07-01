"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StoryDTO, WorkUnitDTO, Column, COLUMNS } from "@/lib/types";
import { WorkUnitCard } from "@/components/WorkUnitCard";
import { OnboardingTooltip } from "@/components/OnboardingTooltip";
import { useTheme } from "@/hooks/useTheme";

type ColumnRefMap = Record<Column, HTMLDivElement | null>;

const ONBOARDING_STORAGE_KEY = "boardOnboarded";

export default function Board() {
  const { isDark, toggle, mounted } = useTheme();
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

  const fetchStories = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      setError(null);
      const response = await fetch("/api/stories");
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
  }, []);

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
          {/* Theme toggle button */}
          <div className="flex justify-end mb-6">
            <button
              onClick={toggle}
              data-testid="theme-toggle-button"
              className={`p-2 rounded-lg transition-colors ${
                isDark
                  ? "bg-ponder-dark-surface hover:bg-ponder-dark-border text-ponder-dark-text"
                  : "bg-ponder-light-surface hover:bg-ponder-light-card-border text-ponder-light-text"
              }`}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.536l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.707.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zm5.657-9.193a1 1 0 00-1.414 0l-.707.707A1 1 0 005.05 6.464l.707-.707a1 1 0 001.414-1.414l-.707-.707zM3 11a1 1 0 100-2H2a1 1 0 100 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>
          </div>

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
