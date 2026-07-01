import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import NewProjectPage from "./page";

describe("NewProjectPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("renders the name field and type radios", () => {
    render(<NewProjectPage />);

    expect(screen.getByTestId("project-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("project-type-standalone")).toBeInTheDocument();
    expect(screen.getByTestId("project-type-jira")).toBeInTheDocument();
  });

  it("does not show the JIRA key field by default (STANDALONE selected)", () => {
    render(<NewProjectPage />);

    expect(
      screen.queryByTestId("jira-project-key-input")
    ).not.toBeInTheDocument();
  });

  it("shows the JIRA key field only when JIRA type is selected", () => {
    render(<NewProjectPage />);

    fireEvent.click(screen.getByTestId("project-type-jira"));
    expect(screen.getByTestId("jira-project-key-input")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-type-standalone"));
    expect(
      screen.queryByTestId("jira-project-key-input")
    ).not.toBeInTheDocument();
  });

  it("uppercases the JIRA key as it is typed", () => {
    render(<NewProjectPage />);

    fireEvent.click(screen.getByTestId("project-type-jira"));
    const input = screen.getByTestId(
      "jira-project-key-input"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "team" } });

    expect(input.value).toBe("TEAM");
  });

  it("submits STANDALONE project data to /api/projects and navigates on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "p1", name: "My Project", type: "STANDALONE" }),
    });
    global.fetch = mockFetch;

    render(<NewProjectPage />);

    fireEvent.change(screen.getByTestId("project-name-input"), {
      target: { value: "My Project" },
    });
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "My Project", type: "STANDALONE" }),
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/projects/p1/board");
    });
  });

  it("submits JIRA project data including the project key", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p2",
        name: "Team Project",
        type: "JIRA",
        jiraProjectKey: "TEAM",
      }),
    });
    global.fetch = mockFetch;

    render(<NewProjectPage />);

    fireEvent.change(screen.getByTestId("project-name-input"), {
      target: { value: "Team Project" },
    });
    fireEvent.click(screen.getByTestId("project-type-jira"));
    fireEvent.change(screen.getByTestId("jira-project-key-input"), {
      target: { value: "team" },
    });
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Team Project",
          type: "JIRA",
          jiraProjectKey: "TEAM",
        }),
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/projects/p2/board");
    });
  });

  it("disables the submit button and shows 'Creating…' while loading", async () => {
    let resolveFetch: () => void;
    const fetchPromise = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const mockFetch = vi.fn().mockImplementation(() =>
      fetchPromise.then(() => ({
        ok: true,
        json: async () => ({ id: "p1" }),
      }))
    );
    global.fetch = mockFetch;

    render(<NewProjectPage />);
    fireEvent.change(screen.getByTestId("project-name-input"), {
      target: { value: "My Project" },
    });

    const submitButton = screen.getByTestId("create-project-submit");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveTextContent("Creating…");
    });

    resolveFetch!();
  });

  it("shows an error message when creation fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Missing required fields: name, type" }),
    });
    global.fetch = mockFetch;

    render(<NewProjectPage />);
    fireEvent.change(screen.getByTestId("project-name-input"), {
      target: { value: "My Project" },
    });
    fireEvent.click(screen.getByTestId("create-project-submit"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Missing required fields: name, type"
      );
    });
  });

  it("ties labels to their inputs for accessibility", () => {
    render(<NewProjectPage />);

    expect(screen.getByLabelText(/Project name/i)).toBe(
      screen.getByTestId("project-name-input")
    );
  });
});
