# MCP Epic Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Ponder MCP server epic support: a `list_epics` tool, an optional `epicKey` filter on `list_stories`/`list_work_units`, and a one-shot `import_by_epic` tool — mirroring the epic-scoped import capability the board UI already has.

**Architecture:** Every MCP tool is a thin wrapper: `server.ts` registers a Zod-typed tool → calls a handler in `tools.ts` → calls a method on `PonderClient` (`client.ts`) → hits Ponder's existing REST API. This plan adds to each of those three layers plus a one-field gap in the REST layer (`StoryDTO`/`GET /api/stories` currently drop `epicKey`/`epicName` entirely). No new REST endpoints, no new business logic — everything needed already exists from `feature/per-epic-jira-import`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, Zod (`zod/v3` subpath — see the existing import comment in `server.ts`), Vitest, Next.js App Router, Prisma.

## Global Constraints

- This branch (`feature/mcp-epic-support`) is stacked on `feature/per-epic-jira-import` (PR #38, unmerged) — `Story.epicKey`/`epicName`, `fetchEpicsForProject`, and `GET /api/projects/[projectId]/jira/epics` already exist on it.
- Every MCP tool stays a thin wrapper — no business logic duplicated outside the REST layer it already lives in.
- `import_by_epic` is single-call: one `breakDown: boolean` applies to every story in the call, no per-story granularity, no "import anyway" override for already-imported stories (matches the UI's default-skip behavior).
- Epic filtering on `list_stories`/`list_work_units` is client-side in the tool handler (filtering the array already returned by `client.getStories`), not a new REST query parameter.
- Tests run via `npm test` / `npm run test:ci` only — never bare `npx vitest`.

---

### Task 1: `StoryDTO` and the `/api/stories` serializer gain `epicKey`/`epicName`

**Files:**
- Modify: `src/lib/types.ts` (the `StoryDTO` interface, `types.ts:50-65`)
- Modify: `src/app/api/stories/route.ts` (the story→DTO mapping, `route.ts:42-52`)
- Test: `src/app/api/stories/route.test.ts`

**Interfaces:**
- Produces: `StoryDTO.epicKey?: string | null`, `StoryDTO.epicName?: string | null` — consumed by Task 4 (epic filter on `listStories`/`listWorkUnits`) and Task 5 (`importByEpic` reads them indirectly via the preview response, not this field, but the DTO shape must be consistent).

- [ ] **Step 1: Write the failing test**

Add this test to `src/app/api/stories/route.test.ts`, after the "excludes a story entirely once every one of its work units is archived" test (at the end of the file, before the closing `});`):

```typescript
  it("serializes epicKey/epicName when present on the story, and null when absent", async () => {
    const project = await prisma.project.create({
      data: { name: "Epic Field Test Project", type: "STANDALONE" },
    });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const withEpic = await prisma.story.create({
      data: {
        jiraKey: `EPICFIELD-${suffix}-1`,
        jiraId: `EPICFIELD-${suffix}-1`,
        projectKey: "EPICFIELD",
        summary: "Story with epic",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/EPICFIELD-${suffix}-1`,
        lastSyncedAt: new Date(),
        projectId: project.id,
        epicKey: "EPICFIELD-100",
        epicName: "The epic",
      },
    });
    const withoutEpic = await prisma.story.create({
      data: {
        jiraKey: `EPICFIELD-${suffix}-2`,
        jiraId: `EPICFIELD-${suffix}-2`,
        projectKey: "EPICFIELD",
        summary: "Story without epic",
        jiraStatus: "To Do",
        url: `https://example.atlassian.net/browse/EPICFIELD-${suffix}-2`,
        lastSyncedAt: new Date(),
        projectId: project.id,
      },
    });

    try {
      const req = new NextRequest(
        `http://localhost:3000/api/stories?projectId=${project.id}`
      );
      const res = await GET(req);
      const data = await res.json();

      const foundWithEpic = data.find((s: { id: string }) => s.id === withEpic.id);
      expect(foundWithEpic.epicKey).toBe("EPICFIELD-100");
      expect(foundWithEpic.epicName).toBe("The epic");

      const foundWithoutEpic = data.find((s: { id: string }) => s.id === withoutEpic.id);
      expect(foundWithoutEpic.epicKey).toBeNull();
      expect(foundWithoutEpic.epicName).toBeNull();
    } finally {
      await prisma.story.delete({ where: { id: withEpic.id } });
      await prisma.story.delete({ where: { id: withoutEpic.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- run src/app/api/stories/route.test.ts`
Expected: FAIL — `foundWithEpic.epicKey` is `undefined`, not `"EPICFIELD-100"` (the serializer doesn't emit the field yet).

- [ ] **Step 3: Add the fields to `StoryDTO`**

In `src/lib/types.ts`, the `StoryDTO` interface currently reads:

```typescript
export interface StoryDTO {
  id: string;
  jiraKey: string;
  jiraId: string;
  projectKey: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  /** JIRA statusCategory key; present only on DTOs from the JIRA fetch path
   * (import/sync). Local API serializers never set it. */
  jiraStatusCategory?: "new" | "indeterminate" | "done";
  url: string;
  lastSyncedAt: string; // ISO string
  completionCommentPostedAt: string | null; // ISO string
  workUnits: WorkUnitDTO[];
}
```

Add `epicKey`/`epicName` right after `jiraStatus`, matching the Prisma `Story` model's column order:

```typescript
export interface StoryDTO {
  id: string;
  jiraKey: string;
  jiraId: string;
  projectKey: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  epicKey?: string | null;
  epicName?: string | null;
  /** JIRA statusCategory key; present only on DTOs from the JIRA fetch path
   * (import/sync). Local API serializers never set it. */
  jiraStatusCategory?: "new" | "indeterminate" | "done";
  url: string;
  lastSyncedAt: string; // ISO string
  completionCommentPostedAt: string | null; // ISO string
  workUnits: WorkUnitDTO[];
}
```

- [ ] **Step 4: Include the fields in the `/api/stories` serializer**

In `src/app/api/stories/route.ts`, the story→DTO mapping currently reads:

```typescript
    const storyDTOs: StoryDTO[] = stories.map((story) => ({
      id: story.id,
      jiraKey: story.jiraKey,
      jiraId: story.jiraId,
      projectKey: story.projectKey,
      summary: story.summary,
      description: story.description,
      jiraStatus: story.jiraStatus,
      url: story.url,
```

Add `epicKey`/`epicName` right after `jiraStatus`:

```typescript
    const storyDTOs: StoryDTO[] = stories.map((story) => ({
      id: story.id,
      jiraKey: story.jiraKey,
      jiraId: story.jiraId,
      projectKey: story.projectKey,
      summary: story.summary,
      description: story.description,
      jiraStatus: story.jiraStatus,
      epicKey: story.epicKey,
      epicName: story.epicName,
      url: story.url,
```

(The rest of the mapping — `lastSyncedAt`, `completionCommentPostedAt`, `workUnits` — is unchanged.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- run src/app/api/stories/route.test.ts`
Expected: PASS, all tests in the file green (including every pre-existing test — `story.epicKey`/`story.epicName` are `null` on every row that didn't set them, matching what those tests already expect implicitly by not checking the field).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/app/api/stories/route.ts src/app/api/stories/route.test.ts
git commit -m "feat: surface epicKey/epicName on StoryDTO and /api/stories"
```

---

### Task 2: `PonderClient` — `getEpics`, `previewEpicImport`, `processEpicImport`

**Files:**
- Modify: `src/mcp/client.ts`
- Test: `src/mcp/client.test.ts`

**Interfaces:**
- Consumes: `Column` type (`@/lib/types`, already imported in `client.ts`); the private `request<T>(method, path, body?)` helper already in `client.ts`.
- Produces:
  - `EpicImportPreviewStory` and `EpicImportProcessItem` interfaces (exported from `client.ts`) — consumed by Task 5 (`importByEpic`).
  - `getEpics(projectId: string): Promise<{ key: string; name: string }[]>`
  - `previewEpicImport(projectId: string, epicKey: string): Promise<{ stories: EpicImportPreviewStory[]; message?: string }>`
  - `processEpicImport(projectId: string, items: EpicImportProcessItem[], epicKey: string, epicName?: string): Promise<{ storiesProcessed: number; storiesSkipped: number; workUnitsCreated: number }>`
  - All three consumed by Task 3 (`getEpics`) and Task 5 (`previewEpicImport`, `processEpicImport`).

- [ ] **Step 1: Write the failing tests**

Append these tests to `src/mcp/client.test.ts`, inside the `describe("PonderClient", ...)` block, right after the `"getStories('p1') requests..."` test (after its closing `});`, before the `moveWorkUnit` tests):

```typescript
  it("getEpics('p1') requests GET .../jira/epics and unwraps .epics", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: { epics: [{ key: "TEAM-1", name: "Big epic" }] },
    });
    const client = new PonderClient(baseUrl, fetchImpl);

    const result = await client.getEpics("p1");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/p1/jira/epics`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual([{ key: "TEAM-1", name: "Big epic" }]);
  });

  it("previewEpicImport('p1','TEAM-1') POSTs {epicKey} to the preview endpoint", async () => {
    const preview = { stories: [] };
    const fetchImpl = fakeFetch({ ok: true, json: preview });
    const client = new PonderClient(baseUrl, fetchImpl);

    const result = await client.previewEpicImport("p1", "TEAM-1");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/p1/import/preview`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ epicKey: "TEAM-1" }),
      })
    );
    expect(result).toEqual(preview);
  });

  it("processEpicImport posts items + epicKey + epicName when epicName is provided", async () => {
    const processResult = { storiesProcessed: 1, storiesSkipped: 0, workUnitsCreated: 1 };
    const fetchImpl = fakeFetch({ ok: true, json: processResult });
    const client = new PonderClient(baseUrl, fetchImpl);
    const items = [
      {
        jiraKey: "TEAM-101",
        jiraId: "10101",
        summary: "S",
        description: null,
        jiraStatus: "To Do",
        breakDown: false,
      },
    ];

    const result = await client.processEpicImport("p1", items, "TEAM-1", "Big epic");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/p1/import/process`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items, epicKey: "TEAM-1", epicName: "Big epic" }),
      })
    );
    expect(result).toEqual(processResult);
  });

  it("processEpicImport omits epicName from the body when not provided", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: { storiesProcessed: 0, storiesSkipped: 0, workUnitsCreated: 0 },
    });
    const client = new PonderClient(baseUrl, fetchImpl);

    await client.processEpicImport("p1", [], "TEAM-1");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/p1/import/process`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items: [], epicKey: "TEAM-1" }),
      })
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- run src/mcp/client.test.ts`
Expected: FAIL — `client.getEpics`/`previewEpicImport`/`processEpicImport` are not functions yet.

- [ ] **Step 3: Add the types and methods**

In `src/mcp/client.ts`, add these two exported interfaces right after the existing imports (after the `import type { ReportsPayload } from "@/lib/reports/types";` line):

```typescript
export interface EpicImportPreviewStory {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  jiraStatusCategory?: "new" | "indeterminate" | "done";
  targetColumn: Column;
  alreadyImported: boolean;
}

export interface EpicImportProcessItem {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  jiraStatusCategory?: "new" | "indeterminate" | "done";
  breakDown: boolean;
}
```

Then add these three methods to the `PonderClient` class, right after the existing `getStories` method:

```typescript
  async getEpics(projectId: string): Promise<{ key: string; name: string }[]> {
    const result = await this.request<{
      epics: { key: string; name: string }[];
      message?: string;
    }>("GET", `/api/projects/${encodeURIComponent(projectId)}/jira/epics`);
    return result.epics;
  }

  async previewEpicImport(
    projectId: string,
    epicKey: string
  ): Promise<{ stories: EpicImportPreviewStory[]; message?: string }> {
    return this.request<{ stories: EpicImportPreviewStory[]; message?: string }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/import/preview`,
      { epicKey }
    );
  }

  async processEpicImport(
    projectId: string,
    items: EpicImportProcessItem[],
    epicKey: string,
    epicName?: string
  ): Promise<{ storiesProcessed: number; storiesSkipped: number; workUnitsCreated: number }> {
    return this.request<{
      storiesProcessed: number;
      storiesSkipped: number;
      workUnitsCreated: number;
    }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/import/process`,
      epicName !== undefined ? { items, epicKey, epicName } : { items, epicKey }
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- run src/mcp/client.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/client.ts src/mcp/client.test.ts
git commit -m "feat: add getEpics, previewEpicImport, processEpicImport to PonderClient"
```

---

### Task 3: `list_epics` tool

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/server.test.ts`
- Test: `src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `PonderClient.getEpics` (Task 2).
- Produces: `listEpics(client, { projectId }): Promise<McpTextResult>` — registered as the `list_epics` MCP tool.

- [ ] **Step 1: Write the failing tests**

Add `listEpics` to the import list at the top of `src/mcp/tools.test.ts`:

```typescript
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
```

Add this `describe` block right after `describe("listProjects", ...)` (after its closing `});`):

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- run src/mcp/tools.test.ts`
Expected: FAIL — `listEpics` is not exported from `./tools`.

- [ ] **Step 3: Implement `listEpics`**

Add this function to `src/mcp/tools.ts`, right after `listProjects` (after its closing `}`, before `columnBreakdown`):

```typescript
/** List a project's JIRA epics (key + name). */
export async function listEpics(
  client: PonderClient,
  args: { projectId: string }
): Promise<McpTextResult> {
  const epics = await client.getEpics(args.projectId);

  if (epics.length === 0) {
    return textResult(`No epics found for project ${args.projectId}.`);
  }

  const lines = epics.map((epic) => `- ${epic.name} (${epic.key})`);

  return textResult(`${epics.length} epic(s):\n${lines.join("\n")}`);
}
```

- [ ] **Step 4: Register the tool**

In `src/mcp/server.ts`, add `listEpics` to the import from `./tools` (currently lines 21-35):

```typescript
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
```

Add this registration right after the `list_projects` registration (after its closing `);`, before `list_stories`):

```typescript
  server.registerTool(
    "list_epics",
    {
      description: "List a project's JIRA epics (key + name).",
      inputSchema: {
        projectId: z.string(),
      },
    },
    async ({ projectId }) => listEpics(client, { projectId })
  );
```

- [ ] **Step 5: Update the tool-count test**

In `src/mcp/server.test.ts`, update the test title and expected array (currently asserts thirteen tools):

```typescript
  it("does not throw and registers the fourteen expected tools", () => {
```

Add `"list_epics"` to the expected array:

```typescript
    expect(registeredNames.sort()).toEqual(
      [
        "list_projects",
        "list_epics",
        "list_stories",
        "list_work_units",
        "move_work_unit",
        "mark_done",
        "update_work_unit",
        "regenerate_acceptance",
        "attach_image",
        "report_verification",
        "report_completed_work",
        "report_throughput",
        "report_status_snapshot",
        "report_jira_trail",
      ].sort()
    );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- run src/mcp/tools.test.ts src/mcp/server.test.ts`
Expected: PASS, all tests in both files green.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools.ts src/mcp/server.ts src/mcp/server.test.ts src/mcp/tools.test.ts
git commit -m "feat: add list_epics MCP tool"
```

---

### Task 4: Epic filter on `list_stories` / `list_work_units`

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts`
- Test: `src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `StoryDTO.epicKey` (Task 1).
- Produces: `listStories(client, { projectId, epicKey? })`, `listWorkUnits(client, { projectId, column?, pendingVerification?, epicKey? })` — both now accept an optional `epicKey` filter, registered on the existing `list_stories`/`list_work_units` MCP tools.

- [ ] **Step 1: Write the failing tests**

Add these two `describe` blocks to `src/mcp/tools.test.ts`, right after `describe("listWorkUnits with pendingVerification", ...)` (after its closing `});`):

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- run src/mcp/tools.test.ts`
Expected: FAIL — `epicKey` is silently ignored (TypeScript would also reject the extra property once the signature is checked; at runtime, the filter test fails because both stories are returned).

- [ ] **Step 3: Add the filter to `listStories`**

In `src/mcp/tools.ts`, `listStories` currently reads:

```typescript
export async function listStories(
  client: PonderClient,
  args: { projectId: string }
): Promise<McpTextResult> {
  const stories = await client.getStories(args.projectId);

  if (stories.length === 0) {
    return textResult(`No stories found for project ${args.projectId}.`);
  }
```

Change it to:

```typescript
export async function listStories(
  client: PonderClient,
  args: { projectId: string; epicKey?: string }
): Promise<McpTextResult> {
  let stories = await client.getStories(args.projectId);
  if (args.epicKey) {
    stories = stories.filter((story) => story.epicKey === args.epicKey);
  }

  if (stories.length === 0) {
    return textResult(
      args.epicKey
        ? `No stories found for project ${args.projectId} under epic ${args.epicKey}.`
        : `No stories found for project ${args.projectId}.`
    );
  }
```

(The rest of the function — building `lines` and the final `textResult` — is unchanged.)

- [ ] **Step 4: Add the filter to `listWorkUnits`**

In `src/mcp/tools.ts`, `listWorkUnits` currently reads:

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
```

Change it to:

```typescript
export async function listWorkUnits(
  client: PonderClient,
  args: {
    projectId: string;
    column?: string;
    pendingVerification?: boolean;
    epicKey?: string;
  }
): Promise<McpTextResult> {
  const validColumns = COLUMNS.map((c) => c.key);

  if (args.column !== undefined && !validColumns.includes(args.column as Column)) {
    return textResult(
      `Invalid column "${args.column}". Valid columns: ${validColumns.join(", ")}.`
    );
  }

  let stories = await client.getStories(args.projectId);
  if (args.epicKey) {
    stories = stories.filter((story) => story.epicKey === args.epicKey);
  }
  const column = args.column as Column | undefined;
```

(The rest of the function — the per-work-unit loop, the empty-result messages, the final `textResult` — is unchanged. The existing empty-result messages stay generic; they don't gain epic-specific wording, since the existing "No work units found for project X" message is still accurate when the epic filter is what emptied the result.)

- [ ] **Step 5: Update the tool registrations**

In `src/mcp/server.ts`, the `list_stories` registration currently reads:

```typescript
  server.registerTool(
    "list_stories",
    {
      description: "List stories (with their work units) for a project.",
      inputSchema: {
        projectId: z.string(),
      },
    },
    async ({ projectId }) => listStories(client, { projectId })
  );
```

Change it to:

```typescript
  server.registerTool(
    "list_stories",
    {
      description:
        "List stories (with their work units) for a project, optionally " +
        "filtered to a single epic.",
      inputSchema: {
        projectId: z.string(),
        epicKey: z.string().optional(),
      },
    },
    async ({ projectId, epicKey }) => listStories(client, { projectId, epicKey })
  );
```

The `list_work_units` registration currently reads:

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

Change it to:

```typescript
  server.registerTool(
    "list_work_units",
    {
      description:
        "List work units for a project, optionally filtered to a single column, " +
        "to only those pending AI-agent verification (pendingVerification: true), " +
        "or to a single epic.",
      inputSchema: {
        projectId: z.string(),
        column: z.string().optional(),
        pendingVerification: z.boolean().optional(),
        epicKey: z.string().optional(),
      },
    },
    async ({ projectId, column, pendingVerification, epicKey }) =>
      listWorkUnits(client, { projectId, column, pendingVerification, epicKey })
  );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- run src/mcp/tools.test.ts src/mcp/server.test.ts`
Expected: PASS, all tests in both files green (server.test.ts is unaffected by this task — no tool names changed, only existing tools' `inputSchema`).

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools.ts src/mcp/server.ts src/mcp/tools.test.ts
git commit -m "feat: add epicKey filter to list_stories and list_work_units"
```

---

### Task 5: `import_by_epic` tool

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/server.test.ts`
- Test: `src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `PonderClient.previewEpicImport`, `PonderClient.processEpicImport`, `EpicImportPreviewStory`, `EpicImportProcessItem` (all Task 2).
- Produces: `importByEpic(client, { projectId, epicKey, epicName?, breakDown? }): Promise<McpTextResult>` — registered as the `import_by_epic` MCP tool.

- [ ] **Step 1: Write the failing tests**

Update the two import statements at the top of `src/mcp/tools.test.ts`. The `./tools` import gains `importByEpic`; the existing `import type { PonderClient } from "./client";` line gains `EpicImportPreviewStory`. Together they should read:

```typescript
import {
  attachImage,
  importByEpic,
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
import type { EpicImportPreviewStory, PonderClient } from "./client";
```

Add this `describe` block at the end of `src/mcp/tools.test.ts` (after the last existing `describe`, before the file ends):

```typescript
describe("importByEpic", () => {
  const previewStory = (
    overrides: Partial<EpicImportPreviewStory>
  ): EpicImportPreviewStory => ({
    jiraKey: "PONE-101",
    jiraId: "10101",
    summary: "Story under epic",
    description: null,
    jiraStatus: "To Do",
    targetColumn: "todo",
    alreadyImported: false,
    ...overrides,
  });

  it("returns the preview message when the project isn't JIRA-linked / missing credentials", async () => {
    const client = fakeClient({
      previewEpicImport: async () => ({
        stories: [],
        message: "JIRA credentials not configured. Add them in project settings.",
      }),
    });

    const result = await importByEpic(client, { projectId: "p1", epicKey: "PONE-1" });

    expect(result.content[0].text).toBe(
      "JIRA credentials not configured. Add them in project settings."
    );
  });

  it("returns a clear message when the epic has no stories and no preview message", async () => {
    const client = fakeClient({
      previewEpicImport: async () => ({ stories: [] }),
    });

    const result = await importByEpic(client, { projectId: "p1", epicKey: "PONE-1" });

    expect(result.content[0].text).toMatch(/no stories found for epic PONE-1/i);
  });

  it("returns a clear message when every story is already imported, without calling process", async () => {
    const processEpicImportMock = vi.fn();
    const client = fakeClient({
      previewEpicImport: async () => ({
        stories: [previewStory({ alreadyImported: true })],
      }),
      processEpicImport: processEpicImportMock as unknown as PonderClient["processEpicImport"],
    });

    const result = await importByEpic(client, { projectId: "p1", epicKey: "PONE-1" });

    expect(result.content[0].text).toMatch(/already on the board/i);
    expect(processEpicImportMock).not.toHaveBeenCalled();
  });

  it("imports not-yet-imported stories with breakDown applied uniformly, and reports counts", async () => {
    const processEpicImportMock = vi.fn(async () => ({
      storiesProcessed: 1,
      storiesSkipped: 1,
      workUnitsCreated: 3,
    })) as unknown as PonderClient["processEpicImport"];
    const client = fakeClient({
      previewEpicImport: async () => ({
        stories: [
          previewStory({ jiraKey: "PONE-101", alreadyImported: false }),
          previewStory({ jiraKey: "PONE-102", alreadyImported: true }),
        ],
      }),
      processEpicImport: processEpicImportMock,
    });

    const result = await importByEpic(client, {
      projectId: "p1",
      epicKey: "PONE-1",
      epicName: "Big epic",
      breakDown: true,
    });

    expect(processEpicImportMock).toHaveBeenCalledWith(
      "p1",
      [
        {
          jiraKey: "PONE-101",
          jiraId: "10101",
          summary: "Story under epic",
          description: null,
          jiraStatus: "To Do",
          jiraStatusCategory: undefined,
          breakDown: true,
        },
      ],
      "PONE-1",
      "Big epic"
    );
    expect(result.content[0].text).toContain("1 processed");
    expect(result.content[0].text).toContain("1 skipped");
    expect(result.content[0].text).toContain("3 work unit(s) created");
    expect(result.content[0].text).toContain("PONE-101");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- run src/mcp/tools.test.ts`
Expected: FAIL — `importByEpic` is not exported from `./tools`.

- [ ] **Step 3: Implement `importByEpic`**

Update the import from `./client` at the top of `src/mcp/tools.ts` (currently `import type { PonderClient } from "./client";`):

```typescript
import type { EpicImportProcessItem, PonderClient } from "./client";
```

Add this function at the end of `src/mcp/tools.ts` (after `reportVerification`, the last function in the file):

```typescript
/**
 * One-shot epic-scoped import: fetches the epic's not-yet-imported issues
 * and imports all of them with a single breakDown flag applied uniformly.
 * Mirrors ImportReview.tsx's preview -> process flow, collapsed into one
 * call since MCP tools are single-shot, not an interactive review session.
 */
export async function importByEpic(
  client: PonderClient,
  args: {
    projectId: string;
    epicKey: string;
    epicName?: string;
    breakDown?: boolean;
  }
): Promise<McpTextResult> {
  const preview = await client.previewEpicImport(args.projectId, args.epicKey);

  if (preview.stories.length === 0) {
    return textResult(preview.message ?? `No stories found for epic ${args.epicKey}.`);
  }

  const toImport = preview.stories.filter((story) => !story.alreadyImported);

  if (toImport.length === 0) {
    return textResult(
      `${preview.stories.length} story(ies) found for epic ${args.epicKey}, all already on the board.`
    );
  }

  const items: EpicImportProcessItem[] = toImport.map((story) => ({
    jiraKey: story.jiraKey,
    jiraId: story.jiraId,
    summary: story.summary,
    description: story.description,
    jiraStatus: story.jiraStatus,
    jiraStatusCategory: story.jiraStatusCategory,
    breakDown: args.breakDown ?? false,
  }));

  const result = await client.processEpicImport(
    args.projectId,
    items,
    args.epicKey,
    args.epicName
  );

  const importedKeys = toImport.map((story) => story.jiraKey).join(", ");

  return textResult(
    `Imported epic ${args.epicKey}: ${result.storiesProcessed} processed, ` +
      `${result.storiesSkipped} skipped, ${result.workUnitsCreated} work unit(s) created.\n` +
      `Stories: ${importedKeys}`
  );
}
```

- [ ] **Step 4: Register the tool**

In `src/mcp/server.ts`, add `importByEpic` to the import from `./tools`:

```typescript
import {
  attachImage,
  importByEpic,
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
```

Add this registration right after `list_work_units` (after its closing `);`, before `move_work_unit`):

```typescript
  server.registerTool(
    "import_by_epic",
    {
      description:
        "Import all not-yet-imported issues under a JIRA epic into this " +
        "project's board, skipping issues already on the board. Optional " +
        "breakDown applies to every imported story (default false).",
      inputSchema: {
        projectId: z.string(),
        epicKey: z.string(),
        epicName: z.string().optional(),
        breakDown: z.boolean().optional(),
      },
    },
    async ({ projectId, epicKey, epicName, breakDown }) =>
      importByEpic(client, { projectId, epicKey, epicName, breakDown })
  );
```

- [ ] **Step 5: Update the tool-count test**

In `src/mcp/server.test.ts`, update the test title and expected array (now fifteen tools):

```typescript
  it("does not throw and registers the fifteen expected tools", () => {
```

```typescript
    expect(registeredNames.sort()).toEqual(
      [
        "list_projects",
        "list_epics",
        "list_stories",
        "list_work_units",
        "import_by_epic",
        "move_work_unit",
        "mark_done",
        "update_work_unit",
        "regenerate_acceptance",
        "attach_image",
        "report_verification",
        "report_completed_work",
        "report_throughput",
        "report_status_snapshot",
        "report_jira_trail",
      ].sort()
    );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- run src/mcp/tools.test.ts src/mcp/server.test.ts`
Expected: PASS, all tests in both files green.

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `npm run test:ci`
Expected: all tests pass (no failures anywhere in the repo).

- [ ] **Step 8: Commit**

```bash
git add src/mcp/tools.ts src/mcp/server.ts src/mcp/server.test.ts src/mcp/tools.test.ts
git commit -m "feat: add import_by_epic MCP tool"
```

---

### Task 6: Docs — `README-mcp.md`

**Files:**
- Modify: `README-mcp.md`

**Interfaces:** None (documentation only).

- [ ] **Step 1: Update the tools reference table**

In `README-mcp.md`, the `list_stories` row currently reads:

```markdown
| `list_stories` | `projectId` | List stories (with a per-column work-unit breakdown) for a project. |
```

Change it to:

```markdown
| `list_stories` | `projectId`, `epicKey?` | List stories (with a per-column work-unit breakdown) for a project, optionally filtered to a single epic. |
```

The `list_work_units` row currently reads:

```markdown
| `list_work_units` | `projectId`, `column?`, `pendingVerification?` | List work units for a project, optionally filtered to a single column (`todo`, `in_progress`, `code_review`, `done`), or to only those pending AI-agent verification. |
```

Change it to:

```markdown
| `list_work_units` | `projectId`, `column?`, `pendingVerification?`, `epicKey?` | List work units for a project, optionally filtered to a single column (`todo`, `in_progress`, `code_review`, `done`), to only those pending AI-agent verification, or to a single epic. |
```

Add a `list_epics` row right after the `list_projects` row:

```markdown
| `list_epics` | `projectId` | List a project's JIRA epics (key + name). |
```

Add an `import_by_epic` row right after the (now-updated) `list_work_units` row, before `move_work_unit`:

```markdown
| `import_by_epic` | `projectId`, `epicKey`, `epicName?`, `breakDown?` | Import all not-yet-imported issues under a JIRA epic into this project's board, skipping issues already on the board. `breakDown` (default `false`) applies uniformly to every imported story. |
```

- [ ] **Step 2: Add example prompts**

In the "Example prompts" section, add these three lines after `"Show the cards for project acme-web."`:

```markdown
- "List the epics for project acme-web."
- "Show me stories for project acme-web under epic ACME-100."
- "Import everything under epic ACME-100 into project acme-web."
```

- [ ] **Step 3: Commit**

```bash
git add README-mcp.md
git commit -m "docs: document list_epics, import_by_epic, and epicKey filters"
```

---

## Self-Review Notes

- **Spec coverage:** `StoryDTO`/serializer gap (Task 1) · `PonderClient` methods (Task 2) · `list_epics` (Task 3) · `epicKey` filter on `list_stories`/`list_work_units` (Task 4) · `import_by_epic` (Task 5) · docs (Task 6) · every "Out of scope" item in the design spec (REST query-param filtering, per-story breakDown, "import anyway" override, README backfill for pre-existing gaps, board UI) has no corresponding task — confirmed intentionally absent.
- **Type consistency:** `EpicImportPreviewStory`/`EpicImportProcessItem` (Task 2, `client.ts`) are the exact shapes `importByEpic` (Task 5, `tools.ts`) maps between — field names and optionality match across both. `{ key: string; name: string }` is the epic shape used consistently in `getEpics` (Task 2), `listEpics` (Task 3), and the `/jira/epics` route this all sits on top of.
- **Ordering:** Task 1 must land before Task 4 (which relies on `StoryDTO.epicKey` existing) and before Task 3/5's tool-count tests are meaningful in a full-repo run. Task 2 must land before Tasks 3 and 5 (both consume its client methods). Task 3 and Task 4 are independent of each other and could be reordered, but both must precede Task 5's `server.test.ts` tool-count edit landing cleanly (each task's edit to that same array is small and sequential, no real conflict either order).
