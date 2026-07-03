import { describe, it, expect } from "vitest";
import {
  buildColumnOrder,
  computeReorderedColumns,
  applyColumnOrder,
} from "@/lib/dndReorder";
import { StoryDTO, WorkUnitDTO } from "@/lib/types";

function makeWorkUnit(overrides: Partial<WorkUnitDTO>): WorkUnitDTO {
  return {
    id: "wu-x",
    storyId: "story-1",
    title: "Unit",
    description: null,
    acceptanceCriteria: null,
    verification: null,
    column: "todo",
    order: 0,
    subNumber: null,
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeStory(id: string, workUnits: WorkUnitDTO[]): StoryDTO {
  return {
    id,
    jiraKey: `PROJ-${id}`,
    jiraId: id,
    projectKey: "PROJ",
    summary: "Story",
    description: null,
    jiraStatus: "To Do",
    url: `https://example.atlassian.net/browse/PROJ-${id}`,
    lastSyncedAt: "2026-01-01T00:00:00Z",
    completionCommentPostedAt: null,
    workUnits,
  };
}

describe("buildColumnOrder", () => {
  it("groups work units by column, sorted by order ascending", () => {
    const stories = [
      makeStory("1", [
        makeWorkUnit({ id: "a", column: "todo", order: 1 }),
        makeWorkUnit({ id: "b", column: "todo", order: 0 }),
        makeWorkUnit({ id: "c", column: "in_progress", order: 0 }),
      ]),
    ];

    const result = buildColumnOrder(stories);
    expect(result.todo).toEqual(["b", "a"]);
    expect(result.in_progress).toEqual(["c"]);
    expect(result.code_review).toEqual([]);
    expect(result.done).toEqual([]);
  });

  it("tiebreaks equal `order` values by id for a deterministic, stable order", () => {
    const stories = [
      makeStory("1", [
        makeWorkUnit({ id: "z", column: "todo", order: 0 }),
        makeWorkUnit({ id: "a", column: "todo", order: 0 }),
      ]),
    ];

    const result = buildColumnOrder(stories);
    expect(result.todo).toEqual(["a", "z"]);
  });

  it("flattens work units across multiple stories", () => {
    const stories = [
      makeStory("1", [makeWorkUnit({ id: "a", column: "done", order: 0 })]),
      makeStory("2", [makeWorkUnit({ id: "b", column: "done", order: 1 })]),
    ];

    const result = buildColumnOrder(stories);
    expect(result.done).toEqual(["a", "b"]);
  });
});

describe("computeReorderedColumns", () => {
  const baseOrder = {
    todo: ["a", "b", "c"],
    in_progress: ["d"],
    code_review: [] as string[],
    done: [] as string[],
  };

  it("reorders within the same column via arrayMove", () => {
    const result = computeReorderedColumns(baseOrder, "a", "c");
    expect(result.changedColumns).toEqual(["todo"]);
    expect(result.columns.todo).toEqual(["b", "c", "a"]);
    // Other columns pass through unchanged.
    expect(result.columns.in_progress).toBe(baseOrder.in_progress);
  });

  it("is a no-op when dropped on its own current position", () => {
    const result = computeReorderedColumns(baseOrder, "a", "a");
    expect(result.changedColumns).toEqual([]);
    expect(result.columns).toBe(baseOrder);
  });

  it("moves a card into another column, inserted before the drop target card", () => {
    const order = { ...baseOrder, in_progress: ["d", "e"] };
    const result = computeReorderedColumns(order, "a", "e");
    expect(result.changedColumns).toEqual(["todo", "in_progress"]);
    expect(result.columns.todo).toEqual(["b", "c"]);
    expect(result.columns.in_progress).toEqual(["d", "a", "e"]);
  });

  it("moves a card into an empty column when dropped on the column's own droppable id", () => {
    const result = computeReorderedColumns(baseOrder, "a", "code_review");
    expect(result.changedColumns).toEqual(["todo", "code_review"]);
    expect(result.columns.todo).toEqual(["b", "c"]);
    expect(result.columns.code_review).toEqual(["a"]);
  });

  it("appends to the end when dropped on a non-empty column's own droppable id (past the last card)", () => {
    const result = computeReorderedColumns(baseOrder, "a", "in_progress");
    expect(result.changedColumns).toEqual(["todo", "in_progress"]);
    expect(result.columns.in_progress).toEqual(["d", "a"]);
  });

  it("is a no-op when the active id is unknown", () => {
    const result = computeReorderedColumns(baseOrder, "ghost", "a");
    expect(result.changedColumns).toEqual([]);
  });

  it("is a no-op when the over id is unknown", () => {
    const result = computeReorderedColumns(baseOrder, "a", "ghost");
    expect(result.changedColumns).toEqual([]);
  });
});

describe("applyColumnOrder", () => {
  it("updates column and order on the affected work units, immutably", () => {
    const stories = [
      makeStory("1", [
        makeWorkUnit({ id: "a", column: "todo", order: 0 }),
        makeWorkUnit({ id: "b", column: "todo", order: 1 }),
      ]),
    ];

    const result = applyColumnOrder(stories, { done: ["b", "a"] });

    expect(result).not.toBe(stories);
    const updated = result[0].workUnits;
    expect(updated.find((w) => w.id === "b")).toMatchObject({
      column: "done",
      order: 0,
    });
    expect(updated.find((w) => w.id === "a")).toMatchObject({
      column: "done",
      order: 1,
    });
  });

  it("leaves work units not referenced by columns untouched", () => {
    const stories = [
      makeStory("1", [makeWorkUnit({ id: "a", column: "todo", order: 0 })]),
    ];

    const result = applyColumnOrder(stories, { done: [] });
    expect(result[0].workUnits[0]).toEqual(stories[0].workUnits[0]);
  });

  it("returns the same array reference when given no columns to apply", () => {
    const stories = [
      makeStory("1", [makeWorkUnit({ id: "a", column: "todo", order: 0 })]),
    ];

    const result = applyColumnOrder(stories, {});
    expect(result).toBe(stories);
  });
});
