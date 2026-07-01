"use client";

import { useEffect, useRef, useState } from "react";
import { WorkUnitDTO, Column } from "@/lib/types";

type PriorityLevel = "HIGH" | "MEDIUM" | "LOW";

interface WorkUnitCardProps {
  workUnit: WorkUnitDTO;
  priority?: PriorityLevel;
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

const columnColors: Record<Column, string> = {
  todo: "bg-gray-100 text-gray-800",
  in_progress: "bg-blue-100 text-blue-800",
  code_review: "bg-purple-100 text-purple-800",
  done: "bg-green-100 text-green-800",
};

const priorityStyles: Record<PriorityLevel, { dot: string; text: string }> = {
  HIGH: {
    dot: "bg-red-500",
    text: "text-red-700",
  },
  MEDIUM: {
    dot: "bg-amber-400",
    text: "text-amber-700",
  },
  LOW: {
    dot: "bg-gray-500",
    text: "text-gray-600",
  },
};

const focusRing = "focus:ring-2 focus:ring-ponder-light-purple focus:outline-none";

export function WorkUnitCard({
  workUnit,
  priority,
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

  // The card div (view mode) and the title input (edit mode) are two
  // different DOM nodes that never exist at the same time, since the
  // component renders one or the other depending on `isEditing`.
  const cardRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const wasEditingRef = useRef(false);

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
  const cardAriaLabel = `Work unit: ${workUnit.title}, in ${columnLabel} column, ${
    workUnit.description || "No description"
  }`;

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

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setIsEditing(true);
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

  if (isEditing) {
    return (
      <div
        role="article"
        aria-label={cardAriaLabel}
        className={`p-3 bg-ponder-light-surface border border-ponder-light-card-border rounded-xl shadow-ponder-card ${focusRing}`}
        tabIndex={0}
        data-testid={`work-unit-card-${workUnit.id}`}
      >
        <input
          ref={titleInputRef}
          type="text"
          value={editData.title || ""}
          onChange={(e) => handleEditChange("title", e.target.value)}
          className={`w-full px-2 py-1 mb-2 border border-ponder-light-card-border rounded-lg font-instrument font-semibold ${focusRing}`}
          placeholder="Title"
          aria-label={`Edit title: ${workUnit.title}`}
          data-testid="edit-title-input"
        />
        <textarea
          value={editData.description || ""}
          onChange={(e) => handleEditChange("description", e.target.value)}
          className={`w-full px-2 py-1 mb-2 border border-ponder-light-card-border rounded-lg font-instrument text-ponder-light-text-muted ${focusRing}`}
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
            className={`px-3 py-1.5 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-instrument font-semibold text-sm ${focusRing}`}
            data-testid="cancel-edit-button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      role="article"
      aria-label={cardAriaLabel}
      className={`p-3 bg-ponder-light-surface border border-ponder-light-card-border rounded-xl shadow-ponder-card hover:shadow-ponder-card-hover hover:-translate-y-0.5 transition-all ${focusRing}`}
      tabIndex={0}
      onKeyDown={handleCardKeyDown}
      data-testid={`work-unit-card-${workUnit.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          {priority && (
            <div className="flex items-center gap-1 mb-2">
              <span className={`inline-flex items-center gap-1 text-xs font-bold tracking-wide ${priorityStyles[priority].text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${priorityStyles[priority].dot}`}></span>
                {priority}
              </span>
            </div>
          )}
          <h3
            className="font-instrument font-semibold text-sm text-ponder-light-text leading-tight"
            data-testid={`work-unit-title-${workUnit.id}`}
          >
            {workUnit.title}
          </h3>
        </div>
        <span
          className={`px-2 py-1 rounded-full text-xs font-instrument font-medium ml-2 flex-shrink-0 ${
            columnColors[workUnit.column]
          }`}
          data-testid={`work-unit-column-badge-${workUnit.id}`}
        >
          {columnLabels[workUnit.column]}
        </span>
      </div>

      {workUnit.description && (
        <p className="text-xs font-instrument text-ponder-light-text-muted mb-3 line-clamp-2">
          {workUnit.description}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setIsEditing(true)}
          aria-label={`Edit work unit: ${workUnit.title}`}
          className={`px-2 py-1.5 text-xs font-instrument font-semibold bg-ponder-light-purple text-white hover:bg-ponder-light-purple-dark rounded-lg transition-colors ${focusRing}`}
          data-testid={`edit-button-${workUnit.id}`}
        >
          Edit
        </button>
        <button
          onClick={handleDelete}
          aria-label={`${isDeleting ? "Confirm delete" : "Delete"} work unit: ${
            workUnit.title
          }`}
          className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg transition-colors ${focusRing} ${
            isDeleting
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-red-500 text-white hover:bg-red-600"
          }`}
          data-testid={`delete-button-${workUnit.id}`}
        >
          {isDeleting ? "Confirm Delete?" : "Delete"}
        </button>
        {isDeleting && (
          <button
            onClick={() => setIsDeleting(false)}
            aria-label={`Cancel delete of ${workUnit.title}`}
            className={`px-2 py-1.5 text-xs font-instrument font-semibold bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors ${focusRing}`}
            data-testid={`cancel-delete-button-${workUnit.id}`}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
