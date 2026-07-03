# MCP Image Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an MCP caller (Claude Code) attach a local image file (e.g. a screenshot) to a Ponder work unit in one tool call — `attach_image(workUnitId, filePath)`.

**Architecture:** The MCP layer reads the file from local disk (this is the one place in Ponder's codebase where a local filesystem read is appropriate — the MCP server IS the local agent process, unlike the Next.js app server which stays repo/fs-agnostic) and infers its MIME type from the file extension, then re-uses Ponder's **existing** attachment upload endpoint (`POST /api/work-units/[id]/attachments`, multipart `file` field) via a new bespoke multipart method on `PonderClient`. **Zero changes to the Next.js app, Prisma schema, or the existing upload route** — this is purely additive MCP surface.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (`zod/v3`, raw ZodRawShape `inputSchema`), Node's global `fetch`/`FormData`/`Blob` (confirmed available in this project's Node v26 runtime — no new dependency), `node:fs/promises`, `node:path`, Vitest.

## Global Constraints

- **No backend changes.** `src/app/api/work-units/[id]/attachments/route.ts`, `prisma/schema.prisma`, and `src/lib/attachmentStorage.ts` are NOT modified. The new MCP method must produce a request the existing route already accepts (multipart `file` field, `image/*` MIME type, ≤10 MB — the route enforces the limit; do not duplicate the `10 * 1024 * 1024` constant in the MCP layer).
- **Supported image extensions:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` (the real-world set for screenshots/evidence). Extension lookup is case-insensitive. An unsupported extension is a clear, immediate error — never guess a MIME type.
- **Separation of concerns**, matching the existing two-file split:
  - `src/mcp/client.ts` stays a "thin HTTP client... no business logic of its own" (its own docstring) — `addAttachment` only turns already-prepared bytes + metadata into an HTTP POST.
  - `src/mcp/tools.ts` handlers stay "thin... no business logic beyond formatting a plain-text summary" (its own docstring) — file reading and MIME inference live in a new dedicated module, `src/mcp/readLocalImage.ts`, not inline in the handler.
- **MCP idioms:** `z` imported from `"zod/v3"`; `registerTool` `inputSchema` is a raw ZodRawShape; handlers return `McpTextResult`; on a thrown error, return `textResult("Error: " + message)`, matching `updateWorkUnit`/`regenerateAcceptance`.
- **Tests run serially:** `npx dotenv -e .env.test -- vitest run --no-file-parallelism`.
- **No secrets committed.** Branch → verify green (`tsc --noEmit`, `npm run lint`, full suite, `npx knip`) → PR → the user merges.

---

## File Structure

**Create:**
- `src/mcp/readLocalImage.ts` — reads a local file path into `{ buffer, filename, mimeType }`; throws a clear `Error` for an unsupported extension.
- `src/mcp/readLocalImage.test.ts` — covers each supported extension, an unsupported extension, a missing file, and the `filenameOverride` behavior, using real temporary files (no fs mocking — matches this project's existing preference for real I/O over mocked `node:fs`).

**Modify:**
- `src/mcp/client.ts` — add `addAttachment(workUnitId, buffer, filename, mimeType): Promise<AttachmentDTO>`.
- `src/mcp/client.test.ts` — add `addAttachment` tests (request shape, non-2xx error).
- `src/mcp/tools.ts` — add `attachImage(client, { workUnitId, filePath, filename? })` handler.
- `src/mcp/tools.test.ts` — add `attachImage` tests (success, unsupported extension, missing file, client throws).
- `src/mcp/server.ts` — register the `attach_image` tool.
- `src/mcp/server.test.ts` — bump the exact-tool-set assertion from seven to eight, adding `"attach_image"`.
- `docs/understand-anything-integration.md` is NOT touched (unrelated feature); no other docs changes are in scope for this plan.

---

### Task 1: `readLocalImage` helper

**Files:**
- Create: `src/mcp/readLocalImage.ts`
- Create: `src/mcp/readLocalImage.test.ts`

**Interfaces:**
- Produces: `readLocalImage(filePath: string, filenameOverride?: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }>` — the sole export Task 2 consumes.

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/readLocalImage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readLocalImage } from "@/mcp/readLocalImage";

describe("readLocalImage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ponder-readLocalImage-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
  ])("infers %s as %s and reads the file's bytes", async (ext, expectedMime) => {
    const filePath = path.join(dir, `screenshot${ext}`);
    await writeFile(filePath, "fake-bytes");

    const result = await readLocalImage(filePath);

    expect(result.mimeType).toBe(expectedMime);
    expect(result.filename).toBe(`screenshot${ext}`);
    expect(result.buffer.toString()).toBe("fake-bytes");
  });

  it("infers the extension case-insensitively", async () => {
    const filePath = path.join(dir, "Screenshot.PNG");
    await writeFile(filePath, "fake-bytes");

    const result = await readLocalImage(filePath);

    expect(result.mimeType).toBe("image/png");
  });

  it("uses filenameOverride instead of the file's basename when provided", async () => {
    const filePath = path.join(dir, "screenshot.png");
    await writeFile(filePath, "fake-bytes");

    const result = await readLocalImage(filePath, "before-fix.png");

    expect(result.filename).toBe("before-fix.png");
  });

  it("throws a clear error for an unsupported extension", async () => {
    const filePath = path.join(dir, "notes.txt");
    await writeFile(filePath, "not an image");

    await expect(readLocalImage(filePath)).rejects.toThrow(/unsupported/i);
  });

  it("propagates the filesystem error for a missing file", async () => {
    const filePath = path.join(dir, "does-not-exist.png");

    await expect(readLocalImage(filePath)).rejects.toThrow(/ENOENT|no such file/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/readLocalImage.test.ts`
Expected: FAIL — module `@/mcp/readLocalImage` not found.

- [ ] **Step 3: Write the implementation**

Create `src/mcp/readLocalImage.ts`:

```ts
/**
 * Reads a local image file for MCP-driven attachment upload. This is the one
 * place in Ponder that reads the local filesystem directly — the MCP server
 * process IS the local agent's own machine, unlike the Next.js app server,
 * which stays repo/filesystem-agnostic (see docs/understand-anything-integration.md).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface LocalImage {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Reads `filePath` from disk and infers its MIME type from the file
 * extension (case-insensitive). Throws a descriptive error for an
 * unsupported extension; a missing/unreadable file surfaces Node's own
 * fs error unmodified.
 */
export async function readLocalImage(
  filePath: string,
  filenameOverride?: string
): Promise<LocalImage> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = EXTENSION_MIME_TYPES[ext];

  if (!mimeType) {
    const supported = Object.keys(EXTENSION_MIME_TYPES).join(", ");
    throw new Error(
      `Unsupported image extension "${ext || "(none)"}" for "${filePath}" — supported: ${supported}`
    );
  }

  const buffer = await readFile(filePath);
  const filename = filenameOverride ?? path.basename(filePath);

  return { buffer, filename, mimeType };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/readLocalImage.test.ts`
Expected: PASS — 9 tests (5 from `it.each` + 4 others).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/readLocalImage.ts src/mcp/readLocalImage.test.ts
git commit -m "feat: add readLocalImage helper for MCP-driven image attachments"
```

---

### Task 2: `addAttachment` client method + `attach_image` MCP tool

**Files:**
- Modify: `src/mcp/client.ts`, `src/mcp/client.test.ts`
- Modify: `src/mcp/tools.ts`, `src/mcp/tools.test.ts`
- Modify: `src/mcp/server.ts`, `src/mcp/server.test.ts`

**Interfaces:**
- Consumes: `readLocalImage` from Task 1.
- Produces: `PonderClient.addAttachment(workUnitId: string, buffer: Buffer, filename: string, mimeType: string): Promise<AttachmentDTO>`.
- Produces: `attachImage(client: PonderClient, args: { workUnitId: string; filePath: string; filename?: string }): Promise<McpTextResult>`.
- Produces: MCP tool `attach_image` with `inputSchema { workUnitId: z.string(), filePath: z.string(), filename: z.string().optional() }`.

- [ ] **Step 1: Write the failing client tests**

Add to `src/mcp/client.test.ts` (add `AttachmentDTO` to the existing `import type { ... } from "@/lib/types"` line):

```ts
  it("addAttachment() POSTs a multipart body with the file to the attachments endpoint", async () => {
    const attachment: AttachmentDTO = {
      id: "a1",
      workUnitId: "w1",
      filename: "screenshot.png",
      mimeType: "image/png",
      size: 4,
      createdAt: "2026-07-02T00:00:00.000Z",
      url: "/api/attachments/a1",
    };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => attachment,
      } as Response;
    }) as unknown as typeof fetch;

    const client = new PonderClient("http://ponder.test", fetchImpl);
    const result = await client.addAttachment(
      "w1",
      Buffer.from("fake-bytes"),
      "screenshot.png",
      "image/png"
    );

    expect(result).toEqual(attachment);
    expect(calls[0].url).toBe(
      "http://ponder.test/api/work-units/w1/attachments"
    );
    expect(calls[0].init.method).toBe("POST");

    const body = calls[0].init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const file = body.get("file") as File;
    expect(file.name).toBe("screenshot.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(10);
  });

  it("addAttachment() throws with a message containing the status on a non-2xx response", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 413,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const client = new PonderClient("http://ponder.test", fetchImpl);

    await expect(
      client.addAttachment("w1", Buffer.from("x"), "big.png", "image/png")
    ).rejects.toThrow(/413/);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/client.test.ts`
Expected: FAIL — `client.addAttachment` is not a function.

- [ ] **Step 3: Add the client method**

In `src/mcp/client.ts`, widen the type import at the top:

```ts
import type { AttachmentDTO, Column, ProjectWithStats, StoryDTO, WorkUnitDTO } from "@/lib/types";
```

Add, after `regenerateAcceptance`:

```ts
  /**
   * Uploads a local image as a work-unit attachment. Bespoke (not routed
   * through the shared `request` helper below): that helper always
   * JSON-encodes its body, but the existing attachments endpoint expects
   * multipart/form-data with the file under a "file" field.
   */
  async addAttachment(
    workUnitId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<AttachmentDTO> {
    const path = `/api/work-units/${encodeURIComponent(workUnitId)}/attachments`;
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: mimeType }), filename);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Ponder API error: ${response.status} POST ${path}`);
    }

    return (await response.json()) as AttachmentDTO;
  }
```

- [ ] **Step 4: Run the client tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tools tests**

Add to `src/mcp/tools.test.ts`. First add these imports at the top (alongside the file's existing imports — match its existing import style, e.g. if it imports from `node:fs/promises`/`node:os`/`node:path` add them the same way Task 1's test file does):

```ts
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
```

Add `attachImage` to the import from `./tools`. Then add:

```ts
describe("attachImage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ponder-attachImage-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the local file and uploads it via client.addAttachment", async () => {
    const filePath = path.join(dir, "screenshot.png");
    await writeFile(filePath, "fake-bytes");

    const fakeClient = {
      addAttachment: async (
        workUnitId: string,
        buffer: Buffer,
        filename: string,
        mimeType: string
      ) => {
        expect(workUnitId).toBe("wu1");
        expect(buffer.toString()).toBe("fake-bytes");
        expect(filename).toBe("screenshot.png");
        expect(mimeType).toBe("image/png");
        return {
          id: "a1",
          workUnitId: "wu1",
          filename,
          mimeType,
          size: buffer.length,
          createdAt: "2026-07-02T00:00:00.000Z",
          url: "/api/attachments/a1",
        };
      },
    } as unknown as PonderClient;

    const result = await attachImage(fakeClient, {
      workUnitId: "wu1",
      filePath,
    });

    expect(result.content[0].text).toContain("screenshot.png");
    expect(result.content[0].text).toContain("wu1");
  });

  it("returns an error-text result for an unsupported extension, without calling the client", async () => {
    const filePath = path.join(dir, "notes.txt");
    await writeFile(filePath, "not an image");
    const addAttachment = vi.fn();
    const fakeClient = { addAttachment } as unknown as PonderClient;

    const result = await attachImage(fakeClient, {
      workUnitId: "wu1",
      filePath,
    });

    expect(result.content[0].text).toMatch(/error/i);
    expect(addAttachment).not.toHaveBeenCalled();
  });

  it("returns an error-text result for a missing file", async () => {
    const fakeClient = {
      addAttachment: vi.fn(),
    } as unknown as PonderClient;

    const result = await attachImage(fakeClient, {
      workUnitId: "wu1",
      filePath: path.join(dir, "does-not-exist.png"),
    });

    expect(result.content[0].text).toMatch(/error/i);
  });

  it("returns an error-text result when the client throws", async () => {
    const filePath = path.join(dir, "screenshot.png");
    await writeFile(filePath, "fake-bytes");
    const fakeClient = {
      addAttachment: async () => {
        throw new Error("Ponder API error: 413 POST /api/work-units/wu1/attachments");
      },
    } as unknown as PonderClient;

    const result = await attachImage(fakeClient, {
      workUnitId: "wu1",
      filePath,
    });

    expect(result.content[0].text).toMatch(/error/i);
    expect(result.content[0].text).toContain("413");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/tools.test.ts`
Expected: FAIL — `attachImage` not exported from `./tools`.

- [ ] **Step 7: Add the tool handler**

In `src/mcp/tools.ts`, add the import:

```ts
import { readLocalImage } from "./readLocalImage";
```

Add, at the end of the file:

```ts
/** Attach a local image file (e.g. a screenshot) to a work unit as evidence. */
export async function attachImage(
  client: PonderClient,
  args: { workUnitId: string; filePath: string; filename?: string }
): Promise<McpTextResult> {
  try {
    const { buffer, filename, mimeType } = await readLocalImage(
      args.filePath,
      args.filename
    );
    const attachment = await client.addAttachment(
      args.workUnitId,
      buffer,
      filename,
      mimeType
    );
    return textResult(
      `Attached "${attachment.filename}" (${attachment.mimeType}, ${attachment.size} bytes) to work unit ${args.workUnitId}.`
    );
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

- [ ] **Step 8: Run the tools tests to verify they pass**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/tools.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing server-registration test**

In `src/mcp/server.test.ts`, update the existing exact-set test: change "seven expected tools" → "eight expected tools" in the test description, and add `"attach_image"` to the expected array.

- [ ] **Step 10: Run it to verify it fails**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/server.test.ts`
Expected: FAIL — `attach_image` not in the registered set.

- [ ] **Step 11: Register the tool**

In `src/mcp/server.ts`, add `attachImage` to the import from `./tools`, then register:

```ts
  server.registerTool(
    "attach_image",
    {
      description:
        "Attach a local image file (e.g. a screenshot) to a work unit as " +
        "evidence. filePath must be readable by the MCP server process. " +
        "Supported extensions: .png, .jpg, .jpeg, .gif, .webp. Max 10 MB " +
        "(enforced server-side).",
      inputSchema: {
        workUnitId: z.string(),
        filePath: z.string(),
        filename: z.string().optional(),
      },
    },
    async ({ workUnitId, filePath, filename }) =>
      attachImage(client, { workUnitId, filePath, filename })
  );
```

- [ ] **Step 12: Run the full MCP suite to verify it passes**

Run: `npx dotenv -e .env.test -- vitest run --no-file-parallelism src/mcp/`
Expected: PASS — all MCP tests green.

- [ ] **Step 13: Commit**

```bash
git add src/mcp/client.ts src/mcp/client.test.ts \
  src/mcp/tools.ts src/mcp/tools.test.ts \
  src/mcp/server.ts src/mcp/server.test.ts
git commit -m "feat: add attach_image MCP tool for uploading local images to work units"
```

---

## Final verification (before PR)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — no new errors.
- [ ] `npx dotenv -e .env.test -- vitest run --no-file-parallelism` — full suite green.
- [ ] `npx knip` — no new unused exports.
- [ ] Open the PR; the user merges.

---

## Self-Review

**Spec coverage:**
- "make it easy to attach images to Ponder Cards via MCP" → one tool call, `attach_image(workUnitId, filePath)`, no new backend surface, reuses all existing validation (image MIME allowlist, 10 MB limit, 404 on missing work unit) for free. ✅

**Type consistency:** `LocalImage` (`{buffer, filename, mimeType}`) from Task 1 is exactly what Task 2's `attachImage` destructures and forwards to `client.addAttachment(workUnitId, buffer, filename, mimeType)`; `AttachmentDTO` return type is identical across `client.addAttachment`, the existing `route.ts`'s `attachmentToDTO`, and the tools test's fake client. One name (`filePath`, `filename`, `workUnitId`) throughout the client method, handler args, and `inputSchema`.

**Placeholder scan:** every step has concrete code; no "TBD"/"add error handling"/"similar to Task N". Step 5 of Task 2 explicitly tells the implementer to match the existing test file's own import style rather than inventing one, flagged as a judgment call rather than hidden.

**Open follow-ups (not in scope):** no `remove_attachment` MCP tool (the existing `DELETE /api/attachments/[id]` route isn't exposed via MCP) — can be a fast follow if needed; local pre-upload size check (to fail fast with a friendlier message than the server's 413) was considered and deliberately skipped as YAGNI, since it would duplicate the `10 * 1024 * 1024` constant across the app/MCP boundary for a marginal UX gain.
