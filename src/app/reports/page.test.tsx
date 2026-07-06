/**
 * Tests for the /reports page. fetch is stubbed: /api/projects returns the
 * project list for the selector, /api/reports returns a canned payload.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsPage from "./page";
import type { ReportsPayload } from "@/lib/reports/types";

const payload: ReportsPayload = {
  completedWork: {
    stories: [
      {
        jiraKey: "TEAM-1",
        summary: "First story",
        jiraStatus: "Code Revew",
        cards: [
          {
            id: "w1",
            title: "Ship the thing",
            subNumber: null,
            completedAt: "2026-07-01T10:00:00.000Z",
            archivedAt: null,
            verificationOutcome: "passed",
          },
        ],
      },
    ],
    totalCards: 1,
    totalStories: 1,
  },
  throughput: {
    weeks: [
      {
        weekStart: "2026-06-29",
        completedCount: 1,
        avgCycleTimeDays: 2.5,
        medianCycleTimeDays: 2.5,
      },
    ],
    totalCompleted: 1,
    avgCycleTimeDays: 2.5,
    medianCycleTimeDays: 2.5,
    avgCardsPerWeek: 1,
  },
  statusSnapshot: {
    stories: [
      {
        jiraKey: "TEAM-2",
        summary: "Active story",
        jiraStatus: "In Progress",
        columnCounts: { todo: 2, in_progress: 1, code_review: 0, done: 0 },
      },
    ],
    columnTotals: { todo: 2, in_progress: 1, code_review: 0, done: 0 },
    awaitingVerification: 1,
    failedVerification: 0,
  },
  jiraTrail: {
    events: [
      {
        type: "moved_to_qa",
        jiraKey: "TEAM-3",
        detail: "QA card",
        timestamp: "2026-07-02T09:00:00.000Z",
      },
    ],
  },
  trends: {
    granularity: "day" as const,
    buckets: ["2026-07-04", "2026-07-05", "2026-07-06"],
    created: [2, 1, 0],
    completed: [0, 1, 1],
    cumulativeCompleted: [0, 1, 2],
    wip: [2, 2, 1],
    activity: {
      movedToQa: [0, 1, 0],
      verifications: [0, 0, 1],
      storyCompletions: [0, 0, 1],
    },
  },
};

const projects = [
  {
    id: "p1",
    name: "TEAM Alliance",
    type: "JIRA",
    jiraProjectKey: "TEAM",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasApiToken: true,
    storyCount: 2,
    workUnitCount: 4,
  },
];

function okJson(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

let fetchMock: ReturnType<
  typeof vi.fn<[input: RequestInfo | URL], Promise<Response>>
>;

beforeEach(() => {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/projects")) return okJson(projects);
    if (url.includes("/api/reports")) return okJson(payload);
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReportsPage", () => {
  it("renders all four report sections from the payload", async () => {
    render(<ReportsPage />);

    expect(
      await screen.findByRole("heading", { name: /snapshot/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /throughput & cycle time/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /completed work/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /jira trail/i })
    ).toBeInTheDocument();

    // Section content spot-checks.
    expect(screen.getByText("Ship the thing")).toBeInTheDocument();
    expect(screen.getByText("Active story")).toBeInTheDocument();
    expect(screen.getByText("QA card")).toBeInTheDocument();
  });

  it("defaults to the 30-day range (sends a from param)", async () => {
    render(<ReportsPage />);
    await screen.findByRole("heading", { name: /snapshot/i });

    const reportCall = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes("/api/reports"));
    expect(reportCall).toContain("from=");
  });

  it("refetches without a from param when All time is selected", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);
    await screen.findByRole("heading", { name: /snapshot/i });

    await user.click(screen.getByRole("button", { name: "All time" }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes("/api/reports"));
      expect(urls.length).toBeGreaterThan(1);
      expect(urls[urls.length - 1]).not.toContain("from=");
    });
  });

  it("refetches with projectId when a project is selected", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);
    await screen.findByRole("heading", { name: /snapshot/i });

    await user.selectOptions(
      await screen.findByLabelText(/project/i),
      "p1"
    );

    await waitFor(() => {
      const urls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes("/api/reports"));
      expect(urls[urls.length - 1]).toContain("projectId=p1");
    });
  });

  it("shows an error state when the reports request fails", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/projects")) return okJson(projects);
      return Promise.resolve(new Response("nope", { status: 500 }));
    });

    render(<ReportsPage />);

    expect(await screen.findByText(/failed to load reports/i)).toBeInTheDocument();
  });

  it("shows empty states when there is no data", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/projects")) return okJson(projects);
      return okJson({
        completedWork: { stories: [], totalCards: 0, totalStories: 0 },
        throughput: {
          weeks: [],
          totalCompleted: 0,
          avgCycleTimeDays: null,
          medianCycleTimeDays: null,
          avgCardsPerWeek: null,
        },
        statusSnapshot: {
          stories: [],
          columnTotals: { todo: 0, in_progress: 0, code_review: 0, done: 0 },
          awaitingVerification: 0,
          failedVerification: 0,
        },
        jiraTrail: { events: [] },
        trends: {
          granularity: "day" as const,
          buckets: [],
          created: [],
          completed: [],
          cumulativeCompleted: [],
          wip: [],
          activity: { movedToQa: [], verifications: [], storyCompletions: [] },
        },
      } satisfies ReportsPayload);
    });

    render(<ReportsPage />);

    expect(
      await screen.findByText(/no completed work in this range/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/no jira events in this range/i)).toBeInTheDocument();
    expect(screen.getByText(/no activity in this range/i)).toBeInTheDocument();
  });

  it("renders the Trends section with all four charts and the granularity caption", async () => {
    render(<ReportsPage />);

    expect(
      await screen.findByRole("heading", { name: /trends/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Daily buckets")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /created vs completed/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /cumulative completed/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /wip over time/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /jira activity/i })
    ).toBeInTheDocument();
  });
});
