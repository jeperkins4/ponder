# Task 1 Report: Add Project table to Prisma schema

**Status:** DONE

## Migration
- Name/timestamp: `20260701145937_add_project_table`
- Path: `prisma/migrations/20260701145937_add_project_table/migration.sql`
- Applied to dev DB (`kanban`) via `prisma migrate dev --name add_project_table`
- Applied to test DB (`kanban_test`) via `prisma migrate deploy`
- Purely additive: new `Project` table, two new nullable FK columns (`Story.projectId`,
  `WorkUnit.projectId`), three new indexes. No column drops, no data loss, no `NOT NULL`
  additions to existing tables.

## Schema changes
- **New model `Project`**: `id` (cuid), `name`, `type` (String, default `"STANDALONE"`),
  `jiraProjectKey` (optional), `createdAt`, `updatedAt`. Indexed on `jiraProjectKey`.
- **Modified model `Story`**: added optional `projectId` + `project Project?` relation,
  indexed on `projectId`. Existing required fields untouched.
- **Modified model `WorkUnit`**: added optional `projectId` + `project Project?` relation
  (named `ProjectWorkUnits`), indexed on `projectId`. Also added an index on the existing
  `storyId` column (was previously unindexed) for query performance, matching the plan's
  example. `storyId` itself was **kept required** (see Concerns below).
- **`src/lib/types.ts`**: added `Project` and `ProjectWithStats` interfaces, verbatim per
  spec.

## Tests
- Baseline (before any change), serial run: 148/148 passing.
- Post-change, serial run: 148/148 passing. No regressions.
- `npx prisma validate`: valid.
- `npx tsc --noEmit`: clean, no type errors.

## Concerns
1. **Deviation from the plan's illustrative `WorkUnit` code block, intentional:** the plan
   snippet showed `storyId String?` (optional) and dropped the `story` relation field
   entirely. I did not follow that literally because:
   - It's internally inconsistent — removing the back-reference field would fail
     `prisma validate` since `Story.workUnits` needs a matching relation field.
   - It would flip `storyId` from required to optional, which breaks the TypeScript
     signatures already hardcoded as `storyId: string` in
     `src/app/api/work-units/route.ts`, `src/app/api/work-units/[id]/route.ts`, and
     `src/app/api/work-units/[id]/move/route.ts` — all out of scope for this task's
     "Files to Modify" list (only `schema.prisma` and `types.ts`).
   - The Deliverable section only asks for an **optional `projectId`** on WorkUnit, not
     for `storyId` to become optional.
   - **Forward-looking implication:** because `storyId` stays required, `WorkUnit` rows
     still must belong to a `Story`. A STANDALONE project that wants story-less work
     units (the apparent point of the STANDALONE type) will need a follow-up migration
     making `storyId` optional plus updates to the three route handlers' DTO mapping.
     Flagging this now so whichever later task (likely the story-sync or board-page
     task) owns that change isn't surprised.

2. **Test command flake, pre-existing, not introduced by this task:** the spec's literal
   verification command `npm test -- --run` uses Vitest's default parallel file workers,
   and multiple test files share one Postgres test DB with `beforeEach` truncation. This
   causes intermittent FK-violation failures under parallelism **before any of my
   changes** (confirmed by running the same command against `main` prior to editing the
   schema). Running with `--no-file-parallelism` is stable and was used for both the
   before/after comparison (148 = 148). This is a suite-level test-isolation issue outside
   this task's scope; worth a ticket for whoever owns test infra.

3. **`Project` TS interface shape vs. existing DTO convention:** per spec, `Project.createdAt`
   is typed `Date` and `jiraProjectKey` is `string | undefined`, whereas existing DTOs
   (`StoryDTO`, `WorkUnitDTO`) use ISO string dates and `string | null` for optional
   Prisma fields. No consumer exists yet, so this doesn't break anything today, but the
   Project API task (Task 2) should decide whether `Project` is the raw type or introduce
   a `ProjectDTO` matching the existing string-date/null convention before wiring it to a
   route handler.

4. Docker/Postgres was not running at task start; started `docker compose up -d` to bring
   up `kanban-db` for migration + test verification. No lasting change to the workflow,
   just noting the dependency.
