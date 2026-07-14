import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  attachImage,
  listEpics,
  listProjects,
  listStories,
  listWorkUnits,
  markDone,
  moveWorkUnit,
  regenerateAcceptance,
  reportCompletedWork,
  reportJiraTrail,
  reportStatusSnapshot,
  reportThroughput,
  reportVerification,
  updateWorkUnit,
} from "./tools";
import type { PonderClient } from "./client";
import type { ProjectWithStats, StoryDTO, WorkUnitDTO } from "@/lib/types";
import type { ReportsPayload } from "@/lib/reports/types";

function fakeClient(overrides: Partial<PonderClient>): PonderClient {
  return overrides as PonderClient;
}

const projects: ProjectWithStats[] = [
  {
    id: "p1",
    name: "Project One",
    type: "JIRA",
    jiraProjectKey: "PONE",
    createdAt: new Date(),
    updatedAt: new Date(),
    hasApiToken: true,
    storyCount: 2,
    workUnitCount: 5,
  },
  {
    id: "p2",
    name: "Project Two",
    type: "STANDALONE",
    createdAt: new Date(),
    updatedAt: new Date(),
    hasApiToken: false,
    storyCount: 0,
    workUnitCount: 0,
  },
];

const stories: StoryDTO[] = [
  {
    id: "s1",
    jiraKey: "PONE-1",
    jiraId: "10001",
    projectKey: "PONE",
    summary: "Do the thing",
    description: null,
    jiraStatus: "In Progress",
    url: "https://example.atlassian.net/browse/PONE-1",
    lastSyncedAt: new Date().toISOString(),
    completionCommentPostedAt: null,
    workUnits: [
      {
        id: "w1",
        storyId: "s1",
        title: "Task A",
        description: null,
        acceptanceCriteria: null,
        verification: null,
        column: "todo",
        order: 0,
        subNumber: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        archivedAt: null,
        movedToQaReportedAt: null,
        verificationRequestedAt: null,
        verifiedAt: null,
        verificationOutcome: null,
        verificationSummary: null,
      },
      {
        id: "w2",
        storyId: "s1",
        title: "Task B",
        description: null,
        acceptanceCriteria: null,
        verification: null,
        column: "todo",
        order: 1,
        subNumber: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        archivedAt: null,
        movedToQaReportedAt: null,
        verificationRequestedAt: null,
        verifiedAt: null,
        verificationOutcome: null,
        verificationSummary: null,
      },
      {
        id: "w3",
        storyId: "s1",
        title: "Task C",
        description: null,
        acceptanceCriteria: null,
        verification: null,
        column: "in_progress",
        order: 0,
        subNumber: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        archivedAt: null,
        movedToQaReportedAt: null,
        verificationRequestedAt: null,
        verifiedAt: null,
        verificationOutcome: null,
        verificationSummary: null,
      },
      {
        id: "w4",
        storyId: "s1",
        title: "Task D",
        description: null,
        acceptanceCriteria: null,
        verification: null,
        column: "code_review",
        order: 0,
        subNumber: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        archivedAt: null,
        movedToQaReportedAt: null,
        verificationRequestedAt: null,
        verifiedAt: null,
        verificationOutcome: null,
        verificationSummary: null,
      },
    ],
  },
  {
    id: "s2",
    jiraKey: "PONE-2",
    jiraId: "10002",
    projectKey: "PONE",
    summary: "Do another thing",
    description: null,
    jiraStatus: "To Do",
    url: "https://example.atlassian.net/browse/PONE-2",
    lastSyncedAt: new Date().toISOString(),
    completionCommentPostedAt: null,
    workUnits: [],
  },
];

describe("listProjects", () => {
  it("includes each project's name and counts", async () => {
    const client = fakeClient({ getProjects: async () => projects });

    const result = await listProjects(client);
    const text = result.content[0].text;

    expect(text).toContain("Project One");
    expect(text).toContain("stories: 2");
    expect(text).toContain("workUnits: 5");
    expect(text).toContain("Project Two");
    expect(text).toContain("stories: 0");
    expect(text).toContain("jiraProjectKey: PONE");
    expect(text).toContain("jiraProjectKey: —");
  });

  it("reports zero projects clearly", async () => {
    const client = fakeClient({ getProjects: async () => [] });

    const result = await listProjects(client);

    expect(result.content[0].text).toMatch(/no projects/i);
  });
});

describe("listEpics", () => {
  it("includes each epic's name and key", async () => {
    const client = fakeClient({
      getEpics: async () => [
        { key: "PONE-100", name: "Big epic" },
        { key: "PONE-200", name: "Other epic" },
      ],
    });

    const result = await listEpics(client, { projectId: "p1" });
    const text = result.content[0].text;

    expect(text).toContain("Big epic");
    expect(text).toContain("PONE-100");
    expect(text).toContain("Other epic");
    expect(text).toContain("PONE-200");
  });

  it("reports zero epics clearly", async () => {
    const client = fakeClient({ getEpics: async () => [] });

    const result = await listEpics(client, { projectId: "p1" });

    expect(result.content[0].text).toMatch(/no epics/i);
  });
});

describe("listStories", () => {
  it("includes each story's jiraKey, status, and per-column breakdown", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listStories(client, { projectId: "p1" });
    const text = result.content[0].text;

    expect(text).toContain("PONE-1");
    expect(text).toContain("In Progress");
    expect(text).toContain("todo: 2");
    expect(text).toContain("in_progress: 1");
    expect(text).toContain("code_review: 1");
    expect(text).toContain("PONE-2");
    expect(text).toContain("To Do");
  });

  it("returns a clear message when there are no stories", async () => {
    const client = fakeClient({ getStories: async () => [] });

    const result = await listStories(client, { projectId: "p1" });

    expect(result.content[0].text).toMatch(/no stories/i);
  });
});

describe("listWorkUnits", () => {
  it("lists every work unit with its id and parent jiraKey", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listWorkUnits(client, { projectId: "p1" });
    const text = result.content[0].text;

    expect(text).toContain("w1");
    expect(text).toContain("Task A");
    expect(text).toContain("PONE-1");
    expect(text).toContain("w4");
    expect(text).toContain("Task D");
  });

  it("filters to a single column when provided", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listWorkUnits(client, {
      projectId: "p1",
      column: "code_review",
    });
    const text = result.content[0].text;

    expect(text).toContain("Task D");
    expect(text).not.toContain("Task A");
    expect(text).not.toContain("Task B");
    expect(text).not.toContain("Task C");
  });

  it("returns an error mentioning valid columns for an invalid column", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listWorkUnits(client, {
      projectId: "p1",
      column: "bogus",
    });
    const text = result.content[0].text;

    expect(text).toMatch(/invalid column/i);
    expect(text).toContain("todo");
    expect(text).toContain("in_progress");
    expect(text).toContain("code_review");
    expect(text).toContain("done");
  });
});

describe("listWorkUnits with pendingVerification", () => {
  const storiesWithPending: StoryDTO[] = [
    {
      ...stories[0],
      workUnits: stories[0].workUnits.map((wu) =>
        wu.id === "w4"
          ? { ...wu, verificationRequestedAt: new Date().toISOString(), verification: null }
          : wu
      ),
    },
    stories[1],
  ];

  it("filters to work units with a pending verification request", async () => {
    const client = fakeClient({ getStories: async () => storiesWithPending });

    const result = await listWorkUnits(client, { projectId: "p1", pendingVerification: true });
    const text = result.content[0].text;

    expect(text).toContain("Task D");
    expect(text).not.toContain("Task A");
    expect(text).toMatch(/verification steps.*missing|missing.*verification steps/i);
  });

  it("returns a clear message when nothing is pending", async () => {
    const client = fakeClient({ getStories: async () => stories });

    const result = await listWorkUnits(client, { projectId: "p1", pendingVerification: true });

    expect(result.content[0].text).toMatch(/no work units/i);
  });
});

describe("listStories with epicKey filter", () => {
  const storiesWithEpic: StoryDTO[] = [
    { ...stories[0], epicKey: "PONE-100", epicName: "Big epic" },
    { ...stories[1], epicKey: "PONE-200", epicName: "Other epic" },
  ];

  it("filters to stories under the given epic", async () => {
    const client = fakeClient({ getStories: async () => storiesWithEpic });

    const result = await listStories(client, { projectId: "p1", epicKey: "PONE-100" });
    const text = result.content[0].text;

    expect(text).toContain("PONE-1");
    expect(text).not.toContain("PONE-2");
  });

  it("returns a clear message when nothing matches the epic", async () => {
    const client = fakeClient({ getStories: async () => storiesWithEpic });

    const result = await listStories(client, { projectId: "p1", epicKey: "NOPE-1" });

    expect(result.content[0].text).toMatch(/no stories/i);
    expect(result.content[0].text).toContain("NOPE-1");
  });
});

describe("listWorkUnits with epicKey filter", () => {
  const storiesWithEpic: StoryDTO[] = [
    { ...stories[0], epicKey: "PONE-100", epicName: "Big epic" },
    { ...stories[1], epicKey: "PONE-200", epicName: "Other epic" },
  ];

  it("filters work units to those under the given epic", async () => {
    const client = fakeClient({ getStories: async () => storiesWithEpic });

    const result = await listWorkUnits(client, { projectId: "p1", epicKey: "PONE-100" });
    const text = result.content[0].text;

    expect(text).toContain("Task A");
    expect(text).toContain("Task D");
  });

  it("composes with the column filter", async () => {
    const client = fakeClient({ getStories: async () => storiesWithEpic });

    const result = await listWorkUnits(client, {
      projectId: "p1",
      epicKey: "PONE-100",
      column: "code_review",
    });
    const text = result.content[0].text;

    expect(text).toContain("Task D");
    expect(text).not.toContain("Task A");
  });
});

describe("reportVerification", () => {
  it("calls client.reportVerification with the right args and confirms", async () => {
    const reportVerificationMock = vi.fn(async () => ({
      id: "w1",
      verificationOutcome: "passed",
    })) as unknown as PonderClient["reportVerification"];
    const client = fakeClient({ reportVerification: reportVerificationMock });

    const result = await reportVerification(client, {
      workUnitId: "w1",
      outcome: "passed",
      summary: "All good",
    });

    expect(reportVerificationMock).toHaveBeenCalledWith("w1", "passed", "All good", undefined);
    expect(result.content[0].text).toMatch(/passed/i);
  });

  it("returns an error-text result when the client throws", async () => {
    const client = fakeClient({
      reportVerification: async () => {
        throw new Error("boom");
      },
    });

    const result = await reportVerification(client, {
      workUnitId: "w1",
      outcome: "failed",
      summary: "broke",
    });

    expect(result.content[0].text).toContain("boom");
  });
});

const movedWorkUnit: WorkUnitDTO = {
  id: "w1",
  storyId: "s1",
  title: "Task A",
  description: null,
  acceptanceCriteria: null,
  verification: null,
  column: "in_progress",
  order: 0,
  subNumber: null,
  createdAt: new Date().toISOString(),
  completedAt: null,
  archivedAt: null,
  movedToQaReportedAt: null,
  verificationRequestedAt: null,
  verifiedAt: null,
  verificationOutcome: null,
  verificationSummary: null,
};

describe("moveWorkUnit", () => {
  it("calls client.moveWorkUnit with the right args and confirms", async () => {
    const moveWorkUnitMock = vi.fn(async () => movedWorkUnit);
    const client = fakeClient({ moveWorkUnit: moveWorkUnitMock });

    const result = await moveWorkUnit(client, {
      workUnitId: "w1",
      column: "in_progress",
      order: 2,
    });
    const text = result.content[0].text;

    expect(moveWorkUnitMock).toHaveBeenCalledWith("w1", "in_progress", 2);
    expect(text).toContain("Task A");
    expect(text).toContain("in_progress");
  });

  it("returns an error naming valid columns for an invalid column, without calling the client", async () => {
    const moveWorkUnitMock = vi.fn(async () => movedWorkUnit);
    const client = fakeClient({ moveWorkUnit: moveWorkUnitMock });

    const result = await moveWorkUnit(client, {
      workUnitId: "w1",
      column: "bogus",
    });
    const text = result.content[0].text;

    expect(text).toMatch(/invalid column/i);
    expect(text).toContain("todo");
    expect(text).toContain("in_progress");
    expect(text).toContain("code_review");
    expect(text).toContain("done");
    expect(moveWorkUnitMock).not.toHaveBeenCalled();
  });

  it("returns an error-text result when the client throws", async () => {
    const client = fakeClient({
      moveWorkUnit: vi.fn(async () => {
        throw new Error("Ponder API error: 404 POST /api/work-units/w1/move");
      }),
    });

    const result = await moveWorkUnit(client, {
      workUnitId: "w1",
      column: "in_progress",
    });
    const text = result.content[0].text;

    expect(text).toMatch(/error/i);
    expect(text).toContain("404");
  });
});

describe("markDone", () => {
  it("calls client.moveWorkUnit with column 'done'", async () => {
    const moveWorkUnitMock = vi.fn(async () => ({
      ...movedWorkUnit,
      column: "done" as const,
    }));
    const client = fakeClient({ moveWorkUnit: moveWorkUnitMock });

    const result = await markDone(client, { workUnitId: "w1" });
    const text = result.content[0].text;

    expect(moveWorkUnitMock).toHaveBeenCalledWith("w1", "done", undefined);
    expect(text).toContain("done");
  });
});

describe("updateWorkUnit", () => {
  it("calls client.updateWorkUnit with just a title when only title is provided", async () => {
    const updateWorkUnitMock = vi.fn(async () => ({
      ...movedWorkUnit,
      title: "New title",
    }));
    const client = fakeClient({ updateWorkUnit: updateWorkUnitMock });

    const result = await updateWorkUnit(client, {
      workUnitId: "w1",
      title: "New title",
    });
    const text = result.content[0].text;

    expect(updateWorkUnitMock).toHaveBeenCalledWith("w1", { title: "New title" });
    expect(text).toContain("New title");
  });

  it("returns an error when neither title nor description is provided, without calling the client", async () => {
    const updateWorkUnitMock = vi.fn(async () => movedWorkUnit);
    const client = fakeClient({ updateWorkUnit: updateWorkUnitMock });

    const result = await updateWorkUnit(client, { workUnitId: "w1" });
    const text = result.content[0].text;

    expect(text).toMatch(/error/i);
    expect(updateWorkUnitMock).not.toHaveBeenCalled();
  });

  it("returns an error-text result when the client throws", async () => {
    const client = fakeClient({
      updateWorkUnit: vi.fn(async () => {
        throw new Error("Ponder API error: 500 PATCH /api/work-units/w1");
      }),
    });

    const result = await updateWorkUnit(client, {
      workUnitId: "w1",
      title: "New title",
    });
    const text = result.content[0].text;

    expect(text).toMatch(/error/i);
    expect(text).toContain("500");
  });
});

describe("regenerateAcceptance", () => {
  it("regenerateAcceptance returns a text summary of the new AC/verification", async () => {
    const fakeClient = {
      regenerateAcceptance: async (id: string, ctx?: string) => {
        expect(id).toBe("wu1");
        expect(ctx).toBe('{"domain":"Projects"}');
        return { acceptanceCriteria: "- a", verification: "run t" };
      },
    } as unknown as PonderClient;

    const result = await regenerateAcceptance(fakeClient, {
      workUnitId: "wu1",
      codebaseContext: '{"domain":"Projects"}',
    });
    expect(result.content[0].text).toContain("Acceptance Criteria");
    expect(result.content[0].text).toContain("run t");
  });

  it("returns an error-text result when the client throws", async () => {
    const fakeClient = {
      regenerateAcceptance: async () => {
        throw new Error("Ponder API error: 500 POST /api/work-units/wu1/generate-acceptance-criteria");
      },
    } as unknown as PonderClient;

    const result = await regenerateAcceptance(fakeClient, { workUnitId: "wu1" });
    const text = result.content[0].text;

    expect(text).toMatch(/error/i);
    expect(text).toContain("500");
  });
});

describe("attachImage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ponder-attachImage-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the local file and uploads it via client.addAttachment", async () => {
    const filePath = path.join(dir, "screenshot.png");
    await writeFile(filePath, "fake-bytes");

    const fakeClient = {
      addAttachment: async (
        workUnitId: string,
        buffer: Buffer,
        filename: string,
        mimeType: string
      ) => {
        expect(workUnitId).toBe("wu1");
        expect(buffer.toString()).toBe("fake-bytes");
        expect(filename).toBe("screenshot.png");
        expect(mimeType).toBe("image/png");
        return {
          id: "a1",
          workUnitId: "wu1",
          filename,
          mimeType,
          size: buffer.length,
          createdAt: "2026-07-02T00:00:00.000Z",
          url: "/api/attachments/a1",
        };
      },
    } as unknown as PonderClient;

    const result = await attachImage(fakeClient, {
      workUnitId: "wu1",
      filePath,
    });

    expect(result.content[0].text).toContain("screenshot.png");
    expect(result.content[0].text).toContain("wu1");
  });

  it("returns an error-text result for an unsupported extension, without calling the client", async () => {
    const filePath = path.join(dir, "notes.txt");
    await writeFile(filePath, "not an image");
    const addAttachment = vi.fn();
    const fakeClient = { addAttachment } as unknown as PonderClient;

    const result = await attachImage(fakeClient, {
      workUnitId: "wu1",
      filePath,
    });

    expect(result.content[0].text).toMatch(/error/i);
    expect(addAttachment).not.toHaveBeenCalled();
  });

  it("returns an error-text result for a missing file", async () => {
    const fakeClient = {
      addAttachment: vi.fn(),
    } as unknown as PonderClient;

    const result = await attachImage(fakeClient, {
      workUnitId: "wu1",
      filePath: path.join(dir, "does-not-exist.png"),
    });

    expect(result.content[0].text).toMatch(/error/i);
  });

  it("returns an error-text result when the client throws", async () => {
    const filePath = path.join(dir, "screenshot.png");
    await writeFile(filePath, "fake-bytes");
    const fakeClient = {
      addAttachment: async () => {
        throw new Error("Ponder API error: 413 POST /api/work-units/wu1/attachments");
      },
    } as unknown as PonderClient;

    const result = await attachImage(fakeClient, {
      workUnitId: "wu1",
      filePath,
    });

    expect(result.content[0].text).toMatch(/error/i);
    expect(result.content[0].text).toContain("413");
  });
});

const reportsPayload: ReportsPayload = {
  completedWork: {
    stories: [
      {
        jiraKey: "PONE-1",
        summary: "Do the thing",
        jiraStatus: "Code Revew",
        cards: [
          {
            id: "w1",
            title: "Task A",
            subNumber: 1,
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
        jiraKey: "PONE-2",
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
        type: "verification",
        jiraKey: "PONE-1",
        detail: "Task A",
        timestamp: "2026-07-02T09:00:00.000Z",
        outcome: "passed",
      },
      {
        type: "moved_to_qa",
        jiraKey: "PONE-3",
        detail: "QA card",
        timestamp: "2026-07-01T09:00:00.000Z",
      },
    ],
  },
  trends: {
    granularity: "day",
    buckets: [],
    created: [],
    completed: [],
    cumulativeCompleted: [],
    wip: [],
    activity: { movedToQa: [], verifications: [], storyCompletions: [] },
  },
  verificationCapacity: {
    granularity: "day",
    buckets: [],
    generated: [],
    verified: [],
    queueDepth: [],
    totalGenerated: 0,
    totalVerified: 0,
    capacityRatio: null,
    avgVerificationLagDays: null,
    medianVerificationLagDays: null,
    completedInWindow: 0,
    completedVerified: 0,
    verifiedCompletionRate: null,
  },
};

function emptyReportsPayload(): ReportsPayload {
  return {
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
      granularity: "day",
      buckets: [],
      created: [],
      completed: [],
      cumulativeCompleted: [],
      wip: [],
      activity: { movedToQa: [], verifications: [], storyCompletions: [] },
    },
    verificationCapacity: {
      granularity: "day",
      buckets: [],
      generated: [],
      verified: [],
      queueDepth: [],
      totalGenerated: 0,
      totalVerified: 0,
      capacityRatio: null,
      avgVerificationLagDays: null,
      medianVerificationLagDays: null,
      completedInWindow: 0,
      completedVerified: 0,
      verifiedCompletionRate: null,
    },
  };
}

describe("reportCompletedWork", () => {
  it("formats completed cards grouped by story", async () => {
    const getReports = vi.fn().mockResolvedValue(reportsPayload);
    const client = fakeClient({ getReports });

    const result = await reportCompletedWork(client, {});

    expect(getReports).toHaveBeenCalledWith({});
    const text = result.content[0].text;
    expect(text).toContain("1 card(s) completed across 1 story(ies)");
    expect(text).toContain("PONE-1: Do the thing");
    expect(text).toContain("Task A [passed] (completed 2026-07-01)");
  });

  it("passes filters through and handles an empty report", async () => {
    const getReports = vi.fn().mockResolvedValue(emptyReportsPayload());
    const client = fakeClient({ getReports });

    const result = await reportCompletedWork(client, {
      projectId: "p1",
      from: "2026-06-01",
      to: "2026-07-01",
    });

    expect(getReports).toHaveBeenCalledWith({
      projectId: "p1",
      from: "2026-06-01",
      to: "2026-07-01",
    });
    expect(result.content[0].text).toBe("No completed work in the selected range.");
  });
});

describe("reportThroughput", () => {
  it("formats totals and weekly buckets", async () => {
    const getReports = vi.fn().mockResolvedValue(reportsPayload);
    const client = fakeClient({ getReports });

    const result = await reportThroughput(client, {});

    const text = result.content[0].text;
    expect(text).toContain("1 completed");
    expect(text).toContain("avg cycle 2.5d");
    expect(text).toContain("median 2.5d");
    expect(text).toContain("- 2026-06-29: 1 completed (avg 2.5d, median 2.5d)");
  });

  it("handles an empty report", async () => {
    const getReports = vi.fn().mockResolvedValue(emptyReportsPayload());
    const client = fakeClient({ getReports });

    const result = await reportThroughput(client, {});

    expect(result.content[0].text).toBe("No completed work in the selected range.");
  });
});

describe("reportStatusSnapshot", () => {
  it("formats column totals, verification tallies, and per-story rows", async () => {
    const getReports = vi.fn().mockResolvedValue(reportsPayload);
    const client = fakeClient({ getReports });

    const result = await reportStatusSnapshot(client, { projectId: "p1" });

    expect(getReports).toHaveBeenCalledWith({ projectId: "p1" });
    const text = result.content[0].text;
    expect(text).toContain("todo 2, in_progress 1, code_review 0, done 0");
    expect(text).toContain("Awaiting verification: 1");
    expect(text).toContain("Failed verification: 0");
    expect(text).toContain("PONE-2: Active story [In Progress]");
  });

  it("handles an empty board", async () => {
    const getReports = vi.fn().mockResolvedValue(emptyReportsPayload());
    const client = fakeClient({ getReports });

    const result = await reportStatusSnapshot(client, {});

    expect(result.content[0].text).toContain("No active cards.");
  });
});

describe("reportJiraTrail", () => {
  it("formats events newest first with outcomes", async () => {
    const getReports = vi.fn().mockResolvedValue(reportsPayload);
    const client = fakeClient({ getReports });

    const result = await reportJiraTrail(client, {});

    const text = result.content[0].text;
    expect(text).toContain("2 JIRA event(s)");
    expect(text).toContain(
      "- 2026-07-02T09:00:00.000Z verification (passed) PONE-1 — Task A"
    );
    expect(text).toContain(
      "- 2026-07-01T09:00:00.000Z moved_to_qa PONE-3 — QA card"
    );
  });

  it("handles an empty trail", async () => {
    const getReports = vi.fn().mockResolvedValue(emptyReportsPayload());
    const client = fakeClient({ getReports });

    const result = await reportJiraTrail(client, {});

    expect(result.content[0].text).toBe("No JIRA events in the selected range.");
  });
});
