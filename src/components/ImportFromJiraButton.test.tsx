import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ImportFromJiraButton } from "./ImportFromJiraButton";

describe("ImportFromJiraButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stories: [] }),
      } as Response)
    );
  });

  it("renders the button", () => {
    render(<ImportFromJiraButton projectId="p1" />);
    expect(screen.getByTestId("import-from-jira-button")).toHaveTextContent(
      "Import from JIRA"
    );
  });

  it("opens the import review dialog and triggers a preview fetch on click", async () => {
    render(<ImportFromJiraButton projectId="p1" />);

    expect(screen.queryByTestId("import-review-dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("import-from-jira-button"));

    expect(screen.getByTestId("import-review-dialog")).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/p1/import/preview",
        { method: "POST" }
      );
    });
  });

  it("closes the review dialog when its Close button is clicked", async () => {
    render(<ImportFromJiraButton projectId="p1" />);

    fireEvent.click(screen.getByTestId("import-from-jira-button"));
    expect(screen.getByTestId("import-review-dialog")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("import-review-empty-message")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("import-review-close-button"));

    expect(screen.queryByTestId("import-review-dialog")).not.toBeInTheDocument();
  });

  it("forwards import result counts on the completion event", async () => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).endsWith("/import/preview")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stories: [
                {
                  jiraKey: "FWD-1",
                  jiraId: "20001",
                  summary: "Forwarded story",
                  description: null,
                  jiraStatus: "To Do",
                  targetColumn: "todo",
                  alreadyImported: false,
                },
              ],
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            storiesProcessed: 2,
            storiesSkipped: 1,
            workUnitsCreated: 4,
          }),
      } as Response);
    }) as unknown as typeof fetch;

    const listener = vi.fn();
    window.addEventListener("ponder-jira-import-complete", listener);
    try {
      render(<ImportFromJiraButton projectId="p1" />);
      fireEvent.click(screen.getByTestId("import-from-jira-button"));

      await waitFor(() =>
        expect(screen.getByTestId("import-review-process-button")).toBeInTheDocument()
      );
      fireEvent.click(screen.getByTestId("import-review-process-button"));

      await waitFor(() => expect(listener).toHaveBeenCalled());
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({
        storiesProcessed: 2,
        storiesSkipped: 1,
        workUnitsCreated: 4,
      });
    } finally {
      window.removeEventListener("ponder-jira-import-complete", listener);
    }
  });

  describe("Theme awareness", () => {
    it("applies the light-mode purple background by default", () => {
      render(<ImportFromJiraButton projectId="p1" />);
      expect(screen.getByTestId("import-from-jira-button")).toHaveClass(
        "bg-ponder-light-purple"
      );
    });

    it("applies the dark-mode purple background when ponderTheme is dark", async () => {
      window.localStorage.setItem("ponderTheme", "dark");

      render(<ImportFromJiraButton projectId="p1" />);

      await waitFor(() => {
        expect(screen.getByTestId("import-from-jira-button")).toHaveClass(
          "bg-ponder-dark-purple"
        );
      });
    });
  });
});
