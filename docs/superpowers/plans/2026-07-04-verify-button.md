# Verify Button (Code Review Lane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Verify" button to Code Review-lane cards that requests AI-agent-driven verification (test run + screenshot, executed in the target repo via MCP), and surfaces the pass/fail result back on the card.

**Architecture:** `WorkUnit` gains four nullable fields tracking verification request/result state. A REST endpoint sets the "requested" state when the button is clicked; a second REST endpoint (wrapped by a new MCP tool) lets an agent report a pass/fail result plus a summary. The existing `list_work_units` MCP tool gains a filter so an agent can discover pending requests, and the existing `attach_image` MCP tool (unchanged) carries the screenshot evidence. Ponder's server never runs tests or captures screenshots itself.

**Tech Stack:** Next.js 15 App Router API routes, Prisma 7 + PostgreSQL, React 18 + Tailwind (`WorkUnitCard`/`WorkUnitDetailModal`), the existing Ponder MCP server (`src/mcp`), Vitest.

## Global Constraints

- New `WorkUnit` fields are nullable timestamps/strings, following the exact pattern of the existing `archivedAt`/`completedAt` fields (see `prisma/schema.prisma:47-69` and migration `prisma/migrations/20260703222511_add_work_unit_archived_at/migration.sql`).
- `verificationOutcome` is a plain `String?` restricted at the application layer to exactly `"passed"` or `"failed"` — no Prisma enum (matches this codebase's existing convention of plain strings for `column`/`jiraStatus`).
- Every `WorkUnitDTO`-serializing spot in the codebase must be updated together — there are 5 in this repo today: `src/app/api/stories/route.ts`, `src/app/api/work-units/route.ts` (its `workUnitToDTO` function AND the inline POST-handler DTO literal), `src/app/api/work-units/[id]/route.ts`, `src/app/api/work-units/[id]/move/route.ts`.
- Test command convention: `npx dotenv -e .env.test -- vitest run --no-file-parallelism <path>` (always serial, per this repo's established convention).
- The Verify button only renders for cards where `workUnit.column === "code_review"` (no JIRA-link gating, unlike Move-to-QA — verification is a local/repo-side concern, not a JIRA transition).
- Screenshot evidence continues to flow through the existing `attach_image` MCP tool — this plan adds no new upload path.

---

### Task 1: Data model — schema, migration, DTO, and all serialization spots

**Files:**
- Modify: `prisma/schema.prisma` (WorkUnit model, `prisma/schema.prisma:47-69`)
- Create: `prisma/migrations/<timestamp>_add_work_unit_verification_fields/migration.sql`
- Modify: `src/lib/types.ts` (`WorkUnitDTO`)
- Modify: `src/app/api/stories/route.ts`
- Modify: `src/app/api/work-units/route.ts` (both `workUnitToDTO` and the inline POST DTO)
- Modify: `src/app/api/work-units/[id]/route.ts`
- Modify: `src/app/api/work-units/[id]/move/route.ts`
- Test: `src/app/api/stories/route.test.ts`, `src/app/api/work-units/route.test.ts` (extend existing serialization assertions; do not create new files — these already exist and already assert `archivedAt` is serialized)

**Interfaces:**
- Produces: `WorkUnitDTO` gains `verificationRequestedAt: string | null`, `verifiedAt: string | null`, `verificationOutcome: "passed" | "failed" | null`, `verificationSummary: string | null`. Every later task reads/writes these exact field names.

- [ ] **Step 1: Add the four fields to the Prisma schema**

Edit `prisma/schema.prisma`, in the `WorkUnit` model, add after the existing `archivedAt DateTime?` line:

```prisma
  archivedAt              DateTime?
  verificationRequestedAt DateTime?
  verifiedAt              DateTime?
  verificationOutcome     String?
  verificationSummary     String?
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_work_unit_verification_fields`

Expected: Prisma creates `prisma/migrations/<timestamp>_add_work_unit_verification_fields/migration.sql` containing four `ALTER TABLE "WorkUnit" ADD COLUMN ...` statements (all nullable, no defaults — mirrors the `archivedAt` migration), applies it to your local dev database, and regenerates the Prisma client. Also run `npm run db:push:test` to sync the test database's schema (this repo's established convention — check `package.json` for the exact script name if this differs).

- [ ] **Step 3: Add the four fields to `WorkUnitDTO`**

Edit `src/lib/types.ts`, in `WorkUnitDTO`, add after the existing `archivedAt: string | null; // ISO string` line:

```typescript
  archivedAt: string | null; // ISO string
  verificationRequestedAt: string | null; // ISO string
  verifiedAt: string | null; // ISO string
  verificationOutcome: "passed" | "failed" | null;
  verificationSummary: string | null;
```

- [ ] **Step 4: Update every DTO-serializing spot to carry the four new fields**

In each of the four files below, find the existing line `archivedAt: wu.archivedAt?.toISOString() ?? null,` (or the equivalent inline literal in `work-units/route.ts`'s POST handler) and add these four lines immediately after it:

```typescript
        verificationRequestedAt: wu.verificationRequestedAt?.toISOString() ?? null,
        verifiedAt: wu.verifiedAt?.toISOString() ?? null,
        verificationOutcome: wu.verificationOutcome as "passed" | "failed" | null,
        verificationSummary: wu.verificationSummary,
```

Apply this in:
- `src/app/api/stories/route.ts` (one spot, ~line 59)
- `src/app/api/work-units/route.ts` — **two** spots: the `workUnitToDTO` function (~line 37) AND the inline DTO literal inside the POST handler's story-workUnits `.map()` (~line 136). Also add `verificationRequestedAt`, `verifiedAt`, `verificationOutcome`, `verificationSummary` to that function's parameter type object (the `wu: { ... }` shape at the top of the file), matching the existing `archivedAt: Date | null;` line.
- `src/app/api/work-units/[id]/route.ts` (one spot, ~line 38, plus its parameter type object at ~line 24)
- `src/app/api/work-units/[id]/move/route.ts` (one spot, ~line 37, plus its parameter type object at ~line 23)

- [ ] **Step 5: Run the full test suite to confirm nothing broke**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/stories/route.test.ts src/app/api/work-units/route.test.ts src/app/api/work-units/`

Expected: all existing tests PASS (these new fields are additive and nullable, so no existing assertion should break — existing tests construct `WorkUnitDTO` fixtures directly in some files, e.g. `src/mcp/tools.test.ts`, but those are covered in Task 3, not this task).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/types.ts src/app/api/stories/route.ts src/app/api/work-units/route.ts "src/app/api/work-units/[id]/route.ts" "src/app/api/work-units/[id]/move/route.ts"
git commit -m "feat: add verification request/result fields to WorkUnit"
```

---

### Task 2: REST endpoints — request-verification and report-verification

**Files:**
- Create: `src/app/api/work-units/[id]/request-verification/route.ts`
- Create: `src/app/api/work-units/[id]/request-verification/route.test.ts`
- Create: `src/app/api/work-units/[id]/report-verification/route.ts`
- Create: `src/app/api/work-units/[id]/report-verification/route.test.ts`

**Interfaces:**
- Consumes: `WorkUnitDTO` fields from Task 1 (`verificationRequestedAt`, `verifiedAt`, `verificationOutcome`, `verificationSummary`), `prisma` client from `@/lib/prisma`.
- Produces: `POST /api/work-units/[id]/request-verification` → 200 `WorkUnitDTO` | 404 `{error}` | 422 `{error}`. `POST /api/work-units/[id]/report-verification` → 200 `WorkUnitDTO` | 400 `{error}` | 404 `{error}`. Task 4 (UI) calls both by exact path; Task 3 (MCP) calls the second by exact path.

- [ ] **Step 1: Write the failing test for request-verification**

Create `src/app/api/work-units/[id]/request-verification/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/request-verification/route";

describe("POST /api/work-units/[id]/request-verification", () => {
  let workUnitId: string;
  let counter = 0;

  beforeEach(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    counter++;
    const story = await prisma.story.create({
      data: {
        jiraKey: `RQV-${counter}`,
        jiraId: `9300${counter}`,
        projectKey: "RQV",
        summary: "Story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/RQV-${counter}`,
        lastSyncedAt: new Date(),
      },
    });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task", column: "code_review", order: 0 },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("sets verificationRequestedAt and clears any prior result", async () => {
    await prisma.workUnit.update({
      where: { id: workUnitId },
      data: {
        verifiedAt: new Date(),
        verificationOutcome: "failed",
        verificationSummary: "old run",
      },
    });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verificationRequestedAt).not.toBeNull();
    expect(data.verifiedAt).toBeNull();
    expect(data.verificationOutcome).toBeNull();
    expect(data.verificationSummary).toBeNull();
  });

  it("returns 422 when the work unit is not in code_review", async () => {
    await prisma.workUnit.update({ where: { id: workUnitId }, data: { column: "in_progress" } });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/code review/i);
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "does-not-exist" }),
    });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/work-units/[id]/request-verification/route.test.ts`
Expected: FAIL — `route.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement request-verification**

Create `src/app/api/work-units/[id]/request-verification/route.ts`:

```typescript
/**
 * POST /api/work-units/[id]/request-verification
 *
 * Marks a Code Review-lane work unit as awaiting AI-agent verification.
 * Clears any prior result so a fresh request always starts clean.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WorkUnitDTO } from "@/lib/types";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({ where: { id } });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }
    if (workUnit.column !== "code_review") {
      return NextResponse.json(
        { error: "Work unit must be in Code Review to request verification" },
        { status: 422 }
      );
    }

    const updated = await prisma.workUnit.update({
      where: { id },
      data: {
        verificationRequestedAt: new Date(),
        verifiedAt: null,
        verificationOutcome: null,
        verificationSummary: null,
      },
    });

    const dto: WorkUnitDTO = {
      id: updated.id,
      storyId: updated.storyId,
      title: updated.title,
      description: updated.description,
      acceptanceCriteria: updated.acceptanceCriteria,
      verification: updated.verification,
      column: updated.column as WorkUnitDTO["column"],
      order: updated.order,
      subNumber: updated.subNumber,
      createdAt: updated.createdAt.toISOString(),
      completedAt: updated.completedAt?.toISOString() ?? null,
      archivedAt: updated.archivedAt?.toISOString() ?? null,
      verificationRequestedAt: updated.verificationRequestedAt?.toISOString() ?? null,
      verifiedAt: updated.verifiedAt?.toISOString() ?? null,
      verificationOutcome: updated.verificationOutcome as WorkUnitDTO["verificationOutcome"],
      verificationSummary: updated.verificationSummary,
    };

    return NextResponse.json(dto);
  } catch (error) {
    console.error("Error requesting verification:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/work-units/[id]/request-verification/route.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Write the failing test for report-verification**

Create `src/app/api/work-units/[id]/report-verification/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/report-verification/route";

function postWith(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/work-units/[id]/report-verification", () => {
  let workUnitId: string;
  let counter = 0;

  beforeEach(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    counter++;
    const story = await prisma.story.create({
      data: {
        jiraKey: `RPV-${counter}`,
        jiraId: `9400${counter}`,
        projectKey: "RPV",
        summary: "Story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/RPV-${counter}`,
        lastSyncedAt: new Date(),
      },
    });
    const wu = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task",
        column: "code_review",
        order: 0,
        verificationRequestedAt: new Date(),
      },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("records a passed outcome, clears the pending request, and fills empty verification steps", async () => {
    const res = await POST(
      postWith({ outcome: "passed", summary: "Ran the repro steps; screenshot attached.", verificationSteps: "1. npm run dev\n2. Click X" }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verificationOutcome).toBe("passed");
    expect(data.verificationSummary).toBe("Ran the repro steps; screenshot attached.");
    expect(data.verificationRequestedAt).toBeNull();
    expect(data.verifiedAt).not.toBeNull();
    expect(data.verification).toBe("1. npm run dev\n2. Click X");
  });

  it("records a failed outcome", async () => {
    const res = await POST(
      postWith({ outcome: "failed", summary: "Repro still shows the bug." }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verificationOutcome).toBe("failed");
    expect(data.verificationSummary).toBe("Repro still shows the bug.");
  });

  it("does not overwrite existing verification steps", async () => {
    await prisma.workUnit.update({ where: { id: workUnitId }, data: { verification: "Existing steps" } });

    const res = await POST(
      postWith({ outcome: "passed", summary: "ok", verificationSteps: "New steps" }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    const data = await res.json();
    expect(data.verification).toBe("Existing steps");
  });

  it("returns 400 for a missing or invalid outcome", async () => {
    const res = await POST(
      postWith({ outcome: "maybe", summary: "ok" }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/outcome/i);
  });

  it("returns 400 for a missing summary", async () => {
    const res = await POST(
      postWith({ outcome: "passed" }),
      { params: Promise.resolve({ id: workUnitId }) }
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(
      postWith({ outcome: "passed", summary: "ok" }),
      { params: Promise.resolve({ id: "does-not-exist" }) }
    );

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/work-units/[id]/report-verification/route.test.ts`
Expected: FAIL — `route.ts` does not exist yet.

- [ ] **Step 7: Implement report-verification**

Create `src/app/api/work-units/[id]/report-verification/route.ts`:

```typescript
/**
 * POST /api/work-units/[id]/report-verification
 *
 * Records the result of an AI-agent verification run (see the "Verify"
 * button / request-verification endpoint). Called by the report_verification
 * MCP tool, never directly by the browser UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WorkUnitDTO } from "@/lib/types";

const VALID_OUTCOMES = ["passed", "failed"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { outcome, summary, verificationSteps } = body ?? {};

    if (!VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: `outcome must be one of: ${VALID_OUTCOMES.join(", ")}` },
        { status: 400 }
      );
    }
    if (typeof summary !== "string" || summary.trim() === "") {
      return NextResponse.json({ error: "summary is required" }, { status: 400 });
    }

    const workUnit = await prisma.workUnit.findUnique({ where: { id } });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }

    const updated = await prisma.workUnit.update({
      where: { id },
      data: {
        verifiedAt: new Date(),
        verificationOutcome: outcome,
        verificationSummary: summary,
        verificationRequestedAt: null,
        ...(typeof verificationSteps === "string" && !workUnit.verification
          ? { verification: verificationSteps }
          : {}),
      },
    });

    const dto: WorkUnitDTO = {
      id: updated.id,
      storyId: updated.storyId,
      title: updated.title,
      description: updated.description,
      acceptanceCriteria: updated.acceptanceCriteria,
      verification: updated.verification,
      column: updated.column as WorkUnitDTO["column"],
      order: updated.order,
      subNumber: updated.subNumber,
      createdAt: updated.createdAt.toISOString(),
      completedAt: updated.completedAt?.toISOString() ?? null,
      archivedAt: updated.archivedAt?.toISOString() ?? null,
      verificationRequestedAt: updated.verificationRequestedAt?.toISOString() ?? null,
      verifiedAt: updated.verifiedAt?.toISOString() ?? null,
      verificationOutcome: updated.verificationOutcome as WorkUnitDTO["verificationOutcome"],
      verificationSummary: updated.verificationSummary,
    };

    return NextResponse.json(dto);
  } catch (error) {
    console.error("Error reporting verification:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/work-units/[id]/request-verification/route.test.ts" "src/app/api/work-units/[id]/report-verification/route.test.ts"`
Expected: PASS (3/3 and 6/6)

- [ ] **Step 9: Commit**

```bash
git add "src/app/api/work-units/[id]/request-verification" "src/app/api/work-units/[id]/report-verification"
git commit -m "feat: add request-verification and report-verification endpoints"
```

---

### Task 3: MCP — pendingVerification filter and report_verification tool

**Files:**
- Modify: `src/mcp/client.ts` (add `reportVerification` method)
- Modify: `src/mcp/tools.ts` (extend `listWorkUnits`, add `reportVerification`)
- Modify: `src/mcp/server.ts` (register the new tool, extend `list_work_units`'s schema)
- Modify: `src/mcp/tools.test.ts`
- Modify: `src/mcp/server.test.ts`
- Modify: `README-mcp.md` (tools reference table + example prompts)

**Interfaces:**
- Consumes: `POST /api/work-units/[id]/report-verification` from Task 2 (exact body shape: `{ outcome, summary, verificationSteps? }`); `WorkUnitDTO.verificationRequestedAt`/`verifiedAt`/`verification` from Task 1.
- Produces: `PonderClient.reportVerification(id, outcome, summary, verificationSteps?): Promise<WorkUnitDTO>`; MCP tools `list_work_units` (now accepts `pendingVerification?: boolean`) and `report_verification(workUnitId, outcome, summary, verificationSteps?)`.

- [ ] **Step 1: Write the failing test for the client method**

Add to `src/mcp/client.test.ts` (open the file first to match its existing `fetchImpl` mock pattern — every other client method test in that file follows the same shape: construct `new PonderClient(baseUrl, fetchMock)`, assert the call and the returned value):

```typescript
describe("reportVerification", () => {
  it("POSTs outcome/summary/verificationSteps and returns the updated work unit", async () => {
    const workUnit = { id: "w1", verificationOutcome: "passed" } as WorkUnitDTO;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => workUnit,
    })) as unknown as typeof fetch;

    const client = new PonderClient("http://localhost:3000", fetchMock);
    const result = await client.reportVerification("w1", "passed", "Looks good", "1. Run it");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/work-units/w1/report-verification",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ outcome: "passed", summary: "Looks good", verificationSteps: "1. Run it" }),
      })
    );
    expect(result).toEqual(workUnit);
  });
});
```

(Match this file's existing import style for `WorkUnitDTO` and `vi` — do not duplicate imports already present at the top of `client.test.ts`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/client.test.ts`
Expected: FAIL — `reportVerification` is not a function.

- [ ] **Step 3: Implement the client method**

In `src/mcp/client.ts`, add this method after `updateWorkUnit`:

```typescript
  async reportVerification(
    id: string,
    outcome: "passed" | "failed",
    summary: string,
    verificationSteps?: string
  ): Promise<WorkUnitDTO> {
    return this.request<WorkUnitDTO>(
      "POST",
      `/api/work-units/${encodeURIComponent(id)}/report-verification`,
      verificationSteps !== undefined
        ? { outcome, summary, verificationSteps }
        : { outcome, summary }
    );
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/client.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for the tool functions**

Add to `src/mcp/tools.test.ts`. First, extend the shared `stories` fixture's Task D (`code_review`, id `w4`) — find the existing `w4` entry and add `verificationRequestedAt`, `verifiedAt`, `verificationOutcome`, `verificationSummary` fields set to `null` (all other work units in the fixture need the same four fields added as `null` too, since `WorkUnitDTO` now requires them — the TypeScript compiler will point at every fixture object missing them).

Then add these two new `describe` blocks after the existing `describe("listWorkUnits", ...)` block:

```typescript
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
```

Update the top-of-file import to add `reportVerification`:

```typescript
import {
  attachImage,
  listProjects,
  listStories,
  listWorkUnits,
  markDone,
  moveWorkUnit,
  regenerateAcceptance,
  reportVerification,
  updateWorkUnit,
} from "./tools";
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/tools.test.ts`
Expected: FAIL — `reportVerification` is not exported from `./tools`, and `listWorkUnits` doesn't accept `pendingVerification`.

- [ ] **Step 7: Implement the tool changes**

In `src/mcp/tools.ts`, replace the `listWorkUnits` function with this version (adds the `pendingVerification` filter and per-row verification-steps note):

```typescript
export async function listWorkUnits(
  client: PonderClient,
  args: { projectId: string; column?: string; pendingVerification?: boolean }
): Promise<McpTextResult> {
  const validColumns = COLUMNS.map((c) => c.key);

  if (args.column !== undefined && !validColumns.includes(args.column as Column)) {
    return textResult(
      `Invalid column "${args.column}". Valid columns: ${validColumns.join(", ")}.`
    );
  }

  const stories = await client.getStories(args.projectId);
  const column = args.column as Column | undefined;

  const rows: {
    id: string;
    title: string;
    column: Column;
    jiraKey: string;
    verification: string | null;
  }[] = [];
  for (const story of stories) {
    for (const workUnit of story.workUnits) {
      if (column && workUnit.column !== column) continue;
      if (args.pendingVerification) {
        if (!workUnit.verificationRequestedAt || workUnit.verifiedAt) continue;
      }
      rows.push({
        id: workUnit.id,
        title: workUnit.title,
        column: workUnit.column,
        jiraKey: story.jiraKey,
        verification: workUnit.verification,
      });
    }
  }

  if (rows.length === 0) {
    if (args.pendingVerification) {
      return textResult(`No work units pending verification for project ${args.projectId}.`);
    }
    return textResult(
      column
        ? `No work units in column "${column}" for project ${args.projectId}.`
        : `No work units found for project ${args.projectId}.`
    );
  }

  const lines = rows.map((row) => {
    const verificationNote = args.pendingVerification
      ? ` — verification steps: ${row.verification ?? "(missing — document them as you verify)"}`
      : "";
    return `- ${row.title} (id: ${row.id}, column: ${row.column}, story: ${row.jiraKey})${verificationNote}`;
  });

  return textResult(`${rows.length} work unit(s):\n${lines.join("\n")}`);
}
```

Then add this new function after `attachImage` (at the end of the file):

```typescript
/** Report the outcome of an AI-agent verification run (see the Verify button). */
export async function reportVerification(
  client: PonderClient,
  args: {
    workUnitId: string;
    outcome: "passed" | "failed";
    summary: string;
    verificationSteps?: string;
  }
): Promise<McpTextResult> {
  try {
    const workUnit = await client.reportVerification(
      args.workUnitId,
      args.outcome,
      args.summary,
      args.verificationSteps
    );
    return textResult(
      `Recorded verification result "${args.outcome}" for work unit ${workUnit.id}.`
    );
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/tools.test.ts`
Expected: PASS

- [ ] **Step 9: Write the failing test for server registration**

In `src/mcp/server.test.ts`, add `"report_verification"` to the expected tool-name array:

```typescript
    expect(registeredNames.sort()).toEqual(
      [
        "list_projects",
        "list_stories",
        "list_work_units",
        "move_work_unit",
        "mark_done",
        "update_work_unit",
        "regenerate_acceptance",
        "attach_image",
        "report_verification",
      ].sort()
    );
```

Also update the test's title from "registers the eight expected tools" to "registers the nine expected tools".

- [ ] **Step 10: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/server.test.ts`
Expected: FAIL — only eight tools registered.

- [ ] **Step 11: Register the tool and extend list_work_units's schema**

In `src/mcp/server.ts`, update the import to add `reportVerification`:

```typescript
import {
  attachImage,
  listProjects,
  listStories,
  listWorkUnits,
  markDone,
  moveWorkUnit,
  regenerateAcceptance,
  reportVerification,
  updateWorkUnit,
} from "./tools";
```

Replace the `list_work_units` registration with:

```typescript
  server.registerTool(
    "list_work_units",
    {
      description:
        "List work units for a project, optionally filtered to a single column, " +
        "or to only those pending AI-agent verification (pendingVerification: true).",
      inputSchema: {
        projectId: z.string(),
        column: z.string().optional(),
        pendingVerification: z.boolean().optional(),
      },
    },
    async ({ projectId, column, pendingVerification }) =>
      listWorkUnits(client, { projectId, column, pendingVerification })
  );
```

Add this new registration after `attach_image`'s, before the closing `return server;`:

```typescript
  server.registerTool(
    "report_verification",
    {
      description:
        "Report the result of an AI-agent verification run for a Code Review " +
        "work unit (requested via the Verify button). Attach the supporting " +
        "screenshot separately with attach_image before or after calling this. " +
        "If the work unit had no documented verification steps, pass " +
        "verificationSteps to record what you ran.",
      inputSchema: {
        workUnitId: z.string(),
        outcome: z.enum(["passed", "failed"]),
        summary: z.string(),
        verificationSteps: z.string().optional(),
      },
    },
    async ({ workUnitId, outcome, summary, verificationSteps }) =>
      reportVerification(client, { workUnitId, outcome, summary, verificationSteps })
  );
```

- [ ] **Step 12: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/server.test.ts`
Expected: PASS

- [ ] **Step 13: Update README-mcp.md**

In `README-mcp.md`'s tools table, add a row after `update_work_unit`:

```markdown
| `report_verification` | `workUnitId`, `outcome` (`passed`\|`failed`), `summary`, `verificationSteps?` | Report the result of an AI-agent verification run requested via Ponder's Verify button. Attach the screenshot separately with `attach_image`. |
```

Update the `list_work_units` row's args column to `projectId`, `column?`, `pendingVerification?`.

Add an example prompt after the existing ones:

```markdown
- "List work units pending verification for project acme-web, verify each one, attach a screenshot, and report the result."
```

- [ ] **Step 14: Commit**

```bash
git add src/mcp/client.ts src/mcp/tools.ts src/mcp/server.ts src/mcp/client.test.ts src/mcp/tools.test.ts src/mcp/server.test.ts README-mcp.md
git commit -m "feat: add report_verification MCP tool and pendingVerification filter"
```

---

### Task 4: WorkUnitCard — Verify button and four UI states

**Files:**
- Modify: `src/components/WorkUnitCard.tsx`
- Modify: `src/components/WorkUnitCard.test.tsx`

**Interfaces:**
- Consumes: `WorkUnitDTO.verificationRequestedAt`/`verifiedAt`/`verificationOutcome`/`verificationSummary` (Task 1); `POST /api/work-units/[id]/request-verification` (Task 2, exact path and 200/404/422 response shape).
- Produces: `data-testid={`verify-button-${workUnit.id}`}` and `data-testid={`verification-badge-${workUnit.id}`}` for Task 5 (or any later consumer) to query against.

- [ ] **Step 1: Write the failing tests for all four states**

Add to `src/components/WorkUnitCard.test.tsx`, after the existing `describe("Move to QA", ...)` block. First, add the four new nullable fields (all `null`) to the top-of-file `mockWorkUnit` fixture:

```typescript
  verificationRequestedAt: null,
  verifiedAt: null,
  verificationOutcome: null,
  verificationSummary: null,
```

Then add:

```typescript
  describe("Verify", () => {
    const codeReviewUnit: WorkUnitDTO = { ...mockWorkUnit, column: "code_review" };

    it("renders an enabled Verify button only for a Code Review card with no request yet", () => {
      const { rerender } = render(<WorkUnitCard workUnit={codeReviewUnit} />);
      const button = screen.getByTestId(`verify-button-${codeReviewUnit.id}`);
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
      expect(button).toHaveTextContent("Verify");

      rerender(<WorkUnitCard workUnit={mockWorkUnit} />);
      expect(screen.queryByTestId(`verify-button-${mockWorkUnit.id}`)).not.toBeInTheDocument();
    });

    it("POSTs to request-verification and shows a disabled Verifying… button while pending", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...codeReviewUnit, verificationRequestedAt: "2026-07-04T00:00:00Z" }),
      } as Response);

      const onUpdate = vi.fn();
      render(<WorkUnitCard workUnit={codeReviewUnit} onUpdate={onUpdate} />);

      fireEvent.click(screen.getByTestId(`verify-button-${codeReviewUnit.id}`));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          `/api/work-units/${codeReviewUnit.id}/request-verification`,
          expect.objectContaining({ method: "POST" })
        );
      });
      expect(onUpdate).toHaveBeenCalled();
    });

    it("shows a disabled Verifying… button when verificationRequestedAt is already set", () => {
      const pendingUnit: WorkUnitDTO = {
        ...codeReviewUnit,
        verificationRequestedAt: "2026-07-04T00:00:00Z",
      };
      render(<WorkUnitCard workUnit={pendingUnit} />);
      const button = screen.getByTestId(`verify-button-${pendingUnit.id}`);
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Verifying…");
    });

    it("shows a green Verified badge and no button when outcome is passed", () => {
      const passedUnit: WorkUnitDTO = {
        ...codeReviewUnit,
        verifiedAt: "2026-07-04T00:00:00Z",
        verificationOutcome: "passed",
        verificationSummary: "Looks good",
      };
      render(<WorkUnitCard workUnit={passedUnit} />);
      expect(screen.getByTestId(`verification-badge-${passedUnit.id}`)).toHaveTextContent(/verified/i);
      expect(screen.queryByTestId(`verify-button-${passedUnit.id}`)).not.toBeInTheDocument();
    });

    it("shows a red Verification failed badge and a re-enabled button when outcome is failed", () => {
      const failedUnit: WorkUnitDTO = {
        ...codeReviewUnit,
        verifiedAt: "2026-07-04T00:00:00Z",
        verificationOutcome: "failed",
        verificationSummary: "Still broken",
      };
      render(<WorkUnitCard workUnit={failedUnit} />);
      const badge = screen.getByTestId(`verification-badge-${failedUnit.id}`);
      expect(badge).toHaveTextContent(/verification failed/i);
      expect(badge).toHaveAttribute("title", "Still broken");
      expect(screen.getByTestId(`verify-button-${failedUnit.id}`)).not.toBeDisabled();
    });

    it("alerts with the server's error message on failure", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Work unit must be in Code Review to request verification" }),
      } as Response);
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

      render(<WorkUnitCard workUnit={codeReviewUnit} />);
      fireEvent.click(screen.getByTestId(`verify-button-${codeReviewUnit.id}`));

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.stringContaining("Code Review")
        );
      });

      alertSpy.mockRestore();
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitCard.test.tsx`
Expected: FAIL — no `verify-button-*`/`verification-badge-*` test ids exist yet, and the `mockWorkUnit` fixture is missing required `WorkUnitDTO` fields (TypeScript compile error) until Step 1's fixture edit is in place.

- [ ] **Step 3: Implement the Verify button and its four states**

In `src/components/WorkUnitCard.tsx`, add a new state variable next to `isMovingToQA` (~line 75):

```typescript
  const [isRequestingVerification, setIsRequestingVerification] = useState(false);
```

Add a new handler after `handleMoveToQA` (~line 220):

```typescript
  const handleRequestVerification = async () => {
    setIsRequestingVerification(true);
    try {
      const response = await fetch(`/api/work-units/${workUnit.id}/request-verification`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Failed to request verification");
        return;
      }

      onUpdate?.(workUnit.id, {
        verificationRequestedAt: data.verificationRequestedAt,
        verifiedAt: data.verifiedAt,
        verificationOutcome: data.verificationOutcome,
        verificationSummary: data.verificationSummary,
      });
    } catch (error) {
      console.error("Error requesting verification:", error);
      alert("Failed to request verification");
    } finally {
      setIsRequestingVerification(false);
    }
  };
```

Add the rendering logic in the action-buttons row, right after the existing Move-to-QA block (~line 453, immediately before the row's closing `</div>`):

```tsx
        {workUnit.column === "code_review" &&
          (workUnit.verificationOutcome === "passed" ? (
            <span
              className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg ${
                isDark
                  ? "bg-green-900/50 text-green-200"
                  : "bg-green-100 text-green-800"
              }`}
              data-testid={`verification-badge-${workUnit.id}`}
            >
              Verified ✓
            </span>
          ) : (
            <>
              {workUnit.verificationOutcome === "failed" && (
                <span
                  title={workUnit.verificationSummary ?? undefined}
                  className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg ${
                    isDark
                      ? "bg-red-900/50 text-red-200"
                      : "bg-red-100 text-red-800"
                  }`}
                  data-testid={`verification-badge-${workUnit.id}`}
                >
                  Verification failed
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRequestVerification();
                }}
                disabled={isRequestingVerification || !!workUnit.verificationRequestedAt}
                aria-label={`Request verification for ${workUnit.title}`}
                className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg transition-colors disabled:opacity-50 ${focusRing} ${
                  isDark
                    ? "bg-blue-900/50 text-blue-200 hover:bg-blue-900/70"
                    : "bg-blue-100 text-blue-800 hover:bg-blue-200"
                }`}
                data-testid={`verify-button-${workUnit.id}`}
              >
                {isRequestingVerification || workUnit.verificationRequestedAt
                  ? "Verifying…"
                  : "Verify"}
              </button>
            </>
          ))}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkUnitCard.tsx src/components/WorkUnitCard.test.tsx
git commit -m "feat: add Verify button and verification states to Code Review cards"
```

---

### Task 5: WorkUnitDetailModal — surface verification result

**Files:**
- Modify: `src/components/WorkUnitDetailModal.tsx`
- Modify: `src/components/WorkUnitDetailModal.test.tsx`

**Interfaces:**
- Consumes: `WorkUnitDTO.verifiedAt`/`verificationOutcome`/`verificationSummary` (Task 1). Screenshot rendering is unchanged — this task adds a text summary next to the existing Verification field, it does not touch the attachments section.

- [ ] **Step 1: Write the failing test**

Add to `src/components/WorkUnitDetailModal.test.tsx` (match the existing file's `baseWorkUnit` fixture pattern — find it near the top and add the four new fields as `null` there first, the same way Task 4 did for `WorkUnitCard.test.tsx`'s fixture):

```typescript
  it("shows the verification result when the work unit has been verified", () => {
    const verifiedUnit: WorkUnitDTO = {
      ...baseWorkUnit,
      verifiedAt: "2026-07-04T12:00:00Z",
      verificationOutcome: "passed",
      verificationSummary: "Confirmed the fix resolves the bug.",
    };
    render(
      <WorkUnitDetailModal
        workUnit={verifiedUnit}
        isOpen={true}
        onClose={() => {}}
      />
    );

    const result = screen.getByTestId("work-unit-detail-verification-result");
    expect(result).toHaveTextContent(/passed/i);
    expect(result).toHaveTextContent("Confirmed the fix resolves the bug.");
  });

  it("omits the verification result section when never verified", () => {
    render(
      <WorkUnitDetailModal
        workUnit={baseWorkUnit}
        isOpen={true}
        onClose={() => {}}
      />
    );

    expect(screen.queryByTestId("work-unit-detail-verification-result")).not.toBeInTheDocument();
  });
```

(Place these inside whichever existing top-level `describe` block groups the read-only display assertions — follow this test file's existing organization rather than starting a new top-level `describe`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitDetailModal.test.tsx`
Expected: FAIL — `work-unit-detail-verification-result` test id doesn't exist.

- [ ] **Step 3: Implement the verification result section**

In `src/components/WorkUnitDetailModal.tsx`, add this block immediately after the existing Verification `<div>` (right after the closing `</div>` at ~line 505, before the "Regenerate" button's `<div>`):

```tsx
              {workUnit.verifiedAt && (
                <div
                  data-testid="work-unit-detail-verification-result"
                  className={`text-sm rounded-lg p-3 ${
                    workUnit.verificationOutcome === "passed"
                      ? isDark
                        ? "bg-green-900/30 text-green-200"
                        : "bg-green-50 text-green-800"
                      : isDark
                        ? "bg-red-900/30 text-red-200"
                        : "bg-red-50 text-red-800"
                  }`}
                >
                  <p className="font-semibold">
                    Verification {workUnit.verificationOutcome === "passed" ? "passed" : "failed"} —{" "}
                    {formatDateTime(workUnit.verifiedAt)}
                  </p>
                  {workUnit.verificationSummary && (
                    <p className="mt-1 whitespace-pre-wrap">{workUnit.verificationSummary}</p>
                  )}
                </div>
              )}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitDetailModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkUnitDetailModal.tsx src/components/WorkUnitDetailModal.test.tsx
git commit -m "feat: surface verification result in the work unit detail modal"
```

---

### Final verification (after all 5 tasks)

Run the full checks used at the end of every prior feature branch in this repo:

```bash
npx tsc --noEmit
npm run lint
npx dotenv -e .env.test -- vitest run --no-file-parallelism
npx knip
```

Expected: no type errors, lint clean (pre-existing warnings acceptable, per this repo's established baseline), full suite green, no new unused-export findings from knip.
