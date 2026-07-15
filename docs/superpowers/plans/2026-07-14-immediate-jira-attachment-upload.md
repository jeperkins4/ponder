# Immediate JIRA Attachment Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a screenshot or video is attached to a work unit (via the board UI or the MCP `attach_image` tool), also upload it to the original JIRA issue immediately — not just later, when the story completes or is moved to QA.

**Architecture:** `POST /api/work-units/[id]/attachments` is the single route both attachment paths already share. After it writes the file and creates the `Attachment` row, it calls a new orchestration function (`syncAttachmentToJira`) that uploads the same file to JIRA via the already-existing `uploadAttachment` (`src/lib/jira/writeback.ts`) and stamps `Attachment.jiraUploadedAt` on success. The two existing deferred-batch upload loops (`applyStoryStatusSync`, `reportWorkUnitToQA` in `src/lib/statusTrigger.ts`) gain a one-line skip so they never re-upload an attachment that `jiraUploadedAt` already marks as done — they remain in place as a safety net for cases where immediate upload failed or the project wasn't JIRA-linked yet.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, Vitest, JIRA REST API v3.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-14-immediate-jira-attachment-upload-design.md`.
- Non-blocking: a JIRA upload failure must never fail the attachment request or throw out of `syncAttachmentToJira` — matches `applyStoryStatusSync`'s existing convention exactly.
- No backfill: attachments created before this change keep `jiraUploadedAt: null` and are picked up normally by the existing deferred paths, unchanged.
- `applyStoryStatusSync` stays non-blocking; `reportWorkUnitToQA` stays blocking/error-surfacing. Neither function's existing contract changes — only a skip-if-already-uploaded condition is added to their attachment loops.
- Tests run via `npm test` / `npm run test:ci` only — never bare `npx vitest`.

---

### Task 1: Schema — `Attachment.jiraUploadedAt`

**Files:**
- Modify: `prisma/schema.prisma` (the `Attachment` model)
- Create: a new migration directory under `prisma/migrations/`

**Interfaces:**
- Produces: `Attachment.jiraUploadedAt: DateTime | null` — consumed by Task 2 (`syncAttachmentToJira`), Task 3 (route/DTO), Task 4 (`statusTrigger.ts`'s two loops).

- [ ] **Step 1: Add the nullable column**

In `prisma/schema.prisma`, the `Attachment` model currently reads:

```prisma
model Attachment {
  id         String   @id @default(cuid())
  workUnitId String
  workUnit   WorkUnit @relation(fields: [workUnitId], references: [id], onDelete: Cascade)
  filename   String
  mimeType   String
  size       Int
  createdAt  DateTime @default(now())

  @@index([workUnitId])
}
```

Add `jiraUploadedAt` right before `createdAt`:

```prisma
model Attachment {
  id             String    @id @default(cuid())
  workUnitId     String
  workUnit       WorkUnit  @relation(fields: [workUnitId], references: [id], onDelete: Cascade)
  filename       String
  mimeType       String
  size           Int
  jiraUploadedAt DateTime?
  createdAt      DateTime  @default(now())

  @@index([workUnitId])
}
```

- [ ] **Step 2: Generate and apply the migration (dev DB)**

Run: `npx prisma migrate dev --name add_attachment_jira_uploaded_at`

Expected: Prisma creates `prisma/migrations/<timestamp>_add_attachment_jira_uploaded_at/migration.sql` containing:

```sql
-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "jiraUploadedAt" TIMESTAMP(3);
```

and applies it to the dev database, regenerating the Prisma client.

- [ ] **Step 3: Push the same schema to the test DB**

Run: `npm run db:push:test`

Expected: command exits 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add jiraUploadedAt column to Attachment"
```

---

### Task 2: `syncAttachmentToJira` orchestration function

**Files:**
- Modify: `src/lib/statusTrigger.ts` (export `hasJiraCredentials`)
- Create: `src/lib/attachmentJiraSync.ts`
- Test: `src/lib/attachmentJiraSync.test.ts`

**Interfaces:**
- Consumes: `hasJiraCredentials` (exported from `statusTrigger.ts`); `uploadAttachment` (`src/lib/jira/writeback.ts`); `readAttachmentFile` (`src/lib/attachmentStorage.ts`); `JiraConfig` (`src/lib/jira/client.ts`).
- Produces: `syncAttachmentToJira(attachmentId: string, prisma: PrismaClient, deps?: SyncAttachmentToJiraDeps): Promise<{ uploaded: boolean; warning?: string }>` — consumed by Task 3 (the attachments route).

- [ ] **Step 1: Export `hasJiraCredentials` from `statusTrigger.ts`**

In `src/lib/statusTrigger.ts`, the function currently reads (around line 116):

```typescript
function hasJiraCredentials(
  project: Project | null
): project is Project & { jiraSiteUrl: string; jiraEmail: string; jiraApiToken: string } {
```

Change to:

```typescript
export function hasJiraCredentials(
  project: Project | null
): project is Project & { jiraSiteUrl: string; jiraEmail: string; jiraApiToken: string } {
```

No other change to the function body.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/attachmentJiraSync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncAttachmentToJira, type SyncAttachmentToJiraDeps } from "./attachmentJiraSync";

describe("syncAttachmentToJira", () => {
  let testCounter = 0;

  beforeEach(async () => {
    await prisma.attachment.deleteMany({});
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
    await prisma.project.deleteMany({});
    testCounter++;
  });

  async function makeJiraProject() {
    return prisma.project.create({
      data: {
        name: `Attachment Sync Test Project ${testCounter}`,
        type: "JIRA",
        jiraProjectKey: "SYNC",
        jiraSiteUrl: "https://example.atlassian.net",
        jiraEmail: "user@example.com",
        jiraApiToken: "token-123",
      },
    });
  }

  async function makeStoryAndWorkUnit(projectId?: string) {
    const story = await prisma.story.create({
      data: {
        jiraKey: `SYNC-${testCounter}`,
        jiraId: `8000${testCounter}`,
        projectKey: "SYNC",
        summary: "Test story",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/SYNC-${testCounter}`,
        lastSyncedAt: new Date(),
        ...(projectId ? { projectId } : {}),
      },
    });
    const workUnit = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task", column: "todo", order: 0 },
    });
    return { story, workUnit };
  }

  function fakeDeps(overrides: Partial<SyncAttachmentToJiraDeps> = {}): SyncAttachmentToJiraDeps {
    return {
      uploadAttachment: vi.fn(async () => {}),
      readAttachmentFile: vi.fn(async () => Buffer.from("fake-bytes")),
      ...overrides,
    };
  }

  it("uploads the attachment and stamps jiraUploadedAt on success", async () => {
    const project = await makeJiraProject();
    const { story, workUnit } = await makeStoryAndWorkUnit(project.id);
    const attachment = await prisma.attachment.create({
      data: { workUnitId: workUnit.id, filename: "shot.png", mimeType: "image/png", size: 100 },
    });

    const deps = fakeDeps();
    const result = await syncAttachmentToJira(attachment.id, prisma, deps);

    expect(result).toEqual({ uploaded: true });
    expect(deps.readAttachmentFile).toHaveBeenCalledWith(attachment.id);
    expect(deps.uploadAttachment).toHaveBeenCalledWith(
      story.jiraKey,
      expect.objectContaining({ filename: "shot.png", mimeType: "image/png" }),
      expect.any(Object)
    );

    const updated = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(updated?.jiraUploadedAt).not.toBeNull();
  });

  it("skips and returns uploaded:false when the project has no JIRA credentials", async () => {
    const { workUnit } = await makeStoryAndWorkUnit();
    const attachment = await prisma.attachment.create({
      data: { workUnitId: workUnit.id, filename: "shot.png", mimeType: "image/png", size: 100 },
    });

    const deps = fakeDeps();
    const result = await syncAttachmentToJira(attachment.id, prisma, deps);

    expect(result.uploaded).toBe(false);
    expect(result.warning).toBeTruthy();
    expect(deps.uploadAttachment).not.toHaveBeenCalled();

    const updated = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(updated?.jiraUploadedAt).toBeNull();
  });

  it("does not throw and returns uploaded:false when uploadAttachment rejects", async () => {
    const project = await makeJiraProject();
    const { workUnit } = await makeStoryAndWorkUnit(project.id);
    const attachment = await prisma.attachment.create({
      data: { workUnitId: workUnit.id, filename: "shot.png", mimeType: "image/png", size: 100 },
    });

    const deps = fakeDeps({
      uploadAttachment: vi.fn(async () => {
        throw new Error("JIRA API error: 500");
      }),
    });

    const result = await syncAttachmentToJira(attachment.id, prisma, deps);

    expect(result.uploaded).toBe(false);
    expect(result.warning).toContain("500");

    const updated = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(updated?.jiraUploadedAt).toBeNull();
  });

  it("does not throw for a non-existent attachment", async () => {
    const deps = fakeDeps();
    const result = await syncAttachmentToJira("does-not-exist", prisma, deps);
    expect(result.uploaded).toBe(false);
    expect(deps.uploadAttachment).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- run src/lib/attachmentJiraSync.test.ts`
Expected: FAIL — the module `./attachmentJiraSync` does not exist yet.

- [ ] **Step 4: Implement `syncAttachmentToJira`**

Create `src/lib/attachmentJiraSync.ts`:

```typescript
/**
 * Immediate JIRA attachment upload — uploads a freshly created Ponder
 * attachment to its parent JIRA issue right away, rather than waiting for
 * the deferred batch uploads in statusTrigger.ts (story completion, Move to
 * QA). Non-blocking: every failure is caught and returned, never thrown, so
 * an attachment's local creation never depends on JIRA succeeding — those
 * deferred paths remain a safety net for anything this misses.
 */

import type { PrismaClient } from "@prisma/client";
import type { JiraConfig } from "@/lib/jira/client";
import { uploadAttachment as defaultUploadAttachment } from "@/lib/jira/writeback";
import { readAttachmentFile as defaultReadAttachmentFile } from "@/lib/attachmentStorage";
import { hasJiraCredentials } from "@/lib/statusTrigger";

export type SyncAttachmentToJiraDeps = {
  uploadAttachment: typeof defaultUploadAttachment;
  readAttachmentFile: typeof defaultReadAttachmentFile;
};

const defaultDeps: SyncAttachmentToJiraDeps = {
  uploadAttachment: defaultUploadAttachment,
  readAttachmentFile: defaultReadAttachmentFile,
};

export type SyncAttachmentToJiraResult = {
  uploaded: boolean;
  warning?: string;
};

/**
 * Uploads a single attachment to its parent story's JIRA issue and stamps
 * `jiraUploadedAt` on success. Never throws.
 * @param attachmentId - the Attachment row to upload
 * @param prisma - Prisma client instance
 * @param deps - Injectable JIRA/storage functions (defaults to the real ones)
 */
export async function syncAttachmentToJira(
  attachmentId: string,
  prisma: PrismaClient,
  deps: SyncAttachmentToJiraDeps = defaultDeps
): Promise<SyncAttachmentToJiraResult> {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { workUnit: { include: { story: { include: { project: true } } } } },
    });

    if (!attachment) {
      const warning = `syncAttachmentToJira: attachment not found: ${attachmentId}`;
      console.warn(warning);
      return { uploaded: false, warning };
    }

    const story = attachment.workUnit.story;

    if (!hasJiraCredentials(story.project)) {
      const warning = `syncAttachmentToJira: story ${story.jiraKey} has no fully-configured JIRA project; skipping upload`;
      console.warn(warning);
      return { uploaded: false, warning };
    }

    const config: JiraConfig = {
      siteUrl: story.project.jiraSiteUrl,
      email: story.project.jiraEmail,
      apiToken: story.project.jiraApiToken,
    };

    const buffer = await deps.readAttachmentFile(attachment.id);
    await deps.uploadAttachment(
      story.jiraKey,
      { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
      config
    );

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { jiraUploadedAt: new Date() },
    });

    return { uploaded: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const warning = `syncAttachmentToJira: failed to upload attachment ${attachmentId} to JIRA: ${message}`;
    console.warn(warning);
    return { uploaded: false, warning };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- run src/lib/attachmentJiraSync.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Run statusTrigger's own tests to confirm the export change is harmless**

Run: `npm test -- run src/lib/statusTrigger.test.ts`
Expected: PASS, all pre-existing tests green (exporting a previously-private function doesn't change its behavior).

- [ ] **Step 7: Commit**

```bash
git add src/lib/statusTrigger.ts src/lib/attachmentJiraSync.ts src/lib/attachmentJiraSync.test.ts
git commit -m "feat: add syncAttachmentToJira orchestration function"
```

---

### Task 3: Wire into the attachments route

**Files:**
- Modify: `src/lib/types.ts` (`AttachmentDTO`)
- Modify: `src/app/api/work-units/[id]/attachments/route.ts`
- Modify: `src/app/api/work-units/[id]/attachments/route.test.ts`

**Interfaces:**
- Consumes: `syncAttachmentToJira` (Task 2).
- Produces: `AttachmentDTO.jiraUploadedAt: string | null` — consumed by Task 5 (`attachImage` MCP tool, via `PonderClient.addAttachment`'s return type, which already returns `AttachmentDTO`).

- [ ] **Step 1: Add `jiraUploadedAt` to `AttachmentDTO`**

In `src/lib/types.ts`, `AttachmentDTO` currently reads:

```typescript
export interface AttachmentDTO {
  id: string;
  workUnitId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string; // ISO string
  url: string; // /api/attachments/{id}
}
```

Add `jiraUploadedAt` right before `createdAt`:

```typescript
export interface AttachmentDTO {
  id: string;
  workUnitId: string;
  filename: string;
  mimeType: string;
  size: number;
  jiraUploadedAt: string | null; // ISO string, or null if not yet uploaded to JIRA
  createdAt: string; // ISO string
  url: string; // /api/attachments/{id}
}
```

- [ ] **Step 2: Write the failing tests**

Add these tests to `src/app/api/work-units/[id]/attachments/route.test.ts`. First, add the mock and import near the top of the file, right after the existing imports (before `describe("Work Unit Attachments Endpoint", ...)`):

```typescript
vi.mock("@/lib/jira/writeback", () => ({
  uploadAttachment: vi.fn(async () => {}),
}));

import { uploadAttachment } from "@/lib/jira/writeback";
```

(Add `vi` to the existing `import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";` line, making it `import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";`.)

Add these three tests inside the `describe("POST", ...)` block, after the "accepts a video larger than the 10 MB image cap" test (before "rejects a video MIME type outside the allowlist"):

```typescript
    it("uploads the attachment to JIRA immediately and reflects jiraUploadedAt in the response", async () => {
      vi.mocked(uploadAttachment).mockClear();
      const project = await prisma.project.create({
        data: {
          name: "JIRA Attachments Test Project",
          type: "JIRA",
          jiraProjectKey: "ATT",
          jiraSiteUrl: "https://example.atlassian.net",
          jiraEmail: "user@example.com",
          jiraApiToken: "token-123",
        },
      });
      await prisma.story.update({ where: { id: storyId }, data: { projectId: project.id } });

      const formData = new FormData();
      formData.append("file", pngFile());
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        { method: "POST", body: formData }
      );

      const res = await POST(req as never, { params: Promise.resolve({ id: workUnitId }) });
      expect(res.status).toBe(201);

      const dto = await res.json();
      expect(dto.jiraUploadedAt).not.toBeNull();
      expect(uploadAttachment).toHaveBeenCalledTimes(1);

      const persisted = await prisma.attachment.findUnique({ where: { id: dto.id } });
      expect(persisted?.jiraUploadedAt).not.toBeNull();

      // Story.projectId has no onDelete cascade — detach before deleting the
      // project, or this throws a foreign-key constraint violation.
      await prisma.story.update({ where: { id: storyId }, data: { projectId: null } });
      await prisma.project.delete({ where: { id: project.id } });
    });

    it("still returns 201 with jiraUploadedAt null when the JIRA upload fails", async () => {
      vi.mocked(uploadAttachment).mockRejectedValueOnce(new Error("JIRA API error: 500"));
      const project = await prisma.project.create({
        data: {
          name: "JIRA Attachments Failure Test Project",
          type: "JIRA",
          jiraProjectKey: "ATT",
          jiraSiteUrl: "https://example.atlassian.net",
          jiraEmail: "user@example.com",
          jiraApiToken: "token-123",
        },
      });
      await prisma.story.update({ where: { id: storyId }, data: { projectId: project.id } });

      const formData = new FormData();
      formData.append("file", pngFile());
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        { method: "POST", body: formData }
      );

      const res = await POST(req as never, { params: Promise.resolve({ id: workUnitId }) });
      expect(res.status).toBe(201);

      const dto = await res.json();
      expect(dto.jiraUploadedAt).toBeNull();

      const persisted = await prisma.attachment.findUnique({ where: { id: dto.id } });
      expect(persisted).not.toBeNull();

      // Story.projectId has no onDelete cascade — detach before deleting the
      // project, or this throws a foreign-key constraint violation.
      await prisma.story.update({ where: { id: storyId }, data: { projectId: null } });
      await prisma.project.delete({ where: { id: project.id } });
    });

    it("returns jiraUploadedAt null and never calls uploadAttachment for a non-JIRA-linked work unit", async () => {
      vi.mocked(uploadAttachment).mockClear();
      const formData = new FormData();
      formData.append("file", pngFile());
      const req = new Request(
        `http://localhost/api/work-units/${workUnitId}/attachments`,
        { method: "POST", body: formData }
      );

      const res = await POST(req as never, { params: Promise.resolve({ id: workUnitId }) });
      const dto = await res.json();
      expect(dto.jiraUploadedAt).toBeNull();
      expect(uploadAttachment).not.toHaveBeenCalled();
    });
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `npm test -- run "src/app/api/work-units/[id]/attachments/route.test.ts"`
Expected: the 3 new tests FAIL (`dto.jiraUploadedAt` is `undefined`, not present in the response); every pre-existing test still PASSES (nothing about the route has changed yet).

- [ ] **Step 4: Wire `syncAttachmentToJira` into the route**

In `src/app/api/work-units/[id]/attachments/route.ts`, add the import (after the existing `AttachmentDTO` import):

```typescript
import { AttachmentDTO } from "@/lib/types";
import { syncAttachmentToJira } from "@/lib/attachmentJiraSync";
```

Update the `attachmentToDTO` helper to accept and map `jiraUploadedAt` (currently lines 17-34):

```typescript
function attachmentToDTO(attachment: {
  id: string;
  workUnitId: string;
  filename: string;
  mimeType: string;
  size: number;
  jiraUploadedAt: Date | null;
  createdAt: Date;
}): AttachmentDTO {
  return {
    id: attachment.id,
    workUnitId: attachment.workUnitId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    jiraUploadedAt: attachment.jiraUploadedAt?.toISOString() ?? null,
    createdAt: attachment.createdAt.toISOString(),
    url: `/api/attachments/${attachment.id}`,
  };
}
```

Update the `POST` handler's return statement (currently `return NextResponse.json(attachmentToDTO(created), { status: 201 });`) to call `syncAttachmentToJira` first and re-fetch the row so the response reflects the true DB state:

```typescript
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeAttachmentFile(created.id, buffer);
    } catch (writeError) {
      // Don't leave an orphan row if the disk write failed.
      await prisma.attachment.delete({ where: { id: created.id } });
      throw writeError;
    }

    await syncAttachmentToJira(created.id, prisma);
    const finalAttachment = await prisma.attachment.findUnique({ where: { id: created.id } });

    return NextResponse.json(attachmentToDTO(finalAttachment ?? created), { status: 201 });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- run "src/app/api/work-units/[id]/attachments/route.test.ts"`
Expected: PASS, all tests in the file green (both new and every pre-existing one — pre-existing tests' stories have no `projectId`, so `syncAttachmentToJira` short-circuits via `hasJiraCredentials` returning false, and `jiraUploadedAt` stays `null`, matching what those tests already expect implicitly by not checking the field).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts "src/app/api/work-units/[id]/attachments/route.ts" "src/app/api/work-units/[id]/attachments/route.test.ts"
git commit -m "feat: upload attachments to JIRA immediately on creation"
```

---

### Task 4: Dedup in the deferred batch upload paths

**Files:**
- Modify: `src/lib/statusTrigger.ts`
- Modify: `src/lib/statusTrigger.test.ts`

**Interfaces:**
- Consumes: `Attachment.jiraUploadedAt` (Task 1).

- [ ] **Step 1: Write the failing tests**

Add this test inside the `describe("completion comment: consolidated AC/verification + attachments", ...)` block in `src/lib/statusTrigger.test.ts`, after the "does not throw and still transitions/updates locally when uploadAttachment rejects" test (before "does not throw and still completes when consolidateAcceptanceCriteria rejects"):

```typescript
    it("skips attachments that already have jiraUploadedAt set", async () => {
      const project = await makeJiraProject();
      const story = await makeStory({ projectId: project.id, jiraStatus: "In Progress" });
      const wu1 = await prisma.workUnit.create({
        data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
      });
      const alreadyUploaded = await prisma.attachment.create({
        data: {
          workUnitId: wu1.id,
          filename: "already.png",
          mimeType: "image/png",
          size: 100,
          jiraUploadedAt: new Date("2026-01-01T00:00:00Z"),
        },
      });
      await prisma.attachment.create({
        data: { workUnitId: wu1.id, filename: "pending.png", mimeType: "image/png", size: 100 },
      });

      const deps = fakeDeps();
      await applyStoryStatusSync(story.id, prisma, deps);

      expect(deps.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(deps.uploadAttachment).toHaveBeenCalledWith(
        story.jiraKey,
        expect.objectContaining({ filename: "pending.png" }),
        expect.any(Object)
      );

      const untouched = await prisma.attachment.findUnique({ where: { id: alreadyUploaded.id } });
      expect(untouched?.jiraUploadedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });
```

Add this test inside the `describe("reportWorkUnitToQA", ...)` block, after the "uploads the work unit's own attachments" test (before "transitions and archives when this was the last sibling to be reported"):

```typescript
  it("skips attachments that already have jiraUploadedAt set", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    const alreadyUploaded = await prisma.attachment.create({
      data: {
        workUnitId: wu.id,
        filename: "already.png",
        mimeType: "image/png",
        size: 100,
        jiraUploadedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const deps = fakeReportDeps();
    await reportWorkUnitToQA(wu.id, prisma, deps);

    expect(deps.uploadAttachment).not.toHaveBeenCalled();
    const untouched = await prisma.attachment.findUnique({ where: { id: alreadyUploaded.id } });
    expect(untouched?.jiraUploadedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- run src/lib/statusTrigger.test.ts`
Expected: the 2 new tests FAIL — `deps.uploadAttachment` is called for both attachments (including the already-uploaded one), so `toHaveBeenCalledTimes(1)` / `not.toHaveBeenCalled()` fail.

- [ ] **Step 3: Add the skip/set logic to `applyStoryStatusSync`**

In `src/lib/statusTrigger.ts`, the attachment-upload loop inside `applyStoryStatusSync` currently reads (around lines 229-245):

```typescript
      for (const workUnit of doneWorkUnits) {
        for (const attachment of workUnit.attachments) {
          try {
            const buffer = await deps.readAttachmentFile(attachment.id);
            await deps.uploadAttachment(
              story.jiraKey,
              { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
              config
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
              `applyStoryStatusSync: failed to upload attachment ${attachment.id} (${attachment.filename}) to ${story.jiraKey}: ${message}`
            );
          }
        }
      }
```

Change it to:

```typescript
      for (const workUnit of doneWorkUnits) {
        for (const attachment of workUnit.attachments) {
          if (attachment.jiraUploadedAt != null) continue;
          try {
            const buffer = await deps.readAttachmentFile(attachment.id);
            await deps.uploadAttachment(
              story.jiraKey,
              { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
              config
            );
            await prisma.attachment.update({
              where: { id: attachment.id },
              data: { jiraUploadedAt: new Date() },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
              `applyStoryStatusSync: failed to upload attachment ${attachment.id} (${attachment.filename}) to ${story.jiraKey}: ${message}`
            );
          }
        }
      }
```

- [ ] **Step 4: Add the skip/set logic to `reportWorkUnitToQA`**

The attachment-upload loop inside `reportWorkUnitToQA` currently reads (around lines 418-425):

```typescript
      for (const attachment of workUnit.attachments) {
        const buffer = await deps.readAttachmentFile(attachment.id);
        await deps.uploadAttachment(
          story.jiraKey,
          { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
          config
        );
      }
```

Change it to:

```typescript
      for (const attachment of workUnit.attachments) {
        if (attachment.jiraUploadedAt != null) continue;
        const buffer = await deps.readAttachmentFile(attachment.id);
        await deps.uploadAttachment(
          story.jiraKey,
          { buffer, filename: attachment.filename, mimeType: attachment.mimeType },
          config
        );
        await prisma.attachment.update({
          where: { id: attachment.id },
          data: { jiraUploadedAt: new Date() },
        });
      }
```

(This loop is already inside the surrounding `try { ... } catch (err) { return { ok: false, error: message }; }` block — the added `prisma.attachment.update` call is covered by that same try/catch, preserving `reportWorkUnitToQA`'s existing blocking/error-surfacing contract.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- run src/lib/statusTrigger.test.ts`
Expected: PASS, all tests in the file green (both new and every pre-existing one — pre-existing tests' attachments are created without `jiraUploadedAt`, which defaults to `null`, so they're never skipped and behave exactly as before).

- [ ] **Step 6: Commit**

```bash
git add src/lib/statusTrigger.ts src/lib/statusTrigger.test.ts
git commit -m "feat: skip already-uploaded attachments in deferred JIRA batch uploads"
```

---

### Task 5: MCP surface — `attachImage` reports JIRA upload status

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `AttachmentDTO.jiraUploadedAt` (Task 3), already returned by `PonderClient.addAttachment` (`src/mcp/client.ts`) with no code change needed there (its return type is `Promise<AttachmentDTO>`, generic).

- [ ] **Step 1: Write the failing tests**

Add these two tests to `src/mcp/tools.test.ts`, inside the `describe("attachImage", ...)` block, after the "reads the local file and uploads it via client.addAttachment" test (before "returns an error-text result for an unsupported extension..."):

```typescript
  it("mentions the JIRA upload result when jiraUploadedAt is set", async () => {
    const filePath = path.join(dir, "screenshot.png");
    await writeFile(filePath, "fake-bytes");
    const fakeClient = {
      addAttachment: async () => ({
        id: "a1",
        workUnitId: "wu1",
        filename: "screenshot.png",
        mimeType: "image/png",
        size: 10,
        jiraUploadedAt: "2026-07-14T00:00:00.000Z",
        createdAt: "2026-07-14T00:00:00.000Z",
        url: "/api/attachments/a1",
      }),
    } as unknown as PonderClient;

    const result = await attachImage(fakeClient, { workUnitId: "wu1", filePath });

    expect(result.content[0].text).toMatch(/uploaded to JIRA/i);
  });

  it("mentions the attachment was not yet uploaded to JIRA when jiraUploadedAt is null", async () => {
    const filePath = path.join(dir, "screenshot.png");
    await writeFile(filePath, "fake-bytes");
    const fakeClient = {
      addAttachment: async () => ({
        id: "a1",
        workUnitId: "wu1",
        filename: "screenshot.png",
        mimeType: "image/png",
        size: 10,
        jiraUploadedAt: null,
        createdAt: "2026-07-14T00:00:00.000Z",
        url: "/api/attachments/a1",
      }),
    } as unknown as PonderClient;

    const result = await attachImage(fakeClient, { workUnitId: "wu1", filePath });

    expect(result.content[0].text).toMatch(/not yet uploaded to JIRA/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- run src/mcp/tools.test.ts`
Expected: the 2 new tests FAIL — the current text result has no mention of JIRA at all.

- [ ] **Step 3: Update `attachImage`'s text result**

In `src/mcp/tools.ts`, `attachImage` currently reads:

```typescript
export async function attachImage(
  client: PonderClient,
  args: { workUnitId: string; filePath: string; filename?: string }
): Promise<McpTextResult> {
  try {
    const { buffer, filename, mimeType } = await readLocalImage(
      args.filePath,
      args.filename
    );
    const attachment = await client.addAttachment(
      args.workUnitId,
      buffer,
      filename,
      mimeType
    );
    return textResult(
      `Attached "${attachment.filename}" (${attachment.mimeType}, ${attachment.size} bytes) to work unit ${args.workUnitId}.`
    );
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

Change the return statement to:

```typescript
    const attachment = await client.addAttachment(
      args.workUnitId,
      buffer,
      filename,
      mimeType
    );
    const jiraNote = attachment.jiraUploadedAt
      ? " Also uploaded to JIRA."
      : " Not yet uploaded to JIRA.";
    return textResult(
      `Attached "${attachment.filename}" (${attachment.mimeType}, ${attachment.size} bytes) to work unit ${args.workUnitId}.${jiraNote}`
    );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- run src/mcp/tools.test.ts`
Expected: PASS, all tests in the file green (the pre-existing "reads the local file and uploads it..." test's fake `addAttachment` doesn't set `jiraUploadedAt`, so it's `undefined` — falsy, same branch as `null` — the added trailing sentence doesn't affect that test's existing assertions, which only check for `"screenshot.png"` and `"wu1"` substrings).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm run test:ci`
Expected: all tests pass repo-wide.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts src/mcp/tools.test.ts
git commit -m "feat: report JIRA upload status from attach_image"
```

---

### Task 6: Docs — README mention

**Files:**
- Modify: `README.md`

**Interfaces:** None (documentation only).

- [ ] **Step 1: Update the "Verification with evidence" bullet**

In `README.md`, the Features list currently has (around line 45):

```markdown
- **Verification with evidence** — request an AI-agent verification per card and attach the proof: screenshots *and screen recordings* (images up to 10 MB, video — MP4/WebM/QuickTime — up to 250 MB, served with seek support).
```

Change it to:

```markdown
- **Verification with evidence** — request an AI-agent verification per card and attach the proof: screenshots *and screen recordings* (images up to 10 MB, video — MP4/WebM/QuickTime — up to 250 MB, served with seek support). Evidence uploads to the original JIRA issue immediately, not just when the story completes.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document immediate JIRA attachment upload"
```

---

## Self-Review Notes

- **Spec coverage:** schema (Task 1) · orchestration function + non-blocking contract (Task 2) · route wiring + DTO (Task 3) · dedup in both deferred paths (Task 4) · MCP surfacing (Task 5) · docs (Task 6) · out-of-scope items from the design spec (board UI badge, retry mechanism, backfill) have no corresponding task — confirmed intentionally absent.
- **Scope trim from the design doc, noted explicitly:** the design's MCP section said the "not yet uploaded" message could include "the warning reason when available." This plan keeps the message boolean-only (uploaded / not yet uploaded, no reason text) — surfacing the raw warning string end-to-end would require adding another `AttachmentDTO` field not otherwise needed, and risks leaking internal error detail to MCP callers. The core requirement (an agent can tell whether evidence reached JIRA) is met either way.
- **Type consistency:** `SyncAttachmentToJiraDeps` (Task 2) has the same two fields (`uploadAttachment`, `readAttachmentFile`) with the same types as the matching subset of `ApplyStoryStatusSyncDeps` (`statusTrigger.ts`), so `attachmentJiraSync.ts` and `statusTrigger.ts` stay interchangeable in spirit without actually sharing a type (deliberately not coupled — `attachmentJiraSync.ts` doesn't need `getTransitions`/`transitionIssue`/`addComment`/etc.).
- **Ordering:** Task 1 (schema) must land before Task 2's tests can pass (they read/write `jiraUploadedAt`). Task 2 must land before Task 3 (route imports `syncAttachmentToJira`) and Task 5 (relies on the DTO field Task 3 adds, though Task 5 could technically run before Task 3 since it only touches the MCP text — kept after for logical narrative order). Task 4 is independent of Tasks 3/5 and could run in parallel with either, but depends on Task 1.
