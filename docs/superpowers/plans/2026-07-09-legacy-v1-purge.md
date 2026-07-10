# Legacy v1 Layer Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the pre-multi-project v1 layer (env-credential `/api/sync`, v1 home page + SyncButton, un-scoped `/board`, no-`projectId` fallbacks) and make `/` redirect to `/projects`.

**Architecture:** Pure removal plus one redirect. The multi-project paths (`/api/projects/[projectId]/sync`, `/projects/[projectId]/board`) already provide all surviving behavior; this plan deletes the superseded entry points and tightens `GET /api/stories` and `KanbanBoard` to require a `projectId`.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Prisma 7, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-legacy-v1-purge-design.md`

## Global Constraints

- Branch `chore/legacy-v1-purge` already exists with the spec committed — work on it.
- NEVER run bare `npx vitest` — it wipes the dev DB. Always `npm test` (or `npm test -- <path>` for a single file).
- Un-scoped `GET /api/stories` must return **400** with a message naming the missing `projectId` query param.
- Do not touch: import pipeline, JIRA write-back sync (`statusTrigger`, `/api/projects/[projectId]/sync`), allowlist, verification flow, reports, settings pages, MCP server.
- Verification bar before finishing: `npm test`, `npm run lint`, `npm run knip` all clean.

---

### Task 1: Replace v1 home page with redirect; delete SyncButton and /api/sync

**Files:**
- Modify: `src/app/page.tsx` (replace contents)
- Modify: `src/app/page.test.tsx` (replace contents)
- Delete: `src/app/components/SyncButton.tsx`, `src/app/components/SyncButton.test.tsx` (removes the whole `src/app/components/` directory)
- Delete: `src/app/api/sync/` (entire directory: `route.ts` and any test beside it)

**Interfaces:**
- Consumes: `redirect` from `next/navigation` (Next.js built-in).
- Produces: `GET /` server-redirects to `/projects`. `POST /api/sync` ceases to exist (its replacement, `POST /api/projects/[projectId]/sync`, is untouched).

- [ ] **Step 1: Write the failing test**

Replace the full contents of `src/app/page.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import Home from "@/app/page";

describe("Home page", () => {
  it("redirects to /projects", () => {
    Home();
    expect(redirectMock).toHaveBeenCalledWith("/projects");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/page.test.tsx`
Expected: FAIL — the current `Home` renders the v1 landing page and never calls `redirect`.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

/**
 * Root route. Ponder has no landing page of its own — the project list is
 * the entry point.
 */
export default function Home() {
  redirect("/projects");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/page.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Delete the orphaned v1 code**

```bash
git rm -r src/app/components src/app/api/sync
```

`SyncButton`'s only consumer was the old `page.tsx`; `/api/sync`'s only caller was `SyncButton`. Nothing else imports either (verify: `grep -rn "SyncButton\|api/sync" src --include="*.ts*" | grep -v "api/projects"` should return nothing).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, with the deleted files' tests gone from the run.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/app/page.test.tsx
git commit -m "refactor: replace v1 home page with redirect to /projects, drop legacy env-based /api/sync"
```

---

### Task 2: Remove the un-scoped /board route and its nav link

**Files:**
- Delete: `src/app/board/` (entire directory: `page.tsx`, `page.test.tsx`)
- Modify: `src/components/TopNav.tsx:16-20` (links array)
- Test: `src/components/TopNav.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: TopNav renders exactly two nav links — `Projects` (`/projects`) and `Reports` (`/reports`). `/board` 404s.

- [ ] **Step 1: Write the failing test**

In `src/components/TopNav.test.tsx`:
- Delete every assertion/test that expects a link named "Board" pointing at `/board` (currently around lines 31–45, including the test that sets `mockPathname = "/projects/abc/board"` to check the global Board link's active state).
- Add this test alongside the remaining link tests:

```tsx
it("does not render a global Board link", () => {
  render(<TopNav />);
  expect(
    screen.queryByRole("link", { name: "Board" })
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/TopNav.test.tsx`
Expected: FAIL — the new test finds the Board link.

- [ ] **Step 3: Write minimal implementation**

In `src/components/TopNav.tsx`, change the links array to:

```tsx
  const links = [
    { href: "/projects", label: "Projects" },
    { href: "/reports", label: "Reports" },
  ];
```

- [ ] **Step 4: Delete the route**

```bash
git rm -r src/app/board
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/components/TopNav.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/TopNav.tsx src/components/TopNav.test.tsx
git commit -m "refactor: remove un-scoped /board route and its nav link"
```

---

### Task 3: Require projectId in GET /api/stories and KanbanBoard

**Files:**
- Modify: `src/app/api/stories/route.ts`
- Test: `src/app/api/stories/route.test.ts`
- Modify: `src/components/KanbanBoard.tsx:47-64,111-113`
- Test: `src/components/KanbanBoard.test.tsx`

**Interfaces:**
- Consumes: Task 2 must land first — `src/app/board/page.tsx` was the only caller rendering `<KanbanBoard />` without a `projectId`.
- Produces: `GET /api/stories?projectId=<id>` → 200 with `StoryDTO[]`; missing param → 400 `{ error: "Missing required query param: projectId" }`. `KanbanBoardProps.projectId` becomes `string` (required). MCP tools and the project board page already always pass it.

- [ ] **Step 1: Write the failing route test**

In `src/app/api/stories/route.test.ts`, add inside the existing `describe("GET /api/stories")`:

```ts
it("returns 400 when projectId is missing", async () => {
  const req = new NextRequest("http://localhost:3000/api/stories");
  const res = await GET(req);
  expect(res.status).toBe(400);
  const data = await res.json();
  expect(data.error).toBe("Missing required query param: projectId");
});
```

Also delete any existing test that calls `GET` without `?projectId=` and expects all stories back (the un-scoped backward-compat behavior).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/stories/route.test.ts`
Expected: FAIL — the route currently returns 200 with all stories.

- [ ] **Step 3: Implement the 400 guard**

In `src/app/api/stories/route.ts`:

Replace the file header comment (lines 1–6) with:

```ts
/**
 * GET /api/stories
 * List one project's stories with their work units. Requires a
 * `?projectId=` query param; requests without it are rejected with 400.
 */
```

After `const projectId = ...` (line 14), add:

```ts
    if (!projectId) {
      return NextResponse.json(
        { error: "Missing required query param: projectId" },
        { status: 400 }
      );
    }
```

And simplify the `where` clause spread (line 18) from `...(projectId ? { projectId } : {}),` to:

```ts
        projectId,
```

- [ ] **Step 4: Run route tests to verify they pass**

Run: `npm test -- src/app/api/stories/route.test.ts`
Expected: PASS

- [ ] **Step 5: Make KanbanBoard's projectId required**

In `src/components/KanbanBoard.tsx`:

Change the prop declaration (lines 47–50) to:

```tsx
export interface KanbanBoardProps {
  /** Scopes the board to a single project's stories. */
  projectId: string;
```

Change the URL construction (lines 111–113) to:

```tsx
  const storiesUrl = `/api/stories?projectId=${projectId}`;
```

- [ ] **Step 6: Fix KanbanBoard tests**

In `src/components/KanbanBoard.test.tsx`, every `render(<KanbanBoard ... />)` that omits `projectId` must now pass one, e.g. `projectId="test-project"` (fetch is mocked in these tests, so any stable id works). TypeScript will point at each site: run `npx tsc --noEmit` and fix every reported render call.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS / no type errors

- [ ] **Step 8: Commit**

```bash
git add src/app/api/stories/route.ts src/app/api/stories/route.test.ts src/components/KanbanBoard.tsx src/components/KanbanBoard.test.tsx
git commit -m "refactor: require projectId for /api/stories and KanbanBoard"
```

---

### Task 4: Purge env vars and docs; knip sweep; open PR

**Files:**
- Modify: `.env.example`
- Modify: `ARCHITECTURE.md` (~lines 276–281, env-var table)
- Modify: `DEPLOYMENT.md` (~lines 62–68 env table; ~lines 160–164 troubleshooting)

**Interfaces:**
- Consumes: Tasks 1–3 complete (no code references `JIRA_SITE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEYS` remain in `src/`).
- Produces: docs describe only the per-project credential model; clean knip run; PR opened for John to review and merge.

- [ ] **Step 1: Verify no code references remain**

Run: `grep -rn "JIRA_SITE_URL\|JIRA_EMAIL\|JIRA_API_TOKEN\|JIRA_PROJECT_KEYS" src`
Expected: no output. If anything appears, it was missed in Tasks 1–3 — fix there first.

- [ ] **Step 2: Update .env.example**

Replace the leading JIRA block (the `# JIRA Configuration` comment through `JIRA_PROJECT_KEYS=TEAM`) with:

```bash
# JIRA credentials are configured per project in the app's Settings panel
# (site URL, email, API token) — nothing JIRA-related belongs in this file.
```

Leave `ANTHROPIC_API_KEY`, `ANTHROPIC_BREAKDOWN_MODEL`, `DATABASE_URL`, `NODE_ENV`, and `GITHUB_TOKEN` untouched.

- [ ] **Step 3: Update ARCHITECTURE.md and DEPLOYMENT.md**

- `ARCHITECTURE.md`: delete the `JIRA_SITE_URL`, `JIRA_EMAIL` / `JIRA_API_TOKEN`, and `JIRA_PROJECT_KEYS` rows from the environment-variable table (~lines 276–281). If the surrounding prose describes env-based JIRA configuration, replace it with one line: "JIRA credentials are stored per project (Settings panel), not in the environment."
- `DEPLOYMENT.md`: delete the same env-var rows (~lines 62–68) and rewrite the troubleshooting bullets (~lines 160–164) that reference them, e.g. "Verify the project's JIRA site URL in Settings includes `https://`" and "Confirm the JIRA project key configured in the project's Settings exists and is accessible".
- Also grep both files plus `README.md` and `API.md` for `/api/sync` and the un-scoped `/board` route and remove any stale mentions: `grep -n "api/sync\|(^|[^)a-z])/board" README.md API.md ARCHITECTURE.md DEPLOYMENT.md -E`

- [ ] **Step 4: Knip sweep**

Run: `npm run knip`
Expected: clean. If the deletions orphaned anything (e.g. a helper only the removed code used), delete the orphan too and re-run until clean.

- [ ] **Step 5: Full verification bar**

Run: `npm test && npm run lint && npm run knip`
Expected: all pass.

- [ ] **Step 6: Commit and open PR**

```bash
git add .env.example ARCHITECTURE.md DEPLOYMENT.md README.md API.md
git commit -m "docs: drop legacy env-based JIRA configuration"
git push -u origin chore/legacy-v1-purge
gh pr create --title "Purge legacy pre-multi-project v1 layer" --body "$(cat <<'EOF'
## Summary
- Replace the v1 "JIRA Kanban Sync" home page with a redirect to /projects
- Remove the legacy env-credential POST /api/sync (superseded by /api/projects/[projectId]/sync) and its SyncButton
- Remove the un-scoped /board route and nav link (confirmed unused)
- GET /api/stories and KanbanBoard now require projectId (400 / required prop)
- Drop JIRA_* env vars from .env.example and docs — credentials are per-project

Spec: docs/superpowers/specs/2026-07-09-legacy-v1-purge-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

John merges the PR himself — do not merge.
