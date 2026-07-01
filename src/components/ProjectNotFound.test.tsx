import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ProjectNotFound } from "./ProjectNotFound";

describe("ProjectNotFound", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the not-found message", () => {
    render(<ProjectNotFound />);
    expect(screen.getByTestId("project-not-found")).toHaveTextContent(
      "Project not found."
    );
  });

  it("applies light-mode styling by default", async () => {
    render(<ProjectNotFound />);
    await waitFor(() => {
      expect(screen.getByRole("main")).toHaveClass("bg-ponder-light-bg");
    });
  });

  it("applies dark-mode styling when ponderTheme is set to dark", async () => {
    window.localStorage.setItem("ponderTheme", "dark");
    render(<ProjectNotFound />);
    await waitFor(() => {
      expect(screen.getByRole("main")).toHaveClass("bg-ponder-dark-bg");
    });
  });
});
