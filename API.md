# API Reference

This document describes the REST API endpoints for the JIRA Kanban Sync application.

## Overview

The API provides endpoints for managing work units within stories. Story reads are performed via Next.js server components querying the database directly, while mutations (create, update, delete, move) are exposed as REST endpoints.

## Authentication

All API requests use HTTP Basic Authentication with JIRA credentials. The frontend handles this automatically by including JIRA email and API token in requests.

**Note:** JIRA authentication is handled server-side using the email and API token configured in each project's Settings panel.

## Base URL

```
http://localhost:3000/api
```

In production, replace with your deployment URL.

## Endpoints

### Work Units

#### Create Work Unit

Creates a new work unit within a story.

```
POST /work-units
```

**Request Body:**

```json
{
  "storyId": "clk1a2b3c4d5e6f7g8h9i0j1k",
  "title": "Implement user authentication",
  "description": "Add JWT-based authentication to the API",
  "column": "todo",
  "order": 0
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storyId` | string | Yes | ID of the parent story |
| `title` | string | Yes | Work unit title |
| `description` | string | No | Detailed description |
| `column` | string | Yes | Column: `"todo"`, `"in_progress"`, or `"done"` |
| `order` | number | Yes | Display order within the column (0-based) |

**Response (201 Created):**

```json
{
  "id": "clk1a2b3c4d5e6f7g8h9i0j1k",
  "jiraKey": "TEAM-123",
  "jiraId": "10000",
  "projectKey": "TEAM",
  "summary": "User authentication feature",
  "description": null,
  "jiraStatus": "In Progress",
  "url": "https://company.atlassian.net/browse/TEAM-123",
  "lastSyncedAt": "2024-01-15T10:30:00.000Z",
  "completionCommentPostedAt": null,
  "workUnits": [
    {
      "id": "clk1a2b3c4d5e6f7g8h9i0j1k",
      "storyId": "clk1a2b3c4d5e6f7g8h9i0j1k",
      "title": "Implement user authentication",
      "description": "Add JWT-based authentication to the API",
      "column": "todo",
      "order": 0,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "completedAt": null
    }
  ]
}
```

**Error Responses:**

- `400 Bad Request` — Missing required fields
- `404 Not Found` — Story not found
- `500 Internal Server Error` — Server error

---

#### Get Work Unit

Retrieves a single work unit by ID.

```
GET /work-units/{id}
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Work unit ID |

**Response (200 OK):**

```json
{
  "id": "clk1a2b3c4d5e6f7g8h9i0j1k",
  "storyId": "clk1a2b3c4d5e6f7g8h9i0j1k",
  "title": "Implement user authentication",
  "description": "Add JWT-based authentication to the API",
  "column": "in_progress",
  "order": 0,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "completedAt": null
}
```

**Error Responses:**

- `404 Not Found` — Work unit not found
- `500 Internal Server Error` — Server error

---

#### Update Work Unit

Updates a work unit's title, description, column, or order.

```
PATCH /work-units/{id}
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Work unit ID |

**Request Body (any fields to update):**

```json
{
  "title": "Updated title",
  "description": "Updated description",
  "column": "in_progress",
  "order": 1
}
```

**Response (200 OK):**

Returns the updated work unit (same format as GET).

**Error Responses:**

- `404 Not Found` — Work unit not found
- `500 Internal Server Error` — Server error

---

#### Delete Work Unit

Deletes a work unit.

```
DELETE /work-units/{id}
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Work unit ID |

**Response (200 OK):**

```json
{
  "success": true
}
```

**Error Responses:**

- `404 Not Found` — Work unit not found
- `500 Internal Server Error` — Server error

---

#### Move Work Unit

Moves a work unit to a different column and/or reorders it.

```
POST /work-units/{id}/move
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Work unit ID |

**Request Body:**

```json
{
  "column": "done",
  "order": 3
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `column` | string | Yes | Target column: `"todo"`, `"in_progress"`, or `"done"` |
| `order` | number | Yes | New display order within the column |

**Response (200 OK):**

Returns the updated work unit with new column and order.

**Error Responses:**

- `400 Bad Request` — Missing column or order
- `404 Not Found` — Work unit not found
- `500 Internal Server Error` — Server error

---

## Data Types

### WorkUnitDTO

Represents a work unit in the kanban board.

```typescript
interface WorkUnitDTO {
  id: string;                    // Unique identifier (CUID)
  storyId: string;               // Parent story ID
  title: string;                 // Work unit title
  description: string | null;    // Detailed description
  column: "todo" | "in_progress" | "done";  // Current column
  order: number;                 // Display order (0-based)
  createdAt: string;             // ISO 8601 timestamp
  completedAt: string | null;    // Completion timestamp (ISO 8601)
}
```

### StoryDTO

Represents a JIRA story with associated work units.

```typescript
interface StoryDTO {
  id: string;                      // Unique identifier (CUID)
  jiraKey: string;                 // JIRA issue key (e.g., "TEAM-123")
  jiraId: string;                  // JIRA internal ID
  projectKey: string;              // JIRA project key (e.g., "TEAM")
  summary: string;                 // Story title/summary
  description: string | null;      // Story description
  jiraStatus: string;              // JIRA status (e.g., "In Progress")
  url: string;                     // Link to JIRA issue
  lastSyncedAt: string;            // Last sync timestamp (ISO 8601)
  completionCommentPostedAt: string | null;  // When completion comment was posted
  workUnits: WorkUnitDTO[];        // Associated work units
}
```

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success (GET, PATCH, DELETE, POST) |
| `201` | Created (POST creating new resource) |
| `400` | Bad Request (validation error) |
| `404` | Not Found (resource doesn't exist) |
| `500` | Internal Server Error |

## Error Response Format

All errors return JSON with an `error` message:

```json
{
  "error": "Description of what went wrong"
}
```

## Example Usage

### Create and move a work unit

```bash
# Create
curl -X POST http://localhost:3000/api/work-units \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "clk1a2b3c4d5e6f7g8h9i0j1k",
    "title": "Setup authentication",
    "column": "todo",
    "order": 0
  }'

# Move to in_progress
curl -X POST http://localhost:3000/api/work-units/clk1a2b3c4d5e6f7g8h9i0j1k/move \
  -H "Content-Type: application/json" \
  -d '{
    "column": "in_progress",
    "order": 0
  }'

# Move to done
curl -X POST http://localhost:3000/api/work-units/clk1a2b3c4d5e6f7g8h9i0j1k/move \
  -H "Content-Type: application/json" \
  -d '{
    "column": "done",
    "order": 0
  }'
```

## Async Route Params

The API uses Next.js async route parameters for dynamic segments (`[id]`). The app handles Promise-based params internally — client code passes parameters as typical path segments.

## Rate Limiting

Currently, there is no rate limiting implemented. Future versions may add rate limiting at the application or infrastructure level.

## CORS

CORS is not configured. Requests from the same origin are allowed by default (Next.js same-origin policy).
