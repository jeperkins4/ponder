# JIRA Work-Unit Kanban Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js kanban board that pulls JIRA stories assigned to the user, lets them break each story into small locally-managed work units organized in per-story swimlanes, and pushes status transitions plus an AI-generated completion summary comment back to JIRA as work progresses.

**Architecture:** A single Next.js (App Router, TypeScript) app with API routes as the backend and a Postgres database via Prisma, run locally via Docker so a future Heroku/Vercel deploy is just a `DATABASE_URL` change. Two server-only integrations — the JIRA REST API and the Claude API — are each wrapped in a small `lib/` client module. Backend logic (sync, breakdown generation, move/reorder, status-transition triggers, completion summary) is built and unit-tested first; the UI is layered on top last, consuming already-tested API routes.

**Tech Stack:** Next.js 14 (App Router) + TypeScript + React 18, Prisma + Postgres (via Docker locally), Tailwind CSS, @dnd-kit for drag-and-drop, @anthropic-ai/sdk, Vitest + @testing-library/react for tests.

**Spec:** `docs/superpowers/specs/2026-06-30-jira-kanban-design.md`

## Global Constraints

- Single user, local-only deployment (`npm run dev` on localhost) — no auth system beyond the JIRA/Claude API credentials in `.env`.
- All JIRA and Claude API calls happen server-side only (Next.js API routes / route handlers) — credentials are never exposed to the browser.
- Work units are local-only: never created, updated, or synced to JIRA as subtasks or any other JIRA entity.
- v1 is scoped to the `TEAM` JIRA project only, via a comma-separated `JIRA_PROJECT_KEYS` env var. The JQL-building and sync logic must already loop over the full list so adding more projects later is a config change, not a code change.
- Sync is always a manual, user-triggered action (a "Sync" button) — no background polling or cron job.
- The AI-generated completion summary always requires explicit user review/confirmation before it is posted to JIRA as a comment — it is never auto-posted.
- Credentials (`JIRA_SITE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `ANTHROPIC_API_KEY`) live only in a local, gitignored `.env`, documented via a committed `.env.example`.
- The database is Postgres (via Prisma), run locally through Docker Compose — not a SQLite file — so the only change needed for a future Heroku/Vercel deploy is `DATABASE_URL`.
- Integration failures (JIRA or Claude API errors) must never block or revert a local board action — they're caught, logged, and surfaced as a non-blocking toast.

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.js`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `.env.test`
- Create: `docker-compose.yml`
- Create: `docker/init-test-db.sh`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm test`, `npm run db:push:test` scripts that every later task relies on. The `@/*` import alias resolves to `src/*` in both the app and Vitest. `docker compose up -d` starts the local Postgres container every later task's database access depends on.

- [ ] **Step 1: Initialize the package and install dependencies**

```bash
npm init -y
npm install next react react-dom @prisma/client @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @anthropic-ai/sdk
npm install -D typescript @types/node @types/react @types/react-dom prisma tailwindcss postcss autoprefixer vitest @testing-library/react @testing-library/jest-dom jsdom dotenv-cli
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {}
module.exports = nextConfig
```

- [ ] **Step 4: Write Tailwind config**

`tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
}
export default config
```

`postcss.config.js`:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 5: Write the app shell**

`src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'JIRA Work-Unit Kanban',
  description: 'Personal kanban board for breaking down assigned JIRA stories',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

`src/app/page.tsx` (placeholder, replaced in Task 12):

```tsx
export default function Home() {
  return <main className="p-8">Board loading…</main>
}
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules
.next
.env
```

- [ ] **Step 7: Write the local Postgres Docker setup**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: kanban
      POSTGRES_PASSWORD: kanban
      POSTGRES_DB: kanban
    ports:
      - '5432:5432'
    volumes:
      - kanban-db-data:/var/lib/postgresql/data
      - ./docker/init-test-db.sh:/docker-entrypoint-initdb.d/init-test-db.sh
volumes:
  kanban-db-data:
```

`docker/init-test-db.sh` (creates the separate test database alongside the dev one on first container start):

```bash
#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE kanban_test;
EOSQL
```

```bash
chmod +x docker/init-test-db.sh
docker compose up -d
```

Expected: `docker compose ps` shows the `db` service as `running`/`healthy`.

- [ ] **Step 8: Write `.env.example` and `.env.test`**

`.env.example`:

```
# Copy this file to .env and fill in real values. Never commit .env.

# Local Postgres started via `docker compose up -d` (see docker-compose.yml).
# When deploying to Heroku/Vercel later, this is the only line that changes —
# point it at the hosted Postgres connection string instead.
DATABASE_URL="postgresql://kanban:kanban@localhost:5432/kanban"

# Atlassian site, e.g. https://yourcompany.atlassian.net
JIRA_SITE_URL=

# The email address of the Atlassian account the API token belongs to.
JIRA_EMAIL=

# Generate at https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_API_TOKEN=

# Comma-separated JIRA project keys to pull assigned stories from.
# v1 is scoped to the TEAM project only.
JIRA_PROJECT_KEYS=TEAM

# Anthropic API key, from https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=
```

`.env.test` (no secrets — safe to commit; points at the `kanban_test` database created by `docker/init-test-db.sh`):

```
DATABASE_URL="postgresql://kanban:kanban@localhost:5432/kanban_test"
```

- [ ] **Step 9: Add scripts to `package.json`**

Edit the `"scripts"` key in `package.json` to:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "db:push:test": "dotenv -e .env.test -- prisma db push --skip-generate --accept-data-loss",
  "test": "npm run db:push:test && dotenv -e .env.test -- vitest run"
}
```

- [ ] **Step 10: Write Vitest config**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    fileParallelism: false,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

`vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 11: Verify the scaffold builds**

Run: `npm run build`
Expected: build completes with "Compiled successfully" (the placeholder page is the only route).

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.js tailwind.config.ts postcss.config.js vitest.config.ts vitest.setup.ts src/app .gitignore .env.example .env.test docker-compose.yml docker/init-test-db.sh
git commit -m "$(cat <<'EOF'
chore: scaffold Next.js app with Tailwind, Vitest, and local Postgres via Docker

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Prisma Schema, Client, and Shared Types

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Create: `src/lib/types.ts`
- Test: `src/lib/prisma.test.ts`

**Interfaces:**
- Consumes: nothing beyond the scaffold from Task 1.
- Produces: `prisma` (singleton `PrismaClient`) from `@/lib/prisma`; `Column`, `COLUMNS`, `WorkUnitDTO`, `StoryDTO` types from `@/lib/types`, used by every later task.

- [ ] **Step 1: Write the Prisma schema**

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Story {
  id                         String     @id @default(cuid())
  jiraKey                    String     @unique
  jiraId                     String     @unique
  projectKey                 String
  summary                    String
  description                String?
  jiraStatus                 String
  url                        String
  lastSyncedAt               DateTime
  completionCommentPostedAt  DateTime?
  workUnits                  WorkUnit[]
}

model WorkUnit {
  id          String    @id @default(cuid())
  storyId     String
  story       Story     @relation(fields: [storyId], references: [id])
  title       String
  description String?
  column      String
  order       Int
  createdAt   DateTime  @default(now())
  completedAt DateTime?
}
```

- [ ] **Step 2: Generate the Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 3: Create your local dev database**

```bash
cp .env.example .env
docker compose up -d
npx prisma migrate dev --name init
```

Expected: the `db` container is running, a migration is created under `prisma/migrations/`, and the `kanban` Postgres database now has `Story` and `WorkUnit` tables. (The JIRA/Claude values in `.env` can stay blank for now — only `DATABASE_URL` is needed for this step.)

- [ ] **Step 4: Write the Prisma client singleton**

`src/lib/prisma.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
```

- [ ] **Step 5: Write shared DTO types**

`src/lib/types.ts`:

```ts
export type Column = 'todo' | 'in_progress' | 'done'

export const COLUMNS: Column[] = ['todo', 'in_progress', 'done']

export type WorkUnitDTO = {
  id: string
  storyId: string
  title: string
  description: string | null
  column: Column
  order: number
  createdAt: string
  completedAt: string | null
}

export type StoryDTO = {
  id: string
  jiraKey: string
  jiraId: string
  projectKey: string
  summary: string
  description: string | null
  jiraStatus: string
  url: string
  lastSyncedAt: string
  completionCommentPostedAt: string | null
  workUnits: WorkUnitDTO[]
}
```

- [ ] **Step 6: Write a failing CRUD round-trip test**

`src/lib/prisma.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from './prisma'

describe('prisma CRUD round trip', () => {
  beforeEach(async () => {
    await prisma.workUnit.deleteMany()
    await prisma.story.deleteMany()
  })

  it('creates and reads back a story with a work unit', async () => {
    const story = await prisma.story.create({
      data: {
        jiraKey: 'TEAM-1',
        jiraId: '10001',
        projectKey: 'TEAM',
        summary: 'Example story',
        jiraStatus: 'To Do',
        url: 'https://example.atlassian.net/browse/TEAM-1',
        lastSyncedAt: new Date(),
      },
    })

    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: 'First work unit',
        column: 'todo',
        order: 0,
      },
    })

    const found = await prisma.story.findUnique({
      where: { id: story.id },
      include: { workUnits: true },
    })

    expect(found?.jiraKey).toBe('TEAM-1')
    expect(found?.workUnits).toHaveLength(1)
    expect(found?.workUnits[0].title).toBe('First work unit')
  })
})
```

- [ ] **Step 7: Run the test**

Run: `npm test`
Expected: `npm run db:push:test` applies the schema to the `kanban_test` Postgres database, then the test PASSes.

- [ ] **Step 8: Commit**

```bash
git add prisma src/lib/prisma.ts src/lib/types.ts src/lib/prisma.test.ts .env.example
git commit -m "$(cat <<'EOF'
feat: add Prisma schema, client, and shared types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: JIRA Domain Helpers (JQL, Transitions, ADF)

**Files:**
- Create: `src/lib/jira/jql.ts`
- Create: `src/lib/jira/jql.test.ts`
- Create: `src/lib/jira/transitions.ts`
- Create: `src/lib/jira/transitions.test.ts`
- Create: `src/lib/jira/adf.ts`
- Create: `src/lib/jira/adf.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildAssignedStoriesJql(projectKeys: string[]): string`, `pickTransition(transitions: JiraTransition[], targetCategory: 'indeterminate' | 'done'): JiraTransition | null`, `JiraTransition` type, `adfToPlainText(doc: unknown): string` — all consumed by Task 4 onward.

- [ ] **Step 1: Write the JQL builder test**

`src/lib/jira/jql.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildAssignedStoriesJql } from './jql'

describe('buildAssignedStoriesJql', () => {
  it('builds a JQL query scoped to a single project', () => {
    expect(buildAssignedStoriesJql(['TEAM'])).toBe(
      'project IN (TEAM) AND assignee = currentUser() AND statusCategory != Done'
    )
  })

  it('expands multiple project keys', () => {
    expect(buildAssignedStoriesJql(['TEAM', 'OPS'])).toBe(
      'project IN (TEAM, OPS) AND assignee = currentUser() AND statusCategory != Done'
    )
  })

  it('throws when given no project keys', () => {
    expect(() => buildAssignedStoriesJql([])).toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- jql`
Expected: FAIL — `./jql` has no exported member `buildAssignedStoriesJql`.

- [ ] **Step 3: Implement the JQL builder**

`src/lib/jira/jql.ts`:

```ts
export function buildAssignedStoriesJql(projectKeys: string[]): string {
  if (projectKeys.length === 0) {
    throw new Error('buildAssignedStoriesJql requires at least one project key')
  }
  const keys = projectKeys.join(', ')
  return `project IN (${keys}) AND assignee = currentUser() AND statusCategory != Done`
}
```

- [ ] **Step 4: Write the transition matcher test**

`src/lib/jira/transitions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickTransition, type JiraTransition } from './transitions'

const transitions: JiraTransition[] = [
  { id: '11', name: 'To Do', to: { name: 'To Do', statusCategory: { key: 'new' } } },
  { id: '21', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
  { id: '31', name: 'Done', to: { name: 'Done', statusCategory: { key: 'done' } } },
]

describe('pickTransition', () => {
  it('picks the transition matching the target category', () => {
    expect(pickTransition(transitions, 'indeterminate')?.id).toBe('21')
    expect(pickTransition(transitions, 'done')?.id).toBe('31')
  })

  it('returns null when no transition matches', () => {
    const noneMatch = transitions.filter((t) => t.to.statusCategory.key !== 'done')
    expect(pickTransition(noneMatch, 'done')).toBeNull()
  })
})
```

- [ ] **Step 5: Implement the transition matcher**

`src/lib/jira/transitions.ts`:

```ts
export type JiraTransition = {
  id: string
  name: string
  to: {
    name: string
    statusCategory: {
      key: string
    }
  }
}

export type StatusCategory = 'indeterminate' | 'done'

export function pickTransition(
  transitions: JiraTransition[],
  targetCategory: StatusCategory
): JiraTransition | null {
  return transitions.find((t) => t.to.statusCategory.key === targetCategory) ?? null
}
```

- [ ] **Step 6: Write the ADF-to-text test**

`src/lib/jira/adf.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { adfToPlainText } from './adf'

describe('adfToPlainText', () => {
  it('returns empty string for null/undefined input', () => {
    expect(adfToPlainText(null)).toBe('')
    expect(adfToPlainText(undefined)).toBe('')
  })

  it('extracts text from paragraphs, one per line', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
      ],
    }
    expect(adfToPlainText(doc)).toBe('First paragraph.\nSecond paragraph.')
  })
})
```

- [ ] **Step 7: Implement the ADF-to-text converter**

`src/lib/jira/adf.ts`:

```ts
type AdfNode = {
  type: string
  text?: string
  content?: AdfNode[]
}

export function adfToPlainText(doc: AdfNode | null | undefined): string {
  if (!doc) return ''

  const buffer: string[] = []

  function walk(node: AdfNode) {
    if (node.type === 'text' && node.text) {
      buffer.push(node.text)
    }
    if (node.content) {
      for (const child of node.content) {
        walk(child)
      }
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      buffer.push('\n')
    }
  }

  walk(doc)
  return buffer.join('').trim()
}
```

- [ ] **Step 8: Run all three test files**

Run: `npm test -- jira`
Expected: PASS (8 tests across jql, transitions, adf).

- [ ] **Step 9: Commit**

```bash
git add src/lib/jira/jql.ts src/lib/jira/jql.test.ts src/lib/jira/transitions.ts src/lib/jira/transitions.test.ts src/lib/jira/adf.ts src/lib/jira/adf.test.ts
git commit -m "$(cat <<'EOF'
feat: add JIRA JQL builder, transition matcher, and ADF converter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: JIRA API Client

**Files:**
- Create: `src/lib/jira/client.ts`
- Test: `src/lib/jira/client.test.ts`

**Interfaces:**
- Consumes: `JiraTransition` type from `@/lib/jira/transitions` (Task 3).
- Produces: `getAssignedStories(jql: string): Promise<JiraIssue[]>`, `getIssueTransitions(jiraId: string): Promise<JiraTransition[]>`, `applyTransition(jiraId: string, transitionId: string): Promise<void>`, `postComment(jiraId: string, body: string): Promise<void>`, `JiraIssue` type — consumed by Task 5 (sync) and Task 10 (status sync) and Task 11 (post-comment route).

- [ ] **Step 1: Write the failing tests**

`src/lib/jira/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.JIRA_SITE_URL = 'https://example.atlassian.net'
  process.env.JIRA_EMAIL = 'me@example.com'
  process.env.JIRA_API_TOKEN = 'token123'
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe('getAssignedStories', () => {
  it('posts the JQL to the search endpoint and returns issues', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issues: [{ id: '1', key: 'TEAM-1', fields: { summary: 'x', description: null, status: { name: 'To Do' } } }],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { getAssignedStories } = await import('./client')
    const issues = await getAssignedStories('project IN (TEAM)')

    expect(issues).toHaveLength(1)
    expect(issues[0].key).toBe('TEAM-1')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/search',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws when JIRA responds with a non-2xx status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' })
    vi.stubGlobal('fetch', mockFetch)

    const { getAssignedStories } = await import('./client')
    await expect(getAssignedStories('project IN (TEAM)')).rejects.toThrow('JIRA API error 401')
  })
})

describe('getIssueTransitions', () => {
  it('fetches transitions for an issue', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transitions: [{ id: '21', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { getIssueTransitions } = await import('./client')
    const transitions = await getIssueTransitions('10001')

    expect(transitions).toHaveLength(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/10001/transitions',
      expect.anything()
    )
  })
})

describe('applyTransition and postComment', () => {
  it('posts the transition id to apply a transition', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', mockFetch)

    const { applyTransition } = await import('./client')
    await applyTransition('10001', '21')

    const [, init] = mockFetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ transition: { id: '21' } })
  })

  it('posts an ADF-wrapped comment body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', mockFetch)

    const { postComment } = await import('./client')
    await postComment('10001', 'Finished the work.')

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.body.content[0].content[0].text).toBe('Finished the work.')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- jira/client`
Expected: FAIL — `./client` module does not exist.

- [ ] **Step 3: Implement the client**

`src/lib/jira/client.ts`:

```ts
import type { JiraTransition } from './transitions'

function authHeader(): string {
  const token = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')
  return `Basic ${token}`
}

async function jiraFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${process.env.JIRA_SITE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`JIRA API error ${res.status}: ${body}`)
  }
  return res
}

export type JiraIssue = {
  id: string
  key: string
  fields: {
    summary: string
    description: unknown
    status: { name: string }
  }
}

export async function getAssignedStories(jql: string): Promise<JiraIssue[]> {
  const res = await jiraFetch('/rest/api/3/search', {
    method: 'POST',
    body: JSON.stringify({
      jql,
      fields: ['summary', 'description', 'status'],
      maxResults: 100,
    }),
  })
  const data = await res.json()
  return data.issues as JiraIssue[]
}

export async function getIssueTransitions(jiraId: string): Promise<JiraTransition[]> {
  const res = await jiraFetch(`/rest/api/3/issue/${jiraId}/transitions`)
  const data = await res.json()
  return data.transitions as JiraTransition[]
}

export async function applyTransition(jiraId: string, transitionId: string): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${jiraId}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  })
}

export async function postComment(jiraId: string, body: string): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${jiraId}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
      },
    }),
  })
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- jira/client`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jira/client.ts src/lib/jira/client.test.ts
git commit -m "$(cat <<'EOF'
feat: add JIRA API client for search, transitions, and comments

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Sync Orchestration and Routes

**Files:**
- Create: `src/lib/sync.ts`
- Test: `src/lib/sync.test.ts`
- Create: `src/app/api/sync/route.ts`
- Test: `src/app/api/sync/route.test.ts`
- Create: `src/app/api/stories/route.ts`
- Test: `src/app/api/stories/route.test.ts`

**Interfaces:**
- Consumes: `buildAssignedStoriesJql` (Task 3), `adfToPlainText` (Task 3), `getAssignedStories`, `JiraIssue` (Task 4), `prisma` (Task 2).
- Produces: `syncStories(): Promise<{ syncedCount: number }>`, `mapIssueToStoryData(issue: JiraIssue)` — consumed only within this task's route. `POST /api/sync` and `GET /api/stories` HTTP endpoints consumed by the Board UI (Task 12).

- [ ] **Step 1: Write the failing sync tests**

`src/lib/sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from './prisma'

vi.mock('./jira/client', () => ({
  getAssignedStories: vi.fn(),
}))

import { getAssignedStories } from './jira/client'
import { mapIssueToStoryData, syncStories } from './sync'

beforeEach(async () => {
  await prisma.workUnit.deleteMany()
  await prisma.story.deleteMany()
  process.env.JIRA_PROJECT_KEYS = 'TEAM'
  process.env.JIRA_SITE_URL = 'https://example.atlassian.net'
  vi.mocked(getAssignedStories).mockReset()
})

describe('mapIssueToStoryData', () => {
  it('derives projectKey from the issue key and converts ADF description to text', () => {
    const data = mapIssueToStoryData({
      id: '10001',
      key: 'TEAM-42',
      fields: {
        summary: 'Do the thing',
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Details here.' }] }] },
        status: { name: 'To Do' },
      },
    })

    expect(data.projectKey).toBe('TEAM')
    expect(data.jiraKey).toBe('TEAM-42')
    expect(data.description).toBe('Details here.')
    expect(data.url).toBe('https://example.atlassian.net/browse/TEAM-42')
  })
})

describe('syncStories', () => {
  it('creates new stories', async () => {
    vi.mocked(getAssignedStories).mockResolvedValue([
      { id: '10001', key: 'TEAM-1', fields: { summary: 'Story one', description: null, status: { name: 'To Do' } } },
    ])

    const result = await syncStories()
    expect(result.syncedCount).toBe(1)

    const stored = await prisma.story.findUnique({ where: { jiraKey: 'TEAM-1' } })
    expect(stored?.summary).toBe('Story one')
  })

  it('updates summary on re-sync without deleting existing work units', async () => {
    const story = await prisma.story.create({
      data: {
        jiraKey: 'TEAM-1',
        jiraId: '10001',
        projectKey: 'TEAM',
        summary: 'Old summary',
        jiraStatus: 'To Do',
        url: 'https://example.atlassian.net/browse/TEAM-1',
        lastSyncedAt: new Date(),
      },
    })
    await prisma.workUnit.create({
      data: { storyId: story.id, title: 'Existing unit', column: 'todo', order: 0 },
    })

    vi.mocked(getAssignedStories).mockResolvedValue([
      { id: '10001', key: 'TEAM-1', fields: { summary: 'New summary', description: null, status: { name: 'In Progress' } } },
    ])

    await syncStories()

    const updated = await prisma.story.findUnique({
      where: { jiraKey: 'TEAM-1' },
      include: { workUnits: true },
    })
    expect(updated?.summary).toBe('New summary')
    expect(updated?.workUnits).toHaveLength(1)
    expect(updated?.workUnits[0].title).toBe('Existing unit')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- sync`
Expected: FAIL — `./sync` module does not exist.

- [ ] **Step 3: Implement sync orchestration**

`src/lib/sync.ts`:

```ts
import { prisma } from './prisma'
import { buildAssignedStoriesJql } from './jira/jql'
import { adfToPlainText } from './jira/adf'
import { getAssignedStories, type JiraIssue } from './jira/client'

export function mapIssueToStoryData(issue: JiraIssue) {
  const projectKey = issue.key.split('-')[0]
  return {
    jiraKey: issue.key,
    jiraId: issue.id,
    projectKey,
    summary: issue.fields.summary,
    description: adfToPlainText(issue.fields.description as Parameters<typeof adfToPlainText>[0]),
    jiraStatus: issue.fields.status.name,
    url: `${process.env.JIRA_SITE_URL}/browse/${issue.key}`,
    lastSyncedAt: new Date(),
  }
}

export async function syncStories(): Promise<{ syncedCount: number }> {
  const projectKeys = (process.env.JIRA_PROJECT_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const jql = buildAssignedStoriesJql(projectKeys)
  const issues = await getAssignedStories(jql)

  for (const issue of issues) {
    const data = mapIssueToStoryData(issue)
    await prisma.story.upsert({
      where: { jiraKey: data.jiraKey },
      create: data,
      update: {
        summary: data.summary,
        description: data.description,
        jiraStatus: data.jiraStatus,
        url: data.url,
        lastSyncedAt: data.lastSyncedAt,
      },
    })
  }

  return { syncedCount: issues.length }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- sync`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the route tests**

`src/app/api/sync/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sync', () => ({ syncStories: vi.fn() }))

import { syncStories } from '@/lib/sync'
import { POST } from './route'

beforeEach(() => {
  vi.mocked(syncStories).mockReset()
})

describe('POST /api/sync', () => {
  it('returns the sync result as JSON', async () => {
    vi.mocked(syncStories).mockResolvedValue({ syncedCount: 3 })
    const res = await POST()
    const data = await res.json()
    expect(data).toEqual({ syncedCount: 3 })
  })

  it('returns a 502 with an error message when sync throws', async () => {
    vi.mocked(syncStories).mockRejectedValue(new Error('boom'))
    const res = await POST()
    expect(res.status).toBe(502)
  })
})
```

`src/app/api/stories/route.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { story: { findMany: vi.fn().mockResolvedValue([{ id: '1', jiraKey: 'TEAM-1' }]) } },
}))

import { GET } from './route'

describe('GET /api/stories', () => {
  it('returns stories from prisma', async () => {
    const res = await GET()
    const data = await res.json()
    expect(data).toEqual([{ id: '1', jiraKey: 'TEAM-1' }])
  })
})
```

- [ ] **Step 6: Run it to verify the routes fail**

Run: `npm test -- api`
Expected: FAIL — route modules don't exist yet.

- [ ] **Step 7: Implement the routes**

`src/app/api/sync/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { syncStories } from '@/lib/sync'

export async function POST() {
  try {
    const result = await syncStories()
    return NextResponse.json(result)
  } catch (err) {
    console.error('Sync failed', err)
    return NextResponse.json({ error: 'Sync failed. Check server logs.' }, { status: 502 })
  }
}
```

`src/app/api/stories/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const stories = await prisma.story.findMany({
    include: { workUnits: { orderBy: { order: 'asc' } } },
    orderBy: { lastSyncedAt: 'desc' },
  })
  return NextResponse.json(stories)
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- api`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/sync.ts src/lib/sync.test.ts src/app/api/sync src/app/api/stories
git commit -m "$(cat <<'EOF'
feat: add JIRA sync orchestration and sync/stories API routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Claude Breakdown Generation

**Files:**
- Create: `src/lib/claude/client.ts`
- Create: `src/lib/claude/json.ts`
- Test: `src/lib/claude/json.test.ts`
- Create: `src/lib/claude/breakdown.ts`
- Test: `src/lib/claude/breakdown.test.ts`
- Create: `src/app/api/stories/[id]/breakdown/route.ts`
- Test: `src/app/api/stories/[id]/breakdown/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2).
- Produces: `generateBreakdown(summary: string, description: string): Promise<BreakdownSuggestion[]>` where `BreakdownSuggestion = { title: string; description: string }`. `POST /api/stories/[id]/breakdown` consumed by Task 12 (BreakdownDialog).

- [ ] **Step 1: Write the Claude client**

`src/lib/claude/client.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'

export const CLAUDE_MODEL = 'claude-sonnet-5'

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
```

- [ ] **Step 2: Write the failing JSON-extraction test**

`src/lib/claude/json.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractJson } from './json'

describe('extractJson', () => {
  it('returns raw text unchanged when there is no code fence', () => {
    expect(extractJson('[{"title":"a"}]')).toBe('[{"title":"a"}]')
  })

  it('strips a ```json code fence', () => {
    expect(extractJson('```json\n[{"title":"a"}]\n```')).toBe('[{"title":"a"}]')
  })
})
```

- [ ] **Step 3: Run it to verify it fails, then implement**

Run: `npm test -- claude/json` — Expected: FAIL.

`src/lib/claude/json.ts`:

```ts
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return fenced ? fenced[1] : text.trim()
}
```

Run: `npm test -- claude/json` — Expected: PASS.

- [ ] **Step 4: Write the failing breakdown test**

`src/lib/claude/breakdown.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: 'claude-sonnet-5',
}))

import { anthropic } from './client'
import { generateBreakdown } from './breakdown'

beforeEach(() => {
  vi.mocked(anthropic.messages.create).mockReset()
})

describe('generateBreakdown', () => {
  it('parses a JSON array of suggestions from the response text', async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue({
      content: [{ type: 'text', text: '[{"title":"Write tests","description":"Cover the happy path"}]' }],
    } as any)

    const suggestions = await generateBreakdown('Add login', 'Users need to log in')

    expect(suggestions).toEqual([{ title: 'Write tests', description: 'Cover the happy path' }])
  })

  it('strips a markdown code fence before parsing', async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue({
      content: [{ type: 'text', text: '```json\n[{"title":"Write tests","description":"x"}]\n```' }],
    } as any)

    const suggestions = await generateBreakdown('Add login', 'Users need to log in')
    expect(suggestions[0].title).toBe('Write tests')
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm test -- claude/breakdown`
Expected: FAIL — `./breakdown` module does not exist.

- [ ] **Step 6: Implement breakdown generation**

`src/lib/claude/breakdown.ts`:

```ts
import { anthropic, CLAUDE_MODEL } from './client'
import { extractJson } from './json'

export type BreakdownSuggestion = { title: string; description: string }

function textFromMessage(message: Awaited<ReturnType<typeof anthropic.messages.create>>): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => ('text' in block ? block.text : ''))
    .join('')
}

export async function generateBreakdown(summary: string, description: string): Promise<BreakdownSuggestion[]> {
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Break the following JIRA story into 3-7 small, concrete work units a developer could complete in under a day each. Respond with ONLY a JSON array of objects with "title" and "description" fields, no other text.\n\nStory summary: ${summary}\n\nStory description: ${description}`,
      },
    ],
  })

  return JSON.parse(extractJson(textFromMessage(message))) as BreakdownSuggestion[]
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- claude/breakdown`
Expected: PASS (2 tests).

- [ ] **Step 8: Write the failing route test**

`src/app/api/stories/[id]/breakdown/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { story: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/claude/breakdown', () => ({ generateBreakdown: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { generateBreakdown } from '@/lib/claude/breakdown'
import { POST } from './route'

beforeEach(() => {
  vi.mocked(prisma.story.findUnique).mockReset()
  vi.mocked(generateBreakdown).mockReset()
})

describe('POST /api/stories/[id]/breakdown', () => {
  it('returns 404 when the story does not exist', async () => {
    vi.mocked(prisma.story.findUnique).mockResolvedValue(null)
    const res = await POST(new Request('http://localhost'), { params: { id: 'missing' } })
    expect(res.status).toBe(404)
  })

  it('returns suggestions generated from the story summary and description', async () => {
    vi.mocked(prisma.story.findUnique).mockResolvedValue({ id: 's1', summary: 'Do X', description: 'Details' } as any)
    vi.mocked(generateBreakdown).mockResolvedValue([{ title: 'Step 1', description: 'd' }])

    const res = await POST(new Request('http://localhost'), { params: { id: 's1' } })
    const data = await res.json()

    expect(data.suggestions).toEqual([{ title: 'Step 1', description: 'd' }])
    expect(generateBreakdown).toHaveBeenCalledWith('Do X', 'Details')
  })

  it('returns 502 when generation fails', async () => {
    vi.mocked(prisma.story.findUnique).mockResolvedValue({ id: 's1', summary: 'Do X', description: null } as any)
    vi.mocked(generateBreakdown).mockRejectedValue(new Error('boom'))

    const res = await POST(new Request('http://localhost'), { params: { id: 's1' } })
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 9: Run it to verify it fails, then implement the route**

Run: `npm test -- breakdown/route` — Expected: FAIL.

`src/app/api/stories/[id]/breakdown/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateBreakdown } from '@/lib/claude/breakdown'

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const story = await prisma.story.findUnique({ where: { id: params.id } })
  if (!story) {
    return NextResponse.json({ error: 'Story not found' }, { status: 404 })
  }

  try {
    const suggestions = await generateBreakdown(story.summary, story.description ?? '')
    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('Breakdown generation failed', err)
    return NextResponse.json(
      { error: 'Could not generate a breakdown. Try again or add work units manually.' },
      { status: 502 }
    )
  }
}
```

- [ ] **Step 10: Run the tests**

Run: `npm test -- breakdown`
Expected: PASS (5 tests).

- [ ] **Step 11: Commit**

```bash
git add src/lib/claude src/app/api/stories/\[id\]/breakdown
git commit -m "$(cat <<'EOF'
feat: add Claude-powered story breakdown generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Work-Unit Creation from an Accepted Breakdown

**Files:**
- Create: `src/lib/workUnits.ts`
- Test: `src/lib/workUnits.test.ts`
- Create: `src/app/api/work-units/route.ts`
- Test: `src/app/api/work-units/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2).
- Produces: `createWorkUnits(storyId: string, units: { title: string; description?: string }[])`. `POST /api/work-units` consumed by Task 12 (BreakdownDialog accept flow).

- [ ] **Step 1: Write the failing test**

`src/lib/workUnits.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from './prisma'
import { createWorkUnits } from './workUnits'

beforeEach(async () => {
  await prisma.workUnit.deleteMany()
  await prisma.story.deleteMany()
})

async function createStory() {
  return prisma.story.create({
    data: {
      jiraKey: 'TEAM-1',
      jiraId: '10001',
      projectKey: 'TEAM',
      summary: 'Story',
      jiraStatus: 'To Do',
      url: 'https://example.atlassian.net/browse/TEAM-1',
      lastSyncedAt: new Date(),
    },
  })
}

describe('createWorkUnits', () => {
  it('creates work units in the todo column with sequential order', async () => {
    const story = await createStory()

    const created = await createWorkUnits(story.id, [{ title: 'First' }, { title: 'Second', description: 'd' }])

    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ title: 'First', column: 'todo', order: 0 })
    expect(created[1]).toMatchObject({ title: 'Second', description: 'd', column: 'todo', order: 1 })
  })

  it('appends after any existing todo units rather than overwriting their order', async () => {
    const story = await createStory()
    await prisma.workUnit.create({ data: { storyId: story.id, title: 'Existing', column: 'todo', order: 0 } })

    const created = await createWorkUnits(story.id, [{ title: 'New' }])

    expect(created[0].order).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- workUnits`
Expected: FAIL — `./workUnits` module does not exist.

- [ ] **Step 3: Implement `createWorkUnits`**

`src/lib/workUnits.ts`:

```ts
import { prisma } from './prisma'

export async function createWorkUnits(storyId: string, units: { title: string; description?: string }[]) {
  const existingCount = await prisma.workUnit.count({ where: { storyId, column: 'todo' } })

  return prisma.$transaction(
    units.map((unit, index) =>
      prisma.workUnit.create({
        data: {
          storyId,
          title: unit.title,
          description: unit.description ?? null,
          column: 'todo',
          order: existingCount + index,
        },
      })
    )
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- workUnits`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing route test**

`src/app/api/work-units/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/workUnits', () => ({ createWorkUnits: vi.fn() }))

import { createWorkUnits } from '@/lib/workUnits'
import { POST } from './route'

beforeEach(() => {
  vi.mocked(createWorkUnits).mockReset()
})

describe('POST /api/work-units', () => {
  it('creates work units for a story', async () => {
    vi.mocked(createWorkUnits).mockResolvedValue([{ id: 'w1' }] as any)

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ storyId: 's1', units: [{ title: 'A' }] }),
      })
    )
    const data = await res.json()

    expect(data.workUnits).toEqual([{ id: 'w1' }])
    expect(createWorkUnits).toHaveBeenCalledWith('s1', [{ title: 'A' }])
  })

  it('returns 400 when units is missing or empty', async () => {
    const res = await POST(
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({ storyId: 's1', units: [] }) })
    )
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 6: Run it to verify it fails, then implement the route**

Run: `npm test -- work-units/route` — Expected: FAIL.

`src/app/api/work-units/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createWorkUnits } from '@/lib/workUnits'

export async function POST(request: Request) {
  const body = await request.json()
  const { storyId, units } = body as { storyId: string; units: { title: string; description?: string }[] }

  if (!storyId || !Array.isArray(units) || units.length === 0) {
    return NextResponse.json({ error: 'storyId and a non-empty units array are required' }, { status: 400 })
  }

  const created = await createWorkUnits(storyId, units)
  return NextResponse.json({ workUnits: created })
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- work-units`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/workUnits.ts src/lib/workUnits.test.ts src/app/api/work-units/route.ts src/app/api/work-units/route.test.ts
git commit -m "$(cat <<'EOF'
feat: create work units from an accepted breakdown

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Work-Unit Move/Reorder

**Files:**
- Modify: `src/lib/workUnits.ts` (add `reorderWorkUnits`, `moveWorkUnit`)
- Modify: `src/lib/workUnits.test.ts` (add new `describe` blocks)
- Create: `src/app/api/work-units/[id]/route.ts`
- Test: `src/app/api/work-units/[id]/route.test.ts`

**Interfaces:**
- Consumes: `prisma`, `Column` type (Task 2).
- Produces: `reorderWorkUnits(units: WorkUnitPosition[], movedId: string, newColumn: Column, newIndex: number): WorkUnitPosition[]` (pure), `moveWorkUnit(workUnitId: string, newColumn: Column, newIndex: number): Promise<{ previousColumn: Column; storyId: string; workUnits: WorkUnit[] }>`. `PATCH /api/work-units/[id]` consumed by Task 13 (drag-and-drop) and extended by Task 10.

- [ ] **Step 1: Write the failing `reorderWorkUnits` tests**

Add to `src/lib/workUnits.test.ts`:

```ts
import { reorderWorkUnits, moveWorkUnit } from './workUnits'

const positions = [
  { id: 'a', column: 'todo' as const, order: 0 },
  { id: 'b', column: 'todo' as const, order: 1 },
  { id: 'c', column: 'in_progress' as const, order: 0 },
]

describe('reorderWorkUnits', () => {
  it('moves a unit to a different column at the given index', () => {
    const result = reorderWorkUnits(positions, 'b', 'in_progress', 0)

    expect(result.find((u) => u.id === 'b')).toMatchObject({ column: 'in_progress', order: 0 })
    expect(result.find((u) => u.id === 'c')).toMatchObject({ column: 'in_progress', order: 1 })
    expect(result.find((u) => u.id === 'a')).toMatchObject({ column: 'todo', order: 0 })
  })

  it('reindexes the old column after the unit leaves it', () => {
    const threeInTodo = [
      { id: 'a', column: 'todo' as const, order: 0 },
      { id: 'b', column: 'todo' as const, order: 1 },
      { id: 'c', column: 'todo' as const, order: 2 },
    ]
    const result = reorderWorkUnits(threeInTodo, 'b', 'done', 0)
    expect(result.find((u) => u.id === 'a')).toMatchObject({ order: 0 })
    expect(result.find((u) => u.id === 'c')).toMatchObject({ order: 1 })
  })

  it('reorders within the same column without changing column', () => {
    const threeInTodo = [
      { id: 'a', column: 'todo' as const, order: 0 },
      { id: 'b', column: 'todo' as const, order: 1 },
      { id: 'c', column: 'todo' as const, order: 2 },
    ]
    const result = reorderWorkUnits(threeInTodo, 'c', 'todo', 0)
    expect(result.find((u) => u.id === 'c')).toMatchObject({ column: 'todo', order: 0 })
    expect(result.find((u) => u.id === 'a')).toMatchObject({ order: 1 })
    expect(result.find((u) => u.id === 'b')).toMatchObject({ order: 2 })
  })

  it('throws when the moved id is not present', () => {
    expect(() => reorderWorkUnits(positions, 'missing', 'todo', 0)).toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- workUnits`
Expected: FAIL — `reorderWorkUnits` is not exported.

- [ ] **Step 3: Implement `reorderWorkUnits`**

Add to `src/lib/workUnits.ts`:

```ts
import type { Column } from './types'

export type WorkUnitPosition = { id: string; column: Column; order: number }

export function reorderWorkUnits(
  units: WorkUnitPosition[],
  movedId: string,
  newColumn: Column,
  newIndex: number
): WorkUnitPosition[] {
  const moved = units.find((u) => u.id === movedId)
  if (!moved) throw new Error(`Work unit ${movedId} not found`)

  const byColumn = (column: Column, excludeId?: string) =>
    units.filter((u) => u.column === column && u.id !== excludeId).sort((a, b) => a.order - b.order)

  const result: WorkUnitPosition[] = []

  if (moved.column === newColumn) {
    const siblings = byColumn(newColumn, movedId)
    const clamped = Math.max(0, Math.min(newIndex, siblings.length))
    siblings.splice(clamped, 0, moved)
    siblings.forEach((u, index) => result.push({ ...u, column: newColumn, order: index }))
  } else {
    const oldSiblings = byColumn(moved.column, movedId)
    oldSiblings.forEach((u, index) => result.push({ ...u, order: index }))

    const newSiblings = byColumn(newColumn)
    const clamped = Math.max(0, Math.min(newIndex, newSiblings.length))
    newSiblings.splice(clamped, 0, moved)
    newSiblings.forEach((u, index) => result.push({ ...u, column: newColumn, order: index }))
  }

  const untouchedColumns = (['todo', 'in_progress', 'done'] as Column[]).filter(
    (c) => c !== moved.column && c !== newColumn
  )
  for (const column of untouchedColumns) {
    result.push(...byColumn(column))
  }

  return result
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- workUnits`
Expected: PASS.

- [ ] **Step 5: Write the failing `moveWorkUnit` test**

Add to `src/lib/workUnits.test.ts`:

```ts
describe('moveWorkUnit', () => {
  it('persists the new column/order and sets completedAt when the moved unit enters done', async () => {
    const story = await createStory()
    const a = await prisma.workUnit.create({ data: { storyId: story.id, title: 'A', column: 'todo', order: 0 } })
    await prisma.workUnit.create({ data: { storyId: story.id, title: 'B', column: 'todo', order: 1 } })

    const result = await moveWorkUnit(a.id, 'done', 0)

    expect(result.previousColumn).toBe('todo')
    const moved = result.workUnits.find((u) => u.id === a.id)
    expect(moved?.column).toBe('done')
    expect(moved?.completedAt).not.toBeNull()
  })

  it('clears completedAt when the moved unit leaves done', async () => {
    const story = await createStory()
    const a = await prisma.workUnit.create({
      data: { storyId: story.id, title: 'A', column: 'done', order: 0, completedAt: new Date() },
    })

    const result = await moveWorkUnit(a.id, 'in_progress', 0)

    const moved = result.workUnits.find((u) => u.id === a.id)
    expect(moved?.completedAt).toBeNull()
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- workUnits`
Expected: FAIL — `moveWorkUnit` is not exported.

- [ ] **Step 7: Implement `moveWorkUnit`**

Add to `src/lib/workUnits.ts`:

```ts
export async function moveWorkUnit(workUnitId: string, newColumn: Column, newIndex: number) {
  const target = await prisma.workUnit.findUniqueOrThrow({ where: { id: workUnitId } })
  const siblings = await prisma.workUnit.findMany({ where: { storyId: target.storyId } })

  const previousColumn = target.column as Column
  const positions: WorkUnitPosition[] = siblings.map((u) => ({ id: u.id, column: u.column as Column, order: u.order }))
  const reordered = reorderWorkUnits(positions, workUnitId, newColumn, newIndex)

  const now = new Date()
  await prisma.$transaction(
    reordered.map((u) =>
      prisma.workUnit.update({
        where: { id: u.id },
        data: {
          column: u.column,
          order: u.order,
          ...(u.id === workUnitId ? { completedAt: u.column === 'done' ? now : null } : {}),
        },
      })
    )
  )

  const updatedWorkUnits = await prisma.workUnit.findMany({
    where: { storyId: target.storyId },
    orderBy: { order: 'asc' },
  })

  return { previousColumn, storyId: target.storyId, workUnits: updatedWorkUnits }
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- workUnits`
Expected: PASS.

- [ ] **Step 9: Write the failing route test**

`src/app/api/work-units/[id]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/workUnits', () => ({ moveWorkUnit: vi.fn() }))

import { moveWorkUnit } from '@/lib/workUnits'
import { PATCH } from './route'

beforeEach(() => {
  vi.mocked(moveWorkUnit).mockReset()
})

describe('PATCH /api/work-units/[id]', () => {
  it('moves the work unit and returns the updated list', async () => {
    vi.mocked(moveWorkUnit).mockResolvedValue({
      previousColumn: 'todo',
      storyId: 's1',
      workUnits: [{ id: 'w1', column: 'in_progress' }],
    } as any)

    const res = await PATCH(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ column: 'in_progress', index: 0 }) }),
      { params: { id: 'w1' } }
    )
    const data = await res.json()

    expect(moveWorkUnit).toHaveBeenCalledWith('w1', 'in_progress', 0)
    expect(data.workUnits).toEqual([{ id: 'w1', column: 'in_progress' }])
  })

  it('returns 500 when the move fails', async () => {
    vi.mocked(moveWorkUnit).mockRejectedValue(new Error('boom'))
    const res = await PATCH(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ column: 'todo', index: 0 }) }),
      { params: { id: 'w1' } }
    )
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 10: Run it to verify it fails, then implement the route**

Run: `npm test -- work-units/\[id\]` — Expected: FAIL.

`src/app/api/work-units/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { moveWorkUnit } from '@/lib/workUnits'
import type { Column } from '@/lib/types'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json()
  const { column, index } = body as { column: Column; index: number }

  try {
    const result = await moveWorkUnit(params.id, column, index)
    return NextResponse.json({ workUnits: result.workUnits, storyId: result.storyId })
  } catch (err) {
    console.error('Move work unit failed', err)
    return NextResponse.json({ error: 'Could not move work unit' }, { status: 500 })
  }
}
```

- [ ] **Step 11: Run the tests**

Run: `npm test -- work-units`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/lib/workUnits.ts src/lib/workUnits.test.ts src/app/api/work-units/\[id\]
git commit -m "$(cat <<'EOF'
feat: add work-unit move/reorder logic and PATCH route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Status Trigger Logic (Pure)

**Files:**
- Create: `src/lib/statusSync.ts`
- Test: `src/lib/statusSync.test.ts`

**Interfaces:**
- Consumes: `Column` type (Task 2).
- Produces: `evaluateStatusTriggers(workUnitsAfterUpdate: { id: string; column: Column }[], movedWorkUnitId: string, previousColumn: Column): { firstUnitStarted: boolean; allUnitsDone: boolean; shouldResetCompletionComment: boolean }` — consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

`src/lib/statusSync.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evaluateStatusTriggers } from './statusSync'

describe('evaluateStatusTriggers', () => {
  it('flags firstUnitStarted when the moved unit leaves todo and all siblings are still todo', () => {
    const units = [
      { id: 'a', column: 'in_progress' as const },
      { id: 'b', column: 'todo' as const },
    ]
    expect(evaluateStatusTriggers(units, 'a', 'todo').firstUnitStarted).toBe(true)
  })

  it('does not flag firstUnitStarted when another unit was already started', () => {
    const units = [
      { id: 'a', column: 'in_progress' as const },
      { id: 'b', column: 'done' as const },
    ]
    expect(evaluateStatusTriggers(units, 'a', 'todo').firstUnitStarted).toBe(false)
  })

  it('flags allUnitsDone only when every unit is done', () => {
    const allDone = [
      { id: 'a', column: 'done' as const },
      { id: 'b', column: 'done' as const },
    ]
    expect(evaluateStatusTriggers(allDone, 'b', 'in_progress').allUnitsDone).toBe(true)

    const notAllDone = [
      { id: 'a', column: 'done' as const },
      { id: 'b', column: 'in_progress' as const },
    ]
    expect(evaluateStatusTriggers(notAllDone, 'b', 'todo').allUnitsDone).toBe(false)
  })

  it('flags shouldResetCompletionComment when the moved unit leaves done', () => {
    const units = [{ id: 'a', column: 'in_progress' as const }]
    expect(evaluateStatusTriggers(units, 'a', 'done').shouldResetCompletionComment).toBe(true)
  })

  it('does not flag shouldResetCompletionComment when the unit was not previously done', () => {
    const units = [{ id: 'a', column: 'in_progress' as const }]
    expect(evaluateStatusTriggers(units, 'a', 'todo').shouldResetCompletionComment).toBe(false)
  })

  it('throws when the moved id is not present', () => {
    expect(() => evaluateStatusTriggers([{ id: 'a', column: 'todo' as const }], 'missing', 'todo')).toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- statusSync`
Expected: FAIL — `./statusSync` module does not exist.

- [ ] **Step 3: Implement `evaluateStatusTriggers`**

`src/lib/statusSync.ts`:

```ts
import type { Column } from './types'

export type StatusTriggers = {
  firstUnitStarted: boolean
  allUnitsDone: boolean
  shouldResetCompletionComment: boolean
}

export function evaluateStatusTriggers(
  workUnitsAfterUpdate: { id: string; column: Column }[],
  movedWorkUnitId: string,
  previousColumn: Column
): StatusTriggers {
  const moved = workUnitsAfterUpdate.find((u) => u.id === movedWorkUnitId)
  if (!moved) throw new Error(`Work unit ${movedWorkUnitId} not found`)

  const others = workUnitsAfterUpdate.filter((u) => u.id !== movedWorkUnitId)

  const firstUnitStarted = moved.column !== 'todo' && others.every((u) => u.column === 'todo')
  const allUnitsDone = workUnitsAfterUpdate.every((u) => u.column === 'done')
  const shouldResetCompletionComment = previousColumn === 'done' && moved.column !== 'done'

  return { firstUnitStarted, allUnitsDone, shouldResetCompletionComment }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- statusSync`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/statusSync.ts src/lib/statusSync.test.ts
git commit -m "$(cat <<'EOF'
feat: add pure status-transition trigger logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire JIRA Transitions into the Move Route

**Files:**
- Modify: `src/lib/statusSync.ts` (add `applyStatusSync`)
- Modify: `src/lib/statusSync.test.ts` (add `describe('applyStatusSync', ...)`)
- Modify: `src/app/api/work-units/[id]/route.ts`
- Modify: `src/app/api/work-units/[id]/route.test.ts`

**Interfaces:**
- Consumes: `evaluateStatusTriggers` (this file, Task 9), `prisma` (Task 2), `getIssueTransitions`, `applyTransition` (Task 4), `pickTransition` (Task 3).
- Produces: `applyStatusSync(storyId: string, workUnitsAfterUpdate: { id: string; column: Column }[], movedWorkUnitId: string, previousColumn: Column): Promise<{ allUnitsDone: boolean; warnings: string[] }>` — consumed by the PATCH route here and by Task 14's UI (via the route's response shape).

- [ ] **Step 1: Write the failing `applyStatusSync` tests**

Add to `src/lib/statusSync.test.ts`:

```ts
vi.mock('./jira/client', () => ({
  getIssueTransitions: vi.fn(),
  applyTransition: vi.fn(),
}))

import { vi, beforeEach } from 'vitest'
import { getIssueTransitions, applyTransition } from './jira/client'
import { prisma } from './prisma'
import { applyStatusSync } from './statusSync'

async function createStory(overrides: Partial<Parameters<typeof prisma.story.create>[0]['data']> = {}) {
  return prisma.story.create({
    data: {
      jiraKey: 'TEAM-1',
      jiraId: '10001',
      projectKey: 'TEAM',
      summary: 's',
      jiraStatus: 'To Do',
      url: 'u',
      lastSyncedAt: new Date(),
      ...overrides,
    },
  })
}

beforeEach(async () => {
  await prisma.workUnit.deleteMany()
  await prisma.story.deleteMany()
  vi.mocked(getIssueTransitions).mockReset()
  vi.mocked(applyTransition).mockReset()
})

describe('applyStatusSync', () => {
  it('applies the In Progress transition on first unit started', async () => {
    const story = await createStory()
    vi.mocked(getIssueTransitions).mockResolvedValue([
      { id: '21', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
    ])

    const result = await applyStatusSync(
      story.id,
      [
        { id: 'a', column: 'in_progress' },
        { id: 'b', column: 'todo' },
      ],
      'a',
      'todo'
    )

    expect(applyTransition).toHaveBeenCalledWith('10001', '21')
    expect(result.warnings).toHaveLength(0)
  })

  it('warns instead of throwing when no matching transition exists', async () => {
    const story = await createStory()
    vi.mocked(getIssueTransitions).mockResolvedValue([])

    const result = await applyStatusSync(story.id, [{ id: 'a', column: 'in_progress' }], 'a', 'todo')

    expect(applyTransition).not.toHaveBeenCalled()
    expect(result.warnings[0]).toContain('No "In Progress" transition found')
  })

  it('applies the Done transition when all units are done', async () => {
    const story = await createStory()
    vi.mocked(getIssueTransitions).mockResolvedValue([
      { id: '31', name: 'Finish', to: { name: 'Done', statusCategory: { key: 'done' } } },
    ])

    const result = await applyStatusSync(story.id, [{ id: 'a', column: 'done' }], 'a', 'in_progress')

    expect(applyTransition).toHaveBeenCalledWith('10001', '31')
    expect(result.allUnitsDone).toBe(true)
  })

  it('resets completionCommentPostedAt when a unit leaves done', async () => {
    const story = await createStory({ jiraStatus: 'Done', completionCommentPostedAt: new Date() })
    vi.mocked(getIssueTransitions).mockResolvedValue([])

    await applyStatusSync(story.id, [{ id: 'a', column: 'in_progress' }], 'a', 'done')

    const updated = await prisma.story.findUnique({ where: { id: story.id } })
    expect(updated?.completionCommentPostedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- statusSync`
Expected: FAIL — `applyStatusSync` is not exported.

- [ ] **Step 3: Implement `applyStatusSync`**

Add to `src/lib/statusSync.ts`:

```ts
import { prisma } from './prisma'
import { getIssueTransitions, applyTransition } from './jira/client'
import { pickTransition } from './jira/transitions'

export async function applyStatusSync(
  storyId: string,
  workUnitsAfterUpdate: { id: string; column: Column }[],
  movedWorkUnitId: string,
  previousColumn: Column
): Promise<{ allUnitsDone: boolean; warnings: string[] }> {
  const triggers = evaluateStatusTriggers(workUnitsAfterUpdate, movedWorkUnitId, previousColumn)
  const warnings: string[] = []

  if (triggers.shouldResetCompletionComment) {
    await prisma.story.update({ where: { id: storyId }, data: { completionCommentPostedAt: null } })
  }

  if (triggers.firstUnitStarted || triggers.allUnitsDone) {
    const story = await prisma.story.findUniqueOrThrow({ where: { id: storyId } })
    const transitions = await getIssueTransitions(story.jiraId)

    if (triggers.firstUnitStarted) {
      const transition = pickTransition(transitions, 'indeterminate')
      if (transition) {
        await applyTransition(story.jiraId, transition.id)
      } else {
        warnings.push(`No "In Progress" transition found for ${story.jiraKey}; status not updated.`)
      }
    }

    if (triggers.allUnitsDone) {
      const transition = pickTransition(transitions, 'done')
      if (transition) {
        await applyTransition(story.jiraId, transition.id)
      } else {
        warnings.push(`No "Done" transition found for ${story.jiraKey}; status not updated.`)
      }
    }
  }

  return { allUnitsDone: triggers.allUnitsDone, warnings }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- statusSync`
Expected: PASS.

- [ ] **Step 5: Wire `applyStatusSync` into the move route**

Modify `src/app/api/work-units/[id]/route.test.ts` — replace its contents with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/workUnits', () => ({ moveWorkUnit: vi.fn() }))
vi.mock('@/lib/statusSync', () => ({ applyStatusSync: vi.fn() }))

import { moveWorkUnit } from '@/lib/workUnits'
import { applyStatusSync } from '@/lib/statusSync'
import { PATCH } from './route'

beforeEach(() => {
  vi.mocked(moveWorkUnit).mockReset()
  vi.mocked(applyStatusSync).mockReset()
})

describe('PATCH /api/work-units/[id]', () => {
  it('moves the work unit, applies status sync, and returns the combined result', async () => {
    vi.mocked(moveWorkUnit).mockResolvedValue({
      previousColumn: 'todo',
      storyId: 's1',
      workUnits: [{ id: 'w1', column: 'in_progress' }],
    } as any)
    vi.mocked(applyStatusSync).mockResolvedValue({ allUnitsDone: false, warnings: ['heads up'] })

    const res = await PATCH(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ column: 'in_progress', index: 0 }) }),
      { params: { id: 'w1' } }
    )
    const data = await res.json()

    expect(applyStatusSync).toHaveBeenCalledWith('s1', [{ id: 'w1', column: 'in_progress' }], 'w1', 'todo')
    expect(data.allUnitsDone).toBe(false)
    expect(data.warnings).toEqual(['heads up'])
  })

  it('returns 500 when the move fails', async () => {
    vi.mocked(moveWorkUnit).mockRejectedValue(new Error('boom'))
    const res = await PATCH(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ column: 'todo', index: 0 }) }),
      { params: { id: 'w1' } }
    )
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- work-units/\[id\]`
Expected: FAIL — route doesn't call `applyStatusSync` yet.

- [ ] **Step 7: Update the route**

Replace `src/app/api/work-units/[id]/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { moveWorkUnit } from '@/lib/workUnits'
import { applyStatusSync } from '@/lib/statusSync'
import type { Column } from '@/lib/types'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json()
  const { column, index } = body as { column: Column; index: number }

  try {
    const moveResult = await moveWorkUnit(params.id, column, index)
    const statusResult = await applyStatusSync(
      moveResult.storyId,
      moveResult.workUnits.map((u) => ({ id: u.id, column: u.column as Column })),
      params.id,
      moveResult.previousColumn
    )

    return NextResponse.json({
      workUnits: moveResult.workUnits,
      storyId: moveResult.storyId,
      allUnitsDone: statusResult.allUnitsDone,
      warnings: statusResult.warnings,
    })
  } catch (err) {
    console.error('Move work unit failed', err)
    return NextResponse.json({ error: 'Could not move work unit' }, { status: 500 })
  }
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- work-units`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/statusSync.ts src/lib/statusSync.test.ts src/app/api/work-units/\[id\]
git commit -m "$(cat <<'EOF'
feat: apply JIRA status transitions when work units move

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Completion Summary Generation and Posting

**Files:**
- Create: `src/lib/claude/completionSummary.ts`
- Test: `src/lib/claude/completionSummary.test.ts`
- Create: `src/app/api/stories/[id]/completion-summary/route.ts`
- Test: `src/app/api/stories/[id]/completion-summary/route.test.ts`
- Create: `src/app/api/stories/[id]/post-comment/route.ts`
- Test: `src/app/api/stories/[id]/post-comment/route.test.ts`

**Interfaces:**
- Consumes: `anthropic`, `CLAUDE_MODEL` (Task 6), `prisma` (Task 2), `postComment` (Task 4).
- Produces: `generateCompletionSummary(storySummary: string, workUnits: { title: string; description: string | null }[]): Promise<string>`. `POST /api/stories/[id]/completion-summary` and `POST /api/stories/[id]/post-comment` consumed by Task 14 (CompletionSummaryDialog).

- [ ] **Step 1: Write the failing generation test**

`src/lib/claude/completionSummary.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: 'claude-sonnet-5',
}))

import { anthropic } from './client'
import { generateCompletionSummary } from './completionSummary'

beforeEach(() => {
  vi.mocked(anthropic.messages.create).mockReset()
})

describe('generateCompletionSummary', () => {
  it('returns the trimmed text from the response', async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue({
      content: [{ type: 'text', text: '  Shipped the login flow and added tests.  ' }],
    } as any)

    const summary = await generateCompletionSummary('Add login', [{ title: 'Write tests', description: null }])

    expect(summary).toBe('Shipped the login flow and added tests.')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- completionSummary`
Expected: FAIL — `./completionSummary` module does not exist.

- [ ] **Step 3: Implement `generateCompletionSummary`**

`src/lib/claude/completionSummary.ts`:

```ts
import { anthropic, CLAUDE_MODEL } from './client'

export type CompletedWorkUnit = { title: string; description: string | null }

function textFromMessage(message: Awaited<ReturnType<typeof anthropic.messages.create>>): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => ('text' in block ? block.text : ''))
    .join('')
}

export async function generateCompletionSummary(
  storySummary: string,
  workUnits: CompletedWorkUnit[]
): Promise<string> {
  const unitList = workUnits.map((u) => `- ${u.title}${u.description ? `: ${u.description}` : ''}`).join('\n')

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Write a concise (2-4 sentence) summary of the work completed for the JIRA story "${storySummary}", suitable to post as a JIRA comment, based on these completed work units:\n\n${unitList}\n\nRespond with ONLY the summary text, no preamble.`,
      },
    ],
  })

  return textFromMessage(message).trim()
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- completionSummary`
Expected: PASS.

- [ ] **Step 5: Write the failing route tests**

`src/app/api/stories/[id]/completion-summary/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { story: { findUnique: vi.fn() } } }))
vi.mock('@/lib/claude/completionSummary', () => ({ generateCompletionSummary: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { generateCompletionSummary } from '@/lib/claude/completionSummary'
import { POST } from './route'

beforeEach(() => {
  vi.mocked(prisma.story.findUnique).mockReset()
  vi.mocked(generateCompletionSummary).mockReset()
})

describe('POST /api/stories/[id]/completion-summary', () => {
  it('generates a summary from only the done work units', async () => {
    vi.mocked(prisma.story.findUnique).mockResolvedValue({
      id: 's1',
      summary: 'Add login',
      workUnits: [
        { title: 'Done unit', description: null, column: 'done' },
        { title: 'Todo unit', description: null, column: 'todo' },
      ],
    } as any)
    vi.mocked(generateCompletionSummary).mockResolvedValue('All done.')

    const res = await POST(new Request('http://localhost'), { params: { id: 's1' } })
    const data = await res.json()

    expect(data.summary).toBe('All done.')
    expect(generateCompletionSummary).toHaveBeenCalledWith('Add login', [{ title: 'Done unit', description: null, column: 'done' }])
  })

  it('returns 404 when the story does not exist', async () => {
    vi.mocked(prisma.story.findUnique).mockResolvedValue(null)
    const res = await POST(new Request('http://localhost'), { params: { id: 'missing' } })
    expect(res.status).toBe(404)
  })
})
```

`src/app/api/stories/[id]/post-comment/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { story: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/jira/client', () => ({ postComment: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { postComment } from '@/lib/jira/client'
import { POST } from './route'

beforeEach(() => {
  vi.mocked(prisma.story.findUnique).mockReset()
  vi.mocked(prisma.story.update).mockReset()
  vi.mocked(postComment).mockReset()
})

describe('POST /api/stories/[id]/post-comment', () => {
  it('posts the comment to JIRA and sets completionCommentPostedAt', async () => {
    vi.mocked(prisma.story.findUnique).mockResolvedValue({ id: 's1', jiraId: '10001' } as any)
    vi.mocked(prisma.story.update).mockResolvedValue({ completionCommentPostedAt: new Date('2026-06-30') } as any)

    const res = await POST(
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({ summary: 'All done.' }) }),
      { params: { id: 's1' } }
    )
    const data = await res.json()

    expect(postComment).toHaveBeenCalledWith('10001', 'All done.')
    expect(data.completionCommentPostedAt).toBeTruthy()
  })

  it('returns 502 when posting to JIRA fails', async () => {
    vi.mocked(prisma.story.findUnique).mockResolvedValue({ id: 's1', jiraId: '10001' } as any)
    vi.mocked(postComment).mockRejectedValue(new Error('boom'))

    const res = await POST(
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({ summary: 'All done.' }) }),
      { params: { id: 's1' } }
    )
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 6: Run it to verify both fail**

Run: `npm test -- stories/\[id\]`
Expected: FAIL — route modules don't exist.

- [ ] **Step 7: Implement the routes**

`src/app/api/stories/[id]/completion-summary/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateCompletionSummary } from '@/lib/claude/completionSummary'

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const story = await prisma.story.findUnique({
    where: { id: params.id },
    include: { workUnits: true },
  })
  if (!story) {
    return NextResponse.json({ error: 'Story not found' }, { status: 404 })
  }

  const doneUnits = story.workUnits.filter((u) => u.column === 'done')

  try {
    const summary = await generateCompletionSummary(story.summary, doneUnits)
    return NextResponse.json({ summary })
  } catch (err) {
    console.error('Completion summary generation failed', err)
    return NextResponse.json(
      { error: 'Could not generate a summary. You can write your own and post it.' },
      { status: 502 }
    )
  }
}
```

`src/app/api/stories/[id]/post-comment/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { postComment } from '@/lib/jira/client'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json()
  const { summary } = body as { summary: string }

  const story = await prisma.story.findUnique({ where: { id: params.id } })
  if (!story) {
    return NextResponse.json({ error: 'Story not found' }, { status: 404 })
  }

  try {
    await postComment(story.jiraId, summary)
    const updated = await prisma.story.update({
      where: { id: params.id },
      data: { completionCommentPostedAt: new Date() },
    })
    return NextResponse.json({ completionCommentPostedAt: updated.completionCommentPostedAt })
  } catch (err) {
    console.error('Posting completion comment failed', err)
    return NextResponse.json({ error: 'Could not post the comment to JIRA' }, { status: 502 })
  }
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- stories/\[id\]`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/claude/completionSummary.ts src/lib/claude/completionSummary.test.ts src/app/api/stories/\[id\]/completion-summary src/app/api/stories/\[id\]/post-comment
git commit -m "$(cat <<'EOF'
feat: generate and post AI completion summaries to JIRA

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Board UI Shell — Tray, Toasts, Breakdown Dialog

**Files:**
- Create: `src/components/ToastProvider.tsx`
- Test: `src/components/ToastProvider.test.tsx`
- Create: `src/components/BreakdownDialog.tsx`
- Test: `src/components/BreakdownDialog.test.tsx`
- Create: `src/components/NeedsBreakdownTray.tsx`
- Create: `src/components/Board.tsx`
- Test: `src/components/Board.test.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `StoryDTO`, `WorkUnitDTO` (Task 2), `GET /api/stories`, `POST /api/sync`, `POST /api/stories/[id]/breakdown` (Task 6), `POST /api/work-units` (Task 7).
- Produces: `useToast(): { showToast: (message: string, variant?: 'error' | 'success') => void }` from `@/components/ToastProvider`, used by every later UI component. `Board` is the page's root client component, extended by Task 13 and Task 14.

- [ ] **Step 1: Write the failing toast test**

`src/components/ToastProvider.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach, act } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToastProvider, useToast } from './ToastProvider'

function TriggerButton() {
  const { showToast } = useToast()
  return <button onClick={() => showToast('Something failed')}>trigger</button>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  it('shows a toast message when showToast is called', async () => {
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>
    )

    screen.getByText('trigger').click()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something failed')
  })

  it('auto-dismisses the toast after 5 seconds', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>
    )

    act(() => {
      screen.getByText('trigger').click()
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- ToastProvider`
Expected: FAIL — `./ToastProvider` module does not exist.

- [ ] **Step 3: Implement `ToastProvider`**

`src/components/ToastProvider.tsx`:

```tsx
'use client'
import { createContext, useCallback, useContext, useState } from 'react'

type Toast = { id: number; message: string; variant: 'error' | 'success' }
type ToastContextValue = { showToast: (message: string, variant?: Toast['variant']) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, variant: Toast['variant'] = 'error') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, variant }])
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`rounded px-4 py-2 text-white shadow ${t.variant === 'error' ? 'bg-red-600' : 'bg-green-600'}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- ToastProvider`
Expected: PASS.

- [ ] **Step 5: Write the failing BreakdownDialog test**

`src/components/BreakdownDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, waitFor } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BreakdownDialog from './BreakdownDialog'
import { ToastProvider } from './ToastProvider'
import type { StoryDTO } from '@/lib/types'

const story: StoryDTO = {
  id: 's1',
  jiraKey: 'TEAM-1',
  jiraId: '10001',
  projectKey: 'TEAM',
  summary: 'Story',
  description: null,
  jiraStatus: 'To Do',
  url: 'https://example.atlassian.net/browse/TEAM-1',
  lastSyncedAt: '',
  completionCommentPostedAt: null,
  workUnits: [],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/breakdown')) {
        return Promise.resolve({ ok: true, json: async () => ({ suggestions: [{ title: 'Write tests', description: 'x' }] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }) as any
  )
})

describe('BreakdownDialog', () => {
  it('loads suggestions, lets the user edit them, then accepts', async () => {
    const onAccepted = vi.fn()
    render(
      <ToastProvider>
        <BreakdownDialog story={story} onClose={() => {}} onAccepted={onAccepted} />
      </ToastProvider>
    )

    const titleInput = await screen.findByDisplayValue('Write tests')
    fireEvent.change(titleInput, { target: { value: 'Write integration tests' } })
    fireEvent.click(screen.getByText('Accept'))

    await waitFor(() => expect(onAccepted).toHaveBeenCalled())

    const postCall = (fetch as any).mock.calls.find((c: any[]) => c[0] === '/api/work-units')
    expect(JSON.parse(postCall[1].body).units[0].title).toBe('Write integration tests')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- BreakdownDialog`
Expected: FAIL — `./BreakdownDialog` module does not exist.

- [ ] **Step 7: Implement `BreakdownDialog`**

`src/components/BreakdownDialog.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { StoryDTO } from '@/lib/types'
import { useToast } from './ToastProvider'

type Suggestion = { title: string; description: string }

export default function BreakdownDialog({
  story,
  onClose,
  onAccepted,
}: {
  story: StoryDTO
  onClose: () => void
  onAccepted: () => void
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/stories/${story.id}/breakdown`, { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSuggestions(data.suggestions ?? [])
      })
      .catch(() => {
        if (!cancelled) showToast('Could not generate a breakdown. Add work units manually below.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [story.id, showToast])

  function updateTitle(index: number, title: string) {
    setSuggestions((current) => current.map((s, i) => (i === index ? { ...s, title } : s)))
  }

  function removeSuggestion(index: number) {
    setSuggestions((current) => current.filter((_, i) => i !== index))
  }

  function addBlankSuggestion() {
    setSuggestions((current) => [...current, { title: '', description: '' }])
  }

  async function accept() {
    const units = suggestions.filter((s) => s.title.trim().length > 0)
    if (units.length === 0) return

    const res = await fetch('/api/work-units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId: story.id, units }),
    })

    if (!res.ok) {
      showToast('Could not save work units. Try again.')
      return
    }

    onAccepted()
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded bg-white p-4">
        <h3 className="mb-2 font-semibold">Break down {story.jiraKey}</h3>
        {loading && <p className="text-sm text-gray-500">Generating suggestions…</p>}
        <ul className="max-h-80 space-y-2 overflow-auto">
          {suggestions.map((s, index) => (
            <li key={index} className="flex items-center gap-2">
              <input
                className="flex-1 rounded border px-2 py-1 text-sm"
                value={s.title}
                onChange={(e) => updateTitle(index, e.target.value)}
                aria-label={`work unit title ${index + 1}`}
              />
              <button onClick={() => removeSuggestion(index)} aria-label={`remove work unit ${index + 1}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button className="mt-2 text-sm text-blue-600" onClick={addBlankSuggestion}>
          + Add work unit
        </button>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-1 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={accept}>
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- BreakdownDialog`
Expected: PASS.

- [ ] **Step 9: Implement `NeedsBreakdownTray`**

`src/components/NeedsBreakdownTray.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { StoryDTO } from '@/lib/types'
import BreakdownDialog from './BreakdownDialog'

export default function NeedsBreakdownTray({
  stories,
  onBreakdownAccepted,
}: {
  stories: StoryDTO[]
  onBreakdownAccepted: () => void
}) {
  const [activeStory, setActiveStory] = useState<StoryDTO | null>(null)

  return (
    <aside className="w-80 shrink-0 overflow-auto border-r p-4">
      <h2 className="mb-3 font-semibold">Needs breakdown</h2>
      {stories.length === 0 && <p className="text-sm text-gray-500">Nothing waiting.</p>}
      <ul className="space-y-2">
        {stories.map((story) => (
          <li key={story.id} className="rounded border p-3">
            <div className="text-sm font-medium">{story.jiraKey}</div>
            <div className="text-sm">{story.summary}</div>
            <button
              className="mt-2 rounded bg-blue-600 px-3 py-1 text-sm text-white"
              onClick={() => setActiveStory(story)}
            >
              Break down with AI
            </button>
          </li>
        ))}
      </ul>
      {activeStory && (
        <BreakdownDialog
          story={activeStory}
          onClose={() => setActiveStory(null)}
          onAccepted={() => {
            setActiveStory(null)
            onBreakdownAccepted()
          }}
        />
      )}
    </aside>
  )
}
```

- [ ] **Step 10: Write the failing Board test**

`src/components/Board.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, waitFor } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Board from './Board'
import { ToastProvider } from './ToastProvider'
import type { StoryDTO } from '@/lib/types'

const storyWithoutUnits: StoryDTO = {
  id: 's1',
  jiraKey: 'TEAM-1',
  jiraId: '1',
  projectKey: 'TEAM',
  summary: 'Needs breakdown',
  description: null,
  jiraStatus: 'To Do',
  url: 'u',
  lastSyncedAt: '',
  completionCommentPostedAt: null,
  workUnits: [],
}

const storyWithUnits: StoryDTO = {
  ...storyWithoutUnits,
  id: 's2',
  jiraKey: 'TEAM-2',
  summary: 'On board',
  workUnits: [
    { id: 'w1', storyId: 's2', title: 't', description: null, column: 'todo', order: 0, createdAt: '', completedAt: null },
  ],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: async () => [storyWithoutUnits, storyWithUnits] })) as any
  )
})

describe('Board', () => {
  it('puts stories with no work units in the needs-breakdown tray', () => {
    render(
      <ToastProvider>
        <Board initialStories={[storyWithoutUnits, storyWithUnits]} />
      </ToastProvider>
    )

    expect(screen.getByText('TEAM-1')).toBeInTheDocument()
  })

  it('refetches stories after a successful sync', async () => {
    render(
      <ToastProvider>
        <Board initialStories={[]} />
      </ToastProvider>
    )

    fireEvent.click(screen.getByText('Sync from JIRA'))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stories'))
  })
})
```

- [ ] **Step 11: Run it to verify it fails**

Run: `npm test -- Board`
Expected: FAIL — `./Board` module does not exist.

- [ ] **Step 12: Implement `Board` (without swimlane rendering, added in Task 13)**

`src/components/Board.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { StoryDTO } from '@/lib/types'
import NeedsBreakdownTray from './NeedsBreakdownTray'
import { useToast } from './ToastProvider'

export default function Board({ initialStories }: { initialStories: StoryDTO[] }) {
  const [stories, setStories] = useState<StoryDTO[]>(initialStories)
  const [syncing, setSyncing] = useState(false)
  const { showToast } = useToast()

  async function refreshStories() {
    const res = await fetch('/api/stories')
    const data: StoryDTO[] = await res.json()
    setStories(data)
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (!res.ok) throw new Error('Sync failed')
      await refreshStories()
    } catch {
      showToast('Sync failed. Check server logs.')
    } finally {
      setSyncing(false)
    }
  }

  const needsBreakdown = stories.filter((s) => s.workUnits.length === 0)
  const onBoard = stories.filter((s) => s.workUnits.length > 0)

  return (
    <div className="flex h-screen">
      <NeedsBreakdownTray stories={needsBreakdown} onBreakdownAccepted={refreshStories} />
      <div className="flex-1 overflow-auto p-4">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="mb-4 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync from JIRA'}
        </button>
        <p className="text-sm text-gray-500">{onBoard.length} on the board.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 13: Run the tests**

Run: `npm test -- Board`
Expected: PASS.

- [ ] **Step 14: Wire the real page**

Replace `src/app/page.tsx` with:

```tsx
import { prisma } from '@/lib/prisma'
import Board from '@/components/Board'
import { ToastProvider } from '@/components/ToastProvider'
import type { StoryDTO } from '@/lib/types'

export default async function Home() {
  const stories = await prisma.story.findMany({
    include: { workUnits: { orderBy: { order: 'asc' } } },
    orderBy: { lastSyncedAt: 'desc' },
  })

  // Round-trip through JSON so Dates become ISO strings, matching the StoryDTO
  // shape returned by GET /api/stories that Board uses for subsequent refetches.
  const initialStories = JSON.parse(JSON.stringify(stories)) as StoryDTO[]

  return (
    <ToastProvider>
      <Board initialStories={initialStories} />
    </ToastProvider>
  )
}
```

- [ ] **Step 15: Verify the app builds and run the full suite**

```bash
npm run build
npm test
```

Expected: build succeeds; all tests PASS.

- [ ] **Step 16: Commit**

```bash
git add src/components src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat: add board shell with needs-breakdown tray and breakdown dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Swimlane Board Rendering and Drag-and-Drop

**Files:**
- Create: `src/lib/boardDnd.ts`
- Test: `src/lib/boardDnd.test.ts`
- Create: `src/components/WorkUnitCard.tsx`
- Create: `src/components/Column.tsx`
- Create: `src/components/Swimlane.tsx`
- Test: `src/components/Swimlane.test.tsx`
- Modify: `src/components/Board.tsx`
- Modify: `src/components/Board.test.tsx`

**Interfaces:**
- Consumes: `StoryDTO`, `WorkUnitDTO`, `Column`, `COLUMNS` (Task 2), `PATCH /api/work-units/[id]` (Task 10).
- Produces: `findUnit(stories, unitId)`, `parseColumnDropId(id)` from `@/lib/boardDnd` — consumed by `Board.tsx` here and extended by Task 14. `Swimlane` component extended (one new prop) by Task 14.

- [ ] **Step 1: Write the failing `boardDnd` tests**

`src/lib/boardDnd.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findUnit, parseColumnDropId } from './boardDnd'
import type { StoryDTO } from './types'

const stories: StoryDTO[] = [
  {
    id: 's1',
    jiraKey: 'TEAM-1',
    jiraId: '1',
    projectKey: 'TEAM',
    summary: 'x',
    description: null,
    jiraStatus: 'To Do',
    url: 'u',
    lastSyncedAt: '',
    completionCommentPostedAt: null,
    workUnits: [
      { id: 'w1', storyId: 's1', title: 't', description: null, column: 'todo', order: 0, createdAt: '', completedAt: null },
    ],
  },
]

describe('findUnit', () => {
  it('finds the story and unit for a given work unit id', () => {
    const result = findUnit(stories, 'w1')
    expect(result?.story.id).toBe('s1')
    expect(result?.unit.id).toBe('w1')
  })

  it('returns null when the unit does not exist', () => {
    expect(findUnit(stories, 'missing')).toBeNull()
  })
})

describe('parseColumnDropId', () => {
  it('parses a valid column drop id', () => {
    expect(parseColumnDropId('s1:in_progress')).toEqual({ storyId: 's1', column: 'in_progress' })
  })

  it('returns null for a non-column id (e.g. a work unit id)', () => {
    expect(parseColumnDropId('w1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- boardDnd`
Expected: FAIL — `./boardDnd` module does not exist.

- [ ] **Step 3: Implement `boardDnd` helpers**

`src/lib/boardDnd.ts`:

```ts
import type { StoryDTO, Column } from './types'

export function findUnit(stories: StoryDTO[], unitId: string) {
  for (const story of stories) {
    const unit = story.workUnits.find((u) => u.id === unitId)
    if (unit) return { story, unit }
  }
  return null
}

export function parseColumnDropId(id: string): { storyId: string; column: Column } | null {
  const [storyId, column] = id.split(':')
  if (storyId && (column === 'todo' || column === 'in_progress' || column === 'done')) {
    return { storyId, column }
  }
  return null
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- boardDnd`
Expected: PASS.

- [ ] **Step 5: Implement the card and column components**

`src/components/WorkUnitCard.tsx`:

```tsx
'use client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { WorkUnitDTO } from '@/lib/types'

export default function WorkUnitCard({ unit }: { unit: WorkUnitDTO }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: unit.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded border bg-white p-2 text-sm shadow-sm"
    >
      {unit.title}
    </div>
  )
}
```

`src/components/Column.tsx`:

```tsx
'use client'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { WorkUnitDTO, Column as ColumnType } from '@/lib/types'
import WorkUnitCard from './WorkUnitCard'

const LABELS: Record<ColumnType, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}

export default function Column({ id, column, units }: { id: string; column: ColumnType; units: WorkUnitDTO[] }) {
  const { setNodeRef } = useDroppable({ id })

  return (
    <div className="w-56 shrink-0">
      <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">{LABELS[column]}</h4>
      <div ref={setNodeRef} className="min-h-[40px] space-y-2 rounded bg-gray-50 p-2">
        <SortableContext items={units.map((u) => u.id)} strategy={verticalListSortingStrategy}>
          {units.map((unit) => (
            <WorkUnitCard key={unit.id} unit={unit} />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write the failing Swimlane test**

`src/components/Swimlane.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import Swimlane from './Swimlane'
import type { StoryDTO } from '@/lib/types'

const story: StoryDTO = {
  id: 's1',
  jiraKey: 'TEAM-1',
  jiraId: '1',
  projectKey: 'TEAM',
  summary: 'Example story',
  description: null,
  jiraStatus: 'To Do',
  url: 'https://example.atlassian.net/browse/TEAM-1',
  lastSyncedAt: '',
  completionCommentPostedAt: null,
  workUnits: [
    { id: 'w1', storyId: 's1', title: 'Unit in todo', description: null, column: 'todo', order: 0, createdAt: '', completedAt: null },
    { id: 'w2', storyId: 's1', title: 'Unit in progress', description: null, column: 'in_progress', order: 0, createdAt: '', completedAt: null },
  ],
}

describe('Swimlane', () => {
  it('renders the story header and work units under their columns', () => {
    render(
      <DndContext onDragEnd={() => {}}>
        <Swimlane story={story} />
      </DndContext>
    )

    expect(screen.getByText('TEAM-1')).toBeInTheDocument()
    expect(screen.getByText('Unit in todo')).toBeInTheDocument()
    expect(screen.getByText('Unit in progress')).toBeInTheDocument()
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test -- Swimlane`
Expected: FAIL — `./Swimlane` module does not exist.

- [ ] **Step 8: Implement `Swimlane`**

`src/components/Swimlane.tsx`:

```tsx
'use client'
import type { StoryDTO, Column as ColumnType } from '@/lib/types'
import { COLUMNS } from '@/lib/types'
import Column from './Column'

export default function Swimlane({ story }: { story: StoryDTO }) {
  return (
    <div className="rounded border p-3">
      <div className="mb-2">
        <a href={story.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">
          {story.jiraKey}
        </a>{' '}
        <span className="text-sm text-gray-600">{story.summary}</span>
      </div>
      <div className="flex gap-4">
        {COLUMNS.map((column: ColumnType) => (
          <Column
            key={column}
            id={`${story.id}:${column}`}
            column={column}
            units={story.workUnits.filter((u) => u.column === column)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Run the tests**

Run: `npm test -- Swimlane`
Expected: PASS.

- [ ] **Step 10: Wire DnD and swimlane rendering into Board**

Modify `src/components/Board.test.tsx` — replace the first test (`'puts stories with no work units in the needs-breakdown tray'`) body with an additional assertion that the on-board story's swimlane renders:

```tsx
  it('puts stories with no work units in the needs-breakdown tray and renders the rest as swimlanes', () => {
    render(
      <ToastProvider>
        <Board initialStories={[storyWithoutUnits, storyWithUnits]} />
      </ToastProvider>
    )

    expect(screen.getByText('TEAM-1')).toBeInTheDocument()
    expect(screen.getByText('TEAM-2')).toBeInTheDocument()
  })
```

Replace `src/components/Board.tsx` with:

```tsx
'use client'
import { useState } from 'react'
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors, closestCorners } from '@dnd-kit/core'
import type { StoryDTO, Column } from '@/lib/types'
import { findUnit, parseColumnDropId } from '@/lib/boardDnd'
import NeedsBreakdownTray from './NeedsBreakdownTray'
import Swimlane from './Swimlane'
import { useToast } from './ToastProvider'

export default function Board({ initialStories }: { initialStories: StoryDTO[] }) {
  const [stories, setStories] = useState<StoryDTO[]>(initialStories)
  const [syncing, setSyncing] = useState(false)
  const { showToast } = useToast()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  async function refreshStories() {
    const res = await fetch('/api/stories')
    const data: StoryDTO[] = await res.json()
    setStories(data)
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (!res.ok) throw new Error('Sync failed')
      await refreshStories()
    } catch {
      showToast('Sync failed. Check server logs.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const found = findUnit(stories, String(active.id))
    if (!found) return

    let targetColumn: Column
    let targetIndex: number

    const overAsColumn = parseColumnDropId(String(over.id))
    if (overAsColumn) {
      targetColumn = overAsColumn.column
      targetIndex = found.story.workUnits.filter((u) => u.column === targetColumn && u.id !== active.id).length
    } else {
      const overUnit = findUnit(stories, String(over.id))
      if (!overUnit) return
      targetColumn = overUnit.unit.column
      const siblings = overUnit.story.workUnits.filter((u) => u.column === targetColumn)
      targetIndex = siblings.findIndex((u) => u.id === over.id)
    }

    try {
      const res = await fetch(`/api/work-units/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: targetColumn, index: targetIndex }),
      })
      if (!res.ok) throw new Error('Move failed')
      const data = await res.json()
      if (data.warnings?.length) {
        data.warnings.forEach((w: string) => showToast(w))
      }
      await refreshStories()
    } catch {
      showToast('Could not move that work unit. Try again.')
    }
  }

  const needsBreakdown = stories.filter((s) => s.workUnits.length === 0)
  const onBoard = stories.filter((s) => s.workUnits.length > 0)

  return (
    <div className="flex h-screen">
      <NeedsBreakdownTray stories={needsBreakdown} onBreakdownAccepted={refreshStories} />
      <div className="flex-1 overflow-auto p-4">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="mb-4 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync from JIRA'}
        </button>
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          <div className="space-y-4">
            {onBoard.map((story) => (
              <Swimlane key={story.id} story={story} />
            ))}
          </div>
        </DndContext>
      </div>
    </div>
  )
}
```

- [ ] **Step 11: Run the tests**

Run: `npm test -- Board`
Expected: PASS.

- [ ] **Step 12: Manual verification (drag-and-drop gestures aren't automated per the spec's testing section)**

```bash
npm run dev
```

Open `http://localhost:3000`, confirm the page loads without console errors. Full drag-and-drop interaction is verified manually once real JIRA credentials are configured (see `.env.example`) — this matches the spec's testing section, which explicitly defers drag-and-drop to manual click-through.

- [ ] **Step 13: Commit**

```bash
git add src/lib/boardDnd.ts src/lib/boardDnd.test.ts src/components/WorkUnitCard.tsx src/components/Column.tsx src/components/Swimlane.tsx src/components/Swimlane.test.tsx src/components/Board.tsx src/components/Board.test.tsx
git commit -m "$(cat <<'EOF'
feat: render swimlane board and wire drag-and-drop to the move route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Completion Summary Dialog

**Files:**
- Create: `src/components/CompletionSummaryDialog.tsx`
- Test: `src/components/CompletionSummaryDialog.test.tsx`
- Modify: `src/components/Swimlane.tsx`
- Modify: `src/components/Swimlane.test.tsx`
- Modify: `src/components/Board.tsx`

**Interfaces:**
- Consumes: `StoryDTO` (Task 2), `POST /api/stories/[id]/completion-summary`, `POST /api/stories/[id]/post-comment` (Task 11), `Swimlane` (Task 13), the `allUnitsDone`/`storyId` fields already returned by `PATCH /api/work-units/[id]` (Task 10).
- Produces: nothing consumed further — this is the final task.

- [ ] **Step 1: Write the failing CompletionSummaryDialog test**

`src/components/CompletionSummaryDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, waitFor } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CompletionSummaryDialog from './CompletionSummaryDialog'
import { ToastProvider } from './ToastProvider'
import type { StoryDTO } from '@/lib/types'

const story: StoryDTO = {
  id: 's1',
  jiraKey: 'TEAM-1',
  jiraId: '10001',
  projectKey: 'TEAM',
  summary: 'Story',
  description: null,
  jiraStatus: 'In Progress',
  url: 'u',
  lastSyncedAt: '',
  completionCommentPostedAt: null,
  workUnits: [],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/completion-summary')) {
        return Promise.resolve({ ok: true, json: async () => ({ summary: 'Shipped the thing.' }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }) as any
  )
})

describe('CompletionSummaryDialog', () => {
  it('loads a generated summary and posts the edited version', async () => {
    const onPosted = vi.fn()
    render(
      <ToastProvider>
        <CompletionSummaryDialog story={story} onClose={() => {}} onPosted={onPosted} />
      </ToastProvider>
    )

    const textarea = await screen.findByDisplayValue('Shipped the thing.')
    fireEvent.change(textarea, { target: { value: 'Shipped the thing, with tests.' } })
    fireEvent.click(screen.getByText('Post to JIRA'))

    await waitFor(() => expect(onPosted).toHaveBeenCalled())

    const postCall = (fetch as any).mock.calls.find((c: any[]) => c[0] === '/api/stories/s1/post-comment')
    expect(JSON.parse(postCall[1].body).summary).toBe('Shipped the thing, with tests.')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- CompletionSummaryDialog`
Expected: FAIL — `./CompletionSummaryDialog` module does not exist.

- [ ] **Step 3: Implement `CompletionSummaryDialog`**

`src/components/CompletionSummaryDialog.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { StoryDTO } from '@/lib/types'
import { useToast } from './ToastProvider'

export default function CompletionSummaryDialog({
  story,
  onClose,
  onPosted,
}: {
  story: StoryDTO
  onClose: () => void
  onPosted: () => void
}) {
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/stories/${story.id}/completion-summary`, { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSummary(data.summary ?? '')
      })
      .catch(() => {
        if (!cancelled) showToast('Could not generate a summary. Write your own below.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [story.id, showToast])

  async function post() {
    setPosting(true)
    try {
      const res = await fetch(`/api/stories/${story.id}/post-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      })
      if (!res.ok) throw new Error('Post failed')
      onPosted()
    } catch {
      showToast('Could not post the comment to JIRA.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded bg-white p-4">
        <h3 className="mb-2 font-semibold">{story.jiraKey} is done — post a summary?</h3>
        {loading && <p className="text-sm text-gray-500">Generating summary…</p>}
        <textarea
          className="h-32 w-full rounded border p-2 text-sm"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-1 text-sm" onClick={onClose}>
            Not now
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={posting || summary.trim().length === 0}
            onClick={post}
          >
            {posting ? 'Posting…' : 'Post to JIRA'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- CompletionSummaryDialog`
Expected: PASS.

- [ ] **Step 5: Add the "Post completion summary" button to Swimlane**

Modify `src/components/Swimlane.test.tsx` — add a new test:

```tsx
  it('shows a "Post completion summary" button once every work unit is done and no comment has posted yet', () => {
    const doneStory: StoryDTO = {
      ...story,
      workUnits: story.workUnits.map((u) => ({ ...u, column: 'done' as const })),
    }
    render(
      <DndContext onDragEnd={() => {}}>
        <Swimlane story={doneStory} onPostCompletionSummary={() => {}} />
      </DndContext>
    )

    expect(screen.getByText('Post completion summary')).toBeInTheDocument()
  })
```

Modify `src/components/Swimlane.tsx` — replace its contents with:

```tsx
'use client'
import type { StoryDTO, Column as ColumnType } from '@/lib/types'
import { COLUMNS } from '@/lib/types'
import Column from './Column'

export default function Swimlane({
  story,
  onPostCompletionSummary,
}: {
  story: StoryDTO
  onPostCompletionSummary?: (storyId: string) => void
}) {
  const allDone = story.workUnits.length > 0 && story.workUnits.every((u) => u.column === 'done')

  return (
    <div className="rounded border p-3">
      <div className="mb-2 flex items-center gap-2">
        <a href={story.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">
          {story.jiraKey}
        </a>
        <span className="text-sm text-gray-600">{story.summary}</span>
        {allDone && !story.completionCommentPostedAt && onPostCompletionSummary && (
          <button
            className="ml-auto text-xs text-blue-600 underline"
            onClick={() => onPostCompletionSummary(story.id)}
          >
            Post completion summary
          </button>
        )}
      </div>
      <div className="flex gap-4">
        {COLUMNS.map((column: ColumnType) => (
          <Column
            key={column}
            id={`${story.id}:${column}`}
            column={column}
            units={story.workUnits.filter((u) => u.column === column)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- Swimlane`
Expected: PASS.

- [ ] **Step 7: Wire the dialog into Board**

Modify `src/components/Board.tsx`:

Add to the imports:

```tsx
import CompletionSummaryDialog from './CompletionSummaryDialog'
```

Add a new piece of state alongside the existing `syncing` state:

```tsx
  const [completionStoryId, setCompletionStoryId] = useState<string | null>(null)
```

In `handleDragEnd`, replace:

```tsx
      if (data.warnings?.length) {
        data.warnings.forEach((w: string) => showToast(w))
      }
      await refreshStories()
    } catch {
```

with:

```tsx
      if (data.warnings?.length) {
        data.warnings.forEach((w: string) => showToast(w))
      }
      await refreshStories()
      if (data.allUnitsDone) {
        setCompletionStoryId(data.storyId)
      }
    } catch {
```

Replace the `<Swimlane key={story.id} story={story} />` line with:

```tsx
              <Swimlane key={story.id} story={story} onPostCompletionSummary={setCompletionStoryId} />
```

Add this just before the closing `</div>` of the component's returned JSX (after the `</DndContext>` block, still inside the outer `<div className="flex h-screen">`):

```tsx
      {completionStoryId &&
        (() => {
          const completionStory = stories.find((s) => s.id === completionStoryId)
          if (!completionStory) return null
          return (
            <CompletionSummaryDialog
              story={completionStory}
              onClose={() => setCompletionStoryId(null)}
              onPosted={() => {
                setCompletionStoryId(null)
                refreshStories()
              }}
            />
          )
        })()}
```

- [ ] **Step 8: Run the full test suite and build**

```bash
npm test
npm run build
```

Expected: all tests PASS; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/CompletionSummaryDialog.tsx src/components/CompletionSummaryDialog.test.tsx src/components/Swimlane.tsx src/components/Swimlane.test.tsx src/components/Board.tsx
git commit -m "$(cat <<'EOF'
feat: add completion summary review dialog and wire it to the board

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final Manual Verification

Automated tests cover all sync, breakdown, move/reorder, status-trigger, and completion-summary logic. Once you've filled in real credentials in `.env` (per `.env.example`):

```bash
npm run dev
```

1. Click "Sync from JIRA" — confirm stories assigned to you in the `TEAM` project appear in the "Needs breakdown" tray.
2. Break one down with AI, edit a suggestion, accept — confirm it appears as a swimlane with work units in To Do.
3. Drag a work unit to In Progress — confirm the JIRA issue transitions to an "In Progress"-category status.
4. Drag all of a story's work units to Done — confirm the JIRA issue transitions to a "Done"-category status and the completion summary dialog opens; edit and post it — confirm a comment appears on the JIRA issue.
5. Drag a work unit back out of Done — confirm the "Post completion summary" button reappears on that swimlane.
