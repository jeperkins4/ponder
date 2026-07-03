# Move-to-QA Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a button to each work-unit card in Ponder's Done lane that explicitly transitions the card's parent JIRA story to the real, live-verified **"QA"** status — a deliberate, human-triggered action, distinct from the existing automatic column-driven JIRA sync.

**Architecture:** Three layers, each consuming the one below: (1) a new pure function `transitionStoryToQA` in `src/lib/statusTrigger.ts`, reusing the exact JIRA transition-matching machinery (`getTransitions`, `pickTransitionByStatusName`, `transitionIssue`) already used by the automatic sync — but unlike that sync, this function **surfaces errors to the caller** instead of swallowing them, since it's a primary user-triggered action, not a background side effect; (2) a new API route `POST /api/work-units/[id]/move-to-qa` that resolves the work unit's parent story and calls it; (3) a new button in `WorkUnitCard.tsx`, shown only on Done-lane, JIRA-linked cards.

**Tech Stack:** Next.js 15 (App Router route handlers), TypeScript, Prisma 7 + PostgreSQL, Vitest + React Testing Library.

## Global Constraints

- **"QA" is a real, verified transition** in the live JIRA workflow (project `COM`) — confirmed live via the Atlassian API: from an issue in "Code Revew" status, transition id `2` targets a status literally named `"QA"` (id `11034`). No name-guessing needed; `pickTransitionByStatusName` (already in `src/lib/jira/transitions.ts`) works generically for any status name string, including `"QA"` — no changes to that file are needed.
- **Gating rule (user-confirmed):** the transition is only allowed when **every** work unit belonging to the story is in the `done` column. If any sibling isn't done, return a clear error instead of transitioning — do not transition partially-complete stories to QA.
- **This is NOT part of `computeDesiredJiraStatus`/`applyStoryStatusSync`.** That function is the automatic, column-driven, **never-throws** sync (a side effect of an unrelated primary action — moving a card). This new `transitionStoryToQA` is a **primary**, explicitly user-triggered action and must surface real errors (not swallow them) so the button's caller can show the user what happened.
- **No new automatic behavior.** Ponder's Done column does not, on its own, imply "ready for QA" — only this explicit button does. Do not modify `computeDesiredJiraStatus`.
- **Local `story.jiraStatus` mirror:** on a successful transition, update the story's local `jiraStatus` field to `"QA"` (mirrors `applyStoryStatusSync`'s own existing convention of keeping the local mirror in sync after a real JIRA write).
- **Explicitly out of scope (do not touch):** `jiraStatusToColumn`'s mapping table (`src/lib/columns.ts`) has no entry for `"qa"` and would map it to the `todo` fallback if a future reverse-sync ever reads it back — this is a pre-existing gap in the reverse-sync path, unrelated to this feature, and is not being fixed here. No MCP tool for this action is being added in this pass (not requested).
- **JIRA-linked cards only:** the button must only render when the card has a `storyKey` (i.e. the project is JIRA-linked) — mirrors the existing conditional rendering of the story-key link/span in `WorkUnitCard.tsx`.
- **Tests run serially:** `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
- **No secrets committed.** Branch → verify green (`tsc --noEmit`, `npm run lint`, full suite, `npx knip`) → PR → the user merges.

---

## File Structure

**Modify:**
- `src/lib/statusTrigger.ts` — add `transitionStoryToQA`.
- `src/lib/statusTrigger.test.ts` — add its tests.
- `src/components/WorkUnitCard.tsx` — add the button (Done-lane, JIRA-linked cards only).
- `src/components/WorkUnitCard.test.tsx` — add its tests.

**Create:**
- `src/app/api/work-units/[id]/move-to-qa/route.ts` — the new route.
- `src/app/api/work-units/[id]/move-to-qa/route.test.ts` — its tests.

---

### Task 1: `transitionStoryToQA`

**Files:**
- Modify: `src/lib/statusTrigger.ts`
- Modify: `src/lib/statusTrigger.test.ts`

**Interfaces:**
- Produces: `transitionStoryToQA(storyId: string, prisma: PrismaClient, deps?: Pick<ApplyStoryStatusSyncDeps, "getTransitions" | "transitionIssue">): Promise<TransitionStoryToQAResult>`, where `TransitionStoryToQAResult = { ok: true } | { ok: false; error: string }`. Consumed by Task 2's route.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/statusTrigger.test.ts` (reuse this file's existing `makeJiraProject`/`makeStory` helpers and `beforeEach` cleanup — add this new `describe` block as a sibling of the existing `describe("applyStoryStatusSync", ...)`, inside the same outer test file so the helpers are in scope):

```ts
describe("transitionStoryToQA", () => {
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
        name: `QA Test Project ${testCounter}`,
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
        jiraKey: `TEAM-QA-${testCounter}`,
        jiraId: `9100${testCounter}`,
        projectKey: "TEAM",
        summary: "Test story",
        description: "A test story",
        jiraStatus: "Code Revew",
        url: `https://example.atlassian.net/browse/TEAM-QA-${testCounter}`,
        lastSyncedAt: new Date(),
        ...overrides,
      },
    });
  }

  function fakeQaDeps(
    overrides: Partial<Pick<ApplyStoryStatusSyncDeps, "getTransitions" | "transitionIssue">> = {}
  ) {
    return {
      getTransitions: vi.fn(async (): Promise<JiraTransition[]> => [
        { id: "2", name: "QA", to: { name: "QA", statusCategory: { key: "indeterminate" } } },
        { id: "3", name: "Code Revew", to: { name: "Code Revew", statusCategory: { key: "indeterminate" } } },
      ]),
      transitionIssue: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("transitions to QA when every work unit is done", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "done", order: 1 },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result).toEqual({ ok: true });
    expect(deps.transitionIssue).toHaveBeenCalledWith(story.jiraKey, "2", expect.any(Object));

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("QA");
  });

  it("returns an error without transitioning when a sibling work unit isn't done", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 2", column: "code_review", order: 1 },
    });

    const deps = fakeQaDeps();
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/done/i);
    }
    expect(deps.transitionIssue).not.toHaveBeenCalled();

    const updated = await prisma.story.findUnique({ where: { id: story.id } });
    expect(updated?.jiraStatus).toBe("Code Revew");
  });

  it("returns an error when the story has no work units", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });

    const result = await transitionStoryToQA(story.id, prisma, fakeQaDeps());

    expect(result.ok).toBe(false);
  });

  it("returns an error for a missing story", async () => {
    const result = await transitionStoryToQA("does-not-exist", prisma, fakeQaDeps());

    expect(result).toEqual({ ok: false, error: expect.stringContaining("not found") });
  });

  it("returns an error when the project has no JIRA credentials", async () => {
    const project = await prisma.project.create({
      data: { name: "No Creds Project", type: "STANDALONE" },
    });
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const result = await transitionStoryToQA(story.id, prisma, fakeQaDeps());

    expect(result.ok).toBe(false);
  });

  it("returns an error when no QA transition is available from the story's current status", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const deps = fakeQaDeps({
      getTransitions: vi.fn(async (): Promise<JiraTransition[]> => [
        { id: "3", name: "Code Revew", to: { name: "Code Revew", statusCategory: { key: "indeterminate" } } },
      ]),
    });
    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/QA/);
    }
  });

  it("surfaces a JIRA API failure as an error result instead of throwing", async () => {
    const project = await makeJiraProject();
    const story = await makeStory({ projectId: project.id });
    await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task 1", column: "done", order: 0 },
    });

    const deps = fakeQaDeps({
      transitionIssue: vi.fn(async () => {
        throw new Error("JIRA API error: 500");
      }),
    });

    const result = await transitionStoryToQA(story.id, prisma, deps);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("500") });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts`
Expected: FAIL — `transitionStoryToQA` is not exported from `./statusTrigger`.

- [ ] **Step 3: Implement `transitionStoryToQA`**

In `src/lib/statusTrigger.ts`, add near the end of the file (after `applyStoryStatusSync`), reusing the file's existing private `hasJiraCredentials` helper and the `pickTransitionByStatusName`/`JiraConfig` imports already present at the top of the file:

```ts
export type TransitionStoryToQAResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Explicitly transitions a story's JIRA issue to "QA". Unlike
 * `applyStoryStatusSync` (an automatic, never-throwing side effect of an
 * unrelated board action), this is a primary, human-triggered action — every
 * failure mode is returned as a clear `{ ok: false, error }` result so the
 * caller (the Move-to-QA button) can show the user what happened, rather than
 * being silently swallowed.
 *
 * Requires every one of the story's work units to be in the `done` column;
 * otherwise returns an error without calling JIRA at all.
 */
export async function transitionStoryToQA(
  storyId: string,
  prisma: PrismaClient,
  deps: Pick<ApplyStoryStatusSyncDeps, "getTransitions" | "transitionIssue"> = defaultDeps
): Promise<TransitionStoryToQAResult> {
  const story = (await prisma.story.findUnique({
    where: { id: storyId },
    include: { workUnits: true, project: true },
  })) as (Story & { workUnits: WorkUnit[]; project: Project | null }) | null;

  if (!story) {
    return { ok: false, error: `Story not found: ${storyId}` };
  }

  if (story.workUnits.length === 0 || !story.workUnits.every((w) => w.column === "done")) {
    return {
      ok: false,
      error: "All work units for this story must be Done before moving it to QA",
    };
  }

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

  try {
    const transitions = await deps.getTransitions(story.jiraKey, config);
    const transition = pickTransitionByStatusName(transitions, "QA");

    if (!transition) {
      return {
        ok: false,
        error: `No "QA" transition available for ${story.jiraKey} from its current status`,
      };
    }

    await deps.transitionIssue(story.jiraKey, transition.id, config);

    await prisma.story.update({
      where: { id: storyId },
      data: { jiraStatus: "QA" },
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/lib/statusTrigger.test.ts`
Expected: PASS — all `transitionStoryToQA` tests plus every pre-existing `applyStoryStatusSync`/`computeDesiredJiraStatus` test (untouched).

- [ ] **Step 5: Commit**

```bash
git add src/lib/statusTrigger.ts src/lib/statusTrigger.test.ts
git commit -m "feat: add transitionStoryToQA for explicit JIRA QA transitions"
```

---

### Task 2: `POST /api/work-units/[id]/move-to-qa`

**Files:**
- Create: `src/app/api/work-units/[id]/move-to-qa/route.ts`
- Create: `src/app/api/work-units/[id]/move-to-qa/route.test.ts`

**Interfaces:**
- Consumes: `transitionStoryToQA(storyId, prisma)` from Task 1.
- Produces: `POST` — 404 if the work unit doesn't exist; 200 `{ ok: true }` on success; 422 `{ error: string }` when `transitionStoryToQA` returns `{ ok: false, error }`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/work-units/[id]/move-to-qa/route.test.ts` (mirror the mocking style already used in `src/app/api/work-units/[id]/generate-acceptance-criteria/route.test.ts` — mock the Task 1 function, use the real test DB for the work unit/story rows):

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/statusTrigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/statusTrigger")>();
  return { ...actual, transitionStoryToQA: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/work-units/[id]/move-to-qa/route";
import { transitionStoryToQA } from "@/lib/statusTrigger";

describe("POST /api/work-units/[id]/move-to-qa", () => {
  let workUnitId: string;
  let storyId: string;
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
    storyId = story.id;
    const wu = await prisma.workUnit.create({
      data: { storyId: story.id, title: "Task", column: "done", order: 0 },
    });
    workUnitId = wu.id;
  });

  afterAll(async () => {
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("returns 200 and calls transitionStoryToQA with the work unit's storyId on success", async () => {
    vi.mocked(transitionStoryToQA).mockResolvedValueOnce({ ok: true });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
    expect(transitionStoryToQA).toHaveBeenCalledWith(storyId, expect.anything());
  });

  it("returns 422 with the error message when transitionStoryToQA reports failure", async () => {
    vi.mocked(transitionStoryToQA).mockResolvedValueOnce({
      ok: false,
      error: "All work units for this story must be Done before moving it to QA",
    });

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: workUnitId }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("must be Done");
  });

  it("returns 404 for a missing work unit", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as never, {
      params: Promise.resolve({ id: "does-not-exist" }),
    });

    expect(res.status).toBe(404);
    expect(transitionStoryToQA).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/work-units/[id]/move-to-qa/route.test.ts"`
Expected: FAIL — the route module doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/work-units/[id]/move-to-qa/route.ts`:

```ts
/**
 * POST /api/work-units/[id]/move-to-qa
 *
 * Explicitly transitions the work unit's parent JIRA story to "QA". Only
 * succeeds when every one of the story's work units is Done — see
 * transitionStoryToQA for the full rule.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transitionStoryToQA } from "@/lib/statusTrigger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const workUnit = await prisma.workUnit.findUnique({
      where: { id },
      select: { id: true, storyId: true },
    });
    if (!workUnit) {
      return NextResponse.json({ error: "Work unit not found" }, { status: 404 });
    }

    const result = await transitionStoryToQA(workUnit.storyId, prisma);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error moving story to QA:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run the route tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism "src/app/api/work-units/[id]/move-to-qa/route.test.ts"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/work-units/[id]/move-to-qa/route.ts" \
  "src/app/api/work-units/[id]/move-to-qa/route.test.ts"
git commit -m "feat: add POST /api/work-units/[id]/move-to-qa route"
```

---

### Task 3: The button on `WorkUnitCard`

**Files:**
- Modify: `src/components/WorkUnitCard.tsx`
- Modify: `src/components/WorkUnitCard.test.tsx`

**Interfaces:**
- Consumes: `POST /api/work-units/${workUnit.id}/move-to-qa` (Task 2), returning `{ ok: true }` (200) or `{ error: string }` (422/404/500).
- No new props — reuses the existing `storyKey` (to gate rendering to JIRA-linked cards) and `onStatusMessage` (to report success, matching this component's existing convention for save/delete).

- [ ] **Step 1: Write the failing tests**

Add to `src/components/WorkUnitCard.test.tsx`, a new `describe` block (place it near the existing `describe("Delete functionality", ...)` block, after the `Rendering` describe):

```ts
describe("Move to QA", () => {
  const doneWorkUnit: WorkUnitDTO = { ...mockWorkUnit, column: "done" };

  it("renders the button only for a Done, JIRA-linked card", () => {
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

  it("POSTs to the move-to-qa endpoint and reports success via onStatusMessage", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
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
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/work-units/${doneWorkUnit.id}/move-to-qa`,
        expect.objectContaining({ method: "POST" })
      );
      expect(onStatusMessage).toHaveBeenCalledWith(
        expect.stringContaining("COM-1")
      );
    });
  });

  it("alerts with the server's error message on failure, without calling onStatusMessage", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "All work units for this story must be Done before moving it to QA" }),
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
        expect.stringContaining("must be Done")
      );
    });
    expect(onStatusMessage).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitCard.test.tsx`
Expected: FAIL — no `move-to-qa-button-${id}` testid exists yet.

- [ ] **Step 3: Add the button**

In `src/components/WorkUnitCard.tsx`, add a new piece of state near the other `useState` declarations (after `isDetailOpen`):

```ts
  const [isMovingToQA, setIsMovingToQA] = useState(false);
```

Add a handler, near `handleDelete`:

```ts
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

      onStatusMessage?.(`Moved "${storyKey}" to JIRA QA`);
    } catch (error) {
      console.error("Error moving story to QA:", error);
      alert("Failed to move story to QA");
    } finally {
      setIsMovingToQA(false);
    }
  };
```

Add the button in the view-mode JSX, inside the existing `<div className="flex gap-2">` that already holds the Edit/Delete/Cancel buttons (so it sits alongside them), placed after the existing Delete/Cancel-delete buttons:

```tsx
        {workUnit.column === "done" && storyKey && (
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
        )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/components/WorkUnitCard.test.tsx`
Expected: PASS — the three new tests plus every pre-existing test.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit` and `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
Expected: both clean/green.

- [ ] **Step 6: Manually verify in a real browser**

Start the dev server (`npm run dev`), open a story that has multiple work units, move all of them to Done, and confirm the "Move to QA" button appears on each Done card, clicking it succeeds (check the real JIRA issue's status in the browser or via the Atlassian API), and confirm the button correctly reports an error (via `alert`) if you click it before every sibling work unit is Done. This is a real external side effect (a live JIRA write) — do not skip this manual check in favor of only the mocked unit tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/WorkUnitCard.tsx src/components/WorkUnitCard.test.tsx
git commit -m "feat: add Move to QA button to Done-lane, JIRA-linked cards"
```

---

## Final verification (before PR)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — no new errors.
- [ ] `npx dotenv -e .env.test -- vitest run --no-file-parallelism` — full suite green.
- [ ] `npx knip` — no new unused exports.
- [ ] Manual browser check (Task 3, Step 6) — a live JIRA write; this is the one part of this feature that automated tests cannot fully prove.
- [ ] Open the PR; the user merges.

---

## Self-Review

**Spec coverage:** "a button on each Card [in Done] to explicitly move the story to JIRA QA" → Task 3's button, gated to Done + JIRA-linked cards, calling Task 2's route, which calls Task 1's `transitionStoryToQA`. The user-confirmed gating rule (all siblings Done) is enforced in Task 1, with a clear error surfaced all the way to an `alert()` in Task 3 — not silently swallowed. ✅

**Type consistency:** `TransitionStoryToQAResult` (`{ok: true} | {ok: false, error: string}`) is defined once in Task 1 and consumed with that exact shape by Task 2's route (`result.ok`/`result.error`) and indirectly by Task 3 (via the route's JSON response `{ error: string }` on failure, `{ ok: true }` on success — same field names throughout, no renaming).

**Placeholder scan:** every step has concrete, complete code; no "add appropriate error handling" placeholders. Task 3 Step 6 is a deliberate, explicitly-justified manual step (a real external JIRA write), not an omitted test.

**Open follow-ups (not in scope):** `jiraStatusToColumn`'s missing `"qa"` mapping (would affect a hypothetical future reverse-sync reading a "QA" status back into Ponder) — flagged in Global Constraints as a known, pre-existing gap, deliberately not fixed here. No MCP tool for this action (not requested this pass — could mirror `regenerate_acceptance`'s pattern later if wanted).
