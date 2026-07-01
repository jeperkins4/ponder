import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SyncButton from "@/app/components/SyncButton";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("SyncButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the sync button", () => {
    render(<SyncButton />);
    expect(screen.getByRole("button", { name: /Import from JIRA/i })).toBeInTheDocument();
  });

  it("calls POST /api/sync on click", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: 2, updated: 1 }),
    });
    global.fetch = mockFetch;

    render(<SyncButton />);
    const button = screen.getByRole("button", { name: /Import from JIRA/i });

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
    });
  });

  it("shows loading state while syncing", async () => {
    // Create a deferred promise to control when fetch resolves
    let resolveFetch: () => void;
    const fetchPromise = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });

    const mockFetch = vi.fn().mockImplementation(() => {
      // Wait for the deferred promise before returning
      return fetchPromise.then(() => ({
        ok: true,
        json: async () => ({ created: 1, updated: 0 }),
      }));
    });
    global.fetch = mockFetch;

    render(<SyncButton />);
    const button = screen.getByRole("button");

    // Initially, button should say "Import from JIRA"
    expect(button).toHaveTextContent("Import from JIRA");

    // Click the button
    fireEvent.click(button);

    // After click, button should be disabled and show "Importing…"
    await waitFor(() => {
      expect(button).toHaveTextContent("Importing…");
      expect(button).toBeDisabled();
    });

    // Resolve the fetch promise
    resolveFetch!();

    // After resolve, loading state should be gone and result should show
    await waitFor(() => {
      expect(button).toHaveTextContent("Import from JIRA");
      expect(button).not.toBeDisabled();
      expect(screen.getByText(/1 stories imported/i)).toBeInTheDocument();
    });
  });

  it("displays sync result", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: 5, updated: 3 }),
    });
    global.fetch = mockFetch;

    render(<SyncButton />);
    const button = screen.getByRole("button", { name: /Import from JIRA/i });

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/8 stories imported.*5 created.*3 updated/i)).toBeInTheDocument();
    });
  });

  it("displays error message on sync failure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "JIRA connection failed" }),
    });
    global.fetch = mockFetch;

    render(<SyncButton />);
    const button = screen.getByRole("button", { name: /Import from JIRA/i });

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/JIRA connection failed/i)).toBeInTheDocument();
    });
  });

  it("displays error message on fetch exception", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    global.fetch = mockFetch;

    render(<SyncButton />);
    const button = screen.getByRole("button", { name: /Import from JIRA/i });

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  it("re-enables button after sync completes", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: 0, updated: 0 }),
    });
    global.fetch = mockFetch;

    render(<SyncButton />);
    const button = screen.getByRole("button", { name: /Import from JIRA/i });

    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});
