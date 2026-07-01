import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import ProjectsPage from "./page";

describe("ProjectsPage", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("renders the Projects heading and a New Project button", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    render(await ProjectsPage());

    expect(
      screen.getByRole("heading", { name: "Projects" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("new-project-button")).toHaveAttribute(
      "href",
      "/projects/new"
    );
  });

  it("shows the empty state when there are no projects", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    render(await ProjectsPage());

    expect(screen.getByTestId("projects-empty-state")).toHaveTextContent(
      "No projects yet. Create one to get started."
    );
    expect(screen.queryByTestId("projects-grid")).not.toBeInTheDocument();
  });

  it("renders a card per project, linking to its board", async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "p1",
        name: "Alpha",
        type: "JIRA",
        jiraProjectKey: "ALPHA",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        _count: { stories: 2, workUnits: 5 },
      },
      {
        id: "p2",
        name: "Beta",
        type: "STANDALONE",
        jiraProjectKey: null,
        createdAt: new Date("2026-01-02"),
        updatedAt: new Date("2026-01-02"),
        _count: { stories: 0, workUnits: 0 },
      },
    ]);

    render(await ProjectsPage());

    const jiraCard = screen.getByTestId("project-card-p1");
    expect(jiraCard).toHaveAttribute("href", "/projects/p1/board");
    expect(jiraCard).toHaveTextContent("Alpha");
    expect(jiraCard).toHaveTextContent("JIRA Project: ALPHA");

    const standaloneCard = screen.getByTestId("project-card-p2");
    expect(standaloneCard).toHaveAttribute("href", "/projects/p2/board");
    expect(standaloneCard).toHaveTextContent("Beta");
    expect(standaloneCard).toHaveTextContent("Standalone project");
  });
});
