import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OnboardingTooltip } from "@/components/OnboardingTooltip";

describe("OnboardingTooltip", () => {
  it("renders when isOpen is true", () => {
    render(<OnboardingTooltip isOpen={true} onDismiss={vi.fn()} />);

    expect(
      screen.getByRole("dialog", { name: /Welcome to Kanban Board/i })
    ).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    render(<OnboardingTooltip isOpen={false} onDismiss={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has the required accessibility attributes", () => {
    render(<OnboardingTooltip isOpen={true} onDismiss={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "onboarding-title");
  });

  it("focuses the 'Got it' button when it opens", () => {
    render(<OnboardingTooltip isOpen={true} onDismiss={vi.fn()} />);

    const button = screen.getByTestId("onboarding-dismiss-button");
    expect(document.activeElement).toBe(button);
  });

  it("calls onDismiss when the 'Got it' button is clicked", () => {
    const onDismiss = vi.fn();
    render(<OnboardingTooltip isOpen={true} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("onboarding-dismiss-button"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when the Escape key is pressed", () => {
    const onDismiss = vi.fn();
    render(<OnboardingTooltip isOpen={true} onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when the overlay outside the modal is clicked", () => {
    const onDismiss = vi.fn();
    render(<OnboardingTooltip isOpen={true} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("onboarding-overlay"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss when clicking inside the modal content", () => {
    const onDismiss = vi.fn();
    render(<OnboardingTooltip isOpen={true} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("onboarding-tooltip"));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("traps Tab focus within the modal, cycling from the last to the first focusable element", () => {
    render(<OnboardingTooltip isOpen={true} onDismiss={vi.fn()} />);

    const button = screen.getByTestId("onboarding-dismiss-button");
    // The button is the only focusable element inside the dialog, so
    // Tab should keep focus on it rather than escaping the modal.
    button.focus();
    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(button);
  });

  it("restores focus to the previously focused element when dismissed", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open board";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <OnboardingTooltip isOpen={true} onDismiss={vi.fn()} />
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("onboarding-dismiss-button")
    );

    rerender(<OnboardingTooltip isOpen={false} onDismiss={vi.fn()} />);

    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("renders the plain-language guidance content", () => {
    render(<OnboardingTooltip isOpen={true} onDismiss={vi.fn()} />);

    expect(screen.getByText(/Click 'Edit' to change/i)).toBeInTheDocument();
    expect(screen.getByText(/Click 'Delete' to remove/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Drag tasks between columns to track progress/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Enter to open a task's details, Delete key to remove/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Got it/i })
    ).toBeInTheDocument();
  });
});
