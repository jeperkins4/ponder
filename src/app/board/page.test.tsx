import { render, screen, waitFor } from "@testing-library/react";
import Board from "@/app/board/page";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { StoryDTO } from "@/lib/types";

// Mock data
const mockStories: StoryDTO[] = [
  {
    id: "story-1",
    jiraKey: "PROJ-1",
    jiraId: "1",
    projectKey: "PROJ",
    summary: "First story",
    description: "Description of first story",
    jiraStatus: "To Do",
    url: "https://jira.example.com/browse/PROJ-1",
    lastSyncedAt: "2024-01-01T00:00:00Z",
    completionCommentPostedAt: null,
    workUnits: [
      {
        id: "wu-1",
        storyId: "story-1",
        title: "Work unit 1",
        description: "Work unit description",
        column: "todo",
        order: 1,
        createdAt: "2024-01-01T00:00:00Z",
        completedAt: null,
      },
      {
        id: "wu-2",
        storyId: "story-1",
        title: "Work unit 2",
        description: null,
        column: "in_progress",
        order: 2,
        createdAt: "2024-01-01T00:00:00Z",
        completedAt: null,
      },
    ],
  },
  {
    id: "story-2",
    jiraKey: "PROJ-2",
    jiraId: "2",
    projectKey: "PROJ",
    summary: "Second story",
    description: null,
    jiraStatus: "Done",
    url: "https://jira.example.com/browse/PROJ-2",
    lastSyncedAt: "2024-01-02T00:00:00Z",
    completionCommentPostedAt: "2024-01-02T10:00:00Z",
    workUnits: [
      {
        id: "wu-3",
        storyId: "story-2",
        title: "Work unit 3",
        description: null,
        column: "done",
        order: 1,
        createdAt: "2024-01-02T00:00:00Z",
        completedAt: "2024-01-02T10:00:00Z",
      },
    ],
  },
];

describe("Kanban Board page", () => {
  beforeEach(() => {
    // Mock the fetch function
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockStories),
      } as Response)
    );
  });

  it("renders the board heading", async () => {
    render(<Board />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Kanban Board/i })).toBeInTheDocument();
    });
  });

  it("renders 3 columns", async () => {
    render(<Board />);
    await waitFor(() => {
      expect(screen.getByText(/To Do/i)).toBeInTheDocument();
      expect(screen.getByText(/In Progress/i)).toBeInTheDocument();
      expect(screen.getByText(/Done/i)).toBeInTheDocument();
    });
  });

  it("displays work units in correct columns", async () => {
    render(<Board />);

    await waitFor(() => {
      // Check that work units are in the right columns
      expect(screen.getByText("Work unit 1")).toBeInTheDocument();
      expect(screen.getByText("Work unit 2")).toBeInTheDocument();
      expect(screen.getByText("Work unit 3")).toBeInTheDocument();
    });

    // Verify the first work unit is associated with the story
    // The text might be split across elements, so check using a more flexible matcher
    const storyTexts = screen.getAllByText((content, element) => {
      return element?.textContent?.includes("Story:") ?? false;
    });
    expect(storyTexts.length).toBeGreaterThan(0);
  });

  it("handles loading state", () => {
    // Create a fetch that never resolves
    global.fetch = vi.fn(
      () => new Promise(() => {
        /* never resolves */
      })
    );

    render(<Board />);
    expect(screen.getByText(/Loading kanban board/i)).toBeInTheDocument();
  });

  it("handles error state", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        statusText: "Not Found",
      } as Response)
    );

    render(<Board />);

    await waitFor(() => {
      expect(screen.getByText(/Error:/i)).toBeInTheDocument();
    });
  });

  it("displays correct work unit counts per column", async () => {
    render(<Board />);

    await waitFor(() => {
      // To Do column should have 1 work unit
      const toDoColumn = screen.getAllByText(/To Do/i)[0].closest("div");
      expect(toDoColumn).toHaveTextContent("1 item");

      // In Progress column should have 1 work unit
      const inProgressColumn = screen.getAllByText(/In Progress/i)[0].closest("div");
      expect(inProgressColumn).toHaveTextContent("1 item");

      // Done column should have 1 work unit
      const doneColumn = screen.getAllByText(/Done/i)[0].closest("div");
      expect(doneColumn).toHaveTextContent("1 item");
    });
  });

  it("shows completed indicator for finished work units", async () => {
    render(<Board />);

    await waitFor(() => {
      expect(screen.getByText("✓ Completed")).toBeInTheDocument();
    });
  });

  it("displays story count on the page", async () => {
    render(<Board />);

    await waitFor(() => {
      expect(screen.getByText(/2 stories/i)).toBeInTheDocument();
    });
  });

  it("fetches stories from API on mount", async () => {
    render(<Board />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/stories");
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
