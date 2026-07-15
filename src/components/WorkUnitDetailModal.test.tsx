import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkUnitDetailModal } from "./WorkUnitDetailModal";
import { WorkUnitDTO, WorkNoteDTO, AttachmentDTO } from "@/lib/types";

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
  archivedAt: null,
  movedToQaReportedAt: null,
  verificationRequestedAt: null,
  verifiedAt: null,
  verificationOutcome: null,
  verificationSummary: null,
};

function mockFetch({
  notes = [] as WorkNoteDTO[],
  notesOk = true,
  patchResponse,
  patchOk = true,
  postNoteResponse,
  postNoteOk = true,
  attachments = [] as AttachmentDTO[],
  attachmentsOk = true,
  uploadResponse,
  uploadOk = true,
  deleteOk = true,
}: {
  notes?: WorkNoteDTO[];
  notesOk?: boolean;
  patchResponse?: unknown;
  patchOk?: boolean;
  postNoteResponse?: unknown;
  postNoteOk?: boolean;
  attachments?: AttachmentDTO[];
  attachmentsOk?: boolean;
  uploadResponse?: unknown;
  uploadOk?: boolean;
  deleteOk?: boolean;
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
    if (url.endsWith("/attachments") && (!init || init.method === undefined)) {
      return Promise.resolve({
        ok: attachmentsOk,
        json: () =>
          Promise.resolve(attachmentsOk ? attachments : { error: "Failed to load screenshots" }),
      } as Response);
    }
    if (url.endsWith("/attachments") && init?.method === "POST") {
      return Promise.resolve({
        ok: uploadOk,
        status: uploadOk ? 201 : 400,
        json: () =>
          Promise.resolve(uploadOk ? uploadResponse : { error: "Failed to upload screenshot" }),
      } as Response);
    }
    if (url.startsWith("/api/attachments/") && init?.method === "DELETE") {
      return Promise.resolve({
        ok: deleteOk,
        json: () =>
          Promise.resolve(deleteOk ? { ok: true } : { error: "Failed to delete screenshot" }),
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
      archivedAt: null,
      movedToQaReportedAt: null,
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

  it("shows the verification result when the work unit has been verified", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;
    const verifiedUnit: WorkUnitDTO = {
      ...baseWorkUnit,
      verifiedAt: "2026-07-04T12:00:00Z",
      verificationOutcome: "passed",
      verificationSummary: "Confirmed the fix resolves the bug.",
    };
    render(
      <WorkUnitDetailModal
        workUnit={verifiedUnit}
        isOpen={true}
        onClose={() => {}}
      />
    );

    const result = screen.getByTestId("work-unit-detail-verification-result");
    expect(result).toHaveTextContent(/passed/i);
    expect(result).toHaveTextContent("Confirmed the fix resolves the bug.");

    await waitFor(() => {
      expect(screen.getByTestId("work-unit-detail-notes-empty")).toBeInTheDocument();
    });
  });

  it("omits the verification result section when never verified", async () => {
    global.fetch = mockFetch({ notes: [] }) as unknown as typeof fetch;

    render(
      <WorkUnitDetailModal
        workUnit={baseWorkUnit}
        isOpen={true}
        onClose={() => {}}
      />
    );

    expect(screen.queryByTestId("work-unit-detail-verification-result")).not.toBeInTheDocument();

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

    expect(fetchMock).toHaveBeenCalledTimes(2); // only the initial notes + attachments GETs
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

  describe("screenshots", () => {
    it("fetches and renders existing attachments as thumbnails on open", async () => {
      const attachments: AttachmentDTO[] = [
        {
          id: "a1",
          workUnitId: "wu-1",
          filename: "shot.png",
          mimeType: "image/png",
          size: 1234,
          createdAt: "2026-01-01T00:00:00Z",
          jiraUploadedAt: null,
          url: "/api/attachments/a1",
        },
      ];
      global.fetch = mockFetch({ attachments }) as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      const img = await screen.findByAltText("shot.png");
      expect(img).toHaveAttribute("src", "/api/attachments/a1");
    });

    it("renders a video attachment as a playable <video> element", async () => {
      const attachments: AttachmentDTO[] = [
        {
          id: "v1",
          workUnitId: "wu-1",
          filename: "test-run.mp4",
          mimeType: "video/mp4",
          size: 5678,
          createdAt: "2026-01-01T00:00:00Z",
          jiraUploadedAt: null,
          url: "/api/attachments/v1",
        },
      ];
      global.fetch = mockFetch({ attachments }) as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      const video = await screen.findByTestId("work-unit-detail-attachment-video-v1");
      expect(video.tagName).toBe("VIDEO");
      expect(video).toHaveAttribute("src", "/api/attachments/v1");
      expect(video).toHaveAttribute("controls");
      expect(video).toHaveAttribute("aria-label", "Play recording test-run.mp4");
    });

    it("rejects a non-media file client-side with a clear message", async () => {
      global.fetch = mockFetch({ attachments: [] }) as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await screen.findByTestId("work-unit-detail-attachments-empty");

      const input = screen.getByTestId("work-unit-detail-attachment-input");
      const pdf = new File(["%PDF"], "report.pdf", { type: "application/pdf" });
      fireEvent.change(input, { target: { files: [pdf] } });

      await waitFor(() => {
        expect(
          screen.getByTestId("work-unit-detail-attachments-upload-error")
        ).toHaveTextContent("Only image and video files can be attached");
      });
    });

    it("shows an empty state when there are no attachments", async () => {
      global.fetch = mockFetch({ attachments: [] }) as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-empty")).toHaveTextContent(
          "No attachments yet"
        );
      });
    });

    it("uploads a file selected via the file picker and shows the new thumbnail", async () => {
      const created: AttachmentDTO = {
        id: "a2",
        workUnitId: "wu-1",
        filename: "picked.png",
        mimeType: "image/png",
        size: 42,
        createdAt: "2026-01-02T00:00:00Z",
        jiraUploadedAt: null,
        url: "/api/attachments/a2",
      };
      const fetchMock = mockFetch({ attachments: [], uploadResponse: created });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-empty")).toBeInTheDocument();
      });

      const file = new File(["binary"], "picked.png", { type: "image/png" });
      const input = screen.getByTestId("work-unit-detail-attachment-input");
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByAltText("picked.png")).toBeInTheDocument();
      });

      const uploadCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/attachments") && init?.method === "POST"
      );
      expect(uploadCall).toBeDefined();
      expect(uploadCall![0]).toBe(`/api/work-units/${baseWorkUnit.id}/attachments`);
      const formData = uploadCall![1]?.body as FormData;
      expect(formData.get("file")).toBe(file);
    });

    it("uploads an image pasted from the clipboard", async () => {
      const created: AttachmentDTO = {
        id: "a3",
        workUnitId: "wu-1",
        filename: "clipboard.png",
        mimeType: "image/png",
        size: 42,
        createdAt: "2026-01-03T00:00:00Z",
        jiraUploadedAt: null,
        url: "/api/attachments/a3",
      };
      const fetchMock = mockFetch({ attachments: [], uploadResponse: created });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-empty")).toBeInTheDocument();
      });

      const file = new File(["binary"], "clipboard.png", { type: "image/png" });
      const clipboardData = {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      };
      fireEvent.paste(screen.getByTestId("work-unit-detail-dialog"), { clipboardData });

      await waitFor(() => {
        expect(screen.getByAltText("clipboard.png")).toBeInTheDocument();
      });

      const uploadCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/attachments") && init?.method === "POST"
      );
      expect(uploadCall).toBeDefined();
    });

    it("does not upload when pasted clipboard data has no image items", async () => {
      const fetchMock = mockFetch({ attachments: [] });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-empty")).toBeInTheDocument();
      });
      const callCountBefore = fetchMock.mock.calls.length;

      const clipboardData = {
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      };
      fireEvent.paste(screen.getByTestId("work-unit-detail-dialog"), { clipboardData });

      // No new fetch calls beyond the initial GETs.
      expect(fetchMock.mock.calls.length).toBe(callCountBefore);
    });

    it("does not upload when a non-image file is selected via the file picker", async () => {
      const fetchMock = mockFetch({ attachments: [] });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-empty")).toBeInTheDocument();
      });
      const callCountBefore = fetchMock.mock.calls.length;

      const file = new File(["text"], "notes.txt", { type: "text/plain" });
      const input = screen.getByTestId("work-unit-detail-attachment-input");
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-upload-error")).toBeInTheDocument();
      });
      expect(fetchMock.mock.calls.length).toBe(callCountBefore);
    });

    it("does not upload when a non-image file is dropped", async () => {
      const fetchMock = mockFetch({ attachments: [] });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-empty")).toBeInTheDocument();
      });
      const callCountBefore = fetchMock.mock.calls.length;

      const file = new File(["text"], "notes.txt", { type: "text/plain" });
      const dropzone = screen.getByTestId("work-unit-detail-attachments-dropzone");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-upload-error")).toBeInTheDocument();
      });
      expect(fetchMock.mock.calls.length).toBe(callCountBefore);
    });

    it("uploads a dropped image file", async () => {
      const created: AttachmentDTO = {
        id: "a4",
        workUnitId: "wu-1",
        filename: "dropped.png",
        mimeType: "image/png",
        size: 42,
        createdAt: "2026-01-04T00:00:00Z",
        jiraUploadedAt: null,
        url: "/api/attachments/a4",
      };
      const fetchMock = mockFetch({ attachments: [], uploadResponse: created });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-attachments-empty")).toBeInTheDocument();
      });

      const file = new File(["binary"], "dropped.png", { type: "image/png" });
      const dropzone = screen.getByTestId("work-unit-detail-attachments-dropzone");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByAltText("dropped.png")).toBeInTheDocument();
      });
    });

    it("deletes an attachment and removes its thumbnail", async () => {
      const attachments: AttachmentDTO[] = [
        {
          id: "a5",
          workUnitId: "wu-1",
          filename: "removeme.png",
          mimeType: "image/png",
          size: 42,
          createdAt: "2026-01-05T00:00:00Z",
          jiraUploadedAt: null,
          url: "/api/attachments/a5",
        },
      ];
      const fetchMock = mockFetch({ attachments });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<WorkUnitDetailModal workUnit={baseWorkUnit} isOpen={true} onClose={vi.fn()} />);

      await screen.findByAltText("removeme.png");

      fireEvent.click(screen.getByTestId("work-unit-detail-attachment-delete-a5"));

      await waitFor(() => {
        expect(screen.queryByAltText("removeme.png")).not.toBeInTheDocument();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/attachments/a5",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("Regenerate acceptance criteria", () => {
    it("POSTs to the generate endpoint and updates the displayed AC/verification", async () => {
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith("/generate-acceptance-criteria") && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                acceptanceCriteria: "Freshly generated AC",
                verification: "Freshly generated verification",
              }),
          } as Response);
        }
        // notes + attachments load as empty on open
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const onUpdated = vi.fn();
      const unit = { ...baseWorkUnit, acceptanceCriteria: null, verification: null };
      render(
        <WorkUnitDetailModal workUnit={unit} isOpen={true} onClose={vi.fn()} onUpdated={onUpdated} />
      );

      // starts as "None yet"
      expect(screen.getByTestId("work-unit-detail-ac")).toHaveTextContent("None yet");

      fireEvent.click(screen.getByTestId("work-unit-detail-regenerate-button"));

      await waitFor(() => {
        expect(screen.getByTestId("work-unit-detail-ac")).toHaveTextContent(
          "Freshly generated AC"
        );
      });
      expect(screen.getByTestId("work-unit-detail-verification")).toHaveTextContent(
        "Freshly generated verification"
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/work-units/${unit.id}/generate-acceptance-criteria`,
        expect.objectContaining({ method: "POST" })
      );
      expect(onUpdated).toHaveBeenCalled();
    });
  });
});
