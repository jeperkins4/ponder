import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ImportFromJiraButton } from "./ImportFromJiraButton";

describe("ImportFromJiraButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the button", () => {
    render(<ImportFromJiraButton projectId="p1" />);
    expect(screen.getByTestId("import-from-jira-button")).toHaveTextContent(
      "Import from JIRA"
    );
  });

  it("posts to the project-scoped sync endpoint and shows the result on success", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ created: 2, updated: 1 }),
      } as Response)
    );

    render(<ImportFromJiraButton projectId="p1" />);
    fireEvent.click(screen.getByTestId("import-from-jira-button"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/projects/p1/sync", {
        method: "POST",
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/3 stories imported/i)).toBeInTheDocument();
    });
  });

  it("shows an error alert when the sync fails", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: "JIRA unreachable" }),
      } as Response)
    );

    render(<ImportFromJiraButton projectId="p1" />);
    fireEvent.click(screen.getByTestId("import-from-jira-button"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("JIRA unreachable");
    });
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
