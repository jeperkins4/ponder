/**
 * Pure helpers for computing @dnd-kit drag results against the board's
 * per-column card ordering.
 *
 * Kept framework-free (no React, no @dnd-kit context) on purpose: KanbanBoard
 * calls these from its `onDragEnd` handler, and they're unit-testable without
 * mounting @dnd-kit's DndContext or simulating pointer geometry in jsdom.
 */

import { arrayMove } from "@dnd-kit/sortable";
import type { Column, StoryDTO } from "@/lib/types";
import { COLUMNS } from "@/lib/columns";

export type ColumnOrderMap = Record<Column, string[]>;

const COLUMN_KEYS = COLUMNS.map((c) => c.key);

/**
 * Builds each column's ordered work-unit id list from all stories, sorted by
 * `order` ascending (stable — tiebreak by id so equal/duplicate `order`
 * values still produce a deterministic, repeatable order). Mirrors how
 * `KanbanColumn` sorts cards for display.
 */
export function buildColumnOrder(stories: StoryDTO[]): ColumnOrderMap {
  const allUnits = stories.flatMap((s) => s.workUnits);
  const map = {} as ColumnOrderMap;
  for (const key of COLUMN_KEYS) {
    map[key] = allUnits
      .filter((w) => w.column === key)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((w) => w.id);
  }
  return map;
}

/** A column's own droppable id equals its column key — see `useDroppable({
 * id: column })` in KanbanColumn, which lets an empty column receive a
 * drop. Anything else must be a card id somewhere in `columnOrder`. */
function findColumnForId(
  columnOrder: ColumnOrderMap,
  id: string
): Column | undefined {
  if ((COLUMN_KEYS as string[]).includes(id)) return id as Column;
  return COLUMN_KEYS.find((col) => columnOrder[col].includes(id));
}

export interface ReorderResult {
  /** Full ColumnOrderMap with the drag applied (unaffected columns pass
   * through unchanged). */
  columns: ColumnOrderMap;
  /** Which column(s) actually changed — empty when the drag was a no-op.
   * One entry for a within-column reorder; two ([from, to]) for a
   * cross-column move. */
  changedColumns: Column[];
}

/**
 * Computes the new per-column card ordering for a completed drag, given the
 * board's current ordering and the dragged card's id (`activeId`) plus
 * whatever @dnd-kit resolved as the drop target (`overId` — either another
 * card's id, or a column's own droppable id when dropped on/into an empty
 * column). Mirrors @dnd-kit's official "multiple sortable lists" example.
 *
 * Pure and side-effect-free: callers apply `columns` to their own state and
 * persist it.
 */
export function computeReorderedColumns(
  columnOrder: ColumnOrderMap,
  activeId: string,
  overId: string
): ReorderResult {
  const noChange: ReorderResult = { columns: columnOrder, changedColumns: [] };

  const activeColumn = findColumnForId(columnOrder, activeId);
  const overColumn = findColumnForId(columnOrder, overId);
  if (!activeColumn || !overColumn) return noChange;

  if (activeColumn === overColumn) {
    const items = columnOrder[activeColumn];
    const oldIndex = items.indexOf(activeId);
    const newIndex = items.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return noChange;
    }
    return {
      columns: {
        ...columnOrder,
        [activeColumn]: arrayMove(items, oldIndex, newIndex),
      },
      changedColumns: [activeColumn],
    };
  }

  // Cross-column move: drop activeId out of its old column and into
  // overColumn, inserted just before overId (or at the end when overId *is*
  // the column itself — i.e. dropped into empty space/an empty column).
  const activeItems = columnOrder[activeColumn].filter((id) => id !== activeId);
  const overItems = columnOrder[overColumn];
  const overIndex = overItems.indexOf(overId);
  const insertAt = overIndex >= 0 ? overIndex : overItems.length;
  const newOverItems = [
    ...overItems.slice(0, insertAt),
    activeId,
    ...overItems.slice(insertAt),
  ];

  return {
    columns: {
      ...columnOrder,
      [activeColumn]: activeItems,
      [overColumn]: newOverItems,
    },
    changedColumns: [activeColumn, overColumn],
  };
}

/**
 * Applies a (possibly partial — only the affected columns need be present)
 * ColumnOrderMap back onto the nested StoryDTO[] shape the board renders
 * from, immutably updating each affected work unit's `column`/`order`.
 * Stories/work units not referenced by `columns` are returned unchanged.
 */
export function applyColumnOrder(
  stories: StoryDTO[],
  columns: Partial<ColumnOrderMap>
): StoryDTO[] {
  const updates = new Map<string, { column: Column; order: number }>();
  (Object.entries(columns) as [Column, string[]][]).forEach(([column, ids]) => {
    ids.forEach((id, index) => updates.set(id, { column, order: index }));
  });
  if (updates.size === 0) return stories;

  return stories.map((story) => ({
    ...story,
    workUnits: story.workUnits.map((wu) => {
      const update = updates.get(wu.id);
      return update ? { ...wu, ...update } : wu;
    }),
  }));
}
