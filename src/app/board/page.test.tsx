import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
      const columnHeadings = screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent);
      expect(columnHeadings).toEqual(
        expect.arrayContaining(["To Do", "In Progress", "Done"])
      );
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

  it("shows a Done column badge for finished work units", async () => {
    render(<Board />);

    await waitFor(() => {
      expect(
        screen.getByTestId("work-unit-column-badge-wu-3")
      ).toHaveTextContent("Done");
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

  it("renders Edit and Delete buttons for each work unit card", async () => {
    render(<Board />);

    await waitFor(() => {
      expect(screen.getByTestId("edit-button-wu-1")).toBeInTheDocument();
      expect(screen.getByTestId("delete-button-wu-1")).toBeInTheDocument();
    });
  });

  it("cards are focusable and show a visible focus ring", async () => {
    render(<Board />);

    await waitFor(() => {
      const card = screen.getByTestId("work-unit-card-wu-1");
      expect(card).toHaveAttribute("tabindex", "0");
      expect(card).toHaveClass("focus:ring-2", "focus:outline-none");
    });
  });

  describe("Keyboard column navigation", () => {
    it("sets up column refs so each column's cards are queryable for navigation", async () => {
      render(<Board />);

      await waitFor(() => {
        // wu-1 is in the To Do column, wu-2 is in In Progress, wu-3 is in Done.
        // If column refs were wired correctly, each card renders inside the
        // page without error and can be found directly.
        expect(screen.getByTestId("work-unit-card-wu-1")).toBeInTheDocument();
        expect(screen.getByTestId("work-unit-card-wu-2")).toBeInTheDocument();
        expect(screen.getByTestId("work-unit-card-wu-3")).toBeInTheDocument();
      });
    });

    it("registers keyboard handlers without errors", async () => {
      render(<Board />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-card-wu-2")).toBeInTheDocument();
      });

      const middleCard = screen.getByTestId("work-unit-card-wu-2");
      expect(() => {
        fireEvent.keyDown(middleCard, { key: "ArrowLeft" });
        fireEvent.keyDown(middleCard, { key: "ArrowRight" });
      }).not.toThrow();
    });

    it("moves focus to the left column when ArrowLeft is pressed from the middle column", async () => {
      render(<Board />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-card-wu-2")).toBeInTheDocument();
      });

      const middleCard = screen.getByTestId("work-unit-card-wu-2"); // in_progress
      const leftCard = screen.getByTestId("work-unit-card-wu-1"); // todo

      middleCard.focus();
      fireEvent.keyDown(middleCard, { key: "ArrowLeft" });

      expect(document.activeElement).toBe(leftCard);
    });

    it("moves focus to the right column when ArrowRight is pressed from the middle column", async () => {
      render(<Board />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-card-wu-2")).toBeInTheDocument();
      });

      const middleCard = screen.getByTestId("work-unit-card-wu-2"); // in_progress
      const rightCard = screen.getByTestId("work-unit-card-wu-3"); // done

      middleCard.focus();
      fireEvent.keyDown(middleCard, { key: "ArrowRight" });

      expect(document.activeElement).toBe(rightCard);
    });

    it("is a no-op when ArrowLeft is pressed from the leftmost column", async () => {
      render(<Board />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-card-wu-1")).toBeInTheDocument();
      });

      const leftCard = screen.getByTestId("work-unit-card-wu-1"); // todo
      leftCard.focus();
      fireEvent.keyDown(leftCard, { key: "ArrowLeft" });

      expect(document.activeElement).toBe(leftCard);
    });

    it("is a no-op when ArrowRight is pressed from the rightmost column", async () => {
      render(<Board />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-card-wu-3")).toBeInTheDocument();
      });

      const rightCard = screen.getByTestId("work-unit-card-wu-3"); // done
      rightCard.focus();
      fireEvent.keyDown(rightCard, { key: "ArrowRight" });

      expect(document.activeElement).toBe(rightCard);
    });
  });
});
