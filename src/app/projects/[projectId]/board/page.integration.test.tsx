import { render, screen, waitFor } from "@testing-library/react";
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

// Deliberately NOT mocking KanbanBoard here: this suite exercises the real
// rendered DOM (heading count, header actions, skip link) rather than the
// page's own responsibilities in isolation (covered by page.test.tsx).
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

describe("ProjectBoardPage integration (real KanbanBoard)", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([jiraProject, standaloneProject]);

    window.localStorage.clear();

    // KanbanBoard fetches stories on mount via `fetch`.
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response)
    );
  });

  it("renders the project name as the sole h1, and the ProjectSelector plus Import-from-JIRA button for a JIRA project", async () => {
    mockFindUnique.mockResolvedValueOnce(jiraProject);

    render(
      await ProjectBoardPage({ params: Promise.resolve({ projectId: "p1" }) })
    );

    await waitFor(() => {
      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent("Alpha");
    });

    expect(screen.getByTestId("project-selector")).toBeInTheDocument();
    expect(screen.getByTestId("import-from-jira-button")).toBeInTheDocument();
  });

  it("renders the project name as the sole h1 and the ProjectSelector, but no Import-from-JIRA button, for a STANDALONE project", async () => {
    mockFindUnique.mockResolvedValueOnce(standaloneProject);

    render(
      await ProjectBoardPage({ params: Promise.resolve({ projectId: "p2" }) })
    );

    await waitFor(() => {
      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent("Beta");
    });

    expect(screen.getByTestId("project-selector")).toBeInTheDocument();
    expect(
      screen.queryByTestId("import-from-jira-button")
    ).not.toBeInTheDocument();
  });

  it("keeps a single main landmark with a functional skip link", async () => {
    mockFindUnique.mockResolvedValueOnce(jiraProject);

    render(
      await ProjectBoardPage({ params: Promise.resolve({ projectId: "p1" }) })
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    expect(screen.getAllByRole("main")).toHaveLength(1);

    const skipLink = screen.getByText(/Skip to main content/i);
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });
});
