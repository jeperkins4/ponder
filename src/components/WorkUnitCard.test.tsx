import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkUnitCard } from "./WorkUnitCard";
import { WorkUnitDTO } from "@/lib/types";

const mockWorkUnit: WorkUnitDTO = {
  id: "test-id-123",
  storyId: "story-123",
  title: "Test Work Unit",
  description: "This is a test description",
  acceptanceCriteria: null,
  verification: null,
  column: "todo",
  order: 0,
  subNumber: null,
  createdAt: "2026-01-01T00:00:00Z",
  completedAt: null,
  archivedAt: null,
  verificationRequestedAt: null,
  verifiedAt: null,
  verificationOutcome: null,
  verificationSummary: null,
};

describe("WorkUnitCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders the title", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);
      expect(
        screen.getByTestId(`work-unit-title-${mockWorkUnit.id}`)
      ).toHaveTextContent("Test Work Unit");
    });

    it("renders the column badge", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);
      expect(
        screen.getByTestId(`work-unit-column-badge-${mockWorkUnit.id}`)
      ).toHaveTextContent("To Do");
    });

    it("renders the description", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);
      expect(screen.getByText("This is a test description")).toBeInTheDocument();
    });

    it("renders the parent JIRA key as a link when storyUrl is provided", () => {
      render(
        <WorkUnitCard
          workUnit={mockWorkUnit}
          storyKey="COM-540"
          storyUrl="https://acme.atlassian.net/browse/COM-540"
        />
      );
      const link = screen.getByTestId(`work-unit-story-key-${mockWorkUnit.id}`);
      expect(link).toHaveTextContent("COM-540");
      expect(link).toHaveAttribute(
        "href",
        "https://acme.atlassian.net/browse/COM-540"
      );
      expect(link.tagName).toBe("A");
    });

    it("renders the parent JIRA key as plain text when no storyUrl", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} storyKey="COM-540" />);
      const badge = screen.getByTestId(`work-unit-story-key-${mockWorkUnit.id}`);
      expect(badge).toHaveTextContent("COM-540");
      expect(badge.tagName).not.toBe("A");
    });

    it("omits the JIRA key badge when no storyKey is provided", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);
      expect(
        screen.queryByTestId(`work-unit-story-key-${mockWorkUnit.id}`)
      ).not.toBeInTheDocument();
    });

    it("is a @dnd-kit sortable item rather than natively draggable", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);
      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);

      // Native HTML5 DnD is gone...
      expect(card).not.toHaveAttribute("draggable");
      // ...replaced by @dnd-kit's useSortable wiring (attributes/listeners
      // spread onto the card root — see WorkUnitCard.tsx). `role`/`tabIndex`
      // are explicitly overridden back to the card's own semantics
      // (role="article", tabIndex=0) rather than dnd-kit's defaults, which
      // the "Accessibility" describe block below asserts directly.
      expect(card).toHaveAttribute("aria-roledescription", "sortable");
    });

    it("renders edit and delete buttons", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);
      expect(
        screen.getByTestId(`edit-button-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`delete-button-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
    });

    it("renders different column badge colors for different columns", () => {
      const inProgressUnit: WorkUnitDTO = {
        ...mockWorkUnit,
        column: "in_progress",
      };
      const { rerender } = render(
        <WorkUnitCard workUnit={inProgressUnit} />
      );
      expect(
        screen.getByTestId(`work-unit-column-badge-${mockWorkUnit.id}`)
      ).toHaveTextContent("In Progress");

      const doneUnit: WorkUnitDTO = { ...mockWorkUnit, column: "done" };
      rerender(<WorkUnitCard workUnit={doneUnit} />);
      expect(
        screen.getByTestId(`work-unit-column-badge-${mockWorkUnit.id}`)
      ).toHaveTextContent("Done");
    });

    it("handles null description gracefully", () => {
      const unitWithoutDescription: WorkUnitDTO = {
        ...mockWorkUnit,
        description: null,
      };
      render(
        <WorkUnitCard workUnit={unitWithoutDescription} />
      );
      expect(screen.queryByText("This is a test description")).not.toBeInTheDocument();
    });
  });

  describe("Move to QA", () => {
    const doneWorkUnit: WorkUnitDTO = { ...mockWorkUnit, column: "done" };

    it("renders the button only for a Done, JIRA-linked card", () => {
      const { rerender } = render(
        <WorkUnitCard workUnit={doneWorkUnit} storyKey="COM-1" />
      );
      expect(
        screen.getByTestId(`move-to-qa-button-${doneWorkUnit.id}`)
      ).toBeInTheDocument();

      rerender(<WorkUnitCard workUnit={mockWorkUnit} storyKey="COM-1" />);
      expect(
        screen.queryByTestId(`move-to-qa-button-${mockWorkUnit.id}`)
      ).not.toBeInTheDocument();

      rerender(<WorkUnitCard workUnit={doneWorkUnit} />);
      expect(
        screen.queryByTestId(`move-to-qa-button-${doneWorkUnit.id}`)
      ).not.toBeInTheDocument();
    });

    it("POSTs to the move-to-qa endpoint and reports success via onStatusMessage", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response);

      const onStatusMessage = vi.fn();
      render(
        <WorkUnitCard
          workUnit={doneWorkUnit}
          storyKey="COM-1"
          onStatusMessage={onStatusMessage}
        />
      );

      fireEvent.click(screen.getByTestId(`move-to-qa-button-${doneWorkUnit.id}`));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/work-units/${doneWorkUnit.id}/move-to-qa`,
          expect.objectContaining({ method: "POST" })
        );
        expect(onStatusMessage).toHaveBeenCalledWith(
          expect.stringContaining("COM-1")
        );
      });
    });

    it("alerts with the server's error message on failure, without calling onStatusMessage", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "All work units for this story must be Done before moving it to QA" }),
      } as Response);
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

      const onStatusMessage = vi.fn();
      render(
        <WorkUnitCard
          workUnit={doneWorkUnit}
          storyKey="COM-1"
          onStatusMessage={onStatusMessage}
        />
      );

      fireEvent.click(screen.getByTestId(`move-to-qa-button-${doneWorkUnit.id}`));

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.stringContaining("must be Done")
        );
      });
      expect(onStatusMessage).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });
  });

  describe("Verify", () => {
    const codeReviewUnit: WorkUnitDTO = { ...mockWorkUnit, column: "code_review" };

    it("renders an enabled Verify button only for a Code Review card with no request yet", () => {
      const { rerender } = render(<WorkUnitCard workUnit={codeReviewUnit} />);
      const button = screen.getByTestId(`verify-button-${codeReviewUnit.id}`);
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
      expect(button).toHaveTextContent("Verify");

      rerender(<WorkUnitCard workUnit={mockWorkUnit} />);
      expect(screen.queryByTestId(`verify-button-${mockWorkUnit.id}`)).not.toBeInTheDocument();
    });

    it("POSTs to request-verification and shows a disabled Verifying… button while pending", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...codeReviewUnit, verificationRequestedAt: "2026-07-04T00:00:00Z" }),
      } as Response);

      const onUpdate = vi.fn();
      render(<WorkUnitCard workUnit={codeReviewUnit} onUpdate={onUpdate} />);

      fireEvent.click(screen.getByTestId(`verify-button-${codeReviewUnit.id}`));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          `/api/work-units/${codeReviewUnit.id}/request-verification`,
          expect.objectContaining({ method: "POST" })
        );
      });
      expect(onUpdate).toHaveBeenCalled();
    });

    it("shows a disabled Verifying… button when verificationRequestedAt is already set", () => {
      const pendingUnit: WorkUnitDTO = {
        ...codeReviewUnit,
        verificationRequestedAt: "2026-07-04T00:00:00Z",
      };
      render(<WorkUnitCard workUnit={pendingUnit} />);
      const button = screen.getByTestId(`verify-button-${pendingUnit.id}`);
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Verifying…");
    });

    it("shows a green Verified badge and no button when outcome is passed", () => {
      const passedUnit: WorkUnitDTO = {
        ...codeReviewUnit,
        verifiedAt: "2026-07-04T00:00:00Z",
        verificationOutcome: "passed",
        verificationSummary: "Looks good",
      };
      render(<WorkUnitCard workUnit={passedUnit} />);
      const badge = screen.getByTestId(`verification-badge-${passedUnit.id}`);
      expect(badge).toHaveTextContent(/verified/i);
      const expectedDate = new Date(passedUnit.verifiedAt!).toLocaleDateString();
      expect(badge).toHaveTextContent(`Verified ✓ ${expectedDate}`);
      expect(screen.queryByTestId(`verify-button-${passedUnit.id}`)).not.toBeInTheDocument();
    });

    it("shows a red Verification failed badge and a re-enabled button when outcome is failed", () => {
      const failedUnit: WorkUnitDTO = {
        ...codeReviewUnit,
        verifiedAt: "2026-07-04T00:00:00Z",
        verificationOutcome: "failed",
        verificationSummary: "Still broken",
      };
      render(<WorkUnitCard workUnit={failedUnit} />);
      const badge = screen.getByTestId(`verification-badge-${failedUnit.id}`);
      expect(badge).toHaveTextContent(/verification failed/i);
      expect(badge).toHaveAttribute("title", "Still broken");
      expect(screen.getByTestId(`verify-button-${failedUnit.id}`)).not.toBeDisabled();
    });

    it("alerts with the server's error message on failure", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Work unit must be in Code Review to request verification" }),
      } as Response);
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

      render(<WorkUnitCard workUnit={codeReviewUnit} />);
      fireEvent.click(screen.getByTestId(`verify-button-${codeReviewUnit.id}`));

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.stringContaining("Code Review")
        );
      });

      alertSpy.mockRestore();
    });
  });

  describe("Delete functionality", () => {
    it("triggers DELETE request when delete button is confirmed", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const onDelete = vi.fn();
      render(
        <WorkUnitCard workUnit={mockWorkUnit} onDelete={onDelete} />
      );

      const deleteButton = screen.getByTestId(`delete-button-${mockWorkUnit.id}`);

      // First click shows confirmation
      fireEvent.click(deleteButton);
      expect(deleteButton).toHaveTextContent("Confirm Delete?");

      // Second click confirms
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          `/api/work-units/${mockWorkUnit.id}`,
          {
            method: "DELETE",
          }
        );
      });

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith(mockWorkUnit.id);
      });

      fetchSpy.mockRestore();
    });

    it("handles delete error gracefully", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const deleteButton = screen.getByTestId(`delete-button-${mockWorkUnit.id}`);
      fireEvent.click(deleteButton); // First click for confirmation
      fireEvent.click(deleteButton); // Second click to confirm delete

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith("Failed to delete work unit");
      });

      alertSpy.mockRestore();
    });

    it("shows cancel button during delete confirmation", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const deleteButton = screen.getByTestId(`delete-button-${mockWorkUnit.id}`);
      fireEvent.click(deleteButton);

      expect(
        screen.getByTestId(`cancel-delete-button-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
    });

    it("cancels delete when cancel button is clicked", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const deleteButton = screen.getByTestId(`delete-button-${mockWorkUnit.id}`);
      fireEvent.click(deleteButton); // Show confirmation

      const cancelButton = screen.getByTestId(
        `cancel-delete-button-${mockWorkUnit.id}`
      );
      fireEvent.click(cancelButton);

      expect(deleteButton).toHaveTextContent("Delete");
      expect(
        screen.queryByTestId(`cancel-delete-button-${mockWorkUnit.id}`)
      ).not.toBeInTheDocument();
    });
  });

  describe("Edit functionality", () => {
    it("switches to edit mode when edit button is clicked", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const editButton = screen.getByTestId(`edit-button-${mockWorkUnit.id}`);
      fireEvent.click(editButton);

      expect(
        screen.getByTestId("edit-title-input")
      ).toHaveValue("Test Work Unit");
      expect(
        screen.getByTestId("edit-description-input")
      ).toHaveValue("This is a test description");
      expect(screen.getByTestId("save-edit-button")).toBeInTheDocument();
      expect(screen.getByTestId("cancel-edit-button")).toBeInTheDocument();
    });

    it("cancels edit mode when cancel button is clicked", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const editButton = screen.getByTestId(`edit-button-${mockWorkUnit.id}`);
      fireEvent.click(editButton);

      const cancelButton = screen.getByTestId("cancel-edit-button");
      fireEvent.click(cancelButton);

      expect(
        screen.queryByTestId("edit-title-input")
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId(`work-unit-title-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
    });

    it("updates work unit fields when save is clicked", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockWorkUnit,
          title: "Updated Title",
          description: "Updated description",
        }),
      } as Response);

      const onUpdate = vi.fn();
      render(
        <WorkUnitCard workUnit={mockWorkUnit} onUpdate={onUpdate} />
      );

      const editButton = screen.getByTestId(`edit-button-${mockWorkUnit.id}`);
      fireEvent.click(editButton);

      const titleInput = screen.getByTestId("edit-title-input");
      const descriptionInput = screen.getByTestId("edit-description-input");

      fireEvent.change(titleInput, { target: { value: "Updated Title" } });
      fireEvent.change(descriptionInput, {
        target: { value: "Updated description" },
      });

      const saveButton = screen.getByTestId("save-edit-button");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          `/api/work-units/${mockWorkUnit.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: "Updated Title",
              description: "Updated description",
            }),
          }
        );
      });

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith(
          mockWorkUnit.id,
          expect.objectContaining({
            title: "Updated Title",
            description: "Updated description",
          })
        );
      });

      fetchSpy.mockRestore();
    });

    it("handles update error gracefully", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const editButton = screen.getByTestId(`edit-button-${mockWorkUnit.id}`);
      fireEvent.click(editButton);

      const saveButton = screen.getByTestId("save-edit-button");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith("Failed to update work unit");
      });

      alertSpy.mockRestore();
    });

    it("exits edit mode after successful update", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockWorkUnit,
          title: "Updated Title",
        }),
      } as Response);

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const editButton = screen.getByTestId(`edit-button-${mockWorkUnit.id}`);
      fireEvent.click(editButton);

      const titleInput = screen.getByTestId("edit-title-input");
      fireEvent.change(titleInput, { target: { value: "Updated Title" } });

      const saveButton = screen.getByTestId("save-edit-button");
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(
          screen.queryByTestId("edit-title-input")
        ).not.toBeInTheDocument();
      });

      expect(
        screen.getByTestId(`work-unit-title-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
    });
  });

  describe("Keyboard navigation", () => {
    it("opens the detail modal when Enter is pressed on the card", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      fireEvent.keyDown(card, { key: "Enter" });

      expect(screen.getByTestId("work-unit-detail-dialog")).toBeInTheDocument();
      expect(screen.queryByTestId("edit-title-input")).not.toBeInTheDocument();

      await screen.findByTestId("work-unit-detail-notes-empty");

      fetchSpy.mockRestore();
    });

    it("shows delete confirmation when Delete is pressed on the card", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      fireEvent.keyDown(card, { key: "Delete" });

      expect(
        screen.getByTestId(`delete-button-${mockWorkUnit.id}`)
      ).toHaveTextContent("Confirm Delete?");
    });

    it("triggers the DELETE API call when Delete is pressed a second time", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const onDelete = vi.fn();
      render(<WorkUnitCard workUnit={mockWorkUnit} onDelete={onDelete} />);

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      fireEvent.keyDown(card, { key: "Delete" }); // first press: show confirm
      fireEvent.keyDown(card, { key: "Delete" }); // second press: confirm delete

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          `/api/work-units/${mockWorkUnit.id}`,
          { method: "DELETE" }
        );
      });

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith(mockWorkUnit.id);
      });

      fetchSpy.mockRestore();
    });

    it("calls onKeyboardNavigation with 'left' when ArrowLeft is pressed", () => {
      const onKeyboardNavigation = vi.fn();
      render(
        <WorkUnitCard
          workUnit={mockWorkUnit}
          onKeyboardNavigation={onKeyboardNavigation}
        />
      );

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      fireEvent.keyDown(card, { key: "ArrowLeft" });

      expect(onKeyboardNavigation).toHaveBeenCalledWith(
        "left",
        mockWorkUnit.id
      );
    });

    it("calls onKeyboardNavigation with 'right' when ArrowRight is pressed", () => {
      const onKeyboardNavigation = vi.fn();
      render(
        <WorkUnitCard
          workUnit={mockWorkUnit}
          onKeyboardNavigation={onKeyboardNavigation}
        />
      );

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      fireEvent.keyDown(card, { key: "ArrowRight" });

      expect(onKeyboardNavigation).toHaveBeenCalledWith(
        "right",
        mockWorkUnit.id
      );
    });

    it("does not throw when arrow keys are pressed without onKeyboardNavigation provided", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      expect(() => {
        fireEvent.keyDown(card, { key: "ArrowLeft" });
        fireEvent.keyDown(card, { key: "ArrowRight" });
      }).not.toThrow();
    });

    it("moves tab focus naturally from the card to the Edit button", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      const editButton = screen.getByTestId(`edit-button-${mockWorkUnit.id}`);

      // Both elements are naturally focusable and in DOM order, so the
      // browser's default Tab order moves from the card to the Edit button
      // without any custom key handling required.
      expect(card).toHaveAttribute("tabindex", "0");
      expect(editButton.tabIndex).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Accessibility", () => {
    it("is focusable and shows a visible focus ring on the card", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      expect(card).toHaveAttribute("tabindex", "0");
      expect(card).toHaveClass(
        "focus:ring-2",
        "focus:ring-ponder-light-purple",
        "focus:outline-none"
      );
    });

    it("shows a visible focus ring on the action buttons", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      expect(
        screen.getByTestId(`edit-button-${mockWorkUnit.id}`)
      ).toHaveClass("focus:ring-2", "focus:outline-none");
      expect(
        screen.getByTestId(`delete-button-${mockWorkUnit.id}`)
      ).toHaveClass("focus:ring-2", "focus:outline-none");
    });

    it("keeps the focus ring visible on the card while in edit mode", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`edit-button-${mockWorkUnit.id}`));

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      expect(card).toHaveAttribute("tabindex", "0");
      expect(card).toHaveClass("focus:ring-2", "focus:outline-none");
    });

    it("marks the card with role=article and an aria-label describing it", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const card = screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`);
      expect(card).toHaveAttribute("role", "article");
      expect(card).toHaveAttribute(
        "aria-label",
        "Work unit: Test Work Unit, in To Do column, This is a test description"
      );
    });

    it("gives the Edit button an aria-label naming the work unit", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      expect(
        screen.getByTestId(`edit-button-${mockWorkUnit.id}`)
      ).toHaveAttribute("aria-label", "Edit work unit: Test Work Unit");
    });

    it("gives the Delete button an aria-label that changes on confirmation", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      const deleteButton = screen.getByTestId(
        `delete-button-${mockWorkUnit.id}`
      );
      expect(deleteButton).toHaveAttribute(
        "aria-label",
        "Delete work unit: Test Work Unit"
      );

      fireEvent.click(deleteButton);

      expect(deleteButton).toHaveAttribute(
        "aria-label",
        "Confirm delete work unit: Test Work Unit"
      );
    });

    it("gives the Save and Cancel buttons aria-labels naming the work unit", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`edit-button-${mockWorkUnit.id}`));

      expect(screen.getByTestId("save-edit-button")).toHaveAttribute(
        "aria-label",
        "Save changes to Test Work Unit"
      );
      expect(screen.getByTestId("cancel-edit-button")).toHaveAttribute(
        "aria-label",
        "Cancel editing Test Work Unit"
      );
    });

    it("moves focus to the title input when entering edit mode", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`edit-button-${mockWorkUnit.id}`));

      expect(document.activeElement).toBe(
        screen.getByTestId("edit-title-input")
      );
    });

    it("returns focus to the card when Cancel is clicked", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`edit-button-${mockWorkUnit.id}`));
      fireEvent.click(screen.getByTestId("cancel-edit-button"));

      expect(document.activeElement).toBe(
        screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`)
      );
    });

    it("returns focus to the card when Save succeeds", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockWorkUnit,
      } as Response);

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`edit-button-${mockWorkUnit.id}`));
      fireEvent.click(screen.getByTestId("save-edit-button"));

      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`)
        );
      });

      fetchSpy.mockRestore();
    });

    it("calls onStatusMessage with a save confirmation for screen readers", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockWorkUnit, title: "Renamed" }),
      } as Response);

      const onStatusMessage = vi.fn();
      render(
        <WorkUnitCard
          workUnit={mockWorkUnit}
          onStatusMessage={onStatusMessage}
        />
      );

      fireEvent.click(screen.getByTestId(`edit-button-${mockWorkUnit.id}`));
      fireEvent.click(screen.getByTestId("save-edit-button"));

      await waitFor(() => {
        expect(onStatusMessage).toHaveBeenCalledWith("Saved changes to Renamed");
      });
    });

    it("calls onStatusMessage with a delete confirmation for screen readers", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const onStatusMessage = vi.fn();
      render(
        <WorkUnitCard
          workUnit={mockWorkUnit}
          onStatusMessage={onStatusMessage}
        />
      );

      const deleteButton = screen.getByTestId(
        `delete-button-${mockWorkUnit.id}`
      );
      fireEvent.click(deleteButton);
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(onStatusMessage).toHaveBeenCalledWith(
          "Deleted work unit: Test Work Unit"
        );
      });
    });
  });

  describe("Detail modal", () => {
    it("opens the detail modal when the card body is clicked", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`));

      expect(screen.getByTestId("work-unit-detail-dialog")).toBeInTheDocument();

      await screen.findByTestId("work-unit-detail-notes-empty");

      fetchSpy.mockRestore();
    });

    it("closes the detail modal when the overlay is clicked (does not re-open via the card's own onClick)", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`));
      await screen.findByTestId("work-unit-detail-notes-empty");

      fireEvent.click(screen.getByTestId("work-unit-detail-overlay"));

      expect(screen.queryByTestId("work-unit-detail-dialog")).not.toBeInTheDocument();

      fetchSpy.mockRestore();
    });

    it("does not open the detail modal when the Edit button is clicked", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`edit-button-${mockWorkUnit.id}`));

      expect(screen.getByTestId("edit-title-input")).toBeInTheDocument();
      expect(screen.queryByTestId("work-unit-detail-dialog")).not.toBeInTheDocument();
    });

    it("does not open the detail modal when the Delete button is clicked", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`delete-button-${mockWorkUnit.id}`));

      expect(screen.queryByTestId("work-unit-detail-dialog")).not.toBeInTheDocument();
    });

    it("does not open the detail modal when the JIRA key link is clicked", () => {
      render(
        <WorkUnitCard
          workUnit={mockWorkUnit}
          storyKey="COM-540"
          storyUrl="https://acme.atlassian.net/browse/COM-540"
        />
      );

      fireEvent.click(screen.getByTestId(`work-unit-story-key-${mockWorkUnit.id}`));

      expect(screen.queryByTestId("work-unit-detail-dialog")).not.toBeInTheDocument();
    });

    it("closes the detail modal on Escape and returns focus to the card", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      fireEvent.click(screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`));
      expect(screen.getByTestId("work-unit-detail-dialog")).toBeInTheDocument();
      await screen.findByTestId("work-unit-detail-notes-empty");

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByTestId("work-unit-detail-dialog")).not.toBeInTheDocument();
      });

      fetchSpy.mockRestore();
    });

    it("passes storyKey and storyUrl through to the detail modal header", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      render(
        <WorkUnitCard
          workUnit={mockWorkUnit}
          storyKey="COM-540"
          storyUrl="https://acme.atlassian.net/browse/COM-540"
        />
      );

      fireEvent.click(screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`));

      const link = screen.getByTestId("work-unit-detail-story-key");
      expect(link).toHaveTextContent("COM-540");
      expect(link).toHaveAttribute(
        "href",
        "https://acme.atlassian.net/browse/COM-540"
      );

      await screen.findByTestId("work-unit-detail-notes-empty");

      fetchSpy.mockRestore();
    });
  });

  describe("Theme awareness", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("uses light-theme classes by default", async () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      await waitFor(() => {
        expect(
          screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`)
        ).toHaveClass("bg-ponder-light-surface");
      });
    });

    it("uses dark-theme classes when ponderTheme is set to dark", async () => {
      localStorage.setItem("ponderTheme", "dark");

      render(<WorkUnitCard workUnit={mockWorkUnit} />);

      await waitFor(() => {
        expect(
          screen.getByTestId(`work-unit-card-${mockWorkUnit.id}`)
        ).toHaveClass("bg-ponder-dark-surface");
      });
    });
  });
});
