import { render, screen } from "@testing-library/react";
import Home from "@/app/page";
import { describe, it, expect } from "vitest";

describe("Home page", () => {
  it("renders the main heading", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: /JIRA Kanban Sync/i })).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    render(<Home />);
    expect(screen.getByText(/v1 - Local sync only/i)).toBeInTheDocument();
  });
});
