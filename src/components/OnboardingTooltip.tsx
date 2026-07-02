"use client";

import { useEffect, useRef } from "react";

interface OnboardingTooltipProps {
  isOpen: boolean;
  onDismiss: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function OnboardingTooltip({ isOpen, onDismiss }: OnboardingTooltipProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  // Move focus into the dialog when it opens, and restore focus to whatever
  // was focused beforehand (typically the board) when it closes.
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
      buttonRef.current?.focus();
    } else {
      previouslyFocusedElement.current?.focus();
      previouslyFocusedElement.current = null;
    }
  }, [isOpen]);

  // Escape-to-dismiss and Tab focus trapping, wired at the document level so
  // it works regardless of which element inside the dialog currently has
  // focus.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss();
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
  }, [isOpen, onDismiss]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onDismiss}
      data-testid="onboarding-overlay"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-label="Board onboarding guide"
        className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="onboarding-tooltip"
      >
        <h2
          id="onboarding-title"
          className="text-2xl font-bold text-gray-800 mb-4"
        >
          Welcome to Kanban Board
        </h2>
        <ul className="text-gray-700 space-y-2 mb-6 list-none">
          <li>• Click &apos;Edit&apos; to change a task&apos;s title or description</li>
          <li>
            • Click &apos;Delete&apos; to remove a task (confirm on the second
            click)
          </li>
          <li>• Drag tasks between columns to track progress</li>
          <li>
            • Use keyboard: Enter to open a task&apos;s details, Delete key to
            remove, arrow keys to move between columns
          </li>
        </ul>
        <button
          ref={buttonRef}
          onClick={onDismiss}
          data-testid="onboarding-dismiss-button"
          className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
