/**
 * Ponder MCP server entry point.
 *
 * Exposes Ponder's board (projects, stories, work units) to an MCP client
 * (e.g. Claude Code) over stdio. Every tool is a thin wrapper around
 * PonderClient, which itself just calls Ponder's existing REST API — no
 * business logic is duplicated here.
 */

import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// Imported from the "zod/v3" subpath (rather than the "zod" package root)
// to match the exact module the MCP SDK's zod-compat layer resolves types
// against under this project's `moduleResolution: "node"` tsconfig — using
// the root import triggers a TS2589 "excessively deep" instantiation error
// because the root and "zod/v3" resolve to structurally-identical but
// nominally distinct declaration files.
import { z } from "zod/v3";
import { PonderClient } from "./client";

// NOTE: tool handlers are placeholders. Tasks 2-3 replace these bodies with
// real PonderClient calls and result formatting.
function notImplemented(toolName: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${toolName}: not yet implemented`,
      },
    ],
  };
}

export function createServer(client: PonderClient): McpServer {
  const server = new McpServer({ name: "ponder", version: "1.0.0" });

  server.registerTool(
    "list_projects",
    {
      description: "List all Ponder projects with story/work-unit stats.",
    },
    async () => notImplemented("list_projects")
  );

  server.registerTool(
    "list_stories",
    {
      description: "List stories (with their work units) for a project.",
      inputSchema: {
        projectId: z.string(),
      },
    },
    async () => notImplemented("list_stories")
  );

  server.registerTool(
    "list_work_units",
    {
      description:
        "List work units for a project, optionally filtered to a single column.",
      inputSchema: {
        projectId: z.string(),
        column: z.string().optional(),
      },
    },
    async () => notImplemented("list_work_units")
  );

  server.registerTool(
    "move_work_unit",
    {
      description: "Move a work unit to a column (and optional order).",
      inputSchema: {
        workUnitId: z.string(),
        column: z.string(),
        order: z.number().optional(),
      },
    },
    async () => notImplemented("move_work_unit")
  );

  server.registerTool(
    "mark_done",
    {
      description: "Move a work unit to the done column.",
      inputSchema: {
        workUnitId: z.string(),
      },
    },
    async () => notImplemented("mark_done")
  );

  server.registerTool(
    "update_work_unit",
    {
      description: "Update a work unit's title and/or description.",
      inputSchema: {
        workUnitId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
      },
    },
    async () => notImplemented("update_work_unit")
  );

  return server;
}

async function main() {
  const client = new PonderClient();
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start the stdio transport when this file is run directly (e.g.
// `tsx src/mcp/server.ts`), not when imported by tests or other modules.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Ponder MCP server failed to start:", error);
    process.exit(1);
  });
}
