import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkUnitDetailModal } from "./WorkUnitDetailModal";
import { WorkUnitDTO, WorkNoteDTO } from "@/lib/types";

const baseWorkUnit: WorkUnitDTO = {
  id: "wu-1",
  storyId: "story-1",
  title: "Implement login",
  description: "Add a login form to the app",
  acceptanceCriteria: "Given a user\nWhen they submit valid credentials\nThen they are logged in",
  verification: "Run npm test",
  column: "in_progress",
  order: 0,
  subNumber: 1,
  createdAt: "2026-01-01T00:00:00Z",
  completedAt: null,
};

function mockFetch({
  notes = [] as WorkNoteDTO[],
  notesOk = true,
  patchResponse,
  patchOk = true,
  postNoteResponse,
  postNoteOk = true,
}: {
  notes?: WorkNoteDTO[];
  notesOk?: boolean;
  patchResponse?: unknown;
  patchOk?: boolean;
  postNoteResponse?: unknown;
  postNoteOk?: boolean;
} = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/notes") && (!init || init.method === undefined)) {
      return Promise.resolve({
        ok: notesOk,
        json: () => Promise.resolve(notesOk ? notes : { error: "Failed to load work notes" }),
      } as Response);
    }
    if (url.endsWith("/notes") && init?.method === "POST") {
      return Promise.resolve({
        ok: postNoteOk,
        status: postNoteOk ? 201 : 400,
        json: () =>
          Promise.resolve(postNoteOk ? postNoteResponse : { error: "Failed to add note" }),
      } as Response);
    }
    if (init?.method === "PATCH") {
      return Promise.resolve({
        ok: patchOk,
        json: () => Promise.resolve(patchOk ? patchResponse : { error: "Failed to save changes" }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  });
}

describe("WorkUnitDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    global.fetch = mockFetch() as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={false} onClose={vi.fn()} />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders title, parent key link, column badge, description, AC, and verification", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal
        workUnit={baseWorkUnit}
        storyKey="COM-540"
        storyUrl="https://acme.atlassian.net/browse/COM-540"
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(
      screen.getByRole("dialog", { name: /Implement login/i })
    ).toBeInTheDocument();

    const link = screen.getByTestId("work-unit-detail-story-key");
    expect(link).toHaveTextContent("COM-540");
    expect(link).toHaveAttribute(
      "href",
      "https://acme.atlassian.net/browse/COM-540"
    );
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("target", "_blank");

    expect(screen.getByTestId("work-unit-detail-column-badge")).toHaveTextContent(
      "In Progress"
    );
    expect(screen.getByTestId("work-unit-detail-description")).toHaveTextContent(
      "Add a login form to the app"
    );
    expect(screen.getByTestId("work-unit-detail-ac")).toHaveTextContent(
      "Given a user"
    );
    expect(screen.getByTestId("work-unit-detail-verification")).toHaveTextContent(
      "Run npm test"
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });
  });

  it("shows a plain-text key with no link when storyUrl is absent", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal
        workUnit={baseWorkUnit}
        storyKey="COM-540"
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    const key = screen.getByTestId("work-unit-detail-story-key");
    expect(key).toHaveTextContent("COM-540");
    expect(key.tagName).not.toBe("A");

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });
  });

  it('shows "None yet" when acceptanceCriteria and verification are null', async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;
    const workUnit: WorkUnitDTO = {
      ...baseWorkUnit,
      acceptanceCriteria: null,
      verification: null,
    };

    render(
      <WorkUnitDetailModal workUnit={workUnit} isOpen={true} onClose={vi.fn()} />
    );

    expect(screen.getByTestId("work-unit-detail-ac")).toHaveTextContent("None yet");
    expect(screen.getByTestId("work-unit-detail-verification")).toHaveTextContent(
      "None yet"
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });
  });

  it("shows the created date and, when set, the completed date", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;
    const workUnit: WorkUnitDTO = {
      ...baseWorkUnit,
      completedAt: "2026-01-05T00:00:00Z",
    };

    render(
      <WorkUnitDetailModal workUnit={workUnit} isOpen={true} onClose={vi.fn()} />
    );

    const dates = screen.getByTestId("work-unit-detail-dates");
    expect(dates).toHaveTextContent("Created");
    expect(dates).toHaveTextContent("Completed");

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });
  });

  it("fetches and lists notes chronologically on open", async () => {
    const notes: WorkNoteDTO[] = [
      { id: "n1", workUnitId: "wu-1", body: "First note", createdAt: "2026-01-01T00:00:00Z" },
      { id: "n2", workUnitId: "wu-1", body: "Second note", createdAt: "2026-01-02T00:00:00Z" },
    ];
    global.fetch = mockFetch({ notes }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("First note")).toBeInTheDocument();
    });

    const noteEls = screen.getAllByTestId(/^work-unit-detail-note-/);
    expect(noteEls).toHaveLength(2);
    expect(noteEls[0]).toHaveTextContent("First note");
    expect(noteEls[1]).toHaveTextContent("Second note");
  });

  it("shows an empty state when there are no notes", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toHaveTextContent(
        "No work notes yet"
      );
    });
  });

  it("shows an inline error when the notes fetch fails", async () => {
    global.fetch = mockFetch({ notesOk: false }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-error")).toBeInTheDocument();
    });
  });

  it("posts a new note and appends it to the list, clearing the input", async () => {
    const created: WorkNoteDTO = {
      id: "n3",
      workUnitId: "wu-1",
      body: "New note",
      createdAt: "2026-01-03T00:00:00Z",
    };
    global.fetch = mockFetch({ notes: [], postNoteResponse: created }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });

    const textarea = screen.getByTestId("work-unit-detail-new-note-input");
    fireEvent.change(textarea, { target: { value: "New note" } });
    fireEvent.click(screen.getByTestId("work-unit-detail-add-note-button"));

    await waitFor(() => {
      expect(screen.getByText("New note")).toBeInTheDocument();
    });
    expect(textarea).toHaveValue("");

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/work-units/${baseWorkUnit.id}/notes`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "New note" }),
      })
    );
  });

  it("does not POST when the note is empty", async () => {
    const fetchMock = mockFetch({ notes: [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });

    const addButton = screen.getByTestId("work-unit-detail-add-note-button");
    expect(addButton).toBeDisabled();
    fireEvent.click(addButton);

    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET
  });

  it("shows an inline error when posting a note fails", async () => {
    global.fetch = mockFetch({ notes: [], postNoteOk: false }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("work-unit-detail-new-note-input"), {
      target: { value: "New note" },
    });
    fireEvent.click(screen.getByTestId("work-unit-detail-add-note-button"));

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-note-error")).toBeInTheDocument();
    });
  });

  it("edits and saves acceptance criteria/verification via PATCH and calls onUpdated", async () => {
    const patched = {
      ...baseWorkUnit,
      acceptanceCriteria: "New AC",
      verification: "New verification",
    };
    global.fetch = mockFetch({ notes: [], patchResponse: patched }) as unknown as typeof fetch;
    const onUpdated = vi.fn();

    render(
      <WorkUnitDetailModal
        workUnit={baseWorkUnit}
        isOpen={true}
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("work-unit-detail-edit-button"));

    const acInput = screen.getByTestId("work-unit-detail-ac-input");
    const verInput = screen.getByTestId("work-unit-detail-verification-input");
    fireEvent.change(acInput, { target: { value: "New AC" } });
    fireEvent.change(verInput, { target: { value: "New verification" } });

    fireEvent.click(screen.getByTestId("work-unit-detail-save-button"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/work-units/${baseWorkUnit.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            acceptanceCriteria: "New AC",
            verification: "New verification",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-ac")).toHaveTextContent("New AC");
    });
    expect(screen.getByTestId("work-unit-detail-verification")).toHaveTextContent(
      "New verification"
    );
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("cancels editing without saving or calling onUpdated", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;
    const onUpdated = vi.fn();

    render(
      <WorkUnitDetailModal
        workUnit={baseWorkUnit}
        isOpen={true}
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("work-unit-detail-edit-button"));
    fireEvent.change(screen.getByTestId("work-unit-detail-ac-input"), {
      target: { value: "Changed but discarded" },
    });
    fireEvent.click(screen.getByTestId("work-unit-detail-cancel-button"));

    expect(screen.queryByTestId("work-unit-detail-ac-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("work-unit-detail-ac")).toHaveTextContent("Given a user");
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("shows an inline error when saving AC/verification fails", async () => {
    global.fetch = mockFetch({ notes: [], patchOk: false }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("work-unit-detail-edit-button"));
    fireEvent.click(screen.getByTestId("work-unit-detail-save-button"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to save changes");
    });
  });

  it("calls onClose when Escape is pressed", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;
    const onClose = vi.fn();

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={onClose} />
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });
  });

  it("calls onClose when the overlay is clicked, but not when the dialog content is clicked", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;
    const onClose = vi.fn();

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={onClose} />
    );

    fireEvent.click(screen.getByTestId("work-unit-detail-dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("work-unit-detail-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });
  });

  it("focuses the close button when it opens", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />
    );

    expect(document.activeElement).toBe(
      screen.getByTestId("work-unit-detail-close-button")
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });
  });
});
