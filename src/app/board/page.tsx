"use client";

import { useCallback, useEffect, useState } from "react";
import { StoryDTO, WorkUnitDTO, Column, COLUMNS } from "@/lib/types";
import { WorkUnitCard } from "@/components/WorkUnitCard";

export default function Board() {
  const [stories, setStories] = useState<StoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStories = useCallback(async () => {
    try {
      setLoading(true);
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

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <div className="text-center">
          <p className="text-lg text-gray-600">Loading kanban board...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <div className="text-center">
          <p className="text-lg text-red-600">Error: {error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-800">Kanban Board</h1>
        <p className="text-gray-600 mt-2">
          {stories.length} {stories.length === 1 ? "story" : "stories"}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {COLUMNS.map((column) => (
          <KanbanColumn
            key={column}
            column={column}
            stories={stories}
            onRefresh={fetchStories}
          />
        ))}
      </div>
    </main>
  );
}

interface KanbanColumnProps {
  column: Column;
  stories: StoryDTO[];
  onRefresh: () => void;
}

function KanbanColumn({ column, stories, onRefresh }: KanbanColumnProps) {
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

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="mb-4 pb-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-800">{columnLabel}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {totalWorkUnits} {totalWorkUnits === 1 ? "item" : "items"}
        </p>
      </div>

      <div className="space-y-3">
        {workUnitsInColumn.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p>No work units</p>
          </div>
        ) : (
          workUnitsInColumn.map((workUnit) => (
            <WorkUnitCard
              key={workUnit.id}
              workUnit={workUnit}
              onDelete={onRefresh}
              onUpdate={onRefresh}
            />
          ))
        )}
      </div>
    </div>
  );
}
