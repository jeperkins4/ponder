import { render, screen, waitFor } from "@testing-library/react";
import Board from "@/app/board/page";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { StoryDTO } from "@/lib/types";

/**
 * /board is now a thin wrapper around <KanbanBoard /> (no projectId). Full
 * board behavior — columns, keyboard nav, ARIA, onboarding, edit/delete,
 * theme-awareness, empty/loading/error states — is covered by
 * src/components/KanbanBoard.test.tsx. These tests just confirm the wrapper
 * renders KanbanBoard and preserves the unscoped (all-projects) fetch.
 */
const mockStories: StoryDTO[] = [
  {
    id: "story-1",
    jiraKey: "PROJ-1",
    jiraId: "1",
    projectKey: "PROJ",
    summary: "First story",
    description: null,
    jiraStatus: "To Do",
    url: "https://jira.example.com/browse/PROJ-1",
    lastSyncedAt: "2024-01-01T00:00:00Z",
    completionCommentPostedAt: null,
    workUnits: [
      {
        id: "wu-1",
        storyId: "story-1",
        title: "Work unit 1",
        description: null,
        column: "todo",
        order: 1,
        createdAt: "2024-01-01T00:00:00Z",
        completedAt: null,
      },
    ],
  },
];

describe("Board page (/board)", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockStories),
      } as Response)
    );
    window.localStorage.clear();
  });

  it("renders the Kanban Board heading via KanbanBoard", async () => {
    render(<Board />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Kanban Board/i })).toBeInTheDocument();
    });
  });

  it("fetches all stories (unscoped) since no projectId is passed", async () => {
    render(<Board />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/stories");
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("handles the loading state", () => {
    global.fetch = vi.fn(
      () => new Promise(() => {
        /* never resolves */
      })
    );

    render(<Board />);
    expect(screen.getByText(/Loading kanban board/i)).toBeInTheDocument();
  });
});
