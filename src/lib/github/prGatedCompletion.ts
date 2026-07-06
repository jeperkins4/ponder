/**
 * PR-gated completion: a story whose JIRA key appears in an open-or-merged
 * PR (branch name or title) across the project's configured GitHub repos
 * has all of its active cards moved to done — stamping completedAt via the
 * shared moveWorkUnitColumn helper, leaving a provenance work note per
 * card — and fires applyStoryStatusSync once (the same JIRA write-back a
 * manual drag to done triggers).
 *
 * Idempotent by construction: only stories with at least one active
 * not-done card are candidates, so a re-run finds nothing to move.
 * Feature-off states (no repos configured, no GITHUB_TOKEN) return zeros
 * silently. Per-repo GitHub failures become warnings, never throws.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyStoryStatusSync } from "@/lib/statusTrigger";
import { moveWorkUnitColumn } from "@/lib/completeMove";
import { fetchRecentPrs, type FetchPrsResult, type PrSummary } from "./client";
import { findPrForKey } from "./prMatch";

export interface PrGateResult {
  cardsCompleted: number;
  storiesCompleted: number;
  warnings: string[];
}

export interface PrGateDeps {
  fetchPrs: (repo: string, token: string) => Promise<FetchPrsResult>;
  applyStorySync: (
    storyId: string,
    prismaClient: PrismaClient
  ) => Promise<unknown>;
}

const defaultDeps: PrGateDeps = {
  fetchPrs: fetchRecentPrs,
  applyStorySync: (storyId, prismaClient) =>
    applyStoryStatusSync(storyId, prismaClient),
};

export async function applyPrGatedCompletion(
  projectId: string,
  prismaClient: PrismaClient = prisma,
  deps: PrGateDeps = defaultDeps
): Promise<PrGateResult> {
  const empty: PrGateResult = {
    cardsCompleted: 0,
    storiesCompleted: 0,
    warnings: [],
  };

  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
  });
  const token = process.env.GITHUB_TOKEN;
  const repos = (project?.githubRepos ?? "")
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);

  if (!project || repos.length === 0 || !token) {
    return empty;
  }

  // Candidate = story with at least one active (non-archived) card that is
  // not yet done. All-done or fully-archived stories are excluded, which is
  // what makes re-runs no-ops.
  const candidates = await prismaClient.story.findMany({
    where: {
      projectId,
      workUnits: { some: { archivedAt: null, column: { not: "done" } } },
    },
    include: {
      workUnits: { where: { archivedAt: null, column: { not: "done" } } },
    },
  });

  if (candidates.length === 0) {
    return empty;
  }

  const warnings: string[] = [];
  const prs: PrSummary[] = [];
  for (const repo of repos) {
    const result = await deps.fetchPrs(repo, token);
    if (Array.isArray(result)) {
      prs.push(...result);
    } else {
      warnings.push(result.warning);
    }
  }

  let cardsCompleted = 0;
  let storiesCompleted = 0;

  for (const story of candidates) {
    const pr = findPrForKey(story.jiraKey, prs);
    if (!pr) continue;

    for (const unit of story.workUnits) {
      await moveWorkUnitColumn(unit.id, "done", unit.order, prismaClient);
      await prismaClient.workNote.create({
        data: {
          workUnitId: unit.id,
          body: `Completed by PR #${pr.number}: ${pr.url}`,
        },
      });
      cardsCompleted++;
    }

    await deps.applyStorySync(story.id, prismaClient);
    storiesCompleted++;
  }

  return { cardsCompleted, storiesCompleted, warnings };
}
