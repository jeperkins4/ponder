import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

// KanbanBoard does its own data fetching (via `fetch`) and is covered
// exhaustively by its own test suite; stub it here so this page test stays
// focused on the page's own responsibilities (lookup, not-found, and the
// title/headerActions it hands to KanbanBoard). The stub renders `title` as
// an `<h1>` and `headerActions` as children, mirroring the real component's
// contract, so this page's real (unmocked) ProjectSelector/ImportFromJira
// children are still exercised.
vi.mock("@/components/KanbanBoard", () => ({
  KanbanBoard: ({
    projectId,
    title,
    headerActions,
  }: {
    projectId?: string;
    title?: string;
    headerActions?: React.ReactNode;
  }) => (
    <div data-testid="kanban-board-stub" data-project-id={projectId}>
      <h1 data-testid="project-board-heading">{title}</h1>
      <div data-testid="kanban-board-header-actions">{headerActions}</div>
    </div>
  ),
}));

import ProjectBoardPage from "./page";

const jiraProject = {
  id: "p1",
  name: "Alpha",
  type: "JIRA",
  jiraProjectKey: "ALPHA",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const standaloneProject = {
  id: "p2",
  name: "Beta",
  type: "STANDALONE",
  jiraProjectKey: null,
  createdAt: new Date("2026-01-02"),
  updatedAt: new Date("2026-01-02"),
};

describe("ProjectBoardPage", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([jiraProject, standaloneProject]);
  });

  it("renders the project name and the KanbanBoard scoped to that project", async () => {
    mockFindUnique.mockResolvedValueOnce(jiraProject);

    render(
      await ProjectBoardPage({ params: Promise.resolve({ projectId: "p1" }) })
    );

    expect(
      screen.getByTestId("project-board-heading")
    ).toHaveTextContent("Alpha");

    const board = screen.getByTestId("kanban-board-stub");
    expect(board.getAttribute("data-project-id")).toBe("p1");
  });

  it("renders a ProjectSelector for switching projects", async () => {
    mockFindUnique.mockResolvedValueOnce(jiraProject);

    render(
      await ProjectBoardPage({ params: Promise.resolve({ projectId: "p1" }) })
    );

    expect(screen.getByTestId("project-selector")).toBeInTheDocument();
    expect(screen.getByTestId("project-selector-toggle")).toHaveTextContent(
      "Alpha"
    );
  });

  it("shows the Import from JIRA button for a JIRA-linked project", async () => {
    mockFindUnique.mockResolvedValueOnce(jiraProject);

    render(
      await ProjectBoardPage({ params: Promise.resolve({ projectId: "p1" }) })
    );

    expect(screen.getByTestId("import-from-jira-button")).toBeInTheDocument();
  });

  it("hides the Import from JIRA button for a STANDALONE project", async () => {
    mockFindUnique.mockResolvedValueOnce(standaloneProject);

    render(
      await ProjectBoardPage({ params: Promise.resolve({ projectId: "p2" }) })
    );

    expect(
      screen.queryByTestId("import-from-jira-button")
    ).not.toBeInTheDocument();
  });

  it("shows a not-found state when the project does not exist", async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    render(
      await ProjectBoardPage({
        params: Promise.resolve({ projectId: "missing" }),
      })
    );

    expect(screen.getByTestId("project-not-found")).toHaveTextContent(
      "Project not found."
    );
    expect(screen.queryByTestId("kanban-board-stub")).not.toBeInTheDocument();
  });
});
