"use client";

import { KanbanBoard } from "@/components/KanbanBoard";

/**
 * Un-scoped board route: preserves the original /board behavior (loads all
 * stories across every project) by rendering KanbanBoard with no projectId.
 */
export default function Board() {
  return <KanbanBoard />;
}
