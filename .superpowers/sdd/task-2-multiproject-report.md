# Task 2 Report: Create Project API endpoints (CRUD)

**Status:** DONE

## Endpoints created

1. `GET /api/projects` — lists all projects, ordered `createdAt desc`, each with
   `storyCount`/`workUnitCount` stats. Returns `200` with an array (empty array if none).
2. `POST /api/projects` — creates a project. Body `{ name, type: "JIRA" | "STANDALONE",
   jiraProjectKey? }`. Returns `201` with the created project (incl. stats, both 0).
   `400` if `name` or `type` missing, or `type` not one of `JIRA`/`STANDALONE`.
   `jiraProjectKey` is silently nulled for non-JIRA projects (matches spec: "jiraProjectKey
   only for JIRA type").
3. `GET /api/projects/[projectId]` — fetches one project with stats. `200` or `404`.
4. `PUT /api/projects/[projectId]` — updates `name`/`jiraProjectKey` (only fields present
   in the body are changed). `200` with updated project, `404` if not found.
5. `DELETE /api/projects/[projectId]` — deletes the project and cascades to its stories
   and work units. `200` `{ success: true }`, `404` if not found.

Files:
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/route.ts`
- `src/lib/projectDto.ts` (shared `projectToDTO` mapper, extracted so it isn't a
  non-HTTP-method export living inside a Next.js `route.ts`)
- `src/app/api/projects/route.test.ts`

## Tests

- 16/16 new tests passing, covering all 5 endpoints: create (JIRA + STANDALONE + key
  ignored for STANDALONE), 400s (missing name, missing type, invalid type), list (empty,
  populated, stats), get (found/404), update (success/404), delete (success, cascade,
  404).
- Full suite: **164/164 passing** (148 pre-existing + 16 new) when run serially
  (`npx dotenv -e .env.test -- npx vitest run --no-file-parallelism`). No regressions to
  existing `stories`/`work-units` endpoints or their tests.
- `npx tsc --noEmit`: clean. `npm run lint`: clean on the new files.

## Deviations from the literal spec code (and why)

1. **Next.js 15 async route params.** The spec's sample `[projectId]/route.ts` used the
   old synchronous `{ params: { projectId: string } }` signature. This repo is on Next 15
   (`work-units/[id]/move/route.ts` already uses `{ params: Promise<{ id: string }> }`),
   so I matched that convention (`await params`) — the synchronous form would throw at
   runtime.
2. **Test imports.** The spec's test file used `const { default: handler } = await
   import('./[projectId]/route')` and called `handler.GET(...)`, but `route.ts` files
   export named `GET`/`PUT`/`DELETE`, not a default export. I imported the named exports
   directly (`import { GET as GET_ONE, PUT, DELETE } from './[projectId]/route'`),
   matching the existing pattern in `src/app/api/work-units.test.ts`.
3. **DELETE cascade is application-level, not DB-level.** Task 1's migration set
   `Story.projectId` and `WorkUnit.projectId` FKs to `ON DELETE SET NULL`, and
   `WorkUnit.storyId` is `ON DELETE RESTRICT`. Deleting a `Project` row alone would
   therefore just orphan (null out) its stories/work units, not remove them, and would
   never delete stories that still have work units. Since the schema is frozen for this
   task, `DELETE /api/projects/[projectId]` instead runs a Prisma `$transaction` that
   explicitly deletes the project's work units (matched by `projectId` or by belonging to
   one of its stories), then its stories, then the project — satisfying the spec's stated
   "cascades to stories/work units" behavior without a schema change.
4. **DTO shape.** Used the existing `ProjectWithStats` type from `src/lib/types.ts`
   (already added in Task 1) via a `projectToDTO` mapper, exposing `storyCount` /
   `workUnitCount` (from Prisma's `_count`) rather than the spec sample's raw
   `_count: { stories, workUnits }` shape — this matches what Task 1 already defined for
   downstream tasks to consume.

## Concerns

1. **Test suite parallelism flake is pre-existing, not introduced here.** `npm test --
   --run` (Vitest's default parallel file workers) intermittently fails with FK-violation
   errors because `work-units.test.ts`, `work-units/[id]/move.test.ts`, and now
   `projects/route.test.ts` share one Postgres test DB. I confirmed this reproduces
   identically on unmodified `main` (stashed my changes, ran `npm test -- --run` 3x,
   saw 2-6 failures each time from the same two pre-existing files colliding with each
   other — my new file wasn't even present). To avoid making it worse, my new test file's
   `beforeEach` only clears the `Project` table (not shared `Story`/`WorkUnit` tables),
   and the two tests that create `Story`/`WorkUnit` rows use unique keys and clean up
   after themselves explicitly. Confirmed 164/164 stable across repeated runs with
   `--no-file-parallelism`. Flagged again here (also flagged in Task 1's report) as a
   test-infra issue worth a dedicated fix (e.g. `fileParallelism: false` in
   `vitest.config.ts`, or per-file schemas/transactions) — out of scope for this task.
2. Noticed the working tree also contains unrelated uncommitted changes/untracked files
   (a `board/page.tsx` redesign, `.superpowers/sdd/*redesign*` reports, `src/hooks/`,
   `DESIGN-IS-2026-07-01/`, etc.) that I did not create and did not touch. Only
   `src/app/api/projects/`, `src/lib/projectDto.ts`, and this progress/report doc were
   staged and committed for this task.

## Commit

`feat: add Project CRUD API endpoints` — stages only
`src/app/api/projects/`, `src/lib/projectDto.ts`, and the two `.superpowers/sdd/*` docs
updated above.
