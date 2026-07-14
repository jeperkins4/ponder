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
    alreadyImported: false,
  },
  {
    jiraKey: "ALPHA-2",
    jiraId: "10002",
    summary: "Second story",
    description: null,
    jiraStatus: "Code Revew",
    targetColumn: "code_review",
    alreadyImported: false,
  },
];

function mockFetchSequence({
  preview,
  process,
  epics,
}: {
  preview: { ok: boolean; body: unknown };
  process?: { ok: boolean; body: unknown };
  epics?: { ok: boolean; body: unknown };
}) {
  return vi.fn((url: string, init?: RequestInit) => {
    void init;
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
    if (url.endsWith("/jira/epics")) {
      return Promise.resolve({
        ok: epics?.ok ?? true,
        json: () => Promise.resolve(epics?.body ?? { epics: [] }),
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

  it("forwards each story's jiraStatusCategory in the posted items", async () => {
    const categoryStories = [
      {
        jiraKey: "CAT-1",
        jiraId: "20001",
        summary: "Blocked story",
        description: null,
        jiraStatus: "Blocked",
        jiraStatusCategory: "indeterminate",
        targetColumn: "in_progress",
        alreadyImported: false,
      },
      {
        jiraKey: "CAT-2",
        jiraId: "20002",
        summary: "No category story",
        description: null,
        jiraStatus: "To Do",
        targetColumn: "todo",
        alreadyImported: false,
      },
    ];

    const fetchMock = mockFetchSequence({
      preview: { ok: true, body: { stories: categoryStories } },
      process: { ok: true, body: { storiesProcessed: 2, workUnitsCreated: 2 } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <ImportReview projectId="p1" onClose={onClose} onImported={onImported} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-review-checkbox-CAT-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => {
      expect(onImported).toHaveBeenCalled();
    });

    const processCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import/process")
    );
    expect(processCall).toBeDefined();
    const [, requestInit] = processCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);

    expect(body.items).toEqual([
      {
        jiraKey: "CAT-1",
        jiraId: "20001",
        summary: "Blocked story",
        description: null,
        jiraStatus: "Blocked",
        jiraStatusCategory: "indeterminate",
        breakDown: false,
      },
      {
        jiraKey: "CAT-2",
        jiraId: "20002",
        summary: "No category story",
        description: null,
        jiraStatus: "To Do",
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

  const dedupStories = [
    { ...previewStories[0], alreadyImported: false },
    {
      jiraKey: "ALPHA-3",
      jiraId: "10003",
      summary: "Already imported story",
      description: null,
      jiraStatus: "To Do",
      targetColumn: "todo",
      alreadyImported: true,
    },
  ];

  it("shows an Already on board badge and Import anyway checkbox on flagged rows only", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: dedupStories } },
    }) as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() =>
      expect(screen.getByTestId("import-review-row-ALPHA-3")).toBeInTheDocument()
    );

    expect(screen.getByTestId("import-review-already-imported-badge-ALPHA-3")).toHaveTextContent(
      "Already on board"
    );
    expect(screen.getByTestId("import-review-import-anyway-ALPHA-3")).not.toBeChecked();
    expect(
      screen.queryByTestId("import-review-already-imported-badge-ALPHA-1")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("import-review-import-anyway-ALPHA-1")
    ).not.toBeInTheDocument();
  });

  it("excludes flagged rows from processing unless Import anyway is checked", async () => {
    const fetchMock = mockFetchSequence({
      preview: { ok: true, body: { stories: dedupStories } },
      process: {
        ok: true,
        body: { storiesProcessed: 1, storiesSkipped: 0, workUnitsCreated: 1 },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() =>
      expect(screen.getByTestId("import-review-process-button")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => expect(onImported).toHaveBeenCalled());

    const processCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import/process")
    );
    const sentItems = JSON.parse(String(processCall![1]!.body)).items;
    expect(sentItems.map((i: { jiraKey: string }) => i.jiraKey)).toEqual(["ALPHA-1"]);
  });

  it("includes a flagged row after Import anyway is checked", async () => {
    const fetchMock = mockFetchSequence({
      preview: { ok: true, body: { stories: dedupStories } },
      process: {
        ok: true,
        body: { storiesProcessed: 1, storiesSkipped: 1, workUnitsCreated: 1 },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() =>
      expect(screen.getByTestId("import-review-import-anyway-ALPHA-3")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("import-review-import-anyway-ALPHA-3"));
    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => expect(onImported).toHaveBeenCalled());

    const processCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import/process")
    );
    const sentItems = JSON.parse(String(processCall![1]!.body)).items;
    expect(sentItems.map((i: { jiraKey: string }) => i.jiraKey)).toEqual([
      "ALPHA-1",
      "ALPHA-3",
    ]);
  });

  it("passes the process result counts to onImported", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: dedupStories } },
      process: {
        ok: true,
        body: { storiesProcessed: 1, storiesSkipped: 0, workUnitsCreated: 3 },
      },
    }) as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() =>
      expect(screen.getByTestId("import-review-process-button")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith({
        storiesProcessed: 1,
        storiesSkipped: 0,
        workUnitsCreated: 3,
      })
    );
  });

  it("does not render an epic dropdown when no epics are returned", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: previewStories } },
    }) as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() => {
      expect(screen.getByText("Import 2 stories")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("import-review-epic-select")).not.toBeInTheDocument();
  });

  it("renders an epic dropdown with 'All epics' plus the fetched epics", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: previewStories } },
      epics: {
        ok: true,
        body: { epics: [{ key: "ALPHA-100", name: "Big epic" }] },
      },
    }) as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() => {
      expect(screen.getByTestId("import-review-epic-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("import-review-epic-select") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["All epics", "Big epic (ALPHA-100)"]);
  });

  it("re-fetches the preview with the selected epicKey and includes it when processing", async () => {
    const fetchMock = mockFetchSequence({
      preview: { ok: true, body: { stories: previewStories } },
      process: { ok: true, body: { storiesProcessed: 2, workUnitsCreated: 2 } },
      epics: {
        ok: true,
        body: { epics: [{ key: "ALPHA-100", name: "Big epic" }] },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() => {
      expect(screen.getByTestId("import-review-epic-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("import-review-epic-select"), {
      target: { value: "ALPHA-100" },
    });

    await waitFor(() => {
      const previewCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/import/preview")
      );
      expect(previewCalls).toHaveLength(2);
    });

    const previewCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/import/preview")
    );
    const secondCallBody = JSON.parse(
      String((previewCalls[1][1] as RequestInit).body)
    );
    expect(secondCallBody).toEqual({ epicKey: "ALPHA-100" });

    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => expect(onImported).toHaveBeenCalled());

    const processCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import/process")
    );
    const processBody = JSON.parse(String((processCall![1] as RequestInit).body));
    expect(processBody.epicKey).toBe("ALPHA-100");
    expect(processBody.epicName).toBe("Big epic");
  });

  it("omits epicKey/epicName when 'All epics' is selected", async () => {
    const fetchMock = mockFetchSequence({
      preview: { ok: true, body: { stories: previewStories } },
      process: { ok: true, body: { storiesProcessed: 2, workUnitsCreated: 2 } },
      epics: {
        ok: true,
        body: { epics: [{ key: "ALPHA-100", name: "Big epic" }] },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() => {
      expect(screen.getByTestId("import-review-process-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => expect(onImported).toHaveBeenCalled());

    const processCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import/process")
    );
    const processBody = JSON.parse(String((processCall![1] as RequestInit).body));
    expect(processBody.epicKey).toBeUndefined();
    expect(processBody.epicName).toBeUndefined();
  });
});
