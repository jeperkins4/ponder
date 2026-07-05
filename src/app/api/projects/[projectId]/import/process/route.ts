/**
 * POST /api/projects/[projectId]/import/process
 * Persists the user's chosen JIRA import: for each item, upserts the Story
 * (by jiraKey) and creates work-unit card(s) placed in the story's target
 * column. If `breakDown` is set, Claude decomposes the story into N
 * subtask cards; otherwise a single card mirrors the story itself.
 * Already-imported stories (those with active work units) are skipped:
 * their Story fields are refreshed but no cards are created and no Claude
 * breakdown runs.
 * Read-only preview of the same data is produced by the sibling
 * import/preview route (Task 3) — this route does the actual write.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractProjectKey } from "@/lib/jira/client";
import { jiraStatusToColumn } from "@/lib/columns";
import { breakDownStory } from "@/lib/anthropic/breakdown";
import { findAlreadyImportedKeys } from "@/lib/importDedup";
import {
  parseWorkUnitDescription,
  stripParentKeyFromTitle,
} from "@/lib/workUnitDescription";

export interface ImportProcessItem {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  breakDown: boolean;
  codebaseContext?: string;
}

export interface ImportProcessResult {
  storiesProcessed: number;
  storiesSkipped: number;
  workUnitsCreated: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await request.json();
    const items: ImportProcessItem[] = Array.isArray(body?.items) ? body.items : [];

    let storiesProcessed = 0;
    let storiesSkipped = 0;
    let workUnitsCreated = 0;

    // Server-side re-check of the de-dup predicate — the client's preview
    // flag is advisory only. Computed once for the whole batch.
    const alreadyImportedKeys = await findAlreadyImportedKeys(
      items.map((item) => item.jiraKey),
      prisma
    );

    // Keys already handled earlier in THIS batch — the precomputed skip set
    // can't see cards created mid-loop, so a duplicated item in one request
    // would otherwise create cards twice.
    const seenKeys = new Set<string>();

    const baseUrl = (project.jiraSiteUrl ?? "").replace(/\/$/, "");

    // Sequential: Claude breakdown calls are slow, and doing this serially
    // keeps card `order` assignment and DB writes simple to reason about.
    for (const item of items) {
      const projectKey = extractProjectKey(item.jiraKey);
      const url = `${baseUrl}/browse/${item.jiraKey}`;

      const story = await prisma.story.upsert({
        where: { jiraKey: item.jiraKey },
        create: {
          jiraKey: item.jiraKey,
          jiraId: item.jiraId,
          projectKey,
          projectId: project.id,
          summary: item.summary,
          description: item.description,
          jiraStatus: item.jiraStatus,
          url,
          lastSyncedAt: new Date(),
        },
        update: {
          jiraId: item.jiraId,
          projectKey,
          projectId: project.id,
          summary: item.summary,
          description: item.description,
          jiraStatus: item.jiraStatus,
          url,
          lastSyncedAt: new Date(),
        },
      });

      if (alreadyImportedKeys.has(item.jiraKey) || seenKeys.has(item.jiraKey)) {
        // Already on the board: story fields were refreshed by the upsert
        // above, but no cards are created (and no Claude breakdown runs).
        storiesSkipped++;
        continue;
      }

      seenKeys.add(item.jiraKey);

      const column = jiraStatusToColumn(item.jiraStatus);

      if (item.breakDown) {
        let drafts;
        try {
          drafts = await breakDownStory({
            summary: item.summary,
            description: item.description,
            codebaseContext: item.codebaseContext,
          });
        } catch (error) {
          console.error(
            `Claude breakdown failed for ${item.jiraKey}, falling back to a single card:`,
            error
          );
          drafts = null;
        }

        if (drafts && drafts.length > 0) {
          // Broken-down stories get a stable 1-based sub-number (COM-540-1,
          // -2, ...) in the order the drafts were created — Ponder-local,
          // never sent to JIRA. Only assign one when there's actually more
          // than one unit to number; a lone draft is indistinguishable from
          // a non-decomposed story and keeps the bare key, matching the
          // backfill's "only decomposed (>1 unit) stories get numbered" rule.
          const isDecomposition = drafts.length > 1;
          for (let i = 0; i < drafts.length; i++) {
            const draft = drafts[i];
            await prisma.workUnit.create({
              data: {
                storyId: story.id,
                projectId: project.id,
                title: stripParentKeyFromTitle(draft.title, item.jiraKey),
                description: null,
                acceptanceCriteria: draft.acceptanceCriteria,
                verification: draft.verification,
                column,
                order: i,
                subNumber: isDecomposition ? i + 1 : null,
              },
            });
            workUnitsCreated++;
          }
        } else {
          const parsed = parseWorkUnitDescription(item.description);
          await prisma.workUnit.create({
            data: {
              storyId: story.id,
              projectId: project.id,
              title: item.summary,
              description: parsed.description,
              acceptanceCriteria: parsed.acceptanceCriteria,
              verification: parsed.verification,
              column,
              order: 0,
              subNumber: null,
            },
          });
          workUnitsCreated++;
        }
      } else {
        const parsed = parseWorkUnitDescription(item.description);
        await prisma.workUnit.create({
          data: {
            storyId: story.id,
            projectId: project.id,
            title: item.summary,
            description: parsed.description,
            acceptanceCriteria: parsed.acceptanceCriteria,
            verification: parsed.verification,
            column,
            order: 0,
            subNumber: null,
          },
        });
        workUnitsCreated++;
      }

      storiesProcessed++;
    }

    const result: ImportProcessResult = { storiesProcessed, storiesSkipped, workUnitsCreated };
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error processing import:", error);
    const message = error instanceof Error ? error.message : "Failed to process import";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
