import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ImportReview } from "./ImportReview";

const previewStories = [
  {
    jiraKey: "ALPHA-1",
    jiraId: "10001",
    summary: "First story",
    description: "First description",
    jiraStatus: "To Do",
    targetColumn: "todo",
  },
  {
    jiraKey: "ALPHA-2",
    jiraId: "10002",
    summary: "Second story",
    description: null,
    jiraStatus: "Code Revew",
    targetColumn: "code_review",
  },
];

function mockFetchSequence({
  preview,
  process,
}: {
  preview: { ok: boolean; body: unknown };
  process?: { ok: boolean; body: unknown };
}) {
  return vi.fn((url: string) => {
    if (url.endsWith("/import/preview")) {
      return Promise.resolve({
        ok: preview.ok,
        json: () => Promise.resolve(preview.body),
      } as Response);
    }
    if (url.endsWith("/import/process")) {
      return Promise.resolve({
        ok: process?.ok ?? true,
        json: () => Promise.resolve(process?.body ?? {}),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  });
}

describe("ImportReview", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onImported: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    onImported = vi.fn();
  });

  it("shows a loading state while fetching the preview", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    render(
      <ImportReview projectId="p1" onClose={onClose} onImported={onImported} />
    );

    expect(screen.getByTestId("import-review-loading")).toHaveTextContent(
      "Loading stories from JIRA…"
    );
  });

  it("renders one row per story with the target-column badge and an unchecked breakdown checkbox", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: previewStories } },
    }) as unknown as typeof fetch;

    render(
      <ImportReview projectId="p1" onClose={onClose} onImported={onImported} />
    );

    await waitFor(() => {
      expect(screen.getByText("Import 2 stories")).toBeInTheDocument();
    });

    expect(screen.getByTestId("import-review-row-ALPHA-1")).toHaveTextContent(
      "First story"
    );
    expect(screen.getByTestId("import-review-badge-ALPHA-1")).toHaveTextContent(
      "To Do"
    );
    expect(screen.getByTestId("import-review-checkbox-ALPHA-1")).not.toBeChecked();

    expect(screen.getByTestId("import-review-row-ALPHA-2")).toHaveTextContent(
      "Second story"
    );
    expect(screen.getByTestId("import-review-badge-ALPHA-2")).toHaveTextContent(
      "Code Review"
    );
    expect(screen.getByTestId("import-review-checkbox-ALPHA-2")).not.toBeChecked();

    // Labelled checkboxes.
    expect(
      screen.getAllByLabelText("Break down into subtasks")
    ).toHaveLength(2);
  });

  it("shows the message and a Close button when the preview has no stories", async () => {
    global.fetch = mockFetchSequence({
      preview: {
        ok: true,
        body: { stories: [], message: "JIRA credentials not configured." },
      },
    }) as unknown as typeof fetch;

    render(
      <ImportReview projectId="p1" onClose={onClose} onImported={onImported} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-review-empty-message")).toHaveTextContent(
        "JIRA credentials not configured."
      );
    });

    fireEvent.click(screen.getByTestId("import-review-close-button"));
    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to a default empty message when none is provided", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: [] } },
    }) as unknown as typeof fetch;

    render(
      <ImportReview projectId="p1" onClose={onClose} onImported={onImported} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-review-empty-message")).toHaveTextContent(
        "No stories to import."
      );
    });
  });

  it("posts breakDown flags reflecting toggled checkboxes, then calls onImported and onClose", async () => {
    const fetchMock = mockFetchSequence({
      preview: { ok: true, body: { stories: previewStories } },
      process: { ok: true, body: { storiesProcessed: 2, workUnitsCreated: 2 } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <ImportReview projectId="p1" onClose={onClose} onImported={onImported} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-review-checkbox-ALPHA-1")).toBeInTheDocument();
    });

    // Toggle only the first story's breakdown checkbox on.
    fireEvent.click(screen.getByTestId("import-review-checkbox-ALPHA-1"));
    expect(screen.getByTestId("import-review-checkbox-ALPHA-1")).toBeChecked();
    expect(screen.getByTestId("import-review-checkbox-ALPHA-2")).not.toBeChecked();

    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => {
      expect(onImported).toHaveBeenCalled();
    });
    expect(onClose).toHaveBeenCalled();

    const processCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import/process")
    );
    expect(processCall).toBeDefined();
    const [, requestInit] = processCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);

    expect(body.items).toEqual([
      {
        jiraKey: "ALPHA-1",
        jiraId: "10001",
        summary: "First story",
        description: "First description",
        jiraStatus: "To Do",
        breakDown: true,
      },
      {
        jiraKey: "ALPHA-2",
        jiraId: "10002",
        summary: "Second story",
        description: null,
        jiraStatus: "Code Revew",
        breakDown: false,
      },
    ]);
  });

  it("shows an inline error and keeps the dialog open when processing fails", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: previewStories } },
      process: { ok: false, body: { error: "Claude API error" } },
    }) as unknown as typeof fetch;

    render(
      <ImportReview projectId="p1" onClose={onClose} onImported={onImported} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-review-process-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Claude API error");
    });

    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("import-review-dialog")).toBeInTheDocument();
  });

  it("closes the dialog on Escape", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: [] } },
    }) as unknown as typeof fetch;

    render(
      <ImportReview projectId="p1" onClose={onClose} onImported={onImported} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-review-empty-message")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
