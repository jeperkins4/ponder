import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPush = vi.fn();
const mockUseParams = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => mockUseParams(),
}));

import ProjectSettingsPage from "./page";

describe("ProjectSettingsPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockUseParams.mockReturnValue({ projectId: "p1" });
  });

  it("shows a loading state before the project is fetched", () => {
    global.fetch = vi.fn(() => new Promise(() => {}));

    render(<ProjectSettingsPage />);

    expect(screen.getByTestId("settings-loading")).toBeInTheDocument();
  });

  it("fetches the project on mount and pre-fills the name field", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p1",
        name: "Existing Project",
        type: "STANDALONE",
        jiraProjectKey: null,
      }),
    });
    global.fetch = mockFetch;

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1");
    });

    await waitFor(() => {
      expect(screen.getByTestId("project-name-input")).toHaveValue(
        "Existing Project"
      );
    });

    expect(
      screen.queryByTestId("jira-project-key-input")
    ).not.toBeInTheDocument();
  });

  it("shows and pre-fills the JIRA key field for JIRA projects", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p1",
        name: "Team Project",
        type: "JIRA",
        jiraProjectKey: "TEAM",
      }),
    });

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("jira-project-key-input")).toHaveValue(
        "TEAM"
      );
    });
  });

  it("submits updated values via PUT and navigates on success", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "p1",
          name: "Team Project",
          type: "JIRA",
          jiraProjectKey: "TEAM",
        }),
      })
    );
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "p1",
          name: "Renamed Project",
          type: "JIRA",
          jiraProjectKey: "RENAMED",
        }),
      })
    );
    global.fetch = mockFetch;

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("project-name-input")).toHaveValue(
        "Team Project"
      );
    });

    fireEvent.change(screen.getByTestId("project-name-input"), {
      target: { value: "Renamed Project" },
    });
    fireEvent.change(screen.getByTestId("jira-project-key-input"), {
      target: { value: "renamed" },
    });

    fireEvent.click(screen.getByTestId("save-project-submit"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Renamed Project",
          jiraProjectKey: "RENAMED",
        }),
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/projects/p1/board");
    });
  });

  it("disables the submit button and shows 'Saving…' while saving", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "p1",
          name: "Team Project",
          type: "STANDALONE",
          jiraProjectKey: null,
        }),
      })
    );

    let resolveSave: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    mockFetch.mockImplementationOnce(() =>
      savePromise.then(() => ({
        ok: true,
        json: async () => ({ id: "p1" }),
      }))
    );
    global.fetch = mockFetch;

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("project-name-input")).toHaveValue(
        "Team Project"
      );
    });

    const submitButton = screen.getByTestId("save-project-submit");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveTextContent("Saving…");
    });

    resolveSave!();
  });

  it("ties labels to their inputs for accessibility", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p1",
        name: "Team Project",
        type: "JIRA",
        jiraProjectKey: "TEAM",
      }),
    });

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Project name/i)).toBe(
        screen.getByTestId("project-name-input")
      );
    });
    expect(screen.getByLabelText(/JIRA project key/i)).toBe(
      screen.getByTestId("jira-project-key-input")
    );
  });
});
