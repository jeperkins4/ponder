# Task 1: Work-unit attachments — schema, filesystem storage, API endpoints

## Status: DONE

Commit hash: `e9b9c59` (verified via `git log --oneline -1` on `feature/card-attachments`)

## Summary

Added an `Attachment` Prisma model (FK-cascade from `WorkUnit`, mirroring
`WorkNote`), a filesystem storage helper keyed by attachment id, and four
endpoints for uploading, listing, serving, and deleting image attachments.
Files live on disk under `UPLOADS_DIR` (default `<cwd>/data/uploads`);
Postgres stores only metadata.

## Endpoint contract (for Task 2)

### `AttachmentDTO` (`src/lib/types.ts`)
```ts
export interface AttachmentDTO {
  id: string;
  workUnitId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string; // ISO string
  url: string;        // /api/attachments/{id}
}
```

### `POST /api/work-units/[id]/attachments`
- Body: `multipart/form-data` with a `file` field (image `File`/`Blob`).
- Validation, in order:
  1. Work unit exists → else `404 { error }`.
  2. `file` field present and is a `Blob`/`File` → else `400 { error }`.
  3. `file.type` starts with `image/` → else `400 { error }`.
  4. `file.size` ≤ 10 MB (10 * 1024 * 1024 bytes) → else `413 { error }`.
- On success: creates the `Attachment` row first (to mint the id), writes
  `await file.arrayBuffer()` to disk via `attachmentStorage.writeAttachmentFile`,
  returns `201` with the `AttachmentDTO`.
- If the disk write throws, the row is deleted before the error propagates
  (no orphan row without a file).

### `GET /api/work-units/[id]/attachments`
- Returns `AttachmentDTO[]` ordered by `createdAt` asc.
- `404 { error }` if the work unit doesn't exist.

### `GET /api/attachments/[id]`
- Streams the file bytes with `Content-Type` set to the stored `mimeType`
  and `Cache-Control: private, max-age=31536000, immutable` (ids are
  content-addressed/immutable in practice — once written, a given
  attachment id's bytes never change).
- `404 { error }` if the row is missing, or if the row exists but the file
  is missing on disk (e.g. manual deletion).

### `DELETE /api/attachments/[id]`
- Deletes the row, then deletes the file (best-effort; `rm(..., { force: true })`
  so a missing file doesn't fail the request).
- Returns `{ ok: true }`. `404 { error }` if the row doesn't exist.

## Storage helper (`src/lib/attachmentStorage.ts`)
- Root dir: `process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads")`.
- `writeAttachmentFile(id, buffer)` — creates the dir recursively, writes `<uploadsDir>/<id>`.
- `readAttachmentFile(id)` — reads `<uploadsDir>/<id>`; throws (ENOENT) if missing — callers convert to 404.
- `deleteAttachmentFile(id)` — `rm(..., { force: true })`, no-op if missing.
- Files are stored with no extension since `mimeType` is recorded in the DB row.

## Migration
- Name: `20260702162510_add_attachments`.
- Applied to dev (`kanban`) via `prisma migrate dev --name add_attachments`.
- Applied to test (`kanban_test`) via `dotenv -e .env.test -- prisma migrate deploy`.
- Verified both with `prisma migrate status` (and the test-env equivalent) —
  both report "Database schema is up to date!", 6 migrations found.

## Tests
- New: `src/app/api/work-units/[id]/attachments/route.test.ts` (8 tests) and
  `src/app/api/attachments/[id]/route.test.ts` (5 tests) — 13 new tests, all
  passing against the real `kanban_test` Postgres DB and a per-suite temp
  `UPLOADS_DIR` (via `mkdtemp`, cleaned up in `afterAll`).
- Full suite: `npx dotenv -e .env.test -- vitest run --no-file-parallelism` →
  **46 files, 435 tests passing** (baseline 422 + 13 new).
- `npx tsc --noEmit` → clean, no errors.
- `npm run lint` → 0 errors (3 pre-existing warnings in unrelated files:
  `no-explicit-any` in `src/app/api/sync/route.ts` and `src/lib/sync.test.ts`,
  not touched by this task).
- `npm run knip` → clean (no unused files/exports/deps).

### Notable finding baked into the tests
The two `multipart/form-data` upload tests run with `// @vitest-environment
node` (overriding the project-wide `jsdom` default) instead of the default
environment. In jsdom, `new Request(url, { body: someFormData })` doesn't
recognize jsdom's `FormData` as the same class Node's `undici`-based
`Request` expects, so it silently stringifies the body instead of setting a
`multipart/form-data; boundary=...` `Content-Type` header — `request.formData()`
then throws `Content-Type was not one of "multipart/form-data" or
"application/x-www-form-urlencoded"`. Confirmed via an isolated repro before
fixing; the `/api/attachments/[id]` tests (no multipart bodies) don't need
the override and were left on the default `jsdom` environment.

## Concerns / follow-ups for later tasks
- **Cascade delete leaves orphan files on disk.** Deleting a `WorkUnit` (or a
  `Story`/`Project` that cascades to it) removes `Attachment` rows via the DB
  FK cascade, but nothing currently deletes the corresponding files under
  `data/uploads/`. Not in scope for Task 1 (no board/card/modal or deletion-flow
  changes were requested), but worth a cleanup job or a `beforeDelete` hook on
  `WorkUnit`/`Story` deletion later, or a periodic reconciliation script.
- `data/uploads/` is gitignored (`/data/uploads/` added to `.gitignore`); the
  directory itself is created lazily on first upload — no placeholder needed.
- No auth/ownership check on `/api/attachments/[id]` beyond existence — matches
  the rest of this app's current (single-tenant, local-first) trust model.
- Filenames aren't sanitized for storage (they're never used as a path
  component — only the DB-generated `id` is), but they are returned verbatim
  as `filename` in the DTO; Task 2 should HTML-escape/text-render them safely
  in the UI rather than trusting them as markup.
