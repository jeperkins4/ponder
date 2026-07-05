# Re-import De-duplication + Broadened Issue Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop JIRA re-imports from duplicating work-unit cards (preview flag + process-route guard, guarded at both layers) and drop the JQL issue-type filter so any assigned issue type imports.

**Architecture:** A shared batch predicate (`src/lib/importDedup.ts`) defines "already imported" = a `Story` row with that `jiraKey` exists AND has ≥1 work unit with `archivedAt: null`. The preview route uses it to flag rows (`alreadyImported`); the process route independently re-checks it and skips card creation (story fields still upsert). The `ImportReview` UI badges flagged rows and requires an explicit "Import anyway" check to include them. The completion event carries counts so `KanbanBoard` can toast "N imported, M already on board".

**Tech Stack:** Next.js App Router (TypeScript), Prisma/Postgres, Vitest + Testing Library. Route tests are integration tests against the test database (`npm test` wraps vitest with `.env.test`).

**Spec:** `docs/superpowers/specs/2026-07-04-reimport-dedup-design.md`

## Global Constraints

- Test command: `npm run test:ci -- <path>` runs one file; plain `npm run test:ci` runs everything. Both load `.env.test` automatically. (`npx vitest` alone will NOT pick up the test DB — always go through the npm scripts.)
- Status list in `src/lib/jira/jql.ts` (`PROJECT_SYNC_STATUSES`) is UNCHANGED — including the intentionally misspelled "Code Revew".
- `syncStoriesFromJira` / `syncStoriesForProject` in `src/lib/sync.ts` are UNCHANGED — they never create cards.
- Card replacement / regeneration for already-imported stories is out of scope.
- Badge copy is exactly "Already on board"; the opt-in checkbox label is exactly "Import anyway".
- Commit after every task; branch is `feature/reimport-dedup`.

---

### Task 1: De-dup predicate `findAlreadyImportedKeys`

**Files:**
- Create: `src/lib/importDedup.ts`
- Test: `src/lib/importDedup.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; Prisma client passed in).
- Produces: `findAlreadyImportedKeys(jiraKeys: string[], prismaClient?: PrismaClient): Promise<Set<string>>` — the subset of `jiraKeys` whose local Story has ≥1 active (non-archived) work unit. Tasks 3 and 4 call this.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/importDedup.test.ts`. Integration tests against the real test DB, mirroring `src/lib/sync.test.ts`'s style. Unique suffixed keys keep runs independent; `finally` blocks clean up.

```typescript
/**
 * Integration tests for findAlreadyImportedKeys against the test database.
 * "Already imported" = Story row exists for the jiraKey AND it has at least
 * one work unit with archivedAt: null. Archived-only stories count as fresh.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { findAlreadyImportedKeys } from "./importDedup";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStory(jiraKey: string) {
  return prisma.story.create({
    data: {
      jiraKey,
      jiraId: `id-${jiraKey}`,
      projectKey: "DEDUP",
      summary: `Story ${jiraKey}`,
      jiraStatus: "To Do",
      url: `https://example.atlassian.net/browse/${jiraKey}`,
      lastSyncedAt: new Date(),
    },
  });
}

describe("findAlreadyImportedKeys", () => {
  it("returns an empty set for an empty input without querying", async () => {
    const result = await findAlreadyImportedKeys([], prisma);
    expect(result).toEqual(new Set());
  });

  it("does not include keys with no local story", async () => {
    const key = uniqueKey("DEDUP-MISSING");
    const result = await findAlreadyImportedKeys([key], prisma);
    expect(result.has(key)).toBe(false);
  });

  it("does not include a story with zero work units", async () => {
    const key = uniqueKey("DEDUP-EMPTY");
    const story = await createStory(key);
    try {
      const result = await findAlreadyImportedKeys([key], prisma);
      expect(result.has(key)).toBe(false);
    } finally {
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("includes a story with at least one active work unit", async () => {
    const key = uniqueKey("DEDUP-ACTIVE");
    const story = await createStory(key);
    try {
      await prisma.workUnit.create({
        data: { storyId: story.id, title: "Active card", column: "todo", order: 0 },
      });
      const result = await findAlreadyImportedKeys([key], prisma);
      expect(result.has(key)).toBe(true);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("does not include a story whose work units are all archived", async () => {
    const key = uniqueKey("DEDUP-ARCHIVED");
    const story = await createStory(key);
    try {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          title: "Archived card",
          column: "done",
          order: 0,
          archivedAt: new Date(),
        },
      });
      const result = await findAlreadyImportedKeys([key], prisma);
      expect(result.has(key)).toBe(false);
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });

  it("returns exactly the already-imported subset of a mixed batch", async () => {
    const activeKey = uniqueKey("DEDUP-MIX-ACTIVE");
    const emptyKey = uniqueKey("DEDUP-MIX-EMPTY");
    const missingKey = uniqueKey("DEDUP-MIX-MISSING");
    const activeStory = await createStory(activeKey);
    const emptyStory = await createStory(emptyKey);
    try {
      await prisma.workUnit.create({
        data: { storyId: activeStory.id, title: "Card", column: "in_progress", order: 0 },
      });
      const result = await findAlreadyImportedKeys(
        [activeKey, emptyKey, missingKey],
        prisma
      );
      expect(result).toEqual(new Set([activeKey]));
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: activeStory.id } });
      await prisma.story.delete({ where: { id: activeStory.id } });
      await prisma.story.delete({ where: { id: emptyStory.id } });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:ci -- src/lib/importDedup.test.ts`
Expected: FAIL — cannot resolve `./importDedup`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/importDedup.ts`:

```typescript
/**
 * Import de-duplication predicate.
 *
 * A story counts as "already imported" when a local Story row with that
 * jiraKey exists AND it has at least one active (archivedAt: null) work
 * unit. Stories whose cards were ALL archived by Move-to-QA count as fresh,
 * so a story reopened in JIRA after failing QA imports normally.
 *
 * Used by BOTH the import preview route (to flag rows in the UI) and the
 * import process route (to skip card creation server-side) — the guard is
 * deliberately duplicated at both layers so a stale preview or a direct API
 * call can never duplicate cards.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Returns the subset of `jiraKeys` that are already imported, using a single
 * grouped query (no per-key N+1).
 */
export async function findAlreadyImportedKeys(
  jiraKeys: string[],
  prismaClient: PrismaClient = prisma
): Promise<Set<string>> {
  if (jiraKeys.length === 0) {
    return new Set();
  }

  const stories = await prismaClient.story.findMany({
    where: {
      jiraKey: { in: jiraKeys },
      workUnits: { some: { archivedAt: null } },
    },
    select: { jiraKey: true },
  });

  return new Set(stories.map((s) => s.jiraKey));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:ci -- src/lib/importDedup.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/importDedup.ts src/lib/importDedup.test.ts
git commit -m "feat: add findAlreadyImportedKeys import de-dup predicate"
```

---

### Task 2: Drop the JQL issue-type filter

**Files:**
- Modify: `src/lib/jira/jql.ts:52` (the `buildProjectStoriesJql` return)
- Test: `src/lib/jira/jql.test.ts:39-44`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildProjectStoriesJql(projectKey: string): string` (signature unchanged) now returns JQL WITHOUT `issuetype in (Story, Task, Bug)`. No caller changes needed.

- [ ] **Step 1: Update the existing test expectation**

In `src/lib/jira/jql.test.ts`, the `buildProjectStoriesJql` assertion currently expects the issuetype clause. Change the expected string to:

```typescript
    const jql = buildProjectStoriesJql("TEAM");
    expect(jql).toBe(
      'project = "TEAM" AND assignee = currentUser() AND status in ("To Do", "In Progress", "Code Revew", "Code Review")'
    );
```

Also update that test's name/description if it mentions issue types (e.g. to "builds project JQL filtered by active statuses for the current user, with no issue-type restriction").

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:ci -- src/lib/jira/jql.test.ts`
Expected: FAIL — actual string still contains `issuetype in (Story, Task, Bug)`.

- [ ] **Step 3: Update the implementation**

In `src/lib/jira/jql.ts`, change the return of `buildProjectStoriesJql` from:

```typescript
  return `project = "${projectKey}" AND issuetype in (Story, Task, Bug) AND assignee = currentUser() AND status in (${statuses})`;
```

to:

```typescript
  return `project = "${projectKey}" AND assignee = currentUser() AND status in (${statuses})`;
```

Update the function's doc comment: it no longer restricts to Story/Task/Bug — any issue type assigned to the current user in an active status is included (sub-tasks and epics arrive as ordinary board stories).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:ci -- src/lib/jira/jql.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jira/jql.ts src/lib/jira/jql.test.ts
git commit -m "feat: import all assigned issue types, not just Story/Task/Bug"
```

---

### Task 3: Preview route flags already-imported stories

**Files:**
- Modify: `src/app/api/projects/[projectId]/import/preview/route.ts`
- Test: `src/app/api/projects/[projectId]/import/preview/route.test.ts`

**Interfaces:**
- Consumes: `findAlreadyImportedKeys(jiraKeys, prisma)` from Task 1.
- Produces: `ImportPreviewStory` gains `alreadyImported: boolean`. Task 5's UI reads it.

- [ ] **Step 1: Write the failing test**

Append to the existing `describe` block in `route.test.ts` (reuse its `makeStory` helper and the mocked `jiraClient.fetchStoriesForProject`):

```typescript
  it("flags stories that already have active cards as alreadyImported", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const activeKey = `PREV-${suffix}-ACTIVE`;
    const archivedKey = `PREV-${suffix}-ARCHIVED`;
    const freshKey = `PREV-${suffix}-FRESH`;

    const project = await prisma.project.create({
      data: {
        name: `Dedup Preview Test ${suffix}`,
        type: "JIRA",
        jiraProjectKey: "PREV",
        jiraSiteUrl: "https://example.atlassian.net/",
        jiraEmail: "preview@example.com",
        jiraApiToken: "preview-token",
      },
    });

    const activeStory = await prisma.story.create({
      data: {
        jiraKey: activeKey,
        jiraId: `id-${activeKey}`,
        projectKey: "PREV",
        summary: "Has active card",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${activeKey}`,
        lastSyncedAt: new Date(),
      },
    });
    await prisma.workUnit.create({
      data: { storyId: activeStory.id, title: "Card", column: "todo", order: 0 },
    });

    const archivedStory = await prisma.story.create({
      data: {
        jiraKey: archivedKey,
        jiraId: `id-${archivedKey}`,
        projectKey: "PREV",
        summary: "Only archived cards",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${archivedKey}`,
        lastSyncedAt: new Date(),
      },
    });
    await prisma.workUnit.create({
      data: {
        storyId: archivedStory.id,
        title: "Archived card",
        column: "done",
        order: 0,
        archivedAt: new Date(),
      },
    });

    vi.mocked(jiraClient.fetchStoriesForProject).mockResolvedValueOnce([
      makeStory({ jiraKey: activeKey, jiraId: `id-${activeKey}` }),
      makeStory({ jiraKey: archivedKey, jiraId: `id-${archivedKey}` }),
      makeStory({ jiraKey: freshKey, jiraId: `id-${freshKey}` }),
    ]);

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/preview`,
        { method: "POST" }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const byKey = Object.fromEntries(
        data.stories.map((s: { jiraKey: string; alreadyImported: boolean }) => [
          s.jiraKey,
          s.alreadyImported,
        ])
      );
      expect(byKey[activeKey]).toBe(true);
      expect(byKey[archivedKey]).toBe(false);
      expect(byKey[freshKey]).toBe(false);
    } finally {
      await prisma.workUnit.deleteMany({
        where: { storyId: { in: [activeStory.id, archivedStory.id] } },
      });
      await prisma.story.deleteMany({
        where: { id: { in: [activeStory.id, archivedStory.id] } },
      });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:ci -- "src/app/api/projects/[projectId]/import/preview/route.test.ts"`
Expected: the new test FAILS (`alreadyImported` is `undefined`); existing tests PASS.

- [ ] **Step 3: Implement**

In `preview/route.ts`:

1. Add import: `import { findAlreadyImportedKeys } from "@/lib/importDedup";`
2. Add the field to the interface:

```typescript
export interface ImportPreviewStory {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  targetColumn: Column;
  alreadyImported: boolean;
}
```

3. After `fetchStoriesForProject`, compute the flag set and include it in the mapping:

```typescript
    const alreadyImportedKeys = await findAlreadyImportedKeys(
      jiraStories.map((dto) => dto.jiraKey),
      prisma
    );

    const stories: ImportPreviewStory[] = jiraStories.map((dto) => ({
      jiraKey: dto.jiraKey,
      jiraId: dto.jiraId,
      summary: dto.summary,
      description: dto.description,
      jiraStatus: dto.jiraStatus,
      targetColumn: jiraStatusToColumn(dto.jiraStatus),
      alreadyImported: alreadyImportedKeys.has(dto.jiraKey),
    }));
```

Note: the route's header comment says it "persists nothing" — this stays true; `findAlreadyImportedKeys` only reads.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:ci -- "src/app/api/projects/[projectId]/import/preview/route.test.ts"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/projects/[projectId]/import/preview/route.ts" "src/app/api/projects/[projectId]/import/preview/route.test.ts"
git commit -m "feat: flag already-imported stories in import preview"
```

---

### Task 4: Process route skips card creation for already-imported stories

**Files:**
- Modify: `src/app/api/projects/[projectId]/import/process/route.ts`
- Test: `src/app/api/projects/[projectId]/import/process/route.test.ts`

**Interfaces:**
- Consumes: `findAlreadyImportedKeys(jiraKeys, prisma)` from Task 1.
- Produces: `ImportProcessResult` becomes `{ storiesProcessed: number; storiesSkipped: number; workUnitsCreated: number }`. Semantics: a skipped item increments `storiesSkipped` and NOT `storiesProcessed`; its Story fields are still upserted; no cards are created and `breakDownStory` is never called for it. Task 5's UI reads these counts.

- [ ] **Step 1: Write the failing test**

Append to the existing `describe` block in `process/route.test.ts` (the file already mocks `@/lib/anthropic/breakdown`):

```typescript
  it("skips card creation but still upserts story fields for an already-imported story", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const jiraKey = `PROC-${suffix}-DUP`;

    const project = await prisma.project.create({
      data: {
        name: `Process Dedup Test ${suffix}`,
        type: "JIRA",
        jiraProjectKey: "PROC",
        jiraSiteUrl: "https://example.atlassian.net/",
        jiraEmail: "process-dedup@example.com",
        jiraApiToken: "process-dedup-token",
      },
    });

    const story = await prisma.story.create({
      data: {
        jiraKey,
        jiraId: `id-${jiraKey}`,
        projectKey: "PROC",
        summary: "Stale summary",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/${jiraKey}`,
        lastSyncedAt: new Date(),
      },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Existing card", column: "in_progress", order: 0 },
    });

    try {
      const req = new Request(
        `http://localhost:3000/api/projects/${project.id}/import/process`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                jiraKey,
                jiraId: `id-${jiraKey}`,
                summary: "Fresh summary",
                description: "Fresh description",
                jiraStatus: "In Progress",
                breakDown: true,
              },
            ],
          }),
        }
      );
      const res = await POST(req as never, {
        params: Promise.resolve({ projectId: project.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        storiesProcessed: 0,
        storiesSkipped: 1,
        workUnitsCreated: 0,
      });

      // Story fields refreshed…
      const updated = await prisma.story.findUnique({ where: { jiraKey } });
      expect(updated?.summary).toBe("Fresh summary");
      expect(updated?.jiraStatus).toBe("In Progress");

      // …but no new cards, and no breakdown call despite breakDown: true.
      const cards = await prisma.workUnit.findMany({ where: { storyId: story.id } });
      expect(cards).toHaveLength(1);
      expect(cards[0].title).toBe("Existing card");
      expect(breakdown.breakDownStory).not.toHaveBeenCalled();
    } finally {
      await prisma.workUnit.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
```

Also update any existing assertion in this file that does `expect(data).toEqual({ storiesProcessed: …, workUnitsCreated: … })` to include `storiesSkipped: 0` (search the file for `storiesProcessed` and extend each full-equality object).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:ci -- "src/app/api/projects/[projectId]/import/process/route.test.ts"`
Expected: new test FAILS (a second card is created; `storiesSkipped` missing).

- [ ] **Step 3: Implement**

In `process/route.ts`:

1. Add import: `import { findAlreadyImportedKeys } from "@/lib/importDedup";`
2. Extend the result interface:

```typescript
export interface ImportProcessResult {
  storiesProcessed: number;
  storiesSkipped: number;
  workUnitsCreated: number;
}
```

3. Add a `storiesSkipped` counter next to the existing counters, and compute the skip set ONCE before the loop (server-side re-check; never trust the client's flag):

```typescript
    let storiesProcessed = 0;
    let storiesSkipped = 0;
    let workUnitsCreated = 0;

    // Server-side re-check of the de-dup predicate — the client's preview
    // flag is advisory only. Computed once for the whole batch.
    const alreadyImportedKeys = await findAlreadyImportedKeys(
      items.map((item) => item.jiraKey),
      prisma
    );
```

4. Inside the `for (const item of items)` loop, keep the `prisma.story.upsert` exactly as-is, then immediately after it (before `const column = …`) add:

```typescript
      if (alreadyImportedKeys.has(item.jiraKey)) {
        // Already on the board: story fields were refreshed by the upsert
        // above, but no cards are created (and no Claude breakdown runs).
        storiesSkipped++;
        continue;
      }
```

5. Return the extended result:

```typescript
    const result: ImportProcessResult = { storiesProcessed, storiesSkipped, workUnitsCreated };
```

6. Update the file's header comment to mention the skip behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:ci -- "src/app/api/projects/[projectId]/import/process/route.test.ts"`
Expected: all PASS (including the pre-existing tests updated for `storiesSkipped: 0`).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/projects/[projectId]/import/process/route.ts" "src/app/api/projects/[projectId]/import/process/route.test.ts"
git commit -m "feat: skip card creation for already-imported stories on import"
```

---

### Task 5: UI — badge, "Import anyway" opt-in, and result toast

**Files:**
- Modify: `src/components/ImportReview.tsx`
- Modify: `src/components/ImportFromJiraButton.tsx`
- Modify: `src/components/KanbanBoard.tsx:144-152` (import-complete listener)
- Test: `src/components/ImportReview.test.tsx`
- Test: `src/components/ImportFromJiraButton.test.tsx`
- Test: `src/components/KanbanBoard.test.tsx`

**Interfaces:**
- Consumes: `alreadyImported` on preview rows (Task 3); `{ storiesProcessed, storiesSkipped, workUnitsCreated }` from process (Task 4).
- Produces: `ImportReviewProps.onImported` changes to `onImported: (result: { storiesProcessed: number; storiesSkipped: number; workUnitsCreated: number }) => void`. `ImportFromJiraButton` forwards it as `new CustomEvent("ponder-jira-import-complete", { detail: result })`. `KanbanBoard` reads `event.detail` to build the toast.

- [ ] **Step 1: Write the failing ImportReview tests**

In `src/components/ImportReview.test.tsx`: add `alreadyImported: false` to both entries in the existing `previewStories` fixture, then append these tests to the `describe` block (reusing `mockFetchSequence`):

```typescript
  const dedupStories = [
    { ...previewStories[0], alreadyImported: false },
    {
      jiraKey: "ALPHA-3",
      jiraId: "10003",
      summary: "Already imported story",
      description: null,
      jiraStatus: "To Do",
      targetColumn: "todo",
      alreadyImported: true,
    },
  ];

  it("shows an Already on board badge and Import anyway checkbox on flagged rows only", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: dedupStories } },
    }) as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() =>
      expect(screen.getByTestId("import-review-row-ALPHA-3")).toBeInTheDocument()
    );

    expect(screen.getByTestId("import-review-already-imported-badge-ALPHA-3")).toHaveTextContent(
      "Already on board"
    );
    expect(screen.getByTestId("import-review-import-anyway-ALPHA-3")).not.toBeChecked();
    expect(
      screen.queryByTestId("import-review-already-imported-badge-ALPHA-1")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("import-review-import-anyway-ALPHA-1")
    ).not.toBeInTheDocument();
  });

  it("excludes flagged rows from processing unless Import anyway is checked", async () => {
    const fetchMock = mockFetchSequence({
      preview: { ok: true, body: { stories: dedupStories } },
      process: {
        ok: true,
        body: { storiesProcessed: 1, storiesSkipped: 0, workUnitsCreated: 1 },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() =>
      expect(screen.getByTestId("import-review-process-button")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => expect(onImported).toHaveBeenCalled());

    const processCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import/process")
    );
    const sentItems = JSON.parse(String(processCall![1]!.body)).items;
    expect(sentItems.map((i: { jiraKey: string }) => i.jiraKey)).toEqual(["ALPHA-1"]);
  });

  it("includes a flagged row after Import anyway is checked", async () => {
    const fetchMock = mockFetchSequence({
      preview: { ok: true, body: { stories: dedupStories } },
      process: {
        ok: true,
        body: { storiesProcessed: 1, storiesSkipped: 1, workUnitsCreated: 1 },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() =>
      expect(screen.getByTestId("import-review-import-anyway-ALPHA-3")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("import-review-import-anyway-ALPHA-3"));
    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() => expect(onImported).toHaveBeenCalled());

    const processCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/import/process")
    );
    const sentItems = JSON.parse(String(processCall![1]!.body)).items;
    expect(sentItems.map((i: { jiraKey: string }) => i.jiraKey)).toEqual([
      "ALPHA-1",
      "ALPHA-3",
    ]);
  });

  it("passes the process result counts to onImported", async () => {
    global.fetch = mockFetchSequence({
      preview: { ok: true, body: { stories: dedupStories } },
      process: {
        ok: true,
        body: { storiesProcessed: 1, storiesSkipped: 0, workUnitsCreated: 3 },
      },
    }) as unknown as typeof fetch;

    render(<ImportReview projectId="p1" onClose={onClose} onImported={onImported} />);

    await waitFor(() =>
      expect(screen.getByTestId("import-review-process-button")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("import-review-process-button"));

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith({
        storiesProcessed: 1,
        storiesSkipped: 0,
        workUnitsCreated: 3,
      })
    );
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:ci -- src/components/ImportReview.test.tsx`
Expected: the 4 new tests FAIL (missing test IDs; onImported called with no args); existing tests PASS.

- [ ] **Step 3: Implement the ImportReview changes**

In `src/components/ImportReview.tsx`:

1. Add `alreadyImported: boolean;` to the local `ImportPreviewStory` interface.
2. Change the props interface:

```typescript
export interface ImportReviewProps {
  projectId: string;
  onClose: () => void;
  onImported: (result: {
    storiesProcessed: number;
    storiesSkipped: number;
    workUnitsCreated: number;
  }) => void;
}
```

3. Add include-state next to `breakDownByKey` — fresh rows are always included; flagged rows are opt-in:

```typescript
  const [importAnywayByKey, setImportAnywayByKey] = useState<Record<string, boolean>>({});
```

Initialize it in `loadPreview` right after `setBreakDownByKey(...)`:

```typescript
        setImportAnywayByKey(
          Object.fromEntries(
            loadedStories.filter((s) => s.alreadyImported).map((s) => [s.jiraKey, false])
          )
        );
```

4. Add the toggle next to `toggleBreakDown`:

```typescript
  const toggleImportAnyway = (jiraKey: string) => {
    setImportAnywayByKey((prev) => ({ ...prev, [jiraKey]: !prev[jiraKey] }));
  };
```

5. In `handleProcess`, filter before mapping:

```typescript
      const items = stories
        .filter((s) => !s.alreadyImported || importAnywayByKey[s.jiraKey])
        .map((s) => ({
          jiraKey: s.jiraKey,
          jiraId: s.jiraId,
          summary: s.summary,
          description: s.description,
          jiraStatus: s.jiraStatus,
          breakDown: Boolean(breakDownByKey[s.jiraKey]),
        }));
```

and pass the result through: replace `onImported();` with

```typescript
      onImported({
        storiesProcessed: data.storiesProcessed ?? 0,
        storiesSkipped: data.storiesSkipped ?? 0,
        workUnitsCreated: data.workUnitsCreated ?? 0,
      });
```

6. In the row JSX (inside `stories.map`), after the existing target-column badge `<span>`, add the flagged-row chrome:

```tsx
                      {story.alreadyImported && (
                        <>
                          <span
                            data-testid={`import-review-already-imported-badge-${story.jiraKey}`}
                            className={`text-xs font-semibold px-2 py-1 rounded-full border shrink-0 ${mutedTextClass} ${rowBorderClass}`}
                          >
                            Already on board
                          </span>
                          <input
                            id={`import-anyway-${story.jiraKey}`}
                            type="checkbox"
                            checked={Boolean(importAnywayByKey[story.jiraKey])}
                            onChange={() => toggleImportAnyway(story.jiraKey)}
                            data-testid={`import-review-import-anyway-${story.jiraKey}`}
                            className="h-4 w-4 shrink-0 focus:ring-2 focus:ring-ponder-light-purple focus:outline-none"
                          />
                          <label
                            htmlFor={`import-anyway-${story.jiraKey}`}
                            className={`text-xs shrink-0 ${mutedTextClass}`}
                          >
                            Import anyway
                          </label>
                        </>
                      )}
```

7. Update the component's doc comment to describe the flag/opt-in behavior.

- [ ] **Step 4: Run to verify ImportReview tests pass**

Run: `npm run test:ci -- src/components/ImportReview.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Write the failing event-forwarding + toast tests**

In `src/components/ImportFromJiraButton.test.tsx`, add to the top-level `describe` block. That file's `beforeEach` mocks `global.fetch` to return `{ stories: [] }` for everything, so this test installs its own two-endpoint mock (same shape as ImportReview.test.tsx's `mockFetchSequence`):

```typescript
  it("forwards import result counts on the completion event", async () => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).endsWith("/import/preview")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stories: [
                {
                  jiraKey: "FWD-1",
                  jiraId: "20001",
                  summary: "Forwarded story",
                  description: null,
                  jiraStatus: "To Do",
                  targetColumn: "todo",
                  alreadyImported: false,
                },
              ],
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            storiesProcessed: 2,
            storiesSkipped: 1,
            workUnitsCreated: 4,
          }),
      } as Response);
    }) as unknown as typeof fetch;

    const listener = vi.fn();
    window.addEventListener("ponder-jira-import-complete", listener);
    try {
      render(<ImportFromJiraButton projectId="p1" />);
      fireEvent.click(screen.getByTestId("import-from-jira-button"));

      await waitFor(() =>
        expect(screen.getByTestId("import-review-process-button")).toBeInTheDocument()
      );
      fireEvent.click(screen.getByTestId("import-review-process-button"));

      await waitFor(() => expect(listener).toHaveBeenCalled());
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({
        storiesProcessed: 2,
        storiesSkipped: 1,
        workUnitsCreated: 4,
      });
    } finally {
      window.removeEventListener("ponder-jira-import-complete", listener);
    }
  });
```

In `src/components/KanbanBoard.test.tsx`, add to the top-level `describe` block (its `beforeEach` already mocks `global.fetch` to return `mockStories` and clears localStorage; `render(<KanbanBoard />)` is the established pattern — no props needed):

```typescript
  it("shows an import-result toast including the already-on-board count", async () => {
    render(<KanbanBoard />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: /Kanban Board/i })
      ).toBeInTheDocument()
    );

    window.dispatchEvent(
      new CustomEvent("ponder-jira-import-complete", {
        detail: { storiesProcessed: 3, storiesSkipped: 2, workUnitsCreated: 7 },
      })
    );

    await waitFor(() =>
      expect(screen.getByText("3 imported, 2 already on board")).toBeInTheDocument()
    );
  });

  it("omits the already-on-board clause when nothing was skipped", async () => {
    render(<KanbanBoard />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: /Kanban Board/i })
      ).toBeInTheDocument()
    );

    window.dispatchEvent(
      new CustomEvent("ponder-jira-import-complete", {
        detail: { storiesProcessed: 3, storiesSkipped: 0, workUnitsCreated: 7 },
      })
    );

    await waitFor(() => expect(screen.getByText("3 imported")).toBeInTheDocument());
    expect(screen.queryByText(/already on board/)).not.toBeInTheDocument();
  });

  it("shows no toast on a bare import-complete event without detail", async () => {
    render(<KanbanBoard />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: /Kanban Board/i })
      ).toBeInTheDocument()
    );

    window.dispatchEvent(new Event("ponder-jira-import-complete"));

    // The silent refetch still runs (existing behavior); no toast appears.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/imported/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm run test:ci -- src/components/ImportFromJiraButton.test.tsx src/components/KanbanBoard.test.tsx`
Expected: new tests FAIL.

- [ ] **Step 7: Implement event forwarding and toast**

In `src/components/ImportFromJiraButton.tsx`, replace `handleImported`:

```typescript
  const handleImported = (result: {
    storiesProcessed: number;
    storiesSkipped: number;
    workUnitsCreated: number;
  }) => {
    // No shared refresh channel exists between this button (rendered via
    // KanbanBoard's headerActions) and KanbanBoard's own story-fetching
    // state, so we broadcast a DOM event the same way useTheme syncs theme
    // changes across instances; KanbanBoard listens, silently refetches,
    // and toasts the result counts.
    window.dispatchEvent(
      new CustomEvent("ponder-jira-import-complete", { detail: result })
    );
  };
```

In `src/components/KanbanBoard.tsx`, replace the listener effect body (lines ~144-152):

```typescript
    const handleImportComplete = (event: Event) => {
      fetchStories({ silent: true });
      const detail = (event as CustomEvent).detail as
        | { storiesProcessed: number; storiesSkipped: number }
        | undefined;
      if (detail) {
        const imported = `${detail.storiesProcessed} imported`;
        setStatusMessage(
          detail.storiesSkipped > 0
            ? `${imported}, ${detail.storiesSkipped} already on board`
            : imported
        );
      }
    };
```

(Keep the add/removeEventListener lines unchanged — `CustomEvent` is an `Event`, so the handler signature stays compatible.)

- [ ] **Step 8: Run to verify they pass**

Run: `npm run test:ci -- src/components/ImportFromJiraButton.test.tsx src/components/KanbanBoard.test.tsx src/components/ImportReview.test.tsx`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/ImportReview.tsx src/components/ImportReview.test.tsx src/components/ImportFromJiraButton.tsx src/components/ImportFromJiraButton.test.tsx src/components/KanbanBoard.tsx src/components/KanbanBoard.test.tsx
git commit -m "feat: badge + Import-anyway opt-in for already-imported stories, result toast"
```

---

### Task 6: Full-suite verification, README roadmap update, PR

**Files:**
- Modify: `README.md:112-115` (Roadmap section)

**Interfaces:** none.

- [ ] **Step 1: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm run test:ci`
Expected: zero type errors; all tests PASS. Fix anything the earlier per-file runs missed (e.g. other tests asserting on the process-result shape or the preview DTO — search for `storiesProcessed` and `ImportPreviewStory` across `src/` if failures appear).

- [ ] **Step 2: Update the README roadmap**

In `README.md`, change:

```markdown
- Re-import de-duplication, additional issue types and status mappings.
```

to:

```markdown
- Additional status mappings (statusCategory-based matching).
```

(Re-import de-dup and issue types are now done; status mappings were explicitly deferred.)

- [ ] **Step 3: Commit and open PR**

```bash
git add README.md
git commit -m "docs: update roadmap — re-import de-dup and issue-type broadening shipped"
git push -u origin feature/reimport-dedup
gh pr create --title "Re-import de-duplication + import all assigned issue types" --body "$(cat <<'EOF'
## Summary
- Importing a story that already has active (non-archived) cards no longer duplicates its cards: the preview flags it ("Already on board", opt-in "Import anyway" checkbox), and the process route independently skips card creation server-side while still refreshing story fields.
- Stories whose cards were all archived by Move-to-QA count as fresh, so a story reopened after failing QA imports normally.
- The completion toast reports "N imported, M already on board".
- The JQL issue-type filter is dropped: any issue type assigned to the current user in an active status imports.

Spec: docs/superpowers/specs/2026-07-04-reimport-dedup-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

John merges PRs himself — do not merge.
