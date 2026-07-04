# Per-Card Move-to-QA Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Move-to-QA from an all-or-nothing story transition into a two-phase flow: every click posts that work unit's own evidence to JIRA, and only the last sibling's click triggers the actual JIRA transition + archive.

**Architecture:** `WorkUnit` gains one new field, `movedToQaReportedAt`. A new `reportWorkUnitToQA` function in `src/lib/statusTrigger.ts` posts a per-work-unit JIRA comment + uploads that work unit's own attachments, sets `movedToQaReportedAt` on success, then checks story-wide readiness (every active work unit both Done and reported) before delegating to the existing `transitionStoryToQA` for the JIRA transition + archive-all. The `POST /api/work-units/[id]/move-to-qa` route calls this new function instead of `transitionStoryToQA` directly.

**Tech Stack:** Next.js 15 App Router API routes, Prisma 7 + PostgreSQL, React 18 + Tailwind (`WorkUnitCard`), Vitest.

## Global Constraints

- `movedToQaReportedAt` is a nullable `DateTime?`, following the exact pattern of `archivedAt`/`completedAt` (see `prisma/schema.prisma:47-69` and migration precedent `prisma/migrations/20260703222511_add_work_unit_archived_at/migration.sql`).
- No AI/Claude call for the per-card comment — it's built directly from the work unit's own `title`, `description`, `acceptanceCriteria`, `verification` fields.
- Comment-post or attachment-upload failure aborts the whole click: nothing is marked reported, the error is surfaced to the user exactly like today's existing Move-to-QA error pattern (not the silent non-blocking pattern `applyStoryStatusSync` uses elsewhere).
- Response shape from `POST /api/work-units/[id]/move-to-qa`: `{ ok: true, transitioned: boolean }` on success (200), `{ error: string }` on failure (404/422).
- The button only renders when `workUnit.column === "done" && storyKey` (unchanged gating from today).
- Test command convention: `npx dotenv -e .env.test -- vitest run --no-file-parallelism <path>` (always serial).
- Every `WorkUnitDTO`-serializing spot and every full-`WorkUnitDTO`-literal test fixture in the repo must carry the new field — see Task 1's exhaustive file list (a prior feature branch left 4 fixture files orphaned by doing this non-exhaustively; this plan lists every spot up front instead).

---

### Task 1: Data model — schema, migration, DTO, and every fixture/serialization spot

**Files:**
- Modify: `prisma/schema.prisma` (WorkUnit model, `prisma/schema.prisma:47-69`)
- Create: `prisma/migrations/<timestamp>_add_work_unit_moved_to_qa_reported_at/migration.sql`
- Modify: `src/lib/types.ts` (`WorkUnitDTO`)
- Modify (DTO-serializing spots, 4 files): `src/app/api/stories/route.ts`, `src/app/api/work-units/route.ts` (its `workUnitToDTO` function AND the inline POST-handler DTO literal), `src/app/api/work-units/[id]/route.ts`, `src/app/api/work-units/[id]/move/route.ts`
- Modify (test fixtures with a full `WorkUnitDTO` literal, 7 files): `src/app/board/page.test.tsx`, `src/mcp/tools.test.ts`, `src/mcp/client.test.ts`, `src/components/WorkUnitCard.test.tsx`, `src/components/KanbanBoard.test.tsx`, `src/components/WorkUnitDetailModal.test.tsx`, `src/lib/dndReorder.test.ts`
- Test: `src/app/api/stories/route.test.ts`, `src/app/api/work-units.test.ts` (extend existing serialization assertions)

**Interfaces:**
- Produces: `WorkUnitDTO.movedToQaReportedAt: string | null`. Every later task reads/writes this exact field name.

- [ ] **Step 1: Add the field to the Prisma schema**

Edit `prisma/schema.prisma`, in the `WorkUnit` model, add after the existing `archivedAt DateTime?` line:

```prisma
  archivedAt          DateTime?
  movedToQaReportedAt DateTime?
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_work_unit_moved_to_qa_reported_at`

Expected: Prisma creates `prisma/migrations/<timestamp>_add_work_unit_moved_to_qa_reported_at/migration.sql` containing `ALTER TABLE "WorkUnit" ADD COLUMN "movedToQaReportedAt" TIMESTAMP(3);` (nullable, no default), applies it locally, regenerates the Prisma client. Also run the test-database schema sync script (check `package.json` for the exact `db:push:test`-style script name).

- [ ] **Step 3: Add the field to `WorkUnitDTO`**

Edit `src/lib/types.ts`, in `WorkUnitDTO`, add after the existing `archivedAt: string | null; // ISO string` line:

```typescript
  archivedAt: string | null; // ISO string
  movedToQaReportedAt: string | null; // ISO string
```

- [ ] **Step 4: Update every DTO-serializing spot**

In each of the four files below, find the existing line `archivedAt: wu.archivedAt?.toISOString() ?? null,` and add this line immediately after it:

```typescript
        movedToQaReportedAt: wu.movedToQaReportedAt?.toISOString() ?? null,
```

Apply in:
- `src/app/api/stories/route.ts` (~line 59)
- `src/app/api/work-units/route.ts` — **two** spots: the `workUnitToDTO` function (~line 37) AND the inline DTO literal inside the POST handler's story-workUnits `.map()` (~line 136). Also add `movedToQaReportedAt: Date | null;` to that function's parameter type object, alongside its existing `archivedAt: Date | null;` line.
- `src/app/api/work-units/[id]/route.ts` (~line 38, plus its parameter type object at ~line 24)
- `src/app/api/work-units/[id]/move/route.ts` (~line 37, plus its parameter type object at ~line 23)

- [ ] **Step 5: Add the field to every full-`WorkUnitDTO`-literal test fixture**

In each of the seven files below, find every object literal that already has a line `archivedAt: null,` (there may be more than one per file — a shared fixture plus inline variants) and add `movedToQaReportedAt: null,` immediately after each one, matching that line's exact indentation:

- `src/app/board/page.test.tsx`
- `src/mcp/tools.test.ts`
- `src/mcp/client.test.ts`
- `src/components/WorkUnitCard.test.tsx`
- `src/components/KanbanBoard.test.tsx`
- `src/components/WorkUnitDetailModal.test.tsx`
- `src/lib/dndReorder.test.ts`

Verify you got every occurrence by comparing counts before/after:

```bash
grep -c "archivedAt: null," src/app/board/page.test.tsx src/mcp/tools.test.ts src/mcp/client.test.ts src/components/WorkUnitCard.test.tsx src/components/KanbanBoard.test.tsx src/components/WorkUnitDetailModal.test.tsx src/lib/dndReorder.test.ts
grep -c "movedToQaReportedAt: null," src/app/board/page.test.tsx src/mcp/tools.test.ts src/mcp/client.test.ts src/components/WorkUnitCard.test.tsx src/components/KanbanBoard.test.tsx src/components/WorkUnitDetailModal.test.tsx src/lib/dndReorder.test.ts
```

Expected: the two count lists are identical, file by file.

- [ ] **Step 6: Run `tsc` and the full test suite to confirm nothing broke**

Run: `npx tsc --noEmit`
Expected: zero errors (this is the first task on a fresh branch — nothing should be mid-flight).

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism`
Expected: full suite passes, same count as before this task started (this task only adds a nullable field — no existing assertion should break).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/types.ts \
  src/app/api/stories/route.ts src/app/api/work-units/route.ts \
  "src/app/api/work-units/[id]/route.ts" "src/app/api/work-units/[id]/move/route.ts" \
  src/app/board/page.test.tsx src/mcp/tools.test.ts src/mcp/client.test.ts \
  src/components/WorkUnitCard.test.tsx src/components/KanbanBoard.test.tsx \
  src/components/WorkUnitDetailModal.test.tsx src/lib/dndReorder.test.ts
git commit -m "feat: add movedToQaReportedAt field to WorkUnit"
```

---

### Task 2: `reportWorkUnitToQA` — per-card comment/attachments + readiness gate

**Files:**
- Modify: `src/lib/statusTrigger.ts`
- Modify: `src/lib/statusTrigger.test.ts`

**Interfaces:**
- Consumes: `deps.addComment(issueKey, text, config): Promise<void>` and `deps.uploadAttachment(issueKey, file, config): Promise<void>` from `src/lib/jira/writeback.ts`; `deps.readAttachmentFile(id): Promise<Buffer>` from `src/lib/attachmentStorage.ts`; the existing `transitionStoryToQA(storyId, prisma, deps)` (unchanged signature, already in this file); `WorkUnit.movedToQaReportedAt` from Task 1.
- Produces: `computeStoryQaReadiness(workUnits: { column: string; movedToQaReportedAt: Date | null }[]): boolean` (exported pure helper) and `reportWorkUnitToQA(workUnitId: string, prisma: PrismaClient, deps?): Promise<TransitionStoryToQAResult & { transitioned?: boolean }>`. Task 3 (the route) calls `reportWorkUnitToQA` by this exact name and signature; on success the result includes `transitioned: boolean`.

- [ ] **Step 1: Write the failing tests for `computeStoryQaReadiness`**

Add to `src/lib/statusTrigger.test.ts`, in a new `describe` block near the top (next to the existing `computeDesiredJiraStatus` tests):

```typescript
describe("computeStoryQaReadiness", () => {
  it("returns false when there are no work units", () => {
    expect(computeStoryQaReadiness([])).toBe(false);
  });

  it("returns false when any work unit isn't done", () => {
    expect(
      computeStoryQaReadiness([
        { column: "done", movedToQaReportedAt: new Date() },
        { column: "code_review", movedToQaReportedAt: null },
      ])
    ).toBe(false);
  });

  it("returns false when any done work unit hasn't been reported", () => {
    expect(
      computeStoryQaReadiness([
        { column: "done", movedToQaReportedAt: new Date() },
        { column: "done", movedToQaReportedAt: null },
      ])
    ).toBe(false);
  });

  it("returns true when every work unit is done and reported", () => {
    expect(
      computeStoryQaReadiness([
        { column: "done", movedToQaReportedAt: new Date() },
        { column: "done", movedToQaReportedAt: new Date() },
      ])
    ).toBe(true);
  });
});
```

Add `computeStoryQaReadiness` to the file's existing import line for `statusTrigger.ts` exports at the top of the test file (match whatever import style the file already uses for `computeDesiredJiraStatus`).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts -t "computeStoryQaReadiness"`
Expected: FAIL — `computeStoryQaReadiness` is not exported.

- [ ] **Step 3: Implement `computeStoryQaReadiness`**

In `src/lib/statusTrigger.ts`, add this function near `computeDesiredJiraStatus` (reuse the existing `ColumnLike` type by extending it inline, since this needs one more field than `computeDesiredJiraStatus` does):

```typescript
/** Minimal shape `computeStoryQaReadiness` needs from a work unit. */
export type QaReadinessLike = { column: string; movedToQaReportedAt: Date | null };

/**
 * True once every one of a story's work units is both `column === "done"`
 * and has been individually reported to JIRA via the Move-to-QA button
 * (`movedToQaReportedAt` set). An empty list is never "ready" — there's
 * nothing to transition.
 */
export function computeStoryQaReadiness(workUnits: QaReadinessLike[]): boolean {
  if (workUnits.length === 0) {
    return false;
  }
  return workUnits.every((w) => w.column === "done" && w.movedToQaReportedAt != null);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts -t "computeStoryQaReadiness"`
Expected: PASS (4/4)

- [ ] **Step 5: Write the failing tests for `reportWorkUnitToQA`**

Add to `src/lib/statusTrigger.test.ts`, in a new `describe("reportWorkUnitToQA", ...)` block, placed after the existing `describe("transitionStoryToQA", ...)` block. Reuse that block's `makeJiraProject`/`makeStory` helper patterns (copy their bodies into this new describe block, or hoist them to file scope if the file's existing convention allows — follow whatever this file already does for sharing helpers between describe blocks):

```typescript
describe("reportWorkUnitToQA", () => {
  let testCounter = 0;

  beforeEach(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    await prisma.project.deleteMany({});
    testCounter++;
  });

  async function makeJiraProject() {
    return prisma.project.create({
      data: {
        name: `Report Test Project ${testCounter}`,
        type: "JIRA",
        jiraProjectKey: "TEAM",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "user@example.com",
        jiraApiToken: "token-123",
      },
    });
  }

  async function makeStory(overrides: Partial<Parameters<typeof prisma.story.create>[0]["data"]> = {}) {
    return prisma.story.create({
      data: {
        jiraKey: `TEAM-RPT-${testCounter}`,
        jiraId: `9200${testCounter}`,
        projectKey: "TEAM",
        summary: "Test story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/TEAM-RPT-${testCounter}`,
        lastSyncedAt: new Date(),
        ...overrides,
      },
    });
  }

  function fakeReportDeps(
    overrides: Partial<{
      getTransitions: ApplyStoryStatusSyncDeps["getTransitions"];
      transitionIssue: ApplyStoryStatusSyncDeps["transitionIssue"];
      addComment: ApplyStoryStatusSyncDeps["addComment"];
      uploadAttachment: ApplyStoryStatusSyncDeps["uploadAttachment"];
      readAttachmentFile: ApplyStoryStatusSyncDeps["readAttachmentFile"];
    }> = {}
  ) {
    return {
      getTransitions: vi.fn(async (): Promise<JiraTransition[]> => [
        { id: "2", name: "QA", to: { name: "QA", statusCategory: { key: "indeterminate" } } },
      ]),
      transitionIssue: vi.fn(async () => {}),
      addComment: vi.fn(async () => {}),
      uploadAttachment: vi.fn(async () => {}),
      readAttachmentFile: vi.fn(async () => Buffer.from("fake-image-bytes")),
      ...overrides,
    };
  }

  it("posts a comment built from the work unit's own fields, marks it reported, and does not transition when siblings aren't ready", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu1 = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 1",
        description: "Did the thing",
        acceptanceCriteria: "AC text",
        verification: "Verification text",
        column: "done",
        order: 0,
      },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "code_review", order: 1 },
    });

    const deps = fakeReportDeps();
    const result = await reportWorkUnitToQA(wu1.id, prisma, deps);

    expect(result).toEqual({ ok: true, transitioned: false });
    expect(deps.addComment).toHaveBeenCalledWith(
      story.jiraKey,
      expect.stringContaining("Task 1"),
      expect.any(Object)
    );
    expect(deps.addComment).toHaveBeenCalledWith(
      story.jiraKey,
      expect.stringContaining("AC text"),
      expect.any(Object)
    );
    expect(deps.transitionIssue).not.toHaveBeenCalled();

    const updated = await prisma.workUnit.findUnique({ where: { id: wu1.id } });
    expect(updated?.movedToQaReportedAt).not.toBeNull();
  });

  it("uploads the work unit's own attachments", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.attachment.create({
      data: { workUnitId: wu.id, filename: "shot.png", mimeType: "image/png", size: 123 },
    });

    const deps = fakeReportDeps();
    await reportWorkUnitToQA(wu.id, prisma, deps);

    expect(deps.readAttachmentFile).toHaveBeenCalledTimes(1);
    expect(deps.uploadAttachment).toHaveBeenCalledWith(
      story.jiraKey,
      expect.objectContaining({ filename: "shot.png", mimeType: "image/png" }),
      expect.any(Object)
    );
  });

  it("transitions and archives when this was the last sibling to be reported", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu1 = await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 1",
        column: "done",
        order: 0,
        movedToQaReportedAt: new Date(),
      },
    });
    const wu2 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "done", order: 1 },
    });

    const deps = fakeReportDeps();
    const result = await reportWorkUnitToQA(wu2.id, prisma, deps);

    expect(result).toEqual({ ok: true, transitioned: true });
    expect(deps.transitionIssue).toHaveBeenCalledWith(story.jiraKey, "2", expect.any(Object));

    const updatedStory = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updatedStory?.jiraStatus).toBe("QA");

    const updatedWu1 = await prisma.workUnit.findUnique({ where: { id: wu1.id } });
    const updatedWu2 = await prisma.workUnit.findUnique({ where: { id: wu2.id } });
    expect(updatedWu1?.archivedAt).not.toBeNull();
    expect(updatedWu2?.archivedAt).not.toBeNull();
  });

  it("fails without marking reported when addComment rejects", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const deps = fakeReportDeps({
      addComment: vi.fn(async () => {
        throw new Error("JIRA API error: 500");
      }),
    });
    const result = await reportWorkUnitToQA(wu.id, prisma, deps);

    expect(result.ok).toBe(false);
    const updated = await prisma.workUnit.findUnique({ where: { id: wu.id } });
    expect(updated?.movedToQaReportedAt).toBeNull();
  });

  it("fails without marking reported when uploadAttachment rejects", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.attachment.create({
      data: { workUnitId: wu.id, filename: "shot.png", mimeType: "image/png", size: 123 },
    });

    const deps = fakeReportDeps({
      uploadAttachment: vi.fn(async () => {
        throw new Error("JIRA API error: 500");
      }),
    });
    const result = await reportWorkUnitToQA(wu.id, prisma, deps);

    expect(result.ok).toBe(false);
    const updated = await prisma.workUnit.findUnique({ where: { id: wu.id } });
    expect(updated?.movedToQaReportedAt).toBeNull();
  });

  it("returns an error for a missing work unit", async () => {
    const result = await reportWorkUnitToQA("does-not-exist", prisma, fakeReportDeps());
    expect(result.ok).toBe(false);
  });

  it("returns an error when the project has no JIRA credentials", async () => {
    const story = await makeStory();
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const result = await reportWorkUnitToQA(wu.id, prisma, fakeReportDeps());
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts -t "reportWorkUnitToQA"`
Expected: FAIL — `reportWorkUnitToQA` is not exported.

- [ ] **Step 7: Implement `reportWorkUnitToQA`**

In `src/lib/statusTrigger.ts`, first widen the dependency bag. Find `ApplyStoryStatusSyncDeps` and confirm it already has `addComment`, `uploadAttachment`, `readAttachmentFile` (it does — `applyStoryStatusSync` already uses all three). Add this function at the end of the file, after `transitionStoryToQA`:

```typescript
/**
 * Posts one work unit's own evidence (title/description/acceptanceCriteria/
 * verification as a comment, its own attachments as JIRA attachments) to its
 * parent story's JIRA issue, then marks it reported. If every one of the
 * story's active work units is now Done AND reported, also runs
 * `transitionStoryToQA` (JIRA transition to QA + archive-all) as a second
 * step.
 *
 * Any failure posting the comment or uploading an attachment aborts before
 * `movedToQaReportedAt` is set — nothing is marked reported, matching this
 * action's human-triggered, error-surfacing contract (unlike
 * `applyStoryStatusSync`'s non-blocking automatic sync).
 */
export async function reportWorkUnitToQA(
  workUnitId: string,
  prisma: PrismaClient,
  deps: Pick<
    ApplyStoryStatusSyncDeps,
    "getTransitions" | "transitionIssue" | "addComment" | "uploadAttachment" | "readAttachmentFile"
  > = defaultDeps
): Promise<TransitionStoryToQAResult & { transitioned?: boolean }> {
  const workUnit = await prisma.workUnit.findUnique({
    where: { id: workUnitId },
    include: {
      attachments: true,
      story: { include: { project: true, workUnits: { where: { archivedAt: null } } } },
    },
  });

  if (!workUnit) {
    return { ok: false, error: `Work unit not found: ${workUnitId}` };
  }

  const story = workUnit.story;

  if (!hasJiraCredentials(story.project)) {
    return {
      ok: false,
      error: `Story ${story.jiraKey} has no fully-configured JIRA project`,
    };
  }

  const config: JiraConfig = {
    siteUrl: story.project.jiraSiteUrl,
    email: story.project.jiraEmail,
    apiToken: story.project.jiraApiToken,
  };

  const sections = [`${workUnit.title}`];
  if (workUnit.description) sections.push(`Description:\n${workUnit.description}`);
  if (workUnit.acceptanceCriteria) sections.push(`Acceptance Criteria:\n${workUnit.acceptanceCriteria}`);
  if (workUnit.verification) sections.push(`Verification:\n${workUnit.verification}`);
  const comment = sections.join("\n\n");

  try {
    await deps.addComment(story.jiraKey, comment, config);

    for (const attachment of workUnit.attachments) {
      const buffer = await deps.readAttachmentFile(attachment.id);
      await deps.uploadAttachment(
        story.jiraKey,
        { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
        config
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  await prisma.workUnit.update({
    where: { id: workUnitId },
    data: { movedToQaReportedAt: new Date() },
  });

  const siblingsAfterReport = story.workUnits.map((w) =>
    w.id === workUnitId ? { column: w.column, movedToQaReportedAt: new Date() } : w
  );

  if (!computeStoryQaReadiness(siblingsAfterReport)) {
    return { ok: true, transitioned: false };
  }

  const transitionResult = await transitionStoryToQA(story.id, prisma, deps);
  if (!transitionResult.ok) {
    return transitionResult;
  }
  return { ok: true, transitioned: true };
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts`
Expected: PASS (all tests in the file, including the new `computeStoryQaReadiness`/`reportWorkUnitToQA` blocks)

- [ ] **Step 9: Commit**

```bash
git add src/lib/statusTrigger.ts src/lib/statusTrigger.test.ts
git commit -m "feat: add reportWorkUnitToQA for per-card JIRA evidence reporting"
```

---

### Task 3: Wire the move-to-qa route to `reportWorkUnitToQA`

**Files:**
- Modify: `src/app/api/work-units/[id]/move-to-qa/route.ts`
- Modify: `src/app/api/work-units/[id]/move-to-qa/route.test.ts`

**Interfaces:**
- Consumes: `reportWorkUnitToQA(workUnitId, prisma, deps?): Promise<TransitionStoryToQAResult & { transitioned?: boolean }>` from Task 2.
- Produces: `POST /api/work-units/[id]/move-to-qa` → 200 `{ ok: true, transitioned: boolean }` | 404 `{ error }` | 422 `{ error }`. Task 4 (UI) reads `transitioned` from this response.

- [ ] **Step 1: Update the failing/changed tests**

Rewrite `src/app/api/work-units/[id]/move-to-qa/route.test.ts` in full:

```typescript
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/statusTrigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/statusTrigger")>();
  return { ...actual, reportWorkUnitToQA: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/move-to-qa/route";
import { reportWorkUnitToQA } from "@/lib/statusTrigger";

describe("POST /api/work-units/[id]/move-to-qa", () => {
  let workUnitId: string;
  let counter = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    counter++;
    const story = await prisma.story.create({
      data: {
        jiraKey: `MVQA-${counter}`,
        jiraId: `9200${counter}`,
        projectKey: "MVQA",
        summary: "Story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/MVQA-${counter}`,
        lastSyncedAt: new Date(),
      },
    });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task", column: "done", order: 0 },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("returns 200 with transitioned: false and calls reportWorkUnitToQA with the work unit's id", async () => {
    vi.mocked(reportWorkUnitToQA).mockResolvedValueOnce({ ok: true, transitioned: false });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, transitioned: false });
    expect(reportWorkUnitToQA).toHaveBeenCalledWith(workUnitId, expect.anything());
  });

  it("returns 200 with transitioned: true when this was the last sibling reported", async () => {
    vi.mocked(reportWorkUnitToQA).mockResolvedValueOnce({ ok: true, transitioned: true });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, transitioned: true });
  });

  it("returns 422 with the error message when reportWorkUnitToQA reports failure", async () => {
    vi.mocked(reportWorkUnitToQA).mockResolvedValueOnce({
      ok: false,
      error: "JIRA API error: 500",
    });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("JIRA API error");
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "does-not-exist" }),
    });

    expect(res.status).toBe(404);
    expect(reportWorkUnitToQA).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/work-units/[id]/move-to-qa/route.test.ts"`
Expected: FAIL — the route still imports/calls `transitionStoryToQA`, not `reportWorkUnitToQA`, and the response shape doesn't include `transitioned`.

- [ ] **Step 3: Rewrite the route**

Replace `src/app/api/work-units/[id]/move-to-qa/route.ts` in full:

```typescript
/**
 * POST /api/work-units/[id]/move-to-qa
 *
 * Posts this work unit's own evidence (title/description/acceptanceCriteria/
 * verification, its own attachments) to its parent story's JIRA issue as a
 * comment, then marks it reported. Once every one of the story's active work
 * units is both Done and reported, this also transitions the JIRA story to
 * QA and archives them all — see `reportWorkUnitToQA` for the full rule.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportWorkUnitToQA } from "@/lib/statusTrigger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }

    const result = await reportWorkUnitToQA(id, prisma);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({ ok: true, transitioned: !!result.transitioned });
  } catch (error) {
    console.error("Error reporting work unit to QA:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/work-units/[id]/move-to-qa/route.test.ts"`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/work-units/[id]/move-to-qa/route.ts" "src/app/api/work-units/[id]/move-to-qa/route.test.ts"
git commit -m "feat: wire move-to-qa route to reportWorkUnitToQA"
```

---

### Task 4: WorkUnitCard — reported badge and differentiated toast messaging

**Files:**
- Modify: `src/components/WorkUnitCard.tsx`
- Modify: `src/components/WorkUnitCard.test.tsx`

**Interfaces:**
- Consumes: `WorkUnitDTO.movedToQaReportedAt` (Task 1); `POST /api/work-units/[id]/move-to-qa` response `{ ok: true, transitioned: boolean }` (Task 3, exact shape).

- [ ] **Step 1: Write the failing tests**

In `src/components/WorkUnitCard.test.tsx`, replace the existing `describe("Move to QA", ...)` block in full:

```typescript
  describe("Move to QA", () => {
    const doneWorkUnit: WorkUnitDTO = { ...mockWorkUnit, column: "done" };

    it("renders the button only for a Done, JIRA-linked card with no report yet", () => {
      const { rerender } = render(
        <WorkUnitCard workUnit={doneWorkUnit} storyKey="COM-1" />
      );
      expect(
        screen.getByTestId(`move-to-qa-button-${doneWorkUnit.id}`)
      ).toBeInTheDocument();

      rerender(<WorkUnitCard workUnit={mockWorkUnit} storyKey="COM-1" />);
      expect(
        screen.queryByTestId(`move-to-qa-button-${mockWorkUnit.id}`)
      ).not.toBeInTheDocument();

      rerender(<WorkUnitCard workUnit={doneWorkUnit} />);
      expect(
        screen.queryByTestId(`move-to-qa-button-${doneWorkUnit.id}`)
      ).not.toBeInTheDocument();
    });

    it("shows a Reported to JIRA badge instead of the button once movedToQaReportedAt is set", () => {
      const reportedUnit: WorkUnitDTO = {
        ...doneWorkUnit,
        movedToQaReportedAt: "2026-07-04T00:00:00Z",
      };
      render(<WorkUnitCard workUnit={reportedUnit} storyKey="COM-1" />);

      expect(screen.getByTestId(`move-to-qa-reported-badge-${reportedUnit.id}`)).toHaveTextContent(
        /reported to jira/i
      );
      expect(
        screen.queryByTestId(`move-to-qa-button-${reportedUnit.id}`)
      ).not.toBeInTheDocument();
    });

    it("POSTs to the move-to-qa endpoint and reports a non-count message when not transitioned", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, transitioned: false }),
      } as Response);

      const onStatusMessage = vi.fn();
      const onUpdate = vi.fn();
      render(
        <WorkUnitCard
          workUnit={doneWorkUnit}
          storyKey="COM-1"
          onStatusMessage={onStatusMessage}
          onUpdate={onUpdate}
        />
      );

      fireEvent.click(screen.getByTestId(`move-to-qa-button-${doneWorkUnit.id}`));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/work-units/${doneWorkUnit.id}/move-to-qa`,
          expect.objectContaining({ method: "POST" })
        );
        expect(onStatusMessage).toHaveBeenCalledWith(
          expect.stringContaining(doneWorkUnit.title)
        );
        expect(onStatusMessage).not.toHaveBeenCalledWith(
          expect.stringContaining("QA")
        );
        expect(onUpdate).toHaveBeenCalled();
      });
    });

    it("reports the existing 'Moved to JIRA QA' message when transitioned is true", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, transitioned: true }),
      } as Response);

      const onStatusMessage = vi.fn();
      render(
        <WorkUnitCard
          workUnit={doneWorkUnit}
          storyKey="COM-1"
          onStatusMessage={onStatusMessage}
        />
      );

      fireEvent.click(screen.getByTestId(`move-to-qa-button-${doneWorkUnit.id}`));

      await waitFor(() => {
        expect(onStatusMessage).toHaveBeenCalledWith(
          expect.stringContaining("COM-1")
        );
        expect(onStatusMessage).toHaveBeenCalledWith(
          expect.stringContaining("JIRA QA")
        );
      });
    });

    it("alerts with the server's error message on failure, without calling onStatusMessage", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "JIRA API error: 500" }),
      } as Response);
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

      const onStatusMessage = vi.fn();
      render(
        <WorkUnitCard
          workUnit={doneWorkUnit}
          storyKey="COM-1"
          onStatusMessage={onStatusMessage}
        />
      );

      fireEvent.click(screen.getByTestId(`move-to-qa-button-${doneWorkUnit.id}`));

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.stringContaining("JIRA API error")
        );
      });
      expect(onStatusMessage).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });
  });
```

Also add `movedToQaReportedAt: null,` to the top-of-file `mockWorkUnit` fixture (Task 1 already required this across the repo — confirm it's present; if Task 1 already added it, skip).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitCard.test.tsx`
Expected: FAIL — no `move-to-qa-reported-badge-*` test id exists yet, and the message/response-shape assertions don't match current behavior.

- [ ] **Step 3: Update `WorkUnitCard.tsx`**

Replace the existing `handleMoveToQA` function (~line 200) with:

```typescript
  const handleMoveToQA = async () => {
    setIsMovingToQA(true);
    try {
      const response = await fetch(`/api/work-units/${workUnit.id}/move-to-qa`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Failed to move story to QA");
        return;
      }

      if (data.transitioned) {
        onStatusMessage?.(`Moved "${storyKey}" to JIRA QA`);
      } else {
        onStatusMessage?.(`Reported "${workUnit.title}" to JIRA`);
      }
      onUpdate?.(workUnit.id, {});
    } catch (error) {
      console.error("Error moving story to QA:", error);
      alert("Failed to move story to QA");
    } finally {
      setIsMovingToQA(false);
    }
  };
```

Replace the existing Move-to-QA button block (~line 436-453) with:

```tsx
        {workUnit.column === "done" && storyKey && (
          workUnit.movedToQaReportedAt ? (
            <span
              className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg ${
                isDark
                  ? "bg-emerald-900/50 text-emerald-200"
                  : "bg-emerald-100 text-emerald-800"
              }`}
              data-testid={`move-to-qa-reported-badge-${workUnit.id}`}
            >
              Reported to JIRA ✓
            </span>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleMoveToQA();
              }}
              disabled={isMovingToQA}
              aria-label={`Move ${storyKey} to JIRA QA`}
              className={`px-2 py-1.5 text-xs font-instrument font-semibold rounded-lg transition-colors disabled:opacity-50 ${focusRing} ${
                isDark
                  ? "bg-emerald-900/50 text-emerald-200 hover:bg-emerald-900/70"
                  : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
              }`}
              data-testid={`move-to-qa-button-${workUnit.id}`}
            >
              {isMovingToQA ? "Moving…" : "Move to QA"}
            </button>
          )
        )}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkUnitCard.tsx src/components/WorkUnitCard.test.tsx
git commit -m "feat: add Reported-to-JIRA badge and differentiated toast to Move-to-QA"
```

---

### Final verification (after all 4 tasks)

```bash
npx tsc --noEmit
npm run lint
npx dotenv -e .env.test -- vitest run --no-file-parallelism
npx knip
```

Expected: no type errors, lint clean (pre-existing warnings acceptable), full suite green, no new unused-export findings from knip.
