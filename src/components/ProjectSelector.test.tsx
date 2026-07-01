import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ProjectSelector } from "./ProjectSelector";
import { Project } from "@/lib/types";

const mockProjects: Project[] = [
  {
    id: "p1",
    name: "Alpha",
    type: "JIRA",
    jiraProjectKey: "ALPHA",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
  {
    id: "p2",
    name: "Beta",
    type: "STANDALONE",
    createdAt: new Date("2026-01-02"),
    updatedAt: new Date("2026-01-02"),
  },
];

describe("ProjectSelector", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the current project's name on the closed toggle", () => {
    render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
    expect(screen.getByTestId("project-selector-toggle")).toHaveTextContent(
      "Alpha"
    );
  });

  it("shows a placeholder when no current project is set", () => {
    render(<ProjectSelector projects={mockProjects} />);
    expect(screen.getByTestId("project-selector-toggle")).toHaveTextContent(
      "Select project"
    );
  });

  it("is closed by default and opens the menu when the toggle is clicked", () => {
    render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
    expect(screen.queryByTestId("project-selector-menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-selector-toggle"));

    expect(screen.getByTestId("project-selector-menu")).toBeInTheDocument();
  });

  it("renders every project as a link to its board", () => {
    render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
    fireEvent.click(screen.getByTestId("project-selector-toggle"));

    const alphaLink = screen.getByTestId("project-selector-item-p1");
    const betaLink = screen.getByTestId("project-selector-item-p2");

    expect(alphaLink).toHaveAttribute("href", "/projects/p1/board");
    expect(alphaLink).toHaveTextContent("Alpha");
    expect(betaLink).toHaveAttribute("href", "/projects/p2/board");
    expect(betaLink).toHaveTextContent("Beta");
  });

  it("highlights the current project in the menu", () => {
    render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
    fireEvent.click(screen.getByTestId("project-selector-toggle"));

    const alphaLink = screen.getByTestId("project-selector-item-p1");
    const betaLink = screen.getByTestId("project-selector-item-p2");

    expect(alphaLink).toHaveAttribute("aria-current", "page");
    expect(betaLink).not.toHaveAttribute("aria-current");
  });

  it("shows a New Project link pointing to /projects/new", () => {
    render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
    fireEvent.click(screen.getByTestId("project-selector-toggle"));

    const newProjectLink = screen.getByTestId("project-selector-new-link");
    expect(newProjectLink).toHaveAttribute("href", "/projects/new");
    expect(newProjectLink).toHaveTextContent("+ New Project");
  });

  it("handles an empty project list gracefully", () => {
    render(<ProjectSelector projects={[]} />);
    fireEvent.click(screen.getByTestId("project-selector-toggle"));

    expect(screen.getByTestId("project-selector-menu")).toHaveTextContent(
      "No projects yet"
    );
    expect(screen.getByTestId("project-selector-new-link")).toBeInTheDocument();
  });

  it("closes the menu when Escape is pressed", () => {
    render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
    fireEvent.click(screen.getByTestId("project-selector-toggle"));
    expect(screen.getByTestId("project-selector-menu")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("project-selector"), {
      key: "Escape",
    });

    expect(screen.queryByTestId("project-selector-menu")).not.toBeInTheDocument();
  });

  describe("Theme awareness", () => {
    it("applies light-mode surface styling by default", async () => {
      render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);

      await waitFor(() => {
        expect(screen.getByTestId("project-selector-toggle")).toHaveClass(
          "bg-ponder-light-surface"
        );
      });
    });

    it("applies dark-mode surface styling when ponderTheme is set to dark", async () => {
      window.localStorage.setItem("ponderTheme", "dark");

      render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);

      await waitFor(() => {
        expect(screen.getByTestId("project-selector-toggle")).toHaveClass(
          "bg-ponder-dark-surface"
        );
      });
    });

    it("applies dark-mode menu styling to the current-project highlight", async () => {
      window.localStorage.setItem("ponderTheme", "dark");

      render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
      fireEvent.click(screen.getByTestId("project-selector-toggle"));

      expect(screen.getByTestId("project-selector-item-p1")).toHaveClass(
        "bg-ponder-dark-purple-light"
      );
    });
  });

  describe("Accessibility", () => {
    it("exposes the toggle as a focusable, labeled button with aria-expanded", () => {
      render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
      const toggle = screen.getByTestId("project-selector-toggle");

      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle).toHaveAttribute("aria-label", "Switch project");
      expect(toggle).toHaveAttribute("aria-haspopup", "true");
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
    });

    it("shows a visible focus ring on the toggle button", () => {
      render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
      expect(screen.getByTestId("project-selector-toggle")).toHaveClass(
        "focus:ring-2",
        "focus:ring-ponder-light-purple",
        "focus:outline-none"
      );
    });

    it("labels the menu list and marks the current item with aria-current", () => {
      render(<ProjectSelector projects={mockProjects} currentProjectId="p1" />);
      fireEvent.click(screen.getByTestId("project-selector-toggle"));

      expect(screen.getByTestId("project-selector-menu")).toHaveAttribute(
        "aria-label",
        "Projects"
      );
      expect(screen.getByTestId("project-selector-item-p1")).toHaveAttribute(
        "aria-current",
        "page"
      );
    });
  });
});
