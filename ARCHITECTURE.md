# System Architecture

This document describes the high-level architecture of the JIRA Kanban Sync application.

## Overview

The system consists of five main components:

1. **JIRA Integration** — Fetches stories from JIRA Cloud
2. **Claude AI** — Breaks down stories into work units
3. **Backend API** — Next.js API routes for managing work units
4. **Frontend** — React UI for viewing and managing kanban board
5. **Database** — PostgreSQL for persistent storage

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        JIRA Cloud                               │
│                  (Stories & Issues)                             │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 │ HTTP Basic Auth
                                 │ (email + API token)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     JIRA REST API Client                         │
│         (src/lib/jira/client.ts & related modules)              │
│  • Fetch assigned stories (JQL query)                           │
│  • Parse issue details (summary, description, status)           │
│  • Convert to StoryDTO format                                   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
    ┌───────────────────────────┐  ┌──────────────────────┐
    │   Claude API Integration  │  │  Sync Engine         │
    │  (src/lib/claude.ts)      │  │ (src/lib/sync.ts)    │
    │                           │  │                      │
    │ • Break story into units  │  │ • Upsert stories     │
    │ • 3-5 work units/story    │  │   to database        │
    │ • Bearer token auth       │  └──────────────────────┘
    └───────────────┬───────────┘
                    │
                    │ Story + Work Units
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                        │
│  • Story table (JIRA issue, status, sync time)                 │
│  • WorkUnit table (title, description, column, order)          │
│                                                                 │
│  Status Trigger (src/lib/statusTrigger.ts):                    │
│  When all work units = "done", update story jiraStatus         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ SQL Queries (Prisma)
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend API Routes                          │
│              (src/app/api/work-units/*)                         │
│  • POST /work-units (create)                                   │
│  • GET /work-units/[id] (fetch)                                │
│  • PATCH /work-units/[id] (update)                             │
│  • DELETE /work-units/[id] (delete)                            │
│  • POST /work-units/[id]/move (reorder)                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ JSON REST API
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend (Next.js)                     │
│              (src/app/page.tsx, components)                     │
│  • Display kanban board (todo, in_progress, done)              │
│  • Drag-and-drop work units                                    │
│  • Create/edit work units                                      │
│  • Display story details                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Component Details

### JIRA Integration

**Location:** `src/lib/jira/`

The JIRA integration consists of:

- **`client.ts`** — Main JIRA REST API client
  - `fetchAssignedStories()` — Retrieves stories assigned to the current user
  - HTTP Basic Authentication (email + API token → base64)
  - Calls `/rest/api/3/search` with JQL query
  - Converts JIRA issues to `StoryDTO` format

- **`jql.ts`** — JQL (JIRA Query Language) builder
  - `buildAssignedStoriesJql()` — Builds query for assigned stories
  - Filters by project keys from environment config

- **`adf.ts`** — Atlassian Document Format parser
  - `adfToPlainText()` — Converts JIRA ADF description to plain text
  - Handles rich text descriptions from JIRA

- **`transitions.ts`** — JIRA status transition handler
  - Maps kanban column states to JIRA transitions
  - Supports custom workflow configurations

### Claude AI Integration

**Location:** `src/lib/claude.ts`

Claude is used to break down JIRA stories into actionable work units:

```typescript
breakdownStory(summary, description, apiKey)
  → Claude API (claude-3-5-sonnet)
  → JSON array of work units
  → [{ title, description }, ...]
```

**Process:**

1. User selects a story to break down
2. Story summary + description sent to Claude API with prompt
3. Claude generates 3-5 work units with titles and descriptions
4. Work units created in database via API
5. Frontend displays new work units in "todo" column

**Authentication:** Bearer token (Anthropic API key)

**Model:** `claude-3-5-sonnet`

**Prompt:** "Break down this JIRA story into 3-5 work units with titles and brief descriptions. Return JSON."

### Sync Engine

**Location:** `src/lib/sync.ts`

The sync engine orchestrates data synchronization:

```typescript
syncStoriesFromJira(projectKeys, jiraConfig, prisma)
  → Fetches stories from JIRA
  → For each story:
      • Check if story exists by jiraId
      • Create new or update existing
  → Returns { created: number, updated: number }
```

**Features:**

- Upserts stories (create if new, update if exists)
- Preserves work units during story updates
- Tracks sync timestamp (`lastSyncedAt`)

### Status Trigger

**Location:** `src/lib/statusTrigger.ts`

Automatically updates story status when work completes:

```typescript
checkAndUpdateStoryStatus(storyId, prisma)
  → Fetch story with all work units
  → Check if ALL work units have column === "done"
  → If yes, update story jiraStatus to "Done"
  → Return true/false (was updated)
```

**Triggering:** Called when:
- A work unit is moved to "done" column
- A work unit's status changes

### Backend API

**Location:** `src/app/api/work-units/`

Express-style Next.js API routes for work unit mutations:

- **`route.ts`** (collection)
  - `POST` — Create work unit, return full story
  - Validates required fields (storyId, title, column, order)

- **`[id]/route.ts`** (single resource)
  - `GET` — Fetch work unit
  - `PATCH` — Update specific fields
  - `DELETE` — Remove work unit

- **`[id]/move/route.ts`** (custom action)
  - `POST` — Move to column and reorder
  - Used for drag-and-drop reordering

**Response Format:** `WorkUnitDTO` or `StoryDTO` (with full work units for context)

### Database

**Location:** `prisma/schema.prisma`

Two main models:

```prisma
model Story {
  id                        String     @id @default(cuid())
  jiraKey                   String     @unique
  jiraId                    String     @unique
  projectKey                String
  summary                   String
  description               String?
  jiraStatus                String
  url                       String
  lastSyncedAt              DateTime
  completionCommentPostedAt DateTime?
  workUnits                 WorkUnit[]
}

model WorkUnit {
  id          String    @id @default(cuid())
  storyId     String
  story       Story     @relation(fields: [storyId], references: [id])
  title       String
  description String?
  column      String    // "todo" | "in_progress" | "done"
  order       Int       // Sort order within column
  createdAt   DateTime  @default(now())
  completedAt DateTime?
}
```

**Constraints:**

- Story `jiraKey` and `jiraId` are unique (no duplicate JIRA issues)
- WorkUnit `storyId` creates a foreign key relationship
- Soft deletes not implemented (hard delete on removal)

### Frontend

**Location:** `src/app/`

Next.js 15 with React 18:

- **`layout.tsx`** — Root layout
- **`page.tsx`** — Home page (entry point)
- **Components** — Kanban board, story details, work unit cards

**Technologies:**

- **Next.js 15** — Server components, API routes, SSR
- **React 18** — UI library
- **Tailwind CSS** — Styling
- **TypeScript** — Type safety

**Data Fetching:**

- Server components query database directly via Prisma
- Mutations use REST API (`/api/work-units/*`)
- No GraphQL layer

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | Next.js | 15.0.0 |
| **UI Framework** | React | 18.3.0 |
| **Styling** | Tailwind CSS | 3.4.1 |
| **Language** | TypeScript | 5.3.3 |
| **ORM** | Prisma | 7.8.0 |
| **Database** | PostgreSQL | 16 |
| **Testing** | Vitest | 1.6.0 |
| **External APIs** | JIRA REST API v3 | N/A |
| **External APIs** | Anthropic (Claude) | v1 |

## Environment Variables

JIRA credentials are stored per project (Settings panel), not in the environment.

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API authentication |
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `development` or `production` |

## Authentication & Security

### JIRA Authentication

- **Method:** HTTP Basic Auth
- **Header:** `Authorization: Basic base64(email:apiToken)`
- **Setup:** Requires API token from JIRA Settings

### Claude Authentication

- **Method:** Bearer Token
- **Header:** `Authorization: Bearer {ANTHROPIC_API_KEY}`
- **Setup:** Requires Anthropic API key from console.anthropic.com

### Database

- **Connection:** Direct Prisma connection to PostgreSQL
- **Auth:** Username/password (environment-based)
- **Network:** Localhost in development; managed service in production

## Key Patterns

### Data Transfer Objects (DTOs)

- `StoryDTO` — Story with all work units
- `WorkUnitDTO` — Single work unit
- Located in `src/lib/types.ts`
- Ensure consistent API response format

### Error Handling

- API routes catch errors and return 500 with message
- Database errors bubble to API error handler
- Frontend should handle error responses gracefully

### Async Route Parameters

- Next.js 15 uses async params: `params: Promise<{ id: string }>`
- Await params before use: `const { id } = await params`
- See `/api/work-units/[id]/route.ts` for examples

## Development Workflow

1. **Modify data model** → Update `prisma/schema.prisma`
2. **Sync schema** → Run `npx prisma db push`
3. **Implement API** → Add/modify `src/app/api/work-units/*`
4. **Write tests** → Add test files with `.test.ts` suffix
5. **Run tests** → `npm test`
6. **Start dev server** → `npm run dev`
7. **Verify in browser** → `http://localhost:3000`

## Future Enhancements

- **Webhook support** — Real-time sync from JIRA webhooks
- **Rate limiting** — Protect API from abuse
- **Caching** — Cache JIRA stories to reduce API calls
- **Multi-user support** — Per-user work unit assignments
- **Workflow customization** — Support arbitrary JIRA workflows
- **Offline mode** — Local-first sync with conflict resolution
