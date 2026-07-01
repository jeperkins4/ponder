"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { COLUMNS } from "@/lib/columns";
import type { Column } from "@/lib/types";

export interface ImportReviewProps {
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}

interface ImportPreviewStory {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  targetColumn: Column;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function columnLabel(column: Column): string {
  return COLUMNS.find((c) => c.key === column)?.label ?? column;
}

/**
 * Modal review step between "Import from JIRA" and actually creating cards.
 * Fetches a read-only preview (POST /import/preview), lets the user toggle
 * "break down into subtasks" per story, then POSTs the chosen selection to
 * /import/process. Mirrors OnboardingTooltip's dialog accessibility
 * mechanics (focus trap, Escape-to-close) but is Ponder theme-aware.
 */
export function ImportReview({ projectId, onClose, onImported }: ImportReviewProps) {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stories, setStories] = useState<ImportPreviewStory[]>([]);
  const [breakDownByKey, setBreakDownByKey] = useState<Record<string, boolean>>({});
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocusedElement.current?.focus();
      previouslyFocusedElement.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`/api/projects/${projectId}/import/preview`, {
          method: "POST",
        });
        const data = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setLoadError(data.error || "Failed to load stories from JIRA");
          setLoading(false);
          return;
        }

        const loadedStories: ImportPreviewStory[] = data.stories ?? [];
        setStories(loadedStories);
        setMessage(data.message ?? null);
        setBreakDownByKey(
          Object.fromEntries(loadedStories.map((s) => [s.jiraKey, false]))
        );
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Move focus into the dialog once its content is ready to receive it.
  useEffect(() => {
    if (!loading) {
      closeButtonRef.current?.focus();
    }
  }, [loading]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const toggleBreakDown = (jiraKey: string) => {
    setBreakDownByKey((prev) => ({ ...prev, [jiraKey]: !prev[jiraKey] }));
  };

  const selectAll = () => {
    setBreakDownByKey(Object.fromEntries(stories.map((s) => [s.jiraKey, true])));
  };

  const selectNone = () => {
    setBreakDownByKey(Object.fromEntries(stories.map((s) => [s.jiraKey, false])));
  };

  const handleProcess = async () => {
    setProcessing(true);
    setProcessError(null);

    try {
      const items = stories.map((s) => ({
        jiraKey: s.jiraKey,
        jiraId: s.jiraId,
        summary: s.summary,
        description: s.description,
        jiraStatus: s.jiraStatus,
        breakDown: Boolean(breakDownByKey[s.jiraKey]),
      }));

      const response = await fetch(`/api/projects/${projectId}/import/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await response.json();

      if (!response.ok) {
        setProcessError(data.error || "Failed to process import");
        setProcessing(false);
        return;
      }

      onImported();
      onClose();
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : "An error occurred");
      setProcessing(false);
    }
  };

  const surfaceClass = isDark
    ? "bg-ponder-dark-surface border-ponder-dark-border text-ponder-dark-text"
    : "bg-ponder-light-surface border-ponder-light-card-border text-ponder-light-text";
  const mutedTextClass = isDark ? "text-ponder-dark-text-muted" : "text-ponder-light-text-muted";
  const purpleButtonClass = isDark
    ? "bg-ponder-dark-purple hover:bg-ponder-dark-purple-dark"
    : "bg-ponder-light-purple hover:bg-ponder-light-purple-dark";
  const badgeClass = isDark
    ? "bg-ponder-dark-purple-light text-ponder-dark-purple border-ponder-dark-border"
    : "bg-ponder-light-purple-light text-ponder-light-purple border-ponder-light-card-border";
  const rowBorderClass = isDark ? "border-ponder-dark-border" : "border-ponder-light-card-border";

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      data-testid="import-review-overlay"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-review-title"
        className={`rounded-2xl border shadow-ponder-card-hover max-w-2xl w-full max-h-[85vh] flex flex-col font-instrument ${surfaceClass}`}
        onClick={(e) => e.stopPropagation()}
        data-testid="import-review-dialog"
      >
        <div className={`flex items-start justify-between gap-4 p-6 border-b ${rowBorderClass}`}>
          <h2 id="import-review-title" className="text-xl font-bold font-space-grotesk">
            {loading ? "Import from JIRA" : `Import ${stories.length} ${stories.length === 1 ? "story" : "stories"}`}
          </h2>
          <button
            ref={loading ? undefined : closeButtonRef}
            type="button"
            onClick={onClose}
            data-testid="import-review-close-button"
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors focus:ring-2 focus:ring-ponder-light-purple focus:outline-none ${mutedTextClass} hover:opacity-80`}
          >
            Close
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading && (
            <p className={mutedTextClass} data-testid="import-review-loading">
              Loading stories from JIRA…
            </p>
          )}

          {!loading && loadError && (
            <div role="alert" className="text-sm text-red-600 mb-4">
              Error: {loadError}
            </div>
          )}

          {!loading && !loadError && stories.length === 0 && (
            <p className={mutedTextClass} data-testid="import-review-empty-message">
              {message || "No stories to import."}
            </p>
          )}

          {!loading && !loadError && stories.length > 0 && (
            <>
              <div className="flex items-center justify-end gap-3 mb-4 text-sm">
                <span className={mutedTextClass}>Break down: </span>
                <button
                  type="button"
                  onClick={selectAll}
                  data-testid="import-review-select-all"
                  className={`underline ${mutedTextClass} hover:opacity-80`}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={selectNone}
                  data-testid="import-review-select-none"
                  className={`underline ${mutedTextClass} hover:opacity-80`}
                >
                  Select none
                </button>
              </div>

              <ul className="space-y-3">
                {stories.map((story) => {
                  const checkboxId = `breakdown-${story.jiraKey}`;
                  return (
                    <li
                      key={story.jiraKey}
                      data-testid={`import-review-row-${story.jiraKey}`}
                      className={`flex items-center gap-4 p-3 rounded-xl border ${rowBorderClass}`}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={Boolean(breakDownByKey[story.jiraKey])}
                        onChange={() => toggleBreakDown(story.jiraKey)}
                        data-testid={`import-review-checkbox-${story.jiraKey}`}
                        className="h-4 w-4 shrink-0 focus:ring-2 focus:ring-ponder-light-purple focus:outline-none"
                      />
                      <label htmlFor={checkboxId} className={`text-xs shrink-0 ${mutedTextClass}`}>
                        Break down into subtasks
                      </label>

                      <span className="text-sm font-semibold shrink-0">{story.jiraKey}</span>
                      <span className="text-sm flex-1 truncate">{story.summary}</span>

                      <span
                        data-testid={`import-review-badge-${story.jiraKey}`}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border shrink-0 ${badgeClass}`}
                      >
                        {columnLabel(story.targetColumn)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {processError && (
            <div role="alert" className="text-sm text-red-600 mt-4">
              Error: {processError}
            </div>
          )}
        </div>

        {!loading && !loadError && stories.length > 0 && (
          <div className={`p-6 border-t flex items-center justify-end gap-3 ${rowBorderClass}`}>
            {processing && (
              <span className={`text-sm ${mutedTextClass}`}>
                Processing… breaking down stories may take a moment.
              </span>
            )}
            <button
              type="button"
              onClick={handleProcess}
              disabled={processing}
              data-testid="import-review-process-button"
              className={`px-4 py-2 rounded-lg font-semibold text-sm text-white transition-colors focus:ring-2 focus:ring-ponder-light-purple focus:outline-none ${
                processing ? "bg-gray-400 cursor-not-allowed" : purpleButtonClass
              }`}
            >
              Process
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
