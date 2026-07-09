# statusCategory Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JIRA sync fetches by `statusCategory` (minus a per-project exclusion list, default "QA") instead of a hardcoded status-name list, and unknown status names map to board columns by category instead of blanket-To Do.

**Architecture:** Two pure-function changes (`jql.ts` builder, `columns.ts` mapping fallback), one DTO field threaded from the JIRA client through preview → ImportReview → process, one new project setting (`jiraExcludedStatuses`, exact `githubRepos` plumbing), and sync wiring that parses the setting into the fetch call.

**Tech Stack:** Next.js 15 App Router, Prisma 7, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-09-status-category-mapping-design.md`

## Global Constraints

- **Run tests ONLY via `npm test -- run <path>` / `npm run test:ci`** — NEVER bare `npx vitest` (vitest.setup.ts refuses non-`_test` databases).
- Fetch JQL: `project = "<key>" AND assignee = currentUser() AND statusCategory != Done` + ` AND status NOT IN (…)` only when the exclusion list (trimmed, blanks dropped) is non-empty. Names double-quoted with `\` then `"` escaped.
- Exclusion parsing: `null`/`undefined` → `["QA"]`; `""` → `[]`; else split on commas, trim, drop blanks.
- Column mapping: existing name overrides win; category fallback `new → todo`, `indeterminate → in_progress`, `done → done`; absent/unknown → `todo`.
- `StoryDTO.jiraStatusCategory` is **optional** (`?`) — set only on JIRA-fetch DTOs; local serializers and existing fixtures stay untouched.
- Client narrows unknown category keys to `"new"`.
- `PROJECT_SYNC_STATUSES` is deleted; `buildAssignedStoriesJql` untouched.
- Schema: `jiraExcludedStatuses String? @default("QA")` — Postgres backfills existing rows; code still treats `null` as default.
- Migration: `npx prisma migrate dev --name add_project_jira_excluded_statuses`; if drift/reset is proposed, STOP — hand-author the single ALTER and use `migrate deploy` + `generate` (established precedent); also `dotenv -e .env.test -- npx prisma migrate deploy`.
- Work happens on the existing branch `feature/status-category-mapping`.

## File Structure

```
src/lib/columns.ts                  — category fallback (Task 1)
src/lib/columns.test.ts             — (Task 1)
src/lib/jira/jql.ts                 — parseExcludedStatuses + rebuilt buildProjectStoriesJql (Task 2)
src/lib/jira/jql.test.ts            — (Task 2)
src/lib/jira/client.ts              — JiraIssue.statusCategory, DTO mapping, fetch param (Task 3)
src/lib/jira/client.test.ts         — (Task 3)
src/lib/types.ts                    — StoryDTO.jiraStatusCategory?; Project.jiraExcludedStatuses? (Tasks 3, 4)
prisma/schema.prisma                — jiraExcludedStatuses (Task 4)
src/lib/projectDto.ts               — map jiraExcludedStatuses (Task 4)
src/app/api/projects/[projectId]/route.ts — PUT accepts it (Task 4)
src/app/projects/[projectId]/settings/page.tsx — settings field (Task 4)
src/app/api/projects/route.test.ts  — PUT cases (Task 4)
src/app/projects/[projectId]/settings/page.test.tsx — field case (Task 4)
src/lib/sync.ts                     — parse + pass exclusions (Task 5)
src/lib/sync.test.ts                — (Task 5)
src/app/api/projects/[projectId]/import/preview/route.ts  — category on preview story + targetColumn (Task 6)
src/components/ImportReview.tsx     — forward category into process items (Task 6)
src/app/api/projects/[projectId]/import/process/route.ts  — category on item + mapping (Task 6)
  (+ their test files)
README.md                           — roadmap line + blurb (Task 7)
```

---

### Task 1: Category fallback in jiraStatusToColumn

**Files:**
- Modify: `src/lib/columns.ts:20-22`
- Test: `src/lib/columns.test.ts` (append)

**Interfaces:**
- Produces (used by Task 6): `jiraStatusToColumn(status: string, category?: "new" | "indeterminate" | "done"): Column` — name overrides first, then category fallback, then `todo`. Existing single-argument callers keep compiling and behaving identically.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/columns.test.ts`:

```ts
describe("jiraStatusToColumn category fallback", () => {
  it("maps unknown statuses by category", () => {
    expect(jiraStatusToColumn("Blocked", "indeterminate")).toBe("in_progress");
    expect(jiraStatusToColumn("Backlog Triage", "new")).toBe("todo");
    expect(jiraStatusToColumn("Shipped", "done")).toBe("done");
  });

  it("lets name overrides beat a contradicting category", () => {
    expect(jiraStatusToColumn("Code Revew", "indeterminate")).toBe("code_review");
    expect(jiraStatusToColumn("To Do", "indeterminate")).toBe("todo");
    expect(jiraStatusToColumn("Review", "done")).toBe("in_progress");
  });

  it("falls back to todo when category is absent or unknown", () => {
    expect(jiraStatusToColumn("Blocked")).toBe("todo");
    expect(
      jiraStatusToColumn("Blocked", "mystery" as unknown as "new")
    ).toBe("todo");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run src/lib/columns.test.ts`
Expected: FAIL — `jiraStatusToColumn("Blocked", "indeterminate")` returns `"todo"`.

- [ ] **Step 3: Implement**

Replace `jiraStatusToColumn` in `src/lib/columns.ts` (and update the comment above `STATUS_TO_COLUMN`):

```ts
// Explicit name overrides for import target columns. `done` is a local-only
// lane for name matching (no JIRA status name maps to it), but the category
// fallback below can land there. Names win over category — "Code Revew" is
// indeterminate-category yet must map to code_review.
const STATUS_TO_COLUMN: Record<string, Column> = {
  "to do": "todo",
  "in progress": "in_progress",
  review: "in_progress",
  "code revew": "code_review", // matches the real (misspelled) JIRA status
  "code review": "code_review",
};

/**
 * Maps a JIRA status to a board column: explicit name overrides first, then
 * the status's JIRA statusCategory (new/indeterminate/done), then todo.
 * The category parameter is optional so pre-category callers keep today's
 * name-or-todo behavior.
 */
export function jiraStatusToColumn(
  status: string,
  category?: "new" | "indeterminate" | "done"
): Column {
  const byName = STATUS_TO_COLUMN[status.trim().toLowerCase()];
  if (byName) return byName;
  if (category === "indeterminate") return "in_progress";
  if (category === "done") return "done";
  return "todo";
}
```

- [ ] **Step 4: Run to verify pass, typecheck, commit**

Run: `npm test -- run src/lib/columns.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

```bash
git add src/lib/columns.ts src/lib/columns.test.ts
git commit -m "feat: jiraStatusToColumn falls back to statusCategory for unknown names"
```

---

### Task 2: Category-based JQL + exclusion parsing

**Files:**
- Modify: `src/lib/jira/jql.ts` (delete `PROJECT_SYNC_STATUSES`; rebuild `buildProjectStoriesJql`; add `parseExcludedStatuses` and `quoteJqlString`)
- Test: `src/lib/jira/jql.test.ts` (rewrite the `buildProjectStoriesJql` describe block; add `parseExcludedStatuses` block; keep `buildAssignedStoriesJql` tests untouched)

**Interfaces:**
- Produces (used by Tasks 3 and 5):
  - `buildProjectStoriesJql(projectKey: string, excludedStatuses: string[]): string` (second param now required)
  - `parseExcludedStatuses(value: string | null | undefined): string[]`

- [ ] **Step 1: Write the failing tests**

In `src/lib/jira/jql.test.ts`, replace the existing `buildProjectStoriesJql` assertions (they assert the old `status in (...)` clause) with:

```ts
describe("buildProjectStoriesJql", () => {
  it("filters by statusCategory != Done", () => {
    expect(buildProjectStoriesJql("TEAM", [])).toBe(
      'project = "TEAM" AND assignee = currentUser() AND statusCategory != Done'
    );
  });

  it("appends a NOT IN clause for excluded statuses", () => {
    expect(buildProjectStoriesJql("TEAM", ["QA"])).toBe(
      'project = "TEAM" AND assignee = currentUser() AND statusCategory != Done AND status NOT IN ("QA")'
    );
    expect(buildProjectStoriesJql("TEAM", ["QA", "Blocked"])).toContain(
      'status NOT IN ("QA", "Blocked")'
    );
  });

  it("trims names and drops blanks in the exclusion list", () => {
    expect(buildProjectStoriesJql("TEAM", [" QA ", "", "  "])).toContain(
      'status NOT IN ("QA")'
    );
  });

  it("escapes embedded quotes and backslashes in status names", () => {
    expect(buildProjectStoriesJql("TEAM", ['Wei"rd'])).toContain(
      'status NOT IN ("Wei\\"rd")'
    );
    expect(buildProjectStoriesJql("TEAM", ["Back\\slash"])).toContain(
      'status NOT IN ("Back\\\\slash")'
    );
  });

  it("throws for an empty project key", () => {
    expect(() => buildProjectStoriesJql("", [])).toThrow(
      "buildProjectStoriesJql requires a project key"
    );
  });
});

describe("parseExcludedStatuses", () => {
  it("defaults null/undefined to QA", () => {
    expect(parseExcludedStatuses(null)).toEqual(["QA"]);
    expect(parseExcludedStatuses(undefined)).toEqual(["QA"]);
  });

  it("treats an empty string as exclude-nothing", () => {
    expect(parseExcludedStatuses("")).toEqual([]);
  });

  it("splits on commas, trims, and drops blanks", () => {
    expect(parseExcludedStatuses(" QA , Blocked ,, ")).toEqual(["QA", "Blocked"]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- run src/lib/jira/jql.test.ts`
Expected: FAIL — old clause emitted; `parseExcludedStatuses` not exported.

- [ ] **Step 3: Implement**

In `src/lib/jira/jql.ts`: delete `PROJECT_SYNC_STATUSES` and its comment; replace `buildProjectStoriesJql`; add the two new functions:

```ts
/**
 * Parses a project's comma-separated "statuses to exclude from sync" setting.
 * null/undefined (pre-setting rows) fall back to the default ["QA"]; an
 * empty string is an explicit "exclude nothing".
 */
export function parseExcludedStatuses(
  value: string | null | undefined
): string[] {
  if (value === null || value === undefined) return ["QA"];
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Double-quotes a JQL string value, escaping backslashes and quotes. */
function quoteJqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Builds a JQL query for a single project's issues assigned to the current
 * user in any not-Done statusCategory, minus explicitly excluded status
 * names (e.g. QA). Category-based matching means custom or renamed active
 * statuses import without code changes; the exclusion list keeps parked
 * work (QA by default) off the board.
 * @param projectKey - JIRA project key (e.g., 'TEAM')
 * @param excludedStatuses - status names to exclude (already parsed; see
 *   parseExcludedStatuses)
 * @throws Error if projectKey is empty
 */
export function buildProjectStoriesJql(
  projectKey: string,
  excludedStatuses: string[]
): string {
  if (!projectKey) {
    throw new Error("buildProjectStoriesJql requires a project key");
  }
  const names = excludedStatuses.map((name) => name.trim()).filter(Boolean);
  const exclusion =
    names.length > 0
      ? ` AND status NOT IN (${names.map(quoteJqlString).join(", ")})`
      : "";
  return `project = "${projectKey}" AND assignee = currentUser() AND statusCategory != Done${exclusion}`;
}
```

Note: `src/lib/jira/client.ts` calls `buildProjectStoriesJql` with one argument — it will fail `tsc` until Task 3. Confirm the ONLY new tsc error is that call site and say so in your report; do not fix it here.

- [ ] **Step 4: Run to verify pass, commit**

Run: `npm test -- run src/lib/jira/jql.test.ts`
Expected: PASS.

```bash
git add src/lib/jira/jql.ts src/lib/jira/jql.test.ts
git commit -m "feat: category-based project JQL with per-project status exclusions"
```

---

### Task 3: Client — statusCategory on the DTO, exclusions on the fetch

**Files:**
- Modify: `src/lib/jira/client.ts` (JiraIssue type ~line 23; `issueToStoryDTO` ~line 63; `fetchStoriesForProject` ~line 178)
- Modify: `src/lib/types.ts` (StoryDTO, after `jiraStatus`)
- Test: `src/lib/jira/client.test.ts` (update fixtures; add category-mapping and exclusion-pass-through cases)

**Interfaces:**
- Consumes: `buildProjectStoriesJql(projectKey, excludedStatuses)` (Task 2).
- Produces (used by Tasks 5–6):
  - `StoryDTO.jiraStatusCategory?: "new" | "indeterminate" | "done"` (optional; set by the JIRA fetch path)
  - `fetchStoriesForProject(projectKey: string, config: JiraConfig, excludedStatuses: string[] = ["QA"]): Promise<StoryDTO[]>`

- [ ] **Step 1: Add the DTO field**

In `src/lib/types.ts`, add to `StoryDTO` after `jiraStatus`:

```ts
  /** JIRA statusCategory key; present only on DTOs from the JIRA fetch path
   * (import/sync). Local API serializers never set it. */
  jiraStatusCategory?: "new" | "indeterminate" | "done";
```

- [ ] **Step 2: Write the failing tests**

In `src/lib/jira/client.test.ts`: the existing issue fixtures build `fields.status: { name: ... }` — extend the shared fixture(s) with `statusCategory: { key: "indeterminate" }` (pick the file's real fixture helper; keep existing assertions passing). Then add:

```ts
  it("maps statusCategory onto the story DTO", async () => {
    // Arrange an issue fixture with status { name: "Blocked", statusCategory: { key: "indeterminate" } }
    // via the file's existing mocked-fetch search response pattern, then:
    // const [story] = await fetchStoriesForProject("TEAM", config, []);
    // expect(story.jiraStatusCategory).toBe("indeterminate");
  });

  it("narrows an unknown statusCategory key to new", async () => {
    // Same pattern with statusCategory: { key: "weird" } ->
    // expect(story.jiraStatusCategory).toBe("new");
  });

  it("passes the exclusion list into the JQL", async () => {
    // Using the file's mocked fetch, call:
    //   await fetchStoriesForProject("TEAM", config, ["QA", "Blocked"]);
    // and assert the requested URL's jql param contains
    //   'status NOT IN ("QA", "Blocked")'
    // Also assert the default: fetchStoriesForProject("TEAM", config)
    // produces a jql containing 'status NOT IN ("QA")'.
  });
```

Write the real bodies with the file's existing mocked-fetch helpers (the comments are the contract; committed tests must exercise the real `fetchStoriesForProject` against the mocked fetch, with no comment scaffolds).

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- run src/lib/jira/client.test.ts`
Expected: the new tests FAIL (no `jiraStatusCategory`; JQL still one-arg — the file may fail to typecheck first, which counts as RED).

- [ ] **Step 4: Implement**

In `src/lib/jira/client.ts`:

1. `JiraIssue` status type:

```ts
    status: {
      name: string;
      statusCategory?: { key: string };
    };
```

2. Narrowing helper (near `issueToStoryDTO`):

```ts
/** JIRA's three fixed category keys; anything unexpected degrades to "new"
 * so the column mapping falls back to To Do (pre-category behavior). */
function narrowStatusCategory(
  key: string | undefined
): "new" | "indeterminate" | "done" {
  return key === "indeterminate" || key === "done" ? key : "new";
}
```

3. In `issueToStoryDTO`, after `jiraStatus`:

```ts
    jiraStatusCategory: narrowStatusCategory(issue.fields.status.statusCategory?.key),
```

4. `fetchStoriesForProject` signature and JQL call:

```ts
export async function fetchStoriesForProject(
  projectKey: string,
  config: JiraConfig,
  excludedStatuses: string[] = ["QA"]
): Promise<StoryDTO[]> {
```

with the internal `buildProjectStoriesJql(projectKey)` call becoming `buildProjectStoriesJql(projectKey, excludedStatuses)`.

- [ ] **Step 5: Run to verify pass, typecheck, commit**

Run: `npm test -- run src/lib/jira/client.test.ts && npx tsc --noEmit`
Expected: PASS; tsc fully clean (Task 2's dangling call site is now fixed).

```bash
git add src/lib/jira/client.ts src/lib/jira/client.test.ts src/lib/types.ts
git commit -m "feat: thread statusCategory and exclusion list through the JIRA client"
```

---

### Task 4: jiraExcludedStatuses setting (schema, DTO, PUT, settings field)

**Files:**
- Modify: `prisma/schema.prisma` (Project model, after `githubRepos`)
- Modify: `src/lib/types.ts` (Project interface, after `githubRepos?` ~line 71)
- Modify: `src/lib/projectDto.ts` (param ~line 16, return ~line 28)
- Modify: `src/app/api/projects/[projectId]/route.ts` (PUT destructure line 51, update data line 74)
- Modify: `src/app/projects/[projectId]/settings/page.tsx` (state ~line 32, load ~line 60, body ~line 93, field markup after the githubRepos block)
- Test: `src/app/api/projects/route.test.ts`, `src/app/projects/[projectId]/settings/page.test.tsx`

**Interfaces:**
- Produces (used by Task 5): `Project.jiraExcludedStatuses: String? @default("QA")` on the Prisma model; `jiraExcludedStatuses?: string` on the TS `Project`/DTO; PUT accepts it update-when-provided.

This is the exact `githubRepos` plumbing from PR #28 — follow that field's implementation in each file line-for-line.

- [ ] **Step 1: Schema + migration**

Add to the `Project` model after `githubRepos`:

```prisma
  jiraExcludedStatuses String?  @default("QA")
```

Run: `npx prisma migrate dev --name add_project_jira_excluded_statuses` (STOP on any reset proposal — hand-author `ALTER TABLE "Project" ADD COLUMN "jiraExcludedStatuses" TEXT DEFAULT 'QA';` + `migrate deploy` + `generate`), then `dotenv -e .env.test -- npx prisma migrate deploy`.

- [ ] **Step 2: Write the failing PUT tests**

Append to the PUT describe block in `src/app/api/projects/route.test.ts`:

```ts
  it("should store jiraExcludedStatuses when provided (including empty string)", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "JIRA", jiraProjectKey: "TEAM" },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jiraExcludedStatuses: "" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.jiraExcludedStatuses).toBe("");
  });

  it("should default jiraExcludedStatuses to QA on creation and preserve it when omitted from PUT", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "JIRA", jiraProjectKey: "TEAM" },
    });
    expect(project.jiraExcludedStatuses).toBe("QA");

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    await PUT(req as never, { params: Promise.resolve({ projectId: project.id }) });

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.jiraExcludedStatuses).toBe("QA");
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- run src/app/api/projects/route.test.ts`
Expected: FAIL (tsc/unknown column before `prisma generate`, or PUT ignoring the field after).

- [ ] **Step 4: Implement the plumbing**

Follow the `githubRepos` pattern exactly:
- `src/lib/types.ts` Project: `jiraExcludedStatuses?: string;`
- `src/lib/projectDto.ts`: param `jiraExcludedStatuses?: string | null;`, return `jiraExcludedStatuses: project.jiraExcludedStatuses ?? undefined,`
- PUT route: add to destructure + `...(jiraExcludedStatuses !== undefined && { jiraExcludedStatuses }),`

- [ ] **Step 5: Run PUT tests to verify pass**

Run: `npm test -- run src/app/api/projects/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Settings field (failing test, then implement)**

Add to `src/app/projects/[projectId]/settings/page.test.tsx` (following the file's githubRepos test exactly): the field labeled "Statuses to exclude from sync" loads the stubbed `jiraExcludedStatuses` value, edits to `"QA, Blocked"`, submits, and the PUT body contains `"jiraExcludedStatuses":"QA, Blocked"`. Run to see it fail, then implement in `page.tsx`:
- state `const [jiraExcludedStatuses, setJiraExcludedStatuses] = useState("");`
- load `setJiraExcludedStatuses(data.jiraExcludedStatuses ?? "");`
- body: `jiraExcludedStatuses,` (always sent, like githubRepos)
- field markup after the github-repos block, copying its exact wrapper/label/input classes, `id="jira-excluded-statuses"`, label "Statuses to exclude from sync", `placeholder="QA, Blocked"`.

Run: `npm test -- run "src/app/projects/[projectId]/settings/page.test.tsx"`
Expected: PASS (including the pre-existing strict PUT-body toEqual test — extend it with `jiraExcludedStatuses: ""` the same way githubRepos extended it; the stubbed GET fixture without the field loads as `""`).

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add prisma/schema.prisma prisma/migrations src/lib/types.ts src/lib/projectDto.ts "src/app/api/projects/[projectId]/route.ts" "src/app/projects/[projectId]/settings/page.tsx" "src/app/projects/[projectId]/settings/page.test.tsx" src/app/api/projects/route.test.ts
git commit -m "feat: per-project jiraExcludedStatuses setting (schema, DTO, PUT, settings field)"
```

---

### Task 5: Sync wiring

**Files:**
- Modify: `src/lib/sync.ts:154` (the `fetchStoriesForProject` call)
- Test: `src/lib/sync.test.ts`

**Interfaces:**
- Consumes: `parseExcludedStatuses` (Task 2), `fetchStoriesForProject(projectKey, config, excludedStatuses)` (Task 3), `Project.jiraExcludedStatuses` (Task 4).
- Produces: sync passes the parsed per-project exclusion list to the fetch.

- [ ] **Step 1: Write the failing tests**

`src/lib/sync.test.ts` mocks `@/lib/jira/client` — add assertions on the mocked `fetchStoriesForProject`'s third argument (follow the file's existing project fixtures; create projects with explicit `jiraExcludedStatuses` values):

```ts
describe("syncStoriesForProject — status exclusions", () => {
  it("passes the parsed exclusion list from the project setting", async () => {
    // project with jiraExcludedStatuses: "QA, Blocked"
    // await syncStoriesForProject(project.id, prisma);
    // expect(vi.mocked(fetchStoriesForProject)).toHaveBeenCalledWith(
    //   project.jiraProjectKey, expect.anything(), ["QA", "Blocked"]);
  });

  it("passes [] for an explicit empty setting", async () => {
    // project with jiraExcludedStatuses: "" -> third arg []
  });

  it("passes the QA default when the field is null", async () => {
    // project created via raw update to null (prisma.project.update data { jiraExcludedStatuses: null })
    // -> third arg ["QA"]
  });
});
```

Write real bodies with the file's fixtures (comments are the contract; committed tests must create real project rows, call the real `syncStoriesForProject`, and clean up in try/finally).

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- run src/lib/sync.test.ts`
Expected: new tests FAIL — third argument is `undefined`.

- [ ] **Step 3: Implement**

In `src/lib/sync.ts`: add `import { parseExcludedStatuses } from "@/lib/jira/jql";` and change line 154 to:

```ts
  const stories = await fetchStoriesForProject(
    project.jiraProjectKey,
    jiraConfig,
    parseExcludedStatuses(project.jiraExcludedStatuses)
  );
```

- [ ] **Step 4: Run to verify pass, typecheck, commit**

Run: `npm test -- run src/lib/sync.test.ts && npx tsc --noEmit`
Expected: PASS (new and existing), clean.

```bash
git add src/lib/sync.ts src/lib/sync.test.ts
git commit -m "feat: sync passes the project's parsed status exclusions to the JIRA fetch"
```

---

### Task 6: Import path threads the category

**Files:**
- Modify: `src/app/api/projects/[projectId]/import/preview/route.ts` (`ImportPreviewStory` ~line 21; mapping ~lines 84-85)
- Modify: `src/components/ImportReview.tsx` (preview-story type; the process-items mapping ~line 183)
- Modify: `src/app/api/projects/[projectId]/import/process/route.ts` (`ImportProcessItem` ~line 25; column mapping ~line 117)
- Test: the three corresponding test files

**Interfaces:**
- Consumes: `StoryDTO.jiraStatusCategory?` (Task 3), `jiraStatusToColumn(status, category?)` (Task 1).
- Produces: end-to-end category flow — preview response carries `jiraStatusCategory`, ImportReview forwards it, process maps columns with it.

- [ ] **Step 1: Write the failing tests**

1. Preview route test (follow the file's existing mocked-JIRA fixture pattern): a fetched story with `jiraStatus: "Blocked"`, `jiraStatusCategory: "indeterminate"` yields a preview story with `jiraStatusCategory: "indeterminate"` and `targetColumn: "in_progress"`.
2. Process route test (follow the file's existing request-body pattern): an item `{ ..., jiraStatus: "Blocked", jiraStatusCategory: "indeterminate", breakDown: false }` creates its work unit with `column: "in_progress"`; an item without `jiraStatusCategory` and unknown status still lands in `todo` (back-compat).
3. ImportReview test (follow the file's existing submit test): the POSTed items include each story's `jiraStatusCategory`.

Write real test bodies with each file's existing helpers.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- run "src/app/api/projects/[projectId]/import/preview/route.test.ts" "src/app/api/projects/[projectId]/import/process/route.test.ts" src/components/ImportReview.test.tsx`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

1. Preview route: add `jiraStatusCategory?: "new" | "indeterminate" | "done";` to `ImportPreviewStory`; in the mapping add `jiraStatusCategory: dto.jiraStatusCategory,` and change line 85 to `targetColumn: jiraStatusToColumn(dto.jiraStatus, dto.jiraStatusCategory),`.
2. ImportReview: add the same optional field to its preview-story type and `jiraStatusCategory: s.jiraStatusCategory,` in the process-items mapping (next to `jiraStatus`).
3. Process route: add `jiraStatusCategory?: "new" | "indeterminate" | "done";` to `ImportProcessItem`; line 117 becomes `const column = jiraStatusToColumn(item.jiraStatus, item.jiraStatusCategory);`.

- [ ] **Step 4: Run to verify pass, typecheck, commit**

Run: `npm test -- run "src/app/api/projects/[projectId]/import/preview/route.test.ts" "src/app/api/projects/[projectId]/import/process/route.test.ts" src/components/ImportReview.test.tsx && npx tsc --noEmit`
Expected: PASS, clean.

```bash
git add "src/app/api/projects/[projectId]/import/preview/route.ts" "src/app/api/projects/[projectId]/import/preview/route.test.ts" src/components/ImportReview.tsx src/components/ImportReview.test.tsx "src/app/api/projects/[projectId]/import/process/route.ts" "src/app/api/projects/[projectId]/import/process/route.test.ts"
git commit -m "feat: thread statusCategory through import preview, review, and process"
```

---

### Task 7: Full verification, README, PR

**Files:**
- Modify: `README.md` (Roadmap section; the "Work the board" / sync description if it names the four statuses)

- [ ] **Step 1: Full verification**

```bash
npx tsc --noEmit && npm run test:ci && npx eslint src && npm run knip
```

Expected: clean (3 pre-existing lint warnings; previous full-suite count 674 + new tests). If knip flags a genuinely internal-only new export, un-export it.

- [ ] **Step 2: Update the README**

1. Remove the shipped roadmap line `- Additional status mappings (statusCategory-based matching).`
2. Where the README describes what syncs (search for "statuses" / "To Do, In Progress"), update to: sync imports everything assigned to you whose JIRA `statusCategory` isn't Done, minus the per-project "Statuses to exclude from sync" list (default `QA`); unknown status names land in the column matching their category.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: document statusCategory-based sync matching"
git push -u origin feature/status-category-mapping
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "statusCategory-based JIRA sync matching + per-project status exclusions" --body "$(cat <<'EOF'
## Summary
- Project sync JQL now fetches by `statusCategory != Done` instead of the hardcoded four-name status list — custom or renamed active statuses import without code changes (`PROJECT_SYNC_STATUSES` deleted)
- New per-project "Statuses to exclude from sync" setting (`jiraExcludedStatuses`, default `QA`) keeps parked work off the board; empty = exclude nothing; names are quoted/escaped into a `status NOT IN (...)` clause
- `jiraStatusToColumn` gains a statusCategory fallback (new → To Do, indeterminate → In Progress, done → Done) replacing the blanket-To Do fallback; explicit name overrides (Code Revew/Review etc.) still win
- `statusCategory` threads from the JIRA client through import preview → review dialog → process, so custom statuses land in the right column on import

Spec: `docs/superpowers/specs/2026-07-09-status-category-mapping-design.md`
Plan: `docs/superpowers/plans/2026-07-09-status-category-mapping.md`

## Test plan
- [ ] `npm run test:ci` — full suite green
- [ ] `npx tsc --noEmit` / `npx eslint src` / `npm run knip` — clean
- [ ] Manual: Sync with default settings (QA stories stay off); clear the exclusion field and Sync (QA stories import into In Progress)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Do not merge — John merges PRs himself.
