# Archive Work Units on Move-to-QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a story's "Move to QA" transition succeeds (`transitionStoryToQA`, already merged — only fires when every one of the story's work units is Done), archive all of that story's work units: they disappear from the Kanban board and from project stats, but their database rows are retained (not deleted) for future reporting.

**Architecture:** A new nullable `archivedAt` timestamp on `WorkUnit` (mirrors the existing `completedAt` field's shape exactly). Three layers: (1) schema + DTO plumbing so the field exists and round-trips; (2) every read path that currently has no filter on work units gets one (`archivedAt: null`) — the board fetch, project stats counts, and the two existing JIRA-sync queries in `statusTrigger.ts`; (3) the actual write — a new `archiveDoneWorkUnits` helper called at the tail of `transitionStoryToQA`'s success path.

**Tech Stack:** Prisma 7 + PostgreSQL (real migration via `prisma migrate dev`), Next.js 15 App Router, TypeScript, Vitest.

## Global Constraints

- **Retain, never delete.** Archiving is `archivedAt = now()`, not `prisma.workUnit.delete(...)`. The row must remain queryable (for a future, not-yet-requested, reporting feature) — every task's tests should confirm the row still exists in the DB after archiving, just excluded from the *active* views.
- **Trigger is exactly the existing `transitionStoryToQA` success path** — no new button, no new gating logic. `transitionStoryToQA` already refuses to transition unless every one of the story's work units is Done; that same guarantee is what makes "archive all of them" correct and safe to do unconditionally on success. Do not duplicate or re-check the "all done" condition in the archiving step itself.
- **A story with zero remaining active work units disappears from the board entirely** (not just its cards) — otherwise the board's "N stories" count would include a phantom story contributing zero visible cards, which reads as a bug. `GET /api/stories` must exclude such stories, not just filter their nested `workUnits` array to empty.
- **`completedAt` is the exact precedent to mirror**: a nullable `DateTime` field, serialized in every `workUnitToDTO`-style converter, PATCH-excluded (archiving is never done through the generic PATCH route — only through `transitionStoryToQA`'s own internal update).
- **No new UI in this plan.** No "view archived cards" screen, no "un-archive" action — not requested. If wanted later, the data model already supports it (nothing here precludes it).
- **Real migration, not just `db push`.** Use `npx prisma migrate dev --name add_work_unit_archived_at` against the local dev Postgres (docker-compose already running per this project's existing convention) so a real, checked-in migration file is produced — this project's `prisma/migrations/` directory has one migration per schema change (`add_project_table`, `add_attachments`, etc.) and this change follows the same convention.
- **Tests run serially:** `npx dotenv -e .env.test -- vitest run --no-file-parallelism`. Test-DB schema sync uses `npm run db:push:test` (`dotenv -e .env.test -- prisma db push`) — run this after the schema change so the test database picks up the new column before running tests.
- **No secrets committed.** Branch → verify green (`tsc --noEmit`, `npm run lint`, full suite, `npx knip`) → PR → the user merges.

---

## File Structure

**Modify:**
- `prisma/schema.prisma` — add `archivedAt DateTime?` to `WorkUnit`.
- `src/lib/types.ts` — add `archivedAt: string | null` to `WorkUnitDTO`.
- `src/app/api/stories/route.ts` — serialize `archivedAt`; filter `workUnits` to `archivedAt: null`; exclude stories with zero remaining active work units.
- `src/app/api/stories/route.test.ts` — new tests for the above.
- `src/app/api/work-units/route.ts` — serialize `archivedAt` in both `workUnitToDTO` and the inline `StoryDTO` construction in `POST`.
- `src/app/api/work-units/route.test.ts` — new/updated tests.
- `src/app/api/work-units/[id]/route.ts` — serialize `archivedAt`.
- `src/app/api/work-units/[id]/route.test.ts` — new/updated tests.
- `src/app/api/work-units/[id]/move/route.ts` — serialize `archivedAt`.
- `src/app/api/work-units/[id]/move/route.test.ts` — new/updated tests.
- `src/app/api/projects/route.ts` — filter both `_count.workUnits` blocks (GET, POST).
- `src/app/api/projects/route.test.ts` — new test.
- `src/app/api/projects/[projectId]/route.ts` — filter both `_count.workUnits` blocks (GET, PUT).
- `src/app/api/projects/[projectId]/route.test.ts` — new test.
- `src/lib/statusTrigger.ts` — filter both existing work-unit queries; add `archiveDoneWorkUnits` and call it from `transitionStoryToQA`.
- `src/lib/statusTrigger.test.ts` — new tests.

**Create:** none (the migration file itself is generated by the Prisma CLI, not hand-authored). **Delete:** none.

---

### Task 1: Schema + DTO plumbing

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/types.ts`
- Modify: `src/app/api/stories/route.ts`, `src/app/api/work-units/route.ts`, `src/app/api/work-units/[id]/route.ts`, `src/app/api/work-units/[id]/move/route.ts`

**Interfaces:**
- Produces: `WorkUnitDTO.archivedAt: string | null` (ISO string or null), serialized identically to the existing `completedAt` field, consumed by every later task.

- [ ] **Step 1: Add the schema field and generate a real migration**

In `prisma/schema.prisma`, in the `WorkUnit` model, add the new field right after `completedAt`:

```prisma
model WorkUnit {
  id                 String    @id @default(cuid())
  storyId            String
  story              Story     @relation(fields: [storyId], references: [id])
  projectId          String?
  project            Project?  @relation("ProjectWorkUnits", fields: [projectId], references: [id])
  title              String
  description        String?
  acceptanceCriteria String?
  verification       String?
  column             String
  order              Int
  subNumber          Int?
  createdAt          DateTime  @default(now())
  completedAt        DateTime?
  archivedAt         DateTime?

  workNotes   WorkNote[]
  attachments Attachment[]

  @@index([projectId])
  @@index([storyId])
}
```

Run: `npx prisma migrate dev --name add_work_unit_archived_at`
Expected: a new directory under `prisma/migrations/` (timestamp-prefixed) containing a `migration.sql` that adds the `archivedAt` column; the command applies it to your local dev database and regenerates the Prisma client.

Then sync the test database's schema:
Run: `npm run db:push:test`
Expected: completes without error (this is the project's existing convention for keeping the test DB's schema current — it does not create a migration file for the test DB, only the dev one already did that in the previous step).

- [ ] **Step 2: Add the field to `WorkUnitDTO`**

In `src/lib/types.ts`, update:

```ts
export interface WorkUnitDTO {
  id: string;
  storyId: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  verification: string | null;
  column: Column;
  order: number;
  subNumber: number | null;
  createdAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}
```

- [ ] **Step 3: Write the failing test for `GET /api/stories` serializing the new field**

Add to `src/app/api/stories/route.test.ts` (find this file's existing setup pattern — a `beforeEach` creating a project/story/work-unit via real Prisma calls — and mirror it exactly):

```ts
  it("serializes archivedAt as null for a non-archived work unit", async () => {
    // reuse this file's existing story/work-unit creation helpers; the key
    // assertion is on the new field only
    const res = await GET(new Request("http://localhost/api/stories") as never);
    const data = await res.json();
    const story = data.find((s: { id: string }) => s.id === /* the story id created in this test's setup */ undefined);
    // If this test file's existing setup already creates exactly one story
    // with one work unit, adapt the lookup to whatever that setup exposes
    // (e.g. a `storyId`/`workUnitId` variable from beforeEach) rather than
    // searching by an undefined id — read the file's existing tests first
    // to match its established lookup pattern before finalizing this
    // assertion.
    expect(data[0].workUnits[0].archivedAt).toBeNull();
  });
```

(This step's exact lookup mechanics depend on the test file's existing fixture pattern — read `src/app/api/stories/route.test.ts`'s existing `beforeEach`/first test before writing this one, and adapt the variable names to match rather than inventing new ones.)

- [ ] **Step 4: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/stories/route.test.ts`
Expected: FAIL — `archivedAt` is `undefined` in the response, not `null` (the DTO converter doesn't serialize it yet).

- [ ] **Step 5: Serialize `archivedAt` in every converter**

In `src/app/api/stories/route.ts`, add `archivedAt: wu.archivedAt?.toISOString() ?? null,` right after the existing `completedAt: wu.completedAt?.toISOString() ?? null,` line in the `workUnits.map(...)` block.

In `src/app/api/work-units/route.ts`, add the same field to BOTH `workUnitToDTO`'s return object AND the inline `workUnits.map(...)` construction inside `POST`'s `storyDTO` object (two separate places in this one file — do not miss the second one).

In `src/app/api/work-units/[id]/route.ts`, add it to `workUnitToDTO`'s return object.

In `src/app/api/work-units/[id]/move/route.ts`, find its own `workUnitToDTO`-equivalent function (mirror the exact same pattern as the other three files) and add the field there too.

In every case, the Prisma query itself does NOT need a `select`/`include` change to make the raw field available — `archivedAt` comes back automatically on any `prisma.workUnit.findMany`/`findUnique`/`update` call once it's a real column; only the DTO conversion functions need the new line.

- [ ] **Step 6: Run the stories test to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/stories/route.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite and fix any exact-shape mismatches**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism`

Some pre-existing tests may do an exact `toEqual`/`toMatchObject` comparison against a full `WorkUnitDTO`/`StoryDTO` shape and now fail because the actual response includes the new `archivedAt: null` field they don't expect. For each such failure, add `archivedAt: null` to that test's expected object (mirroring exactly how `completedAt: null` already appears in the same expected object) — do not weaken the assertion (e.g. do not switch a failing `toEqual` to `toMatchObject` as a shortcut).

Expected: full suite green after these fixes.

- [ ] **Step 8: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/types.ts \
  src/app/api/stories/route.ts src/app/api/stories/route.test.ts \
  src/app/api/work-units/route.ts src/app/api/work-units/route.test.ts \
  "src/app/api/work-units/[id]/route.ts" "src/app/api/work-units/[id]/route.test.ts" \
  "src/app/api/work-units/[id]/move/route.ts" "src/app/api/work-units/[id]/move/route.test.ts"
git commit -m "feat: add archivedAt field to WorkUnit"
```

---

### Task 2: Exclude archived work units from every read path

**Files:**
- Modify: `src/app/api/stories/route.ts`, `src/app/api/stories/route.test.ts`
- Modify: `src/app/api/projects/route.ts`, `src/app/api/projects/route.test.ts`
- Modify: `src/app/api/projects/[projectId]/route.ts`, `src/app/api/projects/[projectId]/route.test.ts`
- Modify: `src/lib/statusTrigger.ts`, `src/lib/statusTrigger.test.ts`

**Interfaces:**
- No new exports. Every function in this task keeps its existing signature — only the Prisma queries inside them change to add a filter. Task 3 depends on these filters being in place (so a fully-archived story is invisible everywhere) before it starts actually setting `archivedAt`.

- [ ] **Step 1: Write the failing test for the board fetch excluding archived work units**

Add to `src/app/api/stories/route.test.ts`:

```ts
  it("excludes archived work units from a story's workUnits array", async () => {
    // Using this file's existing project/story creation helpers: create a
    // story with two work units, archive one directly via prisma.
    const story = await /* this file's existing story-creation helper */ makeStory();
    const activeWU = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Active", column: "done", order: 0 },
    });
    const archivedWU = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Archived", column: "done", order: 1, archivedAt: new Date() },
    });

    const res = await GET(new Request("http://localhost/api/stories") as never);
    const data = await res.json();
    const returnedStory = data.find((s: { id: string }) => s.id === story.id);

    const returnedIds = returnedStory.workUnits.map((w: { id: string }) => w.id);
    expect(returnedIds).toContain(activeWU.id);
    expect(returnedIds).not.toContain(archivedWU.id);
  });

  it("excludes a story entirely once every one of its work units is archived", async () => {
    const story = await /* this file's existing story-creation helper */ makeStory();
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Archived", column: "done", order: 0, archivedAt: new Date() },
    });

    const res = await GET(new Request("http://localhost/api/stories") as never);
    const data = await res.json();

    expect(data.find((s: { id: string }) => s.id === story.id)).toBeUndefined();
  });
```

(Adapt the `makeStory()` call to whatever this test file's actual existing story-creation helper is named — read the file first rather than inventing a new one.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/stories/route.test.ts`
Expected: FAIL — both archived work units and fully-archived stories are still returned.

- [ ] **Step 3: Filter the board fetch**

In `src/app/api/stories/route.ts`, change the query:

```ts
    const stories = await prisma.story.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        workUnits: { some: { archivedAt: null } },
      },
      include: {
        workUnits: {
          where: { archivedAt: null },
          orderBy: { order: "asc" },
        },
      },
    });
```

- [ ] **Step 4: Run the stories tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/stories/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for project stats excluding archived work units**

Add to `src/app/api/projects/route.test.ts` (mirror this file's existing project-creation + request pattern):

```ts
  it("does not count archived work units in workUnitCount", async () => {
    const project = await /* this file's existing project-creation helper */ makeProject();
    const story = await prisma.story.create({
      data: {
        jiraKey: `PROJ-STATS-${Date.now()}`,
        jiraId: `${Date.now()}`,
        projectKey: "PROJ",
        summary: "Story",
        jiraStatus: "To Do",
        url: "https://example.atlassian.net/browse/PROJ-1",
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, projectId: project.id, title: "Active", column: "todo", order: 0 },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, projectId: project.id, title: "Archived", column: "done", order: 1, archivedAt: new Date() },
    });

    const res = await GET(new Request("http://localhost/api/projects") as never);
    const data = await res.json();
    const returned = data.find((p: { id: string }) => p.id === project.id);

    expect(returned.workUnitCount).toBe(1);
  });
```

Add an analogous test to `src/app/api/projects/[projectId]/route.test.ts` for the single-project GET endpoint (same setup, call `GET` with `{ params: Promise.resolve({ projectId: project.id }) }`, assert `data.workUnitCount === 1`).

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/projects/route.test.ts "src/app/api/projects/[projectId]/route.test.ts"`
Expected: FAIL — `workUnitCount` is 2, counting the archived one.

- [ ] **Step 7: Filter the four `_count` blocks**

In `src/app/api/projects/route.ts`, in BOTH the `GET` handler and the `POST` handler, change:

```ts
      include: {
        _count: {
          select: { stories: true, workUnits: true },
        },
      },
```

to:

```ts
      include: {
        _count: {
          select: { stories: true, workUnits: { where: { archivedAt: null } } },
        },
      },
```

In `src/app/api/projects/[projectId]/route.ts`, apply the identical change in BOTH the `GET` handler and the `PUT` handler.

- [ ] **Step 8: Run the project tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/app/api/projects/route.test.ts "src/app/api/projects/[projectId]/route.test.ts"`
Expected: PASS.

- [ ] **Step 9: Write the failing tests for `statusTrigger.ts`'s two internal queries**

Add to `src/lib/statusTrigger.test.ts`, inside the existing `describe("applyStoryStatusSync", ...)` block (mirror its existing `makeJiraProject`/`makeStory` helpers):

```ts
  it("ignores archived work units when computing the desired status", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id, jiraStatus: "In Progress" });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Active", column: "in_progress", order: 0 },
    });
    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Archived done card",
        column: "done",
        order: 1,
        archivedAt: new Date(),
      },
    });

    const deps = fakeDeps();
    const result = await applyStoryStatusSync(story.id, prisma, deps);

    // Only the active (non-archived) work unit should count — it's still
    // in_progress, so this must NOT transition to "Code Revew" just because
    // an archived done card exists.
    expect(result.transitioned).toBe(false);
  });
```

And inside the existing `describe("transitionStoryToQA", ...)` block:

```ts
  it("ignores archived work units when checking whether every card is done", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Archived leftover",
        column: "in_progress",
        order: 1,
        archivedAt: new Date(),
      },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    // The archived work unit is still "in_progress", but since it's
    // archived it must not block the transition.
    expect(result).toEqual({ ok: true });
  });
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts`
Expected: FAIL — both tests fail because the archived work units are still included in the "all done"/status-computation logic.

- [ ] **Step 11: Filter both queries in `statusTrigger.ts`**

Change (around line 133):

```ts
      include: { workUnits: { include: { attachments: true } }, project: true },
```

to:

```ts
      include: {
        workUnits: { where: { archivedAt: null }, include: { attachments: true } },
        project: true,
      },
```

Change (around line 269, inside `transitionStoryToQA`):

```ts
    include: { workUnits: true, project: true },
```

to:

```ts
    include: { workUnits: { where: { archivedAt: null } }, project: true },
```

- [ ] **Step 12: Run the statusTrigger tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts`
Expected: PASS — including every pre-existing test (unaffected, since none of them create archived work units).

- [ ] **Step 13: Run the full suite and typecheck**

Run: `npx tsc --noEmit` and `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
Expected: both clean/green.

- [ ] **Step 14: Commit**

```bash
git add src/app/api/stories/route.ts src/app/api/stories/route.test.ts \
  src/app/api/projects/route.ts src/app/api/projects/route.test.ts \
  "src/app/api/projects/[projectId]/route.ts" "src/app/api/projects/[projectId]/route.test.ts" \
  src/lib/statusTrigger.ts src/lib/statusTrigger.test.ts
git commit -m "feat: exclude archived work units from board, stats, and JIRA-sync queries"
```

---

### Task 3: Actually archive on a successful Move-to-QA

**Files:**
- Modify: `src/lib/statusTrigger.ts`, `src/lib/statusTrigger.test.ts`

**Interfaces:**
- Produces: `archiveDoneWorkUnits(storyId: string, prisma: PrismaClient): Promise<number>` — archives every one of the story's currently-non-archived Done work units, returns the count archived. Called internally by `transitionStoryToQA`; not exported for external use beyond this file (no other task/consumer needs it directly).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/statusTrigger.test.ts`'s `describe("transitionStoryToQA", ...)` block:

```ts
  it("archives every one of the story's work units after a successful transition to QA", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu1 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    const wu2 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "done", order: 1 },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result).toEqual({ ok: true });

    const updated1 = await prisma.workUnit.findUnique({ where: { id: wu1.id } });
    const updated2 = await prisma.workUnit.findUnique({ where: { id: wu2.id } });
    expect(updated1?.archivedAt).not.toBeNull();
    expect(updated2?.archivedAt).not.toBeNull();
  });

  it("does not archive anything when the transition fails (a sibling isn't done)", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    const wu1 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    const wu2 = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "code_review", order: 1 },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result.ok).toBe(false);

    const updated1 = await prisma.workUnit.findUnique({ where: { id: wu1.id } });
    const updated2 = await prisma.workUnit.findUnique({ where: { id: wu2.id } });
    expect(updated1?.archivedAt).toBeNull();
    expect(updated2?.archivedAt).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts`
Expected: FAIL — the first new test fails because nothing archives the work units yet (the second one already passes trivially, since a failed transition already leaves everything untouched — keep it anyway as an explicit regression guard).

- [ ] **Step 3: Implement `archiveDoneWorkUnits` and wire it into `transitionStoryToQA`**

In `src/lib/statusTrigger.ts`, add this function right after `transitionStoryToQA` (or immediately before it — place it so it reads naturally as a helper the exported function calls):

```ts
/**
 * Archives every one of a story's currently-active Done work units — sets
 * `archivedAt` so they're excluded from the board and stats going forward,
 * without deleting the row (retained for future reporting). Called only
 * after `transitionStoryToQA` has already confirmed every one of the
 * story's active work units is Done, so this intentionally does not
 * re-check that condition itself.
 */
async function archiveDoneWorkUnits(storyId: string, prisma: PrismaClient): Promise<number> {
  const result = await prisma.workUnit.updateMany({
    where: { storyId, archivedAt: null, column: "done" },
    data: { archivedAt: new Date() },
  });
  return result.count;
}
```

Then, inside `transitionStoryToQA`, after the existing `await prisma.story.update({ where: { id: storyId }, data: { jiraStatus: "QA" } });` line and before `return { ok: true };`, add:

```ts
    await archiveDoneWorkUnits(storyId, prisma);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts`
Expected: PASS — both new tests, plus every pre-existing test in this file (unaffected).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit` and `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
Expected: both clean/green.

- [ ] **Step 6: Manually verify in a real browser**

Start the dev server, take a story with multiple work units, move them all to Done, click "Move to QA" on one of them, and confirm: (a) the success toast appears as before, (b) ALL of that story's cards immediately disappear from the Done column on refresh, (c) the story itself disappears from the board's story count if that was its only story. This is a genuinely new, user-visible behavior change (cards vanishing) worth seeing directly, not just trusting the unit tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/statusTrigger.ts src/lib/statusTrigger.test.ts
git commit -m "feat: archive a story's work units after a successful Move-to-QA transition"
```

---

## Final verification (before PR)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — no new errors.
- [ ] `npx dotenv -e .env.test -- vitest run --no-file-parallelism` — full suite green.
- [ ] `npx knip` — no new unused exports.
- [ ] Manual browser check (Task 3, Step 6) — cards genuinely vanishing from the board is the core user-visible behavior of this feature.
- [ ] Open the PR; the user merges.

---

## Self-Review

**Spec coverage:** "the Ponder card should be archived and removed from Kanban board" → Task 2 (excluded from every read path) + Task 3 (the field actually gets set). "retain the record... for reporting" → `archivedAt` is a soft flag, never a delete, verified by Task 3's tests directly querying the row after archiving. "if all the sub-stories are in Done and one is Moved to QA successfully, then all the sub-stories should be archived" → Task 3's `archiveDoneWorkUnits`, triggered exactly by `transitionStoryToQA`'s existing success path, which already only succeeds when every work unit is Done — no new gating logic duplicated. ✅

**Type consistency:** `archivedAt: string | null` on `WorkUnitDTO` (Task 1) is serialized identically (`wu.archivedAt?.toISOString() ?? null`) across all four DTO converters. `archiveDoneWorkUnits(storyId: string, prisma: PrismaClient): Promise<number>` (Task 3) matches the exact `PrismaClient` type already imported and used throughout `statusTrigger.ts`.

**Placeholder scan:** every step has concrete, complete code. Two steps (Task 1 Step 3, Task 2 Steps 1 and 5) explicitly instruct the implementer to read the target test file's existing fixture/helper pattern first and adapt variable names — this is a flagged judgment call (matching how this codebase's tests already vary slightly in their exact helper names/creation patterns file-to-file), not a hidden gap; the assertions themselves are fully specified.

**Open follow-ups (not in scope):** no UI to view archived cards (a future reporting feature would read the same `archivedAt`-tagged rows this plan produces); no un-archive action (a direct Prisma/DB update would suffice if ever needed manually).
