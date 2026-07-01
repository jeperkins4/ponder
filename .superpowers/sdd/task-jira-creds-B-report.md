# Task: Per-project JIRA credentials — settings-panel UI + Test Connection (Part B)

## Status: DONE

## Files created/changed

- Modified: `src/app/projects/[projectId]/settings/page.tsx` — added the JIRA
  Connection section (Site URL, Email, API token fields + Test connection
  button/result region), wired PUT to include the new fields, gated the
  API-token PUT field on a non-empty typed value.
- Modified: `src/app/projects/[projectId]/settings/page.test.tsx` — updated
  the existing PUT-body assertion to be order-independent (parses JSON
  instead of comparing serialized strings) and added 10 new tests covering
  field rendering (JIRA vs standalone), token never-prefilled behavior, both
  API-token placeholder variants, the help link's attributes, PUT
  include/omit-token semantics, and the Test Connection button's success,
  failure, and in-flight states.
- Created: `src/app/api/projects/[projectId]/test-connection/route.ts` — new
  `POST` endpoint that loads the project, merges body-supplied credentials
  with stored ones (falling back per-field), short-circuits with
  `{ ok: false, error: "JIRA credentials are incomplete." }` (HTTP 200) when
  still incomplete, otherwise calls `testJiraConnection` and returns its
  result. Never echoes the token.
- Created: `src/app/api/projects/[projectId]/test-connection/route.test.ts` —
  5 integration tests against the real test Postgres DB (via `prisma`),
  mocking `@/lib/jira/client`'s `testJiraConnection`: project-not-found,
  incomplete-creds short circuit (asserts `testJiraConnection` not called),
  full body-supplied creds success, stored-token fallback when the body omits
  the token (asserts the merged call args), and a check that the token is
  never present in the response JSON.
- Modified: `src/lib/jira/client.ts` — added `testJiraConnection(config)` and
  a `JiraConnectionResult` type. Reuses the file's existing Basic-auth header
  construction (`Buffer.from(\`${email}:${apiToken}\`).toString("base64")`)
  and performs a single GET to `${siteUrl}/rest/api/3/myself`. Maps 401 → "HTTP
  401 — check email/API token", 404 → "HTTP 404 — check the site URL", other
  non-ok statuses → generic `HTTP {status} — {statusText}`, and network/URL
  construction errors → "Could not reach JIRA — {message}". Never throws.
- Modified: `src/lib/jira/client.test.ts` — added 6 tests for
  `testJiraConnection` (200 with/without displayName, 401, 404, other
  non-ok status, network error).

## Confirmations

- **Token never prefilled**: the API token input's `value` is always driven
  by local `jiraApiToken` state, which is initialized to `""` and never set
  from the fetched project payload (the load effect only pre-fills
  `jiraSiteUrl`/`jiraEmail`, with an inline comment noting the token is
  write-only and intentionally not pre-filled). Covered by
  `"shows and pre-fills the JIRA connection fields for JIRA projects, but
  never the API token"` in `page.test.tsx`.
- **PUT omits blank token**: `handleSubmit` only sets `body.jiraApiToken`
  when `jiraApiToken.trim() !== ""`; `name`/`jiraProjectKey`/`jiraSiteUrl`/
  `jiraEmail` are always sent. Covered by
  `"includes jiraApiToken in the PUT body only when the user typed one"`
  and `"includes jiraApiToken when the user types a new token"`.
- **test-connection falls back to stored creds when body fields are
  blank/missing**: `firstNonBlank(body.field, project.field)` in the route
  picks the first non-blank string, per field independently. Covered by the
  route test `"falls back to the stored API token when the body's token is
  blank"`, which asserts `testJiraConnection` was called with the stored
  token merged alongside body-supplied site URL/email.

## Full suite

- `npx dotenv -e .env.test -- vitest run --no-file-parallelism`:
  **267 passing** (30 test files), 0 failing. Baseline was 248; added 19
  new tests (6 in `client.test.ts`, 8 in `page.test.tsx` net — one existing
  test rewritten, not counted as new — plus 5 in the new
  `test-connection/route.test.ts`).
- `npx tsc --noEmit`: clean, no errors.

## Concerns

None. Scope was kept to the 6 files listed in the task (settings page +
test, new test-connection route + test, jira client helper + test); no
Prisma schema, sync.ts, projects CRUD routes, or board files were touched.
