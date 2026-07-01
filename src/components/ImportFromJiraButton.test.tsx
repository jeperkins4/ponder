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
