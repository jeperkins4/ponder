"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { WorkUnitDTO, Column } from "@/lib/types";
import { WorkUnitDetailModal } from "@/components/WorkUnitDetailModal";
import { useTheme } from "@/hooks/useTheme";

interface WorkUnitCardProps {
  workUnit: WorkUnitDTO;
  /** JIRA key of the parent story this card was decomposed from (e.g. "COM-540"). */
  storyKey?: string;
  /** Link to the parent JIRA issue; when present the key renders as a link. */
  storyUrl?: string;
  onDelete?: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<WorkUnitDTO>) => void;
  onKeyboardNavigation?: (direction: "left" | "right", workUnitId: string) => void;
  onStatusMessage?: (message: string) => void;
}

const columnLabels: Record<Column, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  code_review: "Code Review",
  done: "Done",
};

const focusRing = "focus:ring-2 focus:ring-ponder-light-purple focus:outline-none";

export function WorkUnitCard({
  workUnit,
  storyKey,
  storyUrl,
  onDelete,
  onUpdate,
  onKeyboardNavigation,
  onStatusMessage,
}: WorkUnitCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<WorkUnitDTO>>({
    title: workUnit.title,
    description: workUnit.description,
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isMovingToQA, setIsMovingToQA] = useState(false);
  const [isRequestingVerification, setIsRequestingVerification] = useState(false);

  // The card div (view mode) and the title input (edit mode) are two
  // different DOM nodes that never exist at the same time, since the
  // component renders one or the other depending on `isEditing`.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const wasEditingRef = useRef(false);

  const { isDark } = useTheme();
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
  // Matches WorkUnitDetailModal's own fieldClass convention for form fields —
  // the edit-mode input/textarea never had an explicit background class
  // (just the browser's white default), so in dark mode they rendered as
  // white boxes inside an otherwise dark card.
  const fieldClass = isDark
    ? "bg-ponder-dark-bg border-ponder-dark-border"
    : "bg-white border-ponder-light-card-border";

  // Makes the card a @dnd-kit sortable item: whole-card dragging (both
  // pointer and keyboard, via the sensors configured on KanbanBoard's
  // DndContext), reorderable within its column and movable across columns.
  // Disabled while editing — you can't drag a card that's mid-edit.
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workUnit.id, disabled: isEditing });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  // Focus management for edit mode entry/exit. We rely on an effect
  // (rather than calling .focus() directly inside handleSaveEdit /
  // handleCancelEdit) because the DOM node we want to focus doesn't exist
  // yet at the moment those handlers call setIsEditing() -- it only
  // mounts after React commits the re-render.
  useEffect(() => {
    if (isEditing) {
      titleInputRef.current?.focus();
    } else if (wasEditingRef.current) {
      cardRef.current?.focus();
    }
    wasEditingRef.current = isEditing;
  }, [isEditing]);

  const columnLabel = columnLabels[workUnit.column];
  const cardAriaLabel = `Work unit: ${workUnit.title}${
    storyKey ? `, from JIRA ${storyKey}` : ""
  }, in ${columnLabel} column, ${workUnit.description || "No description"}`;

  const handleEditChange = (field: string, value: string | null) => {
    setEditData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveEdit = async () => {
    try {
      const response = await fetch(`/api/work-units/${workUnit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });

      if (!response.ok) {
        throw new Error("Failed to update work unit");
      }

      const updated = await response.json();
      onUpdate?.(workUnit.id, updated);
      onStatusMessage?.(`Saved changes to ${updated.title ?? workUnit.title}`);
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating work unit:", error);
      alert("Failed to update work unit");
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!isDeleting) {
      setIsDeleting(true);
      return;
    }

    try {
      const response = await fetch(`/api/work-units/${workUnit.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete work unit");
      }

      onStatusMessage?.(`Deleted work unit: ${workUnit.title}`);
      onDelete?.(workUnit.id);
    } catch (error) {
      console.error("Error deleting work unit:", error);
      alert("Failed to delete work unit");
      setIsDeleting(false);
    }
  };

  const handleMoveToQA = async () => {
    setIsMovingToQA(true);
    try {
      const response = await fetch(`/api/work-units/${workUnit.id}/move-to-qa`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Failed to move story to QA");
        return;
      }

      if (data.transitioned) {
        onStatusMessage?.(`Moved "${storyKey}" to JIRA QA`);
      } else {
        onStatusMessage?.(`Reported "${workUnit.title}" to JIRA`);
      }
      onUpdate?.(workUnit.id, {});
    } catch (error) {
      console.error("Error moving story to QA:", error);
      alert("Failed to move story to QA");
    } finally {
      setIsMovingToQA(false);
    }
  };

  const handleRequestVerification = async () => {
    setIsRequestingVerification(true);
    try {
      const response = await fetch(`/api/work-units/${workUnit.id}/request-verification`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Failed to request verification");
        return;
      }

      onUpdate?.(workUnit.id, {
        verificationRequestedAt: data.verificationRequestedAt,
        verifiedAt: data.verifiedAt,
        verificationOutcome: data.verificationOutcome,
        verificationSummary: data.verificationSummary,
      });
    } catch (error) {
      console.error("Error requesting verification:", error);
      alert("Failed to request verification");
    } finally {
      setIsRequestingVerification(false);
    }
  };

  const handleDetailUpdated = () => {
    onUpdate?.(workUnit.id, {});
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setIsDetailOpen(true);
    } else if (e.key === "Delete") {
      e.preventDefault();
      handleDelete();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onKeyboardNavigation?.(
        e.key === "ArrowLeft" ? "left" : "right",
        workUnit.id
      );
    }
  };

  // WorkUnitDetailModal is rendered as a sibling of the card (not a
  // descendant) below, outside both the edit-mode and view-mode branches.
  // Nesting it inside the clickable/keydown-handling card div would let its
  // overlay clicks and internal keydowns (e.g. Enter/Delete inside its
  // textareas) bubble back up into the card's own onClick/onKeyDown
  // handlers, and its `fixed` overlay would be positioned relative to the
  // card once `hover:-translate-y-0.5` makes the card a containing block.
  const detailModal = (
    <WorkUnitDetailModal
      workUnit={workUnit}
      storyKey={storyKey}
      storyUrl={storyUrl}
      isOpen={isDetailOpen}
      onClose={() => setIsDetailOpen(false)}
      onUpdated={handleDetailUpdated}
    />
  );

  if (isEditing) {
    return (
      <>
      <div
        ref={setSortableRef}
        role="article"
        aria-label={cardAriaLabel}
        className={`p-3 border ${surfaceClass} rounded-xl shadow-ponder-card ${focusRing}`}
        style={dragStyle}
        tabIndex={0}
        data-testid={`work-unit-card-${workUnit.id}`}
      >
        <input
          ref={titleInputRef}
          type="text"
          value={editData.title || ""}
          onChange={(e) => handleEditChange("title", e.target.value)}
          className={`w-full px-2 py-1 mb-2 border ${fieldClass} ${textClass} rounded-lg font-instrument font-semibold ${focusRing}`}
          placeholder="Title"
          aria-label={`Edit title: ${workUnit.title}`}
          data-testid="edit-title-input"
        />
        <textarea
          value={editData.description || ""}
          onChange={(e) => handleEditChange("description", e.target.value)}
          className={`w-full px-2 py-1 mb-2 border ${fieldClass} rounded-lg font-instrument ${mutedTextClass} ${focusRing}`}
          placeholder="Description"
          rows={3}
          aria-label={`Edit description: ${workUnit.title}`}
          data-testid="edit-description-input"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSaveEdit}
            aria-label={`Save changes to ${workUnit.title}`}
            className={`px-3 py-1.5 bg-ponder-light-purple text-white rounded-lg hover:bg-ponder-light-purple-dark font-instrument font-semibold text-sm ${focusRing}`}
            data-testid="save-edit-button"
          >
            Save
          </button>
          <button
            onClick={handleCancelEdit}
            aria-label={`Cancel editing ${workUnit.title}`}
            className={`px-3 py-1.5 ${cancelButtonClass} rounded-lg font-instrument font-semibold text-sm ${focusRing}`}
            data-testid="cancel-edit-button"
          >
            Cancel
          </button>
        </div>
      </div>
      {detailModal}
      </>
    );
  }

  return (
    <>
    <div
      ref={(el) => {
        cardRef.current = el;
        setSortableRef(el);
      }}
      {...attributes}
      {...listeners}
      role="article"
      aria-label={cardAriaLabel}
      className={`group p-3 border ${surfaceClass} rounded-xl shadow-ponder-card hover:shadow-ponder-card-hover hover:-translate-y-0.5 transition-all cursor-pointer ${focusRing}`}
      style={dragStyle}
      tabIndex={0}
      onClick={() => setIsDetailOpen(true)}
      onKeyDown={(e) => {
        // dnd-kit's KeyboardSensor listener first (Space starts/ends a
        // keyboard drag), then this card's own key handling (Enter opens
        // the modal, Delete deletes, arrow keys move focus between
        // columns) — the two never collide since KanbanBoard's
        // KeyboardSensor is configured to use Space only, not Enter.
        listeners?.onKeyDown?.(e);
        handleCardKeyDown(e);
      }}
      data-testid={`work-unit-card-${workUnit.id}`}
    >
      <div className="mb-2">
          {storyKey &&
            (storyUrl ? (
              <a
                href={storyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`inline-block mb-1 font-instrument text-xs font-semibold text-ponder-light-purple hover:underline ${focusRing}`}
                data-testid={`work-unit-story-key-${workUnit.id}`}
              >
                {storyKey}
              </a>
            ) : (
              <span
                className={`inline-block mb-1 font-instrument text-xs font-semibold ${mutedTextClass}`}
                data-testid={`work-unit-story-key-${workUnit.id}`}
              >
                {storyKey}
              </span>
            ))}
          <h3
            className={`font-instrument font-semibold text-sm ${textClass} leading-tight`}
            data-testid={`work-unit-title-${workUnit.id}`}
          >
            {workUnit.title}
          </h3>
      </div>

      {workUnit.description && (
        <p className={`text-xs font-instrument ${mutedTextClass} mb-3 line-clamp-2`}>
          {workUnit.description}
        </p>
      )}

      <div className="flex gap-2">
        <div
          className={`flex gap-2 ${
            isDeleting
              ? ""
              : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
          data-testid={`card-actions-${workUnit.id}`}
        >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          aria-label={`Edit work unit: ${workUnit.title}`}
          className={`px-2 py-1.5 text-xs font-instrument font-semibold bg-ponder-light-purple text-white hover:bg-ponder-light-purple-dark rounded-lg transition-colors ${focusRing}`}
          data-testid={`edit-button-${workUnit.id}`}
        >
          Edit
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          aria-label={`${isDeleting ? "Confirm delete" : "Delete"} work unit: ${
            workUnit.title
          }`}
          className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg transition-colors ${focusRing} ${
            isDeleting
              ? "bg-red-600 text-white hover:bg-red-700"
              : isDark
                ? "bg-red-900/40 text-red-300 hover:bg-red-900/60"
                : "bg-red-50 text-red-700 hover:bg-red-100"
          }`}
          data-testid={`delete-button-${workUnit.id}`}
        >
          {isDeleting ? "Confirm Delete?" : "Delete"}
        </button>
        {isDeleting && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsDeleting(false);
            }}
            aria-label={`Cancel delete of ${workUnit.title}`}
            className={`px-2 py-1.5 text-xs font-instrument font-semibold ${cancelButtonClass} rounded-lg transition-colors ${focusRing}`}
            data-testid={`cancel-delete-button-${workUnit.id}`}
          >
            Cancel
          </button>
        )}
        </div>
        {workUnit.column === "done" && storyKey && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMoveToQA();
            }}
            disabled={isMovingToQA}
            aria-label={
              workUnit.movedToQaReportedAt
                ? `Retry moving ${storyKey} to JIRA QA`
                : `Move ${storyKey} to JIRA QA`
            }
            className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg transition-colors disabled:opacity-50 ${focusRing} ${
              isDark
                ? "bg-emerald-900/50 text-emerald-200 hover:bg-emerald-900/70"
                : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
            }`}
            data-testid={`move-to-qa-button-${workUnit.id}`}
          >
            {isMovingToQA
              ? "Moving…"
              : workUnit.movedToQaReportedAt
                ? "Reported ✓ (Retry)"
                : "Move to QA"}
          </button>
        )}
        {workUnit.column === "code_review" &&
          (workUnit.verificationOutcome === "passed" ? (
            <span
              className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg ${
                isDark
                  ? "bg-green-900/50 text-green-200"
                  : "bg-green-100 text-green-800"
              }`}
              data-testid={`verification-badge-${workUnit.id}`}
            >
              Verified ✓{" "}
              {workUnit.verifiedAt &&
                new Date(workUnit.verifiedAt).toLocaleDateString()}
            </span>
          ) : (
            <>
              {workUnit.verificationOutcome === "failed" && (
                <span
                  title={workUnit.verificationSummary ?? undefined}
                  className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg ${
                    isDark
                      ? "bg-red-900/50 text-red-200"
                      : "bg-red-100 text-red-800"
                  }`}
                  data-testid={`verification-badge-${workUnit.id}`}
                >
                  Verification failed
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRequestVerification();
                }}
                disabled={isRequestingVerification || !!workUnit.verificationRequestedAt}
                aria-label={`Request verification for ${workUnit.title}`}
                className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg transition-colors disabled:opacity-50 ${focusRing} ${
                  isDark
                    ? "bg-blue-900/50 text-blue-200 hover:bg-blue-900/70"
                    : "bg-blue-100 text-blue-800 hover:bg-blue-200"
                }`}
                data-testid={`verify-button-${workUnit.id}`}
              >
                {isRequestingVerification || workUnit.verificationRequestedAt
                  ? "Verifying…"
                  : "Verify"}
              </button>
            </>
          ))}
      </div>
    </div>
    {detailModal}
    </>
  );
}
