# PR-Gated Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A story's cards move to Done (and the existing JIRA write-back fires) when a GitHub PR referencing the story's JIRA key exists, checked during the normal Sync action — plus the shared fix that entering/leaving the Done column finally stamps/clears `completedAt`.

**Architecture:** A new `src/lib/github/` module (fetch-based REST client, pure PR matcher, and the gate `applyPrGatedCompletion`) plugged into the tail of `syncStoriesForProject`. A new shared `moveWorkUnitColumn` helper owns column moves + `completedAt` stamping and is used by both the manual move route and the gate. Config: `Project.githubRepos` (comma-separated `owner/repo`) + `GITHUB_TOKEN` from `.env`.

**Tech Stack:** Next.js 15 App Router, Prisma 7 (PostgreSQL), Vitest + Testing Library, GitHub REST API via `fetch` (no SDK).

**Spec:** `docs/superpowers/specs/2026-07-05-pr-gated-completion-design.md`

## Global Constraints

- **No new dependencies** — the GitHub client is `fetch`-based.
- **Run tests ONLY via `npm test` / `npm run test:ci`** — NEVER bare `npx vitest` (vitest.setup.ts refuses non-`_test` databases; this guard exists because bare vitest once wiped the dev DB). To run a single file: `npm test -- run <path>`.
- `GITHUB_TOKEN` is read server-side from the environment and never included in any API response (same posture as `jiraApiToken`).
- PR matching is **case-insensitive, word-boundary** (boundary = start/end of string or any non-alphanumeric char): `COM-54` must NOT match `COM-540`; `COM-540` must NOT match `COM-5401`. Match against branch name (`headRef`) OR title. Only **open or merged** PRs count; closed-unmerged are ignored.
- `completedAt` semantics: entering `done` sets it **only if currently null**; leaving `done` clears it to null; same-column moves never touch it.
- The gate fires `applyStoryStatusSync` **once per story** (after moving all its cards); the manual move route keeps firing it per move.
- GitHub failures NEVER fail a sync — per-repo errors become warning strings.
- Integration tests follow the repo pattern: unique keys (`` `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}` ``), try/finally cleanup, no blanket deleteMany on shared tables.
- Work happens on the existing branch `feature/pr-gated-completion`.

## File Structure

```
prisma/schema.prisma                          — Project.githubRepos String? (Task 1)
src/lib/types.ts                              — Project.githubRepos?: string (Task 1)
src/lib/projectDto.ts                         — map githubRepos (Task 1)
src/app/api/projects/[projectId]/route.ts     — PUT accepts githubRepos (Task 1)
src/app/projects/[projectId]/settings/page.tsx — GitHub repositories field (Task 1)
.env.example                                  — GITHUB_TOKEN (Task 1)
src/lib/completeMove.ts                       — moveWorkUnitColumn helper (Task 2)
src/lib/completeMove.test.ts                  — (Task 2)
src/app/api/work-units/[id]/move/route.ts     — use the helper (Task 2)
src/lib/github/client.ts                      — fetchRecentPrs + PrSummary (Task 3)
src/lib/github/client.test.ts                 — (Task 3)
src/lib/github/prMatch.ts                     — findPrForKey (Task 3)
src/lib/github/prMatch.test.ts                — (Task 3)
src/lib/github/prGatedCompletion.ts           — applyPrGatedCompletion (Task 4)
src/lib/github/prGatedCompletion.test.ts      — (Task 4)
src/lib/sync.ts                               — call the gate, merge message (Task 5)
src/lib/sync.test.ts                          — message-merge tests (Task 5)
README.md                                     — docs + roadmap (Task 6)
```

---

### Task 1: Config plumbing — schema, DTO, PUT route, settings field

**Files:**
- Modify: `prisma/schema.prisma` (Project model)
- Modify: `src/lib/types.ts` (Project interface, ~line 64)
- Modify: `src/lib/projectDto.ts`
- Modify: `src/app/api/projects/[projectId]/route.ts` (PUT, ~line 51 destructure and update data)
- Modify: `src/app/projects/[projectId]/settings/page.tsx`
- Modify: `.env.example`
- Test: `src/app/api/projects/route.test.ts` (add PUT cases)
- Test: `src/app/projects/[projectId]/settings/page.test.tsx` (add field cases)

**Interfaces:**
- Consumes: existing Project model/DTO/PUT plumbing.
- Produces (used by Task 4): `Project.githubRepos: String?` on the Prisma model; `githubRepos?: string` on the `Project` TS interface and `ProjectWithStats` DTO responses; PUT `/api/projects/[projectId]` accepts `githubRepos` (update-when-provided, preserve-when-omitted, same rule as `jiraSiteUrl`).

- [ ] **Step 1: Add the schema field and migrate**

In `prisma/schema.prisma`, add to the `Project` model after `jiraApiToken`:

```prisma
  githubRepos    String?
```

Run: `npx prisma migrate dev --name add_project_github_repos`
Expected: one new migration adding a nullable column; no destructive statements.
**If Prisma reports drift and proposes a reset: STOP — do not reset.** Hand-author the migration (a single `ALTER TABLE "Project" ADD COLUMN "githubRepos" TEXT;`) and apply with `npx prisma migrate deploy`, then `npx prisma generate` (precedent: the per-card-move-to-qa feature hit the same drift from a stale worktree sharing the dev Postgres).

Also apply it to the test database: `dotenv -e .env.test -- npx prisma migrate deploy`

- [ ] **Step 2: Write the failing PUT-route tests**

Append to the `PUT /api/projects/[projectId]` describe block in `src/app/api/projects/route.test.ts`:

```ts
  it("should store githubRepos when provided", async () => {
    const project = await prisma.project.create({
      data: { name: "Team A", type: "JIRA", jiraProjectKey: "TEAM" },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubRepos: "sphero/team-alliance, sphero/shared-ui" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.githubRepos).toBe("sphero/team-alliance, sphero/shared-ui");

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.githubRepos).toBe("sphero/team-alliance, sphero/shared-ui");
  });

  it("should leave githubRepos untouched when omitted from the body", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Team A",
        type: "JIRA",
        jiraProjectKey: "TEAM",
        githubRepos: "sphero/team-alliance",
      },
    });

    const req = new Request(`http://localhost:3000/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    const res = await PUT(req as never, {
      params: Promise.resolve({ projectId: project.id }),
    });
    expect(res.status).toBe(200);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored?.githubRepos).toBe("sphero/team-alliance");
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- run src/app/api/projects/route.test.ts`
Expected: FAIL — the first new test gets `data.githubRepos` undefined (and the Prisma create in the second may fail until `npx prisma generate` has run; generate happened in Step 1).

- [ ] **Step 4: Implement the plumbing**

1. `src/lib/types.ts` — add to the `Project` interface (after `jiraEmail?`):

```ts
  githubRepos?: string;
```

2. `src/lib/projectDto.ts` — add `githubRepos?: string | null;` to the parameter type (after `jiraApiToken`), and to the returned object (after `jiraEmail`):

```ts
    githubRepos: project.githubRepos ?? undefined,
```

3. `src/app/api/projects/[projectId]/route.ts` — in PUT, add `githubRepos` to the body destructure, and to the update data following the exact `jiraSiteUrl` pattern:

```ts
        ...(githubRepos !== undefined && { githubRepos }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- run src/app/api/projects/route.test.ts`
Expected: PASS (new and existing).

- [ ] **Step 6: Write the failing settings-page test**

In `src/app/projects/[projectId]/settings/page.test.tsx`, find how the existing tests stub the project GET response and submit the form (follow the file's existing helpers/patterns exactly). Add:

```tsx
  it("loads, edits, and submits the GitHub repositories field", async () => {
    // Arrange: include githubRepos in the stubbed GET /api/projects/[id] payload:
    //   githubRepos: "sphero/team-alliance"
    // (extend the existing project fixture the same way jiraSiteUrl is included)

    // 1. The field renders with the stored value:
    const input = await screen.findByLabelText(/github repositories/i);
    expect(input).toHaveValue("sphero/team-alliance");

    // 2. Edit and submit:
    //   change the input value to "sphero/team-alliance, sphero/shared-ui"
    //   submit the form (same interaction the jiraSiteUrl tests use)

    // 3. The PUT body includes the new value:
    //   assert the fetch mock's PUT call body contains
    //   "githubRepos":"sphero/team-alliance, sphero/shared-ui"
  });
```

Flesh out the arrange/act steps using the file's existing test utilities — the assertions above are the contract. (The comment scaffold is guidance for writing the real test, not the final test body: the committed test must perform the real render, edit, submit, and fetch-body assertions with no commented-out steps.)

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- run "src/app/projects/[projectId]/settings/page.test.tsx"`
Expected: FAIL — no field labeled "GitHub repositories".

- [ ] **Step 8: Add the settings field**

In `src/app/projects/[projectId]/settings/page.tsx`:

1. State (next to the jira fields, ~line 29): `const [githubRepos, setGithubRepos] = useState("");`
2. Load (in the effect that seeds state from the GET response, ~line 57): `setGithubRepos(data.githubRepos ?? "");`
3. Save (in `handleSubmit`'s `body`, after `jiraEmail`): `githubRepos,`
4. Field markup — inside the JIRA section, after the API-token input block, copying the `jira-site-url` block's exact wrapper/label/input classes:

```tsx
              <div>
                <label
                  htmlFor="github-repos"
                  /* same className as the jira-site-url label */
                >
                  GitHub repositories
                </label>
                <input
                  id="github-repos"
                  type="text"
                  value={githubRepos}
                  onChange={(e) => setGithubRepos(e.target.value)}
                  placeholder="owner/repo, owner/repo"
                  /* same className as the jira-site-url input */
                />
              </div>
```

(Copy the classes verbatim from the `jira-site-url` label/input in the same file — do not leave the comments in.)

- [ ] **Step 9: Run tests, typecheck**

Run: `npm test -- run "src/app/projects/[projectId]/settings/page.test.tsx" src/app/api/projects/route.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 10: Document the env var and commit**

Append to `.env.example`:

```
# GitHub token for PR-gated completion (repo read scope). One token serves all
# repos listed in each project's "GitHub repositories" setting.
GITHUB_TOKEN=
```

```bash
git add prisma/schema.prisma prisma/migrations src/lib/types.ts src/lib/projectDto.ts "src/app/api/projects/[projectId]/route.ts" "src/app/projects/[projectId]/settings/page.tsx" "src/app/projects/[projectId]/settings/page.test.tsx" src/app/api/projects/route.test.ts .env.example
git commit -m "feat: add Project.githubRepos config plumbing (schema, DTO, PUT, settings field)"
```

---

### Task 2: moveWorkUnitColumn helper + completedAt stamping

**Files:**
- Create: `src/lib/completeMove.ts`
- Test: `src/lib/completeMove.test.ts`
- Modify: `src/app/api/work-units/[id]/move/route.ts:80-87` (replace the raw update)
- Test: `src/app/api/work-units/[id]/move.test.ts` (add stamp/clear cases)

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma`.
- Produces (used by Task 4): `moveWorkUnitColumn(workUnitId: string, column: string, order: number, prismaClient?: PrismaClient): Promise<WorkUnit>` — updates column/order; entering `done` sets `completedAt: new Date()` only if currently null; leaving `done` clears it; same-column moves never touch it. Does NOT call `applyStoryStatusSync`.

- [ ] **Step 1: Write the failing helper tests**

Create `src/lib/completeMove.test.ts`:

```ts
/**
 * Integration tests for moveWorkUnitColumn against the test database.
 * Entering done stamps completedAt (only if null); leaving done clears it;
 * same-column moves never touch it. The helper does NOT fire the JIRA
 * status trigger — callers own that.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { moveWorkUnitColumn } from "./completeMove";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function createStoryWithUnit(column: string, completedAt: Date | null = null) {
  const key = uniqueKey("CMOVE");
  const story = await prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "CMOVE",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
    },
  });
  const unit = await prisma.workUnit.create({
    data: { storyId: story.id, title: "Card", column, order: 0, completedAt },
  });
  return { story, unit };
}

async function cleanup(storyId: string) {
  await prisma.workUnit.deleteMany({ where: { storyId } });
  await prisma.story.delete({ where: { id: storyId } });
}

describe("moveWorkUnitColumn", () => {
  it("stamps completedAt when entering done", async () => {
    const { story, unit } = await createStoryWithUnit("in_progress");
    try {
      const before = Date.now();
      const moved = await moveWorkUnitColumn(unit.id, "done", 3, prisma);
      expect(moved.column).toBe("done");
      expect(moved.order).toBe(3);
      expect(moved.completedAt).not.toBeNull();
      expect((moved.completedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      await cleanup(story.id);
    }
  });

  it("preserves an existing completedAt when entering done again", async () => {
    const original = new Date("2026-07-01T10:00:00.000Z");
    const { story, unit } = await createStoryWithUnit("in_progress", original);
    try {
      const moved = await moveWorkUnitColumn(unit.id, "done", 0, prisma);
      expect(moved.completedAt?.toISOString()).toBe(original.toISOString());
    } finally {
      await cleanup(story.id);
    }
  });

  it("clears completedAt when leaving done", async () => {
    const { story, unit } = await createStoryWithUnit("done", new Date());
    try {
      const moved = await moveWorkUnitColumn(unit.id, "in_progress", 1, prisma);
      expect(moved.column).toBe("in_progress");
      expect(moved.completedAt).toBeNull();
    } finally {
      await cleanup(story.id);
    }
  });

  it("does not touch completedAt on a same-column reorder in done", async () => {
    const original = new Date("2026-07-01T10:00:00.000Z");
    const { story, unit } = await createStoryWithUnit("done", original);
    try {
      const moved = await moveWorkUnitColumn(unit.id, "done", 5, prisma);
      expect(moved.order).toBe(5);
      expect(moved.completedAt?.toISOString()).toBe(original.toISOString());
    } finally {
      await cleanup(story.id);
    }
  });

  it("leaves completedAt null on moves between non-done columns", async () => {
    const { story, unit } = await createStoryWithUnit("todo");
    try {
      const moved = await moveWorkUnitColumn(unit.id, "in_progress", 0, prisma);
      expect(moved.completedAt).toBeNull();
    } finally {
      await cleanup(story.id);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- run src/lib/completeMove.test.ts`
Expected: FAIL — `Cannot find module './completeMove'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/completeMove.ts`:

```ts
/**
 * Shared column-move write path. Both the manual move route and PR-gated
 * completion go through here so completedAt semantics stay in one place:
 * entering done stamps it (only if not already set), leaving done clears
 * it, same-column moves never touch it.
 *
 * Deliberately does NOT call applyStoryStatusSync — callers decide when to
 * fire the JIRA trigger (the move route fires per move; the PR gate fires
 * once per story after moving all of its cards).
 */

import { PrismaClient, WorkUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function moveWorkUnitColumn(
  workUnitId: string,
  column: string,
  order: number,
  prismaClient: PrismaClient = prisma
): Promise<WorkUnit> {
  const existing = await prismaClient.workUnit.findUniqueOrThrow({
    where: { id: workUnitId },
  });

  const enteringDone = column === "done" && existing.column !== "done";
  const leavingDone = column !== "done" && existing.column === "done";

  return prismaClient.workUnit.update({
    where: { id: workUnitId },
    data: {
      column,
      order,
      ...(enteringDone && existing.completedAt === null
        ? { completedAt: new Date() }
        : {}),
      ...(leavingDone ? { completedAt: null } : {}),
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- run src/lib/completeMove.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Write the failing move-route tests**

Append to `src/app/api/work-units/[id]/move.test.ts` (match the file's existing fixture/cleanup patterns for creating a story + work unit and calling `POST`):

```ts
  it("stamps completedAt in the response when moving into done", async () => {
    // create a story + work unit in "in_progress" per the file's existing pattern
    // POST { column: "done", order: 0 }
    // expect response DTO: column "done", completedAt a non-null ISO string
  });

  it("clears completedAt in the response when moving out of done", async () => {
    // create a story + work unit in "done" with completedAt: new Date()
    // POST { column: "in_progress", order: 0 }
    // expect response DTO: completedAt null
  });
```

Write the real bodies using the file's existing helpers (the comments are the contract; the committed tests must create real rows, call the real `POST`, and assert on the parsed response, with try/finally cleanup).

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- run "src/app/api/work-units/[id]/move.test.ts"`
Expected: the two new tests FAIL (completedAt stays null / stays set).

- [ ] **Step 7: Switch the route to the helper**

In `src/app/api/work-units/[id]/move/route.ts`, add the import and replace the raw update (lines 80–87):

```ts
import { moveWorkUnitColumn } from "@/lib/completeMove";
```

```ts
    // Update the work unit with new column and order (stamps/clears
    // completedAt on entering/leaving done — see src/lib/completeMove.ts).
    const updated = await moveWorkUnitColumn(id, column, order, prisma);
```

Everything else in the route (404 check, non-blocking `applyStoryStatusSync`, DTO mapping) stays unchanged.

- [ ] **Step 8: Run tests, typecheck, commit**

Run: `npm test -- run "src/app/api/work-units/[id]/move.test.ts" src/lib/completeMove.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

```bash
git add src/lib/completeMove.ts src/lib/completeMove.test.ts "src/app/api/work-units/[id]/move/route.ts" "src/app/api/work-units/[id]/move.test.ts"
git commit -m "feat: shared moveWorkUnitColumn helper stamps/clears completedAt on done transitions"
```

---

### Task 3: GitHub client + PR matcher

**Files:**
- Create: `src/lib/github/client.ts`
- Create: `src/lib/github/prMatch.ts`
- Test: `src/lib/github/client.test.ts`
- Test: `src/lib/github/prMatch.test.ts`

**Interfaces:**
- Consumes: nothing project-specific.
- Produces (used by Task 4):
  - `interface PrSummary { number: number; title: string; headRef: string; state: "open" | "closed"; merged: boolean; url: string }`
  - `type FetchPrsResult = PrSummary[] | { warning: string }`
  - `fetchRecentPrs(repo: string, token: string, fetchImpl?: typeof fetch): Promise<FetchPrsResult>`
  - `findPrForKey(jiraKey: string, prs: PrSummary[]): PrSummary | null`

- [ ] **Step 1: Write the failing matcher tests**

Create `src/lib/github/prMatch.test.ts`:

```ts
/**
 * Pure unit tests for findPrForKey. Word-boundary, case-insensitive match
 * against branch name (headRef) or title; only open-or-merged PRs count.
 */

import { describe, it, expect } from "vitest";
import { findPrForKey } from "./prMatch";
import type { PrSummary } from "./client";

function pr(overrides: Partial<PrSummary>): PrSummary {
  return {
    number: 1,
    title: "Unrelated title",
    headRef: "unrelated-branch",
    state: "open",
    merged: false,
    url: "https://github.com/o/r/pull/1",
    ...overrides,
  };
}

describe("findPrForKey", () => {
  it("matches the key in a branch name", () => {
    const match = pr({ headRef: "feature/COM-540-team-page" });
    expect(findPrForKey("COM-540", [match])).toBe(match);
  });

  it("matches the key in a title", () => {
    const match = pr({ title: "COM-540: Team page changes" });
    expect(findPrForKey("COM-540", [match])).toBe(match);
  });

  it("matches case-insensitively", () => {
    const match = pr({ headRef: "feature/com-540-team-page" });
    expect(findPrForKey("COM-540", [match])).toBe(match);
  });

  it("matches when the key is bracketed or at string edges", () => {
    expect(findPrForKey("COM-540", [pr({ title: "[COM-540] fix" })])).not.toBeNull();
    expect(findPrForKey("COM-540", [pr({ headRef: "COM-540" })])).not.toBeNull();
    expect(findPrForKey("COM-540", [pr({ title: "fix for COM-540" })])).not.toBeNull();
  });

  it("does not let a shorter key match a longer one (COM-54 vs COM-540)", () => {
    expect(findPrForKey("COM-54", [pr({ headRef: "feature/COM-540-x" })])).toBeNull();
  });

  it("does not match a longer key against a superstring (COM-540 vs COM-5401)", () => {
    expect(findPrForKey("COM-540", [pr({ title: "COM-5401 something" })])).toBeNull();
  });

  it("ignores closed-unmerged PRs but accepts merged ones", () => {
    const closed = pr({ headRef: "COM-540", state: "closed", merged: false });
    expect(findPrForKey("COM-540", [closed])).toBeNull();

    const merged = pr({ headRef: "COM-540", state: "closed", merged: true });
    expect(findPrForKey("COM-540", [merged])).toBe(merged);
  });

  it("returns the first match in list order", () => {
    const first = pr({ number: 10, title: "COM-540 first" });
    const second = pr({ number: 11, headRef: "COM-540-second" });
    expect(findPrForKey("COM-540", [first, second])).toBe(first);
  });

  it("returns null when nothing matches", () => {
    expect(findPrForKey("COM-540", [pr({})])).toBeNull();
    expect(findPrForKey("COM-540", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- run src/lib/github/prMatch.test.ts`
Expected: FAIL — `Cannot find module './prMatch'` (or `./client` for the type import).

- [ ] **Step 3: Implement client types + matcher**

Create `src/lib/github/client.ts`:

```ts
/**
 * Thin fetch-based GitHub REST client — no SDK dependency. One call per
 * repo returns the 100 most-recently-updated PRs. Failures (bad token,
 * unknown repo, rate limit, network) come back as { warning } instead of
 * throwing: one bad repo must never break a sync.
 */

export interface PrSummary {
  number: number;
  title: string;
  headRef: string;
  state: "open" | "closed";
  merged: boolean;
  url: string;
}

export type FetchPrsResult = PrSummary[] | { warning: string };

interface GitHubPrResponse {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  html_url: string;
  head: { ref: string };
}

export async function fetchRecentPrs(
  repo: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<FetchPrsResult> {
  const url = `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`;

  try {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      return { warning: `${repo}: ${response.status} ${response.statusText}` };
    }

    const body = (await response.json()) as GitHubPrResponse[];
    return body.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      state: pr.state === "open" ? ("open" as const) : ("closed" as const),
      merged: pr.merged_at !== null,
      url: pr.html_url,
    }));
  } catch (error) {
    return {
      warning: `${repo}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

Create `src/lib/github/prMatch.ts`:

```ts
/**
 * Pure PR-to-story matcher. A PR gates a story when the story's JIRA key
 * appears — case-insensitively, on word boundaries — in the PR's branch
 * name or title, and the PR is open or merged (closed-unmerged PRs are
 * abandoned work and don't count).
 */

import type { PrSummary } from "./client";

function containsKey(text: string, jiraKey: string): boolean {
  const escaped = jiraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Boundary = start/end of string or any non-alphanumeric character, so
  // COM-54 does not match COM-540 and COM-540 does not match COM-5401.
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(text);
}

export function findPrForKey(jiraKey: string, prs: PrSummary[]): PrSummary | null {
  for (const pr of prs) {
    if (pr.state === "closed" && !pr.merged) continue;
    if (containsKey(pr.headRef, jiraKey) || containsKey(pr.title, jiraKey)) {
      return pr;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run matcher tests to verify they pass**

Run: `npm test -- run src/lib/github/prMatch.test.ts`
Expected: PASS (9/9).

- [ ] **Step 5: Write the failing client tests**

Create `src/lib/github/client.test.ts`:

```ts
/**
 * Unit tests for fetchRecentPrs with a stubbed fetch — no network.
 */

import { describe, it, expect, vi } from "vitest";
import { fetchRecentPrs } from "./client";

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchRecentPrs", () => {
  it("requests the repo's PRs with auth and maps the response shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse([
        {
          number: 42,
          title: "COM-540: Team page",
          state: "closed",
          merged_at: "2026-07-05T12:00:00Z",
          html_url: "https://github.com/sphero/team-alliance/pull/42",
          head: { ref: "feature/COM-540-team-page" },
        },
        {
          number: 43,
          title: "WIP",
          state: "open",
          merged_at: null,
          html_url: "https://github.com/sphero/team-alliance/pull/43",
          head: { ref: "wip-branch" },
        },
      ])
    );

    const result = await fetchRecentPrs("sphero/team-alliance", "tok", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/sphero/team-alliance/pulls?state=all&sort=updated&direction=desc&per_page=100",
      {
        headers: {
          Authorization: "Bearer tok",
          Accept: "application/vnd.github+json",
        },
      }
    );
    expect(result).toEqual([
      {
        number: 42,
        title: "COM-540: Team page",
        headRef: "feature/COM-540-team-page",
        state: "closed",
        merged: true,
        url: "https://github.com/sphero/team-alliance/pull/42",
      },
      {
        number: 43,
        title: "WIP",
        headRef: "wip-branch",
        state: "open",
        merged: false,
        url: "https://github.com/sphero/team-alliance/pull/43",
      },
    ]);
  });

  it("returns a warning (not a throw) on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("nope", { status: 404, statusText: "Not Found" })
    );

    const result = await fetchRecentPrs("sphero/missing", "tok", fetchImpl);

    expect(result).toEqual({ warning: "sphero/missing: 404 Not Found" });
  });

  it("returns a warning (not a throw) on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchRecentPrs("sphero/team-alliance", "tok", fetchImpl);

    expect(result).toEqual({ warning: "sphero/team-alliance: ECONNREFUSED" });
  });
});
```

- [ ] **Step 6: Run client tests to verify they pass**

Run: `npm test -- run src/lib/github/client.test.ts`
Expected: PASS (3/3) — implementation already exists from Step 3. (If any fail, fix the implementation, not the tests.)

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/github/
git commit -m "feat: add fetch-based GitHub PR client and word-boundary PR matcher"
```

---

### Task 4: applyPrGatedCompletion

**Files:**
- Create: `src/lib/github/prGatedCompletion.ts`
- Test: `src/lib/github/prGatedCompletion.test.ts`

**Interfaces:**
- Consumes: `moveWorkUnitColumn` (Task 2), `fetchRecentPrs`/`FetchPrsResult`/`PrSummary` + `findPrForKey` (Task 3), `applyStoryStatusSync` from `@/lib/statusTrigger`, `prisma` from `@/lib/prisma`, `GITHUB_TOKEN` from the environment.
- Produces (used by Task 5):
  - `interface PrGateResult { cardsCompleted: number; storiesCompleted: number; warnings: string[] }`
  - `applyPrGatedCompletion(projectId: string, prismaClient?: PrismaClient, deps?: PrGateDeps): Promise<PrGateResult>`
  - `interface PrGateDeps { fetchPrs: (repo: string, token: string) => Promise<FetchPrsResult>; applyStorySync: (storyId: string, prismaClient: PrismaClient) => Promise<unknown> }` (defaults: the real client and `applyStoryStatusSync` — the deps pattern mirrors `ApplyStoryStatusSyncDeps` in `statusTrigger.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/github/prGatedCompletion.test.ts`:

```ts
/**
 * Integration tests for applyPrGatedCompletion: real test database, stubbed
 * PR fetcher and story-sync trigger (deps injection). GITHUB_TOKEN is
 * stubbed per test via vi.stubEnv.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyPrGatedCompletion, type PrGateDeps } from "./prGatedCompletion";
import type { PrSummary } from "./client";

afterEach(() => {
  vi.unstubAllEnvs();
});

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function pr(overrides: Partial<PrSummary>): PrSummary {
  return {
    number: 7,
    title: "t",
    headRef: "b",
    state: "open",
    merged: false,
    url: "https://github.com/o/r/pull/7",
    ...overrides,
  };
}

function makeDeps(
  prsByRepo: Record<string, PrSummary[] | { warning: string }>
): PrGateDeps & { fetchPrs: ReturnType<typeof vi.fn>; applyStorySync: ReturnType<typeof vi.fn> } {
  return {
    fetchPrs: vi.fn(async (repo: string) => prsByRepo[repo] ?? []),
    applyStorySync: vi.fn(async () => ({ transitioned: false, commented: false })),
  };
}

async function createProjectWithStory(opts: {
  githubRepos?: string | null;
  columns: string[]; // one active card per entry
}) {
  const project = await prisma.project.create({
    data: {
      name: `PRGate ${Date.now()}`,
      type: "JIRA",
      jiraProjectKey: "PRG",
      githubRepos: opts.githubRepos ?? null,
    },
  });
  const key = uniqueKey("PRG");
  const story = await prisma.story.create({
    data: {
      jiraKey: key,
      jiraId: `id-${key}`,
      projectKey: "PRG",
      summary: `Story ${key}`,
      jiraStatus: "In Progress",
      url: `https://example.atlassian.net/browse/${key}`,
      lastSyncedAt: new Date(),
      projectId: project.id,
    },
  });
  for (const [i, column] of opts.columns.entries()) {
    await prisma.workUnit.create({
      data: { storyId: story.id, title: `Card ${i}`, column, order: i },
    });
  }
  return { project, story, key };
}

async function cleanup(projectId: string, storyId: string) {
  await prisma.workNote.deleteMany({ where: { workUnit: { storyId } } });
  await prisma.workUnit.deleteMany({ where: { storyId } });
  await prisma.story.delete({ where: { id: storyId } });
  await prisma.project.delete({ where: { id: projectId } });
}

describe("applyPrGatedCompletion", () => {
  it("silently returns zeros when the project has no githubRepos", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story } = await createProjectWithStory({ columns: ["todo"] });
    const deps = makeDeps({});
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result).toEqual({ cardsCompleted: 0, storiesCompleted: 0, warnings: [] });
      expect(deps.fetchPrs).not.toHaveBeenCalled();
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("silently returns zeros when GITHUB_TOKEN is unset", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const { project, story } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["todo"],
    });
    const deps = makeDeps({});
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result).toEqual({ cardsCompleted: 0, storiesCompleted: 0, warnings: [] });
      expect(deps.fetchPrs).not.toHaveBeenCalled();
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("skips the GitHub calls entirely when there are no candidate stories", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["done"], // all cards already done -> not a candidate
    });
    const deps = makeDeps({});
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result.cardsCompleted).toBe(0);
      expect(deps.fetchPrs).not.toHaveBeenCalled();
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("completes a matched story: cards to done + completedAt + work notes + one story sync", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story, key } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["todo", "in_progress"],
    });
    const deps = makeDeps({
      "o/r": [pr({ number: 42, headRef: `feature/${key}-x`, url: "https://github.com/o/r/pull/42" })],
    });
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);

      expect(result.cardsCompleted).toBe(2);
      expect(result.storiesCompleted).toBe(1);
      expect(result.warnings).toEqual([]);

      const units = await prisma.workUnit.findMany({
        where: { storyId: story.id },
        include: { workNotes: true },
        orderBy: { order: "asc" },
      });
      for (const unit of units) {
        expect(unit.column).toBe("done");
        expect(unit.completedAt).not.toBeNull();
        expect(unit.workNotes.map((n) => n.body)).toContain(
          "Completed by PR #42: https://github.com/o/r/pull/42"
        );
      }
      expect(deps.applyStorySync).toHaveBeenCalledTimes(1);
      expect(deps.applyStorySync).toHaveBeenCalledWith(story.id, prisma);
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("leaves non-matching stories untouched", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["todo"],
    });
    const deps = makeDeps({ "o/r": [pr({ headRef: "feature/OTHER-1" })] });
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result.cardsCompleted).toBe(0);
      const unit = await prisma.workUnit.findFirst({ where: { storyId: story.id } });
      expect(unit?.column).toBe("todo");
      expect(deps.applyStorySync).not.toHaveBeenCalled();
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("propagates per-repo warnings and still processes good repos", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story, key } = await createProjectWithStory({
      githubRepos: "bad/repo, o/r",
      columns: ["todo"],
    });
    const deps = makeDeps({
      "bad/repo": { warning: "bad/repo: 404 Not Found" },
      "o/r": [pr({ headRef: key })],
    });
    try {
      const result = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(result.warnings).toEqual(["bad/repo: 404 Not Found"]);
      expect(result.cardsCompleted).toBe(1);
    } finally {
      await cleanup(project.id, story.id);
    }
  });

  it("is a no-op on re-run (idempotent)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "tok");
    const { project, story, key } = await createProjectWithStory({
      githubRepos: "o/r",
      columns: ["todo"],
    });
    const deps = makeDeps({ "o/r": [pr({ headRef: key })] });
    try {
      const first = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(first.cardsCompleted).toBe(1);

      const second = await applyPrGatedCompletion(project.id, prisma, deps);
      expect(second.cardsCompleted).toBe(0);
      expect(second.storiesCompleted).toBe(0);

      const notes = await prisma.workNote.findMany({
        where: { workUnit: { storyId: story.id } },
      });
      expect(notes).toHaveLength(1); // no duplicate note from the re-run
    } finally {
      await cleanup(project.id, story.id);
    }
  });
});
```

Note: the `workNotes` include relation name must match the schema (`WorkUnit.workNotes WorkNote[]` — check `prisma/schema.prisma`; it is `workNotes`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- run src/lib/github/prGatedCompletion.test.ts`
Expected: FAIL — `Cannot find module './prGatedCompletion'`.

- [ ] **Step 3: Implement the gate**

Create `src/lib/github/prGatedCompletion.ts`:

```ts
/**
 * PR-gated completion: a story whose JIRA key appears in an open-or-merged
 * PR (branch name or title) across the project's configured GitHub repos
 * has all of its active cards moved to done — stamping completedAt via the
 * shared moveWorkUnitColumn helper, leaving a provenance work note per
 * card — and fires applyStoryStatusSync once (the same JIRA write-back a
 * manual drag to done triggers).
 *
 * Idempotent by construction: only stories with at least one active
 * not-done card are candidates, so a re-run finds nothing to move.
 * Feature-off states (no repos configured, no GITHUB_TOKEN) return zeros
 * silently. Per-repo GitHub failures become warnings, never throws.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyStoryStatusSync } from "@/lib/statusTrigger";
import { moveWorkUnitColumn } from "@/lib/completeMove";
import { fetchRecentPrs, type FetchPrsResult, type PrSummary } from "./client";
import { findPrForKey } from "./prMatch";

export interface PrGateResult {
  cardsCompleted: number;
  storiesCompleted: number;
  warnings: string[];
}

export interface PrGateDeps {
  fetchPrs: (repo: string, token: string) => Promise<FetchPrsResult>;
  applyStorySync: (
    storyId: string,
    prismaClient: PrismaClient
  ) => Promise<unknown>;
}

const defaultDeps: PrGateDeps = {
  fetchPrs: fetchRecentPrs,
  applyStorySync: (storyId, prismaClient) =>
    applyStoryStatusSync(storyId, prismaClient),
};

export async function applyPrGatedCompletion(
  projectId: string,
  prismaClient: PrismaClient = prisma,
  deps: PrGateDeps = defaultDeps
): Promise<PrGateResult> {
  const empty: PrGateResult = {
    cardsCompleted: 0,
    storiesCompleted: 0,
    warnings: [],
  };

  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
  });
  const token = process.env.GITHUB_TOKEN;
  const repos = (project?.githubRepos ?? "")
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);

  if (!project || repos.length === 0 || !token) {
    return empty;
  }

  // Candidate = story with at least one active (non-archived) card that is
  // not yet done. All-done or fully-archived stories are excluded, which is
  // what makes re-runs no-ops.
  const candidates = await prismaClient.story.findMany({
    where: {
      projectId,
      workUnits: { some: { archivedAt: null, column: { not: "done" } } },
    },
    include: {
      workUnits: { where: { archivedAt: null, column: { not: "done" } } },
    },
  });

  if (candidates.length === 0) {
    return empty;
  }

  const warnings: string[] = [];
  const prs: PrSummary[] = [];
  for (const repo of repos) {
    const result = await deps.fetchPrs(repo, token);
    if (Array.isArray(result)) {
      prs.push(...result);
    } else {
      warnings.push(result.warning);
    }
  }

  let cardsCompleted = 0;
  let storiesCompleted = 0;

  for (const story of candidates) {
    const pr = findPrForKey(story.jiraKey, prs);
    if (!pr) continue;

    for (const unit of story.workUnits) {
      await moveWorkUnitColumn(unit.id, "done", unit.order, prismaClient);
      await prismaClient.workNote.create({
        data: {
          workUnitId: unit.id,
          body: `Completed by PR #${pr.number}: ${pr.url}`,
        },
      });
      cardsCompleted++;
    }

    await deps.applyStorySync(story.id, prismaClient);
    storiesCompleted++;
  }

  return { cardsCompleted, storiesCompleted, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- run src/lib/github/prGatedCompletion.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/github/prGatedCompletion.ts src/lib/github/prGatedCompletion.test.ts
git commit -m "feat: applyPrGatedCompletion — PR match completes a story's cards and fires the JIRA trigger"
```

---

### Task 5: Sync integration

**Files:**
- Modify: `src/lib/sync.ts` (`syncStoriesForProject`, ~line 200: before the final return)
- Test: `src/lib/sync.test.ts` (add gate-merge cases; keep existing tests passing)

**Interfaces:**
- Consumes: `applyPrGatedCompletion`/`PrGateResult` (Task 4).
- Produces: `syncStoriesForProject`'s `ProjectSyncResult.message` gains `N card(s) completed by PRs` and/or `GitHub: <warning>` parts, joined with `" · "`, when the gate did something or warned. Signature unchanged.

- [ ] **Step 1: Write the failing sync tests**

`src/lib/sync.test.ts` already mocks `@/lib/jira/client` — follow its existing `vi.mock` style. Add a module mock for the gate at the top of the file (alongside the existing mocks):

```ts
import { applyPrGatedCompletion } from "@/lib/github/prGatedCompletion";

vi.mock("@/lib/github/prGatedCompletion", () => ({
  applyPrGatedCompletion: vi.fn(async () => ({
    cardsCompleted: 0,
    storiesCompleted: 0,
    warnings: [],
  })),
}));
```

Then add a describe block (create a JIRA-linked project with credentials and one mocked JIRA story, per the file's existing `syncStoriesForProject` test fixtures):

```ts
describe("syncStoriesForProject — PR gate integration", () => {
  it("appends the completed-by-PRs count to the result message", async () => {
    vi.mocked(applyPrGatedCompletion).mockResolvedValueOnce({
      cardsCompleted: 3,
      storiesCompleted: 2,
      warnings: [],
    });
    // arrange a JIRA-linked project + mocked fetchStoriesForProject response
    // (reuse the file's existing fixture helpers)
    const result = await syncStoriesForProject(project.id, prisma);
    expect(result.message).toContain("3 card(s) completed by PRs");
  });

  it("appends GitHub warnings to the result message", async () => {
    vi.mocked(applyPrGatedCompletion).mockResolvedValueOnce({
      cardsCompleted: 0,
      storiesCompleted: 0,
      warnings: ["bad/repo: 404 Not Found"],
    });
    const result = await syncStoriesForProject(project.id, prisma);
    expect(result.message).toContain("GitHub: bad/repo: 404 Not Found");
  });

  it("returns no message when the gate is silent", async () => {
    const result = await syncStoriesForProject(project.id, prisma);
    expect(result.message).toBeUndefined();
  });

  it("reports a warning instead of failing when the gate throws", async () => {
    vi.mocked(applyPrGatedCompletion).mockRejectedValueOnce(new Error("boom"));
    const result = await syncStoriesForProject(project.id, prisma);
    expect(result.created).toBeGreaterThanOrEqual(0); // sync itself succeeded
    expect(result.message).toContain("GitHub: PR check failed (boom)");
  });
});
```

Adapt the arrange sections to the file's real fixtures (project creation + `fetchStoriesForProject` mock return) — the assertions are the contract. The committed tests must create real project rows and call the real `syncStoriesForProject`, with try/finally cleanup of created rows.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- run src/lib/sync.test.ts`
Expected: the new tests FAIL (`result.message` undefined); existing tests still pass.

- [ ] **Step 3: Integrate the gate**

In `src/lib/sync.ts`, add the import:

```ts
import { applyPrGatedCompletion } from "@/lib/github/prGatedCompletion";
```

In `syncStoriesForProject`, replace the final `return { created, updated };` with:

```ts
  // PR-gated completion runs after the JIRA sync. GitHub problems must
  // never fail the sync — they surface as message parts instead.
  const messageParts: string[] = [];
  try {
    const gate = await applyPrGatedCompletion(projectId, prismaClient);
    if (gate.cardsCompleted > 0) {
      messageParts.push(`${gate.cardsCompleted} card(s) completed by PRs`);
    }
    messageParts.push(...gate.warnings.map((warning) => `GitHub: ${warning}`));
  } catch (error) {
    messageParts.push(
      `GitHub: PR check failed (${error instanceof Error ? error.message : String(error)})`
    );
  }

  return {
    created,
    updated,
    ...(messageParts.length > 0 ? { message: messageParts.join(" · ") } : {}),
  };
```

(The early no-op returns for "not linked to JIRA" / "credentials not configured" stay as they are — the gate does not run for them, per the spec.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- run src/lib/sync.test.ts`
Expected: PASS (new and existing).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/sync.ts src/lib/sync.test.ts
git commit -m "feat: run PR-gated completion during project sync and surface results in the message"
```

---

### Task 6: Full verification, README, PR

**Files:**
- Modify: `README.md` (feature blurb + Roadmap section, currently ~lines 115-119)

**Interfaces:**
- Consumes: everything above.
- Produces: green suite, updated docs, an open PR.

- [ ] **Step 1: Full verification**

```bash
npx tsc --noEmit && npm run test:ci && npx eslint src && npm run knip
```

Expected: no type errors; all tests pass (previous full-suite count was 624 — expect that plus the new tests); lint clean except the 3 pre-existing warnings; knip clean (if knip flags a new export that is genuinely internal-only, un-export it rather than adding an ignore).

- [ ] **Step 2: Update the README**

1. Add a feature section (near the Reports section added 2026-07-05):

```markdown
## PR-gated completion

Link a project to GitHub (Settings → "GitHub repositories", comma-separated `owner/repo`; one `GITHUB_TOKEN` in `.env` serves all repos) and Sync will also check GitHub: any **open or merged PR** whose branch name or title contains a story's JIRA key (word-boundary match — `COM-54` never matches `COM-540`) moves all of that story's active cards to Done, records a "Completed by PR #N" work note on each card, and fires the same JIRA write-back a manual drag does (story → Code Revew + summary comment). Cards entering Done now also stamp `completedAt` (manual drags included), which feeds the throughput and completed-work reports.
```

2. In the Roadmap section, remove the now-shipped line:

```markdown
- **PR-gated completion** — a story advances to Code Review / Done when a pull request is opened, rather than on a manual board drag.
```

(keep the other roadmap entries).

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: document PR-gated completion"
git push -u origin feature/pr-gated-completion
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "PR-gated completion: GitHub PRs complete stories during Sync" --body "$(cat <<'EOF'
## Summary
- `Project.githubRepos` (comma-separated `owner/repo`) + settings field; `GITHUB_TOKEN` from `.env` (server-side only)
- `src/lib/github/`: fetch-based PR client (failures → warnings, never throws), word-boundary PR matcher (branch or title, open-or-merged only), and `applyPrGatedCompletion`
- Runs at the tail of `syncStoriesForProject`: a matching PR moves all of a story's active cards to Done, adds a "Completed by PR #N: <url>" work note per card, and fires the existing `applyStoryStatusSync` JIRA write-back once per story; sync message gains "N card(s) completed by PRs" / GitHub warnings
- Included fix: new shared `moveWorkUnitColumn` helper stamps `completedAt` on entering Done and clears it on leaving (used by the manual move route too) — the completed-work/throughput reports finally get real data

Spec: `docs/superpowers/specs/2026-07-05-pr-gated-completion-design.md`
Plan: `docs/superpowers/plans/2026-07-06-pr-gated-completion.md`

## Test plan
- [ ] `npm run test:ci` — full suite green
- [ ] `npx tsc --noEmit` / `npx eslint src` / `npm run knip` — clean
- [ ] Manual: set `GITHUB_TOKEN` + a repo on the project, open a branch/PR containing a story key, hit Sync, watch the story's cards complete and JIRA transition

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Do not merge — John merges PRs himself.
