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
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/p1",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const putCall = mockFetch.mock.calls.find(
      (call) => call[0] === "/api/projects/p1" && call[1]?.method === "PUT"
    );
    expect(JSON.parse(putCall![1].body as string)).toEqual({
      name: "Renamed Project",
      jiraProjectKey: "RENAMED",
      jiraSiteUrl: "",
      jiraEmail: "",
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
    expect(screen.getByLabelText(/Site URL/i)).toBe(
      screen.getByTestId("jira-site-url-input")
    );
    expect(screen.getByLabelText(/^Email/i)).toBe(
      screen.getByTestId("jira-email-input")
    );
    expect(screen.getByLabelText(/API token/i)).toBe(
      screen.getByTestId("jira-api-token-input")
    );
  });

  it("shows and pre-fills the JIRA connection fields for JIRA projects, but never the API token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p1",
        name: "Team Project",
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "user@example.com",
        hasApiToken: true,
      }),
    });

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("jira-site-url-input")).toHaveValue(
        "https://example.atlassian.net"
      );
    });
    expect(screen.getByTestId("jira-email-input")).toHaveValue(
      "user@example.com"
    );
    expect(screen.getByTestId("jira-api-token-input")).toHaveValue("");
    expect(screen.getByTestId("jira-api-token-input")).toHaveAttribute(
      "type",
      "password"
    );
    expect(screen.getByTestId("jira-api-token-input")).toHaveAttribute(
      "placeholder",
      "•••••••• (saved — leave blank to keep)"
    );

    const link = screen.getByRole("link", { name: /id\.atlassian\.com/i });
    expect(link).toHaveAttribute(
      "href",
      "https://id.atlassian.com/manage-profile/security/api-tokens"
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows a different API token placeholder when no token is stored yet", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p1",
        name: "Team Project",
        type: "JIRA",
        jiraProjectKey: "TEAM",
        hasApiToken: false,
      }),
    });

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("jira-api-token-input")).toHaveAttribute(
        "placeholder",
        "Paste your Atlassian API token"
      );
    });
  });

  it("does not show JIRA connection fields for standalone projects", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p1",
        name: "Standalone Project",
        type: "STANDALONE",
        jiraProjectKey: null,
      }),
    });

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("project-name-input")).toHaveValue(
        "Standalone Project"
      );
    });

    expect(
      screen.queryByTestId("jira-connection-section")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("jira-site-url-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("jira-email-input")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("jira-api-token-input")
    ).not.toBeInTheDocument();
  });

  it("includes jiraApiToken in the PUT body only when the user typed one", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "p1",
          name: "Team Project",
          type: "JIRA",
          jiraProjectKey: "TEAM",
          jiraSiteUrl: "https://example.atlassian.net",
          jiraEmail: "user@example.com",
          hasApiToken: true,
        }),
      })
    );
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
    global.fetch = mockFetch;

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("jira-site-url-input")).toHaveValue(
        "https://example.atlassian.net"
      );
    });

    fireEvent.click(screen.getByTestId("save-project-submit"));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (call) => call[1]?.method === "PUT"
      );
      expect(putCall).toBeDefined();
      const parsedBody = JSON.parse(putCall![1].body as string);
      expect(parsedBody.jiraApiToken).toBeUndefined();
    });
  });

  it("includes jiraApiToken when the user types a new token", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "p1",
          name: "Team Project",
          type: "JIRA",
          jiraProjectKey: "TEAM",
          hasApiToken: true,
        }),
      })
    );
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ id: "p1" }),
      })
    );
    global.fetch = mockFetch;

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("jira-api-token-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("jira-api-token-input"), {
      target: { value: "new-secret-token" },
    });

    fireEvent.click(screen.getByTestId("save-project-submit"));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (call) => call[1]?.method === "PUT"
      );
      expect(putCall).toBeDefined();
      const parsedBody = JSON.parse(putCall![1].body as string);
      expect(parsedBody.jiraApiToken).toBe("new-secret-token");
    });
  });

  it("tests the connection and shows a success result", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "p1",
          name: "Team Project",
          type: "JIRA",
          jiraProjectKey: "TEAM",
          jiraSiteUrl: "https://example.atlassian.net",
          jiraEmail: "user@example.com",
          hasApiToken: true,
        }),
      })
    );
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, displayName: "Jane Doe" }),
      })
    );
    global.fetch = mockFetch;

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("test-connection-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("test-connection-button"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/p1/test-connection",
        expect.objectContaining({ method: "POST" })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("test-connection-result")).toHaveTextContent(
        "✓ Connected as Jane Doe"
      );
    });
  });

  it("tests the connection and shows a failure result", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "p1",
          name: "Team Project",
          type: "JIRA",
          jiraProjectKey: "TEAM",
          hasApiToken: false,
        }),
      })
    );
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          ok: false,
          error: "HTTP 401 — check email/API token",
        }),
      })
    );
    global.fetch = mockFetch;

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("test-connection-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("test-connection-button"));

    await waitFor(() => {
      expect(screen.getByTestId("test-connection-result")).toHaveTextContent(
        "✗ HTTP 401 — check email/API token"
      );
    });
  });

  it("disables the test-connection button and shows 'Testing…' while in flight", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "p1",
          name: "Team Project",
          type: "JIRA",
          jiraProjectKey: "TEAM",
          hasApiToken: true,
        }),
      })
    );

    let resolveTest: () => void;
    const testPromise = new Promise<void>((resolve) => {
      resolveTest = resolve;
    });
    mockFetch.mockImplementationOnce(() =>
      testPromise.then(() => ({
        ok: true,
        json: async () => ({ ok: true }),
      }))
    );
    global.fetch = mockFetch;

    render(<ProjectSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("test-connection-button")).toBeInTheDocument();
    });

    const testButton = screen.getByTestId("test-connection-button");
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(testButton).toBeDisabled();
      expect(testButton).toHaveTextContent("Testing…");
    });

    resolveTest!();
  });
});
