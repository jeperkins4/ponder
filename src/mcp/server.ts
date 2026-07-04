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
import {
  attachImage,
  listProjects,
  listStories,
  listWorkUnits,
  markDone,
  moveWorkUnit,
  regenerateAcceptance,
  reportVerification,
  updateWorkUnit,
} from "./tools";

export function createServer(client: PonderClient): McpServer {
  const server = new McpServer({ name: "ponder", version: "1.0.0" });

  server.registerTool(
    "list_projects",
    {
      description: "List all Ponder projects with story/work-unit stats.",
    },
    async () => listProjects(client)
  );

  server.registerTool(
    "list_stories",
    {
      description: "List stories (with their work units) for a project.",
      inputSchema: {
        projectId: z.string(),
      },
    },
    async ({ projectId }) => listStories(client, { projectId })
  );

  server.registerTool(
    "list_work_units",
    {
      description:
        "List work units for a project, optionally filtered to a single column, " +
        "or to only those pending AI-agent verification (pendingVerification: true).",
      inputSchema: {
        projectId: z.string(),
        column: z.string().optional(),
        pendingVerification: z.boolean().optional(),
      },
    },
    async ({ projectId, column, pendingVerification }) =>
      listWorkUnits(client, { projectId, column, pendingVerification })
  );

  server.registerTool(
    "move_work_unit",
    {
      description:
        "Move a work unit to a column (todo, in_progress, code_review, done) and optional order. " +
        "Moving to a working lane or Done may update the linked JIRA issue " +
        "(In Progress, or Code Revew + a summary comment) — this happens " +
        "server-side automatically.",
      inputSchema: {
        workUnitId: z.string(),
        column: z.string(),
        order: z.number().optional(),
      },
    },
    async ({ workUnitId, column, order }) =>
      moveWorkUnit(client, { workUnitId, column, order })
  );

  server.registerTool(
    "mark_done",
    {
      description:
        "Move a work unit to the done column. May drive the linked JIRA " +
        "issue to Code Revew (+ a summary comment) once all of the story's " +
        "cards are Done — this happens server-side automatically.",
      inputSchema: {
        workUnitId: z.string(),
      },
    },
    async ({ workUnitId }) => markDone(client, { workUnitId })
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
    async ({ workUnitId, title, description }) =>
      updateWorkUnit(client, { workUnitId, title, description })
  );

  server.registerTool(
    "regenerate_acceptance",
    {
      description:
        "(Re)generate a work unit's acceptance criteria and verification with Claude. " +
        "Pass codebaseContext (a located slice of the repo's Understand-Anything " +
        "knowledge-graph.json) to ground the output in real files, layers, and tests.",
      inputSchema: {
        workUnitId: z.string(),
        codebaseContext: z.string().optional(),
      },
    },
    async ({ workUnitId, codebaseContext }) =>
      regenerateAcceptance(client, { workUnitId, codebaseContext })
  );

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

  server.registerTool(
    "report_verification",
    {
      description:
        "Report the result of an AI-agent verification run for a Code Review " +
        "work unit (requested via the Verify button). Attach the supporting " +
        "screenshot separately with attach_image before or after calling this. " +
        "If the work unit had no documented verification steps, pass " +
        "verificationSteps to record what you ran.",
      inputSchema: {
        workUnitId: z.string(),
        outcome: z.enum(["passed", "failed"]),
        summary: z.string(),
        verificationSteps: z.string().optional(),
      },
    },
    async ({ workUnitId, outcome, summary, verificationSteps }) =>
      reportVerification(client, { workUnitId, outcome, summary, verificationSteps })
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
