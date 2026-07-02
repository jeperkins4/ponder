"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { COLUMNS } from "@/lib/columns";
import type { WorkUnitDTO, WorkNoteDTO } from "@/lib/types";

export interface WorkUnitDetailModalProps {
  workUnit: WorkUnitDTO;
  /** JIRA key of the parent story this card was decomposed from (e.g. "COM-540"). */
  storyKey?: string;
  /** Link to the parent JIRA issue; when present the key renders as a link. */
  storyUrl?: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called after acceptanceCriteria/verification are saved, so the parent can refresh. */
  onUpdated?: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function columnLabel(column: WorkUnitDTO["column"]): string {
  return COLUMNS.find((c) => c.key === column)?.label ?? column;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Detail modal opened from a WorkUnitCard. Mirrors OnboardingTooltip/ImportReview's
 * dialog accessibility mechanics (focus trap, Escape-to-close, overlay-click-close,
 * focus restore) but is Ponder theme-aware like ImportReview.
 *
 * Shows the work unit's details (title, description, acceptance criteria,
 * verification, dates), lets the user edit acceptanceCriteria/verification in
 * place, and renders a chronological work-notes log with an add-note form.
 * Title/description editing stays on the card's own Edit button.
 */
export function WorkUnitDetailModal({
  workUnit,
  storyKey,
  storyUrl,
  isOpen,
  onClose,
  onUpdated,
}: WorkUnitDetailModalProps) {
  const { isDark } = useTheme();

  const [acceptanceCriteria, setAcceptanceCriteria] = useState(workUnit.acceptanceCriteria);
  const [verification, setVerification] = useState(workUnit.verification);

  useEffect(() => {
    setAcceptanceCriteria(workUnit.acceptanceCriteria);
    setVerification(workUnit.verification);
  }, [workUnit.id, workUnit.acceptanceCriteria, workUnit.verification]);

  const [isEditing, setIsEditing] = useState(false);
  const [editAC, setEditAC] = useState("");
  const [editVerification, setEditVerification] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [notes, setNotes] = useState<WorkNoteDTO[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [postingNote, setPostingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  // Fetch the notes log whenever the modal opens (or opens for a different
  // work unit while already mounted).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function loadNotes() {
      setNotesLoading(true);
      setNotesError(null);
      try {
        const response = await fetch(`/api/work-units/${workUnit.id}/notes`);
        const data = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setNotesError(data.error || "Failed to load work notes");
          return;
        }
        setNotes(data);
      } catch (err) {
        if (!cancelled) {
          setNotesError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (!cancelled) setNotesLoading(false);
      }
    }

    loadNotes();
    return () => {
      cancelled = true;
    };
  }, [isOpen, workUnit.id]);

  // Move focus into the dialog when it opens, and restore focus to whatever
  // was focused beforehand when it closes.
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
      closeButtonRef.current?.focus();
    } else {
      previouslyFocusedElement.current?.focus();
      previouslyFocusedElement.current = null;
    }
  }, [isOpen]);

  // Escape-to-close and Tab focus trapping, wired at the document level so
  // it works regardless of which element inside the dialog currently has
  // focus.
  useEffect(() => {
    if (!isOpen) return;

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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const startEditing = () => {
    setEditAC(acceptanceCriteria ?? "");
    setEditVerification(verification ?? "");
    setSaveError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setSaveError(null);
  };

  const saveEditing = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/work-units/${workUnit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptanceCriteria: editAC,
          verification: editVerification,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setSaveError(data.error || "Failed to save changes");
        setSaving(false);
        return;
      }

      setAcceptanceCriteria(data.acceptanceCriteria);
      setVerification(data.verification);
      setIsEditing(false);
      setSaving(false);
      onUpdated?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "An error occurred");
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || postingNote) return;

    setPostingNote(true);
    setNoteError(null);
    try {
      const response = await fetch(`/api/work-units/${workUnit.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newNote }),
      });
      const data = await response.json();

      if (!response.ok) {
        setNoteError(data.error || "Failed to add note");
        setPostingNote(false);
        return;
      }

      setNotes((prev) => [...prev, data]);
      setNewNote("");
      setPostingNote(false);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "An error occurred");
      setPostingNote(false);
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
  const fieldClass = isDark
    ? "bg-ponder-dark-bg border-ponder-dark-border text-ponder-dark-text"
    : "bg-white border-ponder-light-card-border text-ponder-light-text";
  const focusRing = "focus:ring-2 focus:ring-ponder-light-purple focus:outline-none";

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      data-testid="work-unit-detail-overlay"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-unit-detail-title"
        className={`rounded-2xl border shadow-ponder-card-hover max-w-2xl w-full max-h-[85vh] flex flex-col font-instrument ${surfaceClass}`}
        onClick={(e) => e.stopPropagation()}
        data-testid="work-unit-detail-dialog"
      >
        <div className={`flex items-start justify-between gap-4 p-6 border-b ${rowBorderClass}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {storyKey &&
                (storyUrl ? (
                  <a
                    href={storyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs font-semibold text-ponder-light-purple hover:underline ${focusRing}`}
                    data-testid="work-unit-detail-story-key"
                  >
                    {storyKey}
                  </a>
                ) : (
                  <span
                    className={`text-xs font-semibold ${mutedTextClass}`}
                    data-testid="work-unit-detail-story-key"
                  >
                    {storyKey}
                  </span>
                ))}
              <span
                className={`text-xs font-semibold px-2 py-1 rounded-full border ${badgeClass}`}
                data-testid="work-unit-detail-column-badge"
              >
                {columnLabel(workUnit.column)}
              </span>
            </div>
            <h2
              id="work-unit-detail-title"
              className="text-xl font-bold font-space-grotesk break-words"
              data-testid="work-unit-detail-title"
            >
              {workUnit.title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            data-testid="work-unit-detail-close-button"
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${focusRing} ${mutedTextClass} hover:opacity-80`}
          >
            Close
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {workUnit.description && (
            <p className="text-sm whitespace-pre-wrap" data-testid="work-unit-detail-description">
              {workUnit.description}
            </p>
          )}

          {!isEditing ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold font-space-grotesk">Acceptance Criteria</h3>
                  <button
                    type="button"
                    onClick={startEditing}
                    data-testid="work-unit-detail-edit-button"
                    aria-label="Edit acceptance criteria and verification"
                    className={`text-xs font-semibold underline ${mutedTextClass} hover:opacity-80 ${focusRing}`}
                  >
                    Edit
                  </button>
                </div>
                <p
                  className={`text-sm whitespace-pre-wrap ${acceptanceCriteria ? "" : mutedTextClass}`}
                  data-testid="work-unit-detail-ac"
                >
                  {acceptanceCriteria || "None yet"}
                </p>
              </div>

              <div>
                <h3 className="text-sm font-semibold font-space-grotesk mb-1">Verification</h3>
                <p
                  className={`text-sm whitespace-pre-wrap ${verification ? "" : mutedTextClass}`}
                  data-testid="work-unit-detail-verification"
                >
                  {verification || "None yet"}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="work-unit-detail-ac-input"
                  className="block text-sm font-semibold font-space-grotesk mb-1"
                >
                  Acceptance Criteria
                </label>
                <textarea
                  id="work-unit-detail-ac-input"
                  value={editAC}
                  onChange={(e) => setEditAC(e.target.value)}
                  rows={4}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${fieldClass} ${focusRing}`}
                  data-testid="work-unit-detail-ac-input"
                />
              </div>
              <div>
                <label
                  htmlFor="work-unit-detail-verification-input"
                  className="block text-sm font-semibold font-space-grotesk mb-1"
                >
                  Verification
                </label>
                <textarea
                  id="work-unit-detail-verification-input"
                  value={editVerification}
                  onChange={(e) => setEditVerification(e.target.value)}
                  rows={4}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${fieldClass} ${focusRing}`}
                  data-testid="work-unit-detail-verification-input"
                />
              </div>

              {saveError && (
                <div role="alert" className="text-sm text-red-600">
                  Error: {saveError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveEditing}
                  disabled={saving}
                  data-testid="work-unit-detail-save-button"
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors ${focusRing} ${
                    saving ? "bg-gray-400 cursor-not-allowed" : purpleButtonClass
                  }`}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  data-testid="work-unit-detail-cancel-button"
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${focusRing} ${mutedTextClass} hover:opacity-80`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className={`text-xs ${mutedTextClass} space-y-0.5`} data-testid="work-unit-detail-dates">
            <p>Created {formatDateTime(workUnit.createdAt)}</p>
            {workUnit.completedAt && <p>Completed {formatDateTime(workUnit.completedAt)}</p>}
          </div>

          <div className={`border-t pt-4 ${rowBorderClass}`}>
            <h3 className="text-sm font-semibold font-space-grotesk mb-2">Work Notes</h3>

            <div className="max-h-56 overflow-y-auto space-y-3 mb-3" data-testid="work-unit-detail-notes-list">
              {notesLoading && (
                <p className={`text-sm ${mutedTextClass}`} data-testid="work-unit-detail-notes-loading">
                  Loading notes…
                </p>
              )}

              {!notesLoading && notesError && (
                <div role="alert" className="text-sm text-red-600" data-testid="work-unit-detail-notes-error">
                  Error: {notesError}
                </div>
              )}

              {!notesLoading && !notesError && notes.length === 0 && (
                <p className={`text-sm ${mutedTextClass}`} data-testid="work-unit-detail-notes-empty">
                  No work notes yet
                </p>
              )}

              {!notesLoading &&
                !notesError &&
                notes.map((note) => (
                  <div
                    key={note.id}
                    className={`text-sm border rounded-lg p-2 ${rowBorderClass}`}
                    data-testid={`work-unit-detail-note-${note.id}`}
                  >
                    <p className={`text-xs mb-1 ${mutedTextClass}`}>{formatDateTime(note.createdAt)}</p>
                    <p className="whitespace-pre-wrap">{note.body}</p>
                  </div>
                ))}
            </div>

            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note…"
              rows={2}
              className={`w-full px-3 py-2 rounded-lg border text-sm mb-2 ${fieldClass} ${focusRing}`}
              aria-label="Add a note"
              data-testid="work-unit-detail-new-note-input"
            />

            {noteError && (
              <div role="alert" className="text-sm text-red-600 mb-2" data-testid="work-unit-detail-note-error">
                Error: {noteError}
              </div>
            )}

            <button
              type="button"
              onClick={handleAddNote}
              disabled={postingNote || !newNote.trim()}
              data-testid="work-unit-detail-add-note-button"
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors ${focusRing} ${
                postingNote || !newNote.trim() ? "bg-gray-400 cursor-not-allowed" : purpleButtonClass
              }`}
            >
              {postingNote ? "Adding…" : "Add note"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
