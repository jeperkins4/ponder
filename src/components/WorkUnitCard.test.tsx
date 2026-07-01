import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkUnitCard } from "./WorkUnitCard";
import { WorkUnitDTO } from "@/lib/types";

// Mock react-beautiful-dnd
vi.mock("react-beautiful-dnd", () => ({
  Draggable: ({ children, draggableId }: any) => (
    <div data-testid={`draggable-${draggableId}`}>
      {children(
        {
          innerRef: vi.fn(),
          draggableProps: {},
          dragHandleProps: {},
        },
        { isDragging: false }
      )}
    </div>
  ),
}));

const mockWorkUnit: WorkUnitDTO = {
  id: "test-id-123",
  storyId: "story-123",
  title: "Test Work Unit",
  description: "This is a test description",
  column: "todo",
  order: 0,
  createdAt: "2026-01-01T00:00:00Z",
  completedAt: null,
};

describe("WorkUnitCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders the title", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);
      expect(
        screen.getByTestId(`work-unit-title-${mockWorkUnit.id}`)
      ).toHaveTextContent("Test Work Unit");
    });

    it("renders the column badge", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);
      expect(
        screen.getByTestId(`work-unit-column-badge-${mockWorkUnit.id}`)
      ).toHaveTextContent("To Do");
    });

    it("renders the description", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);
      expect(screen.getByText("This is a test description")).toBeInTheDocument();
    });

    it("renders edit and delete buttons", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);
      expect(
        screen.getByTestId(`edit-button-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`delete-button-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
    });

    it("renders the card with draggable wrapper", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);
      expect(
        screen.getByTestId(`draggable-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
    });

    it("renders different column badge colors for different columns", () => {
      const inProgressUnit: WorkUnitDTO = {
        ...mockWorkUnit,
        column: "in_progress",
      };
      const { rerender } = render(
        <WorkUnitCard workUnit={inProgressUnit} index={0} />
      );
      expect(
        screen.getByTestId(`work-unit-column-badge-${mockWorkUnit.id}`)
      ).toHaveTextContent("In Progress");

      const doneUnit: WorkUnitDTO = { ...mockWorkUnit, column: "done" };
      rerender(<WorkUnitCard workUnit={doneUnit} index={0} />);
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
        <WorkUnitCard workUnit={unitWithoutDescription} index={0} />
      );
      expect(screen.queryByText("This is a test description")).not.toBeInTheDocument();
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
        <WorkUnitCard workUnit={mockWorkUnit} index={0} onDelete={onDelete} />
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

      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);

      const deleteButton = screen.getByTestId(`delete-button-${mockWorkUnit.id}`);
      fireEvent.click(deleteButton); // First click for confirmation
      fireEvent.click(deleteButton); // Second click to confirm delete

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith("Failed to delete work unit");
      });

      alertSpy.mockRestore();
    });

    it("shows cancel button during delete confirmation", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);

      const deleteButton = screen.getByTestId(`delete-button-${mockWorkUnit.id}`);
      fireEvent.click(deleteButton);

      expect(
        screen.getByTestId(`cancel-delete-button-${mockWorkUnit.id}`)
      ).toBeInTheDocument();
    });

    it("cancels delete when cancel button is clicked", () => {
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);

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
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);

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
      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);

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
        <WorkUnitCard workUnit={mockWorkUnit} index={0} onUpdate={onUpdate} />
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

      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);

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

      render(<WorkUnitCard workUnit={mockWorkUnit} index={0} />);

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
});
