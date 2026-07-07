/**
 * GET /api/reports - All four report sections in one payload.
 *
 * Query params: projectId? (omitted = all projects), from?/to? (ISO date
 * strings, inclusive). Invalid dates or from > to -> 400. Unknown projectId
 * returns empty sections (consistent with existing routes' tolerance).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCompletedWork } from "@/lib/reports/completedWork";
import { getJiraTrail } from "@/lib/reports/jiraTrail";
import { getStatusSnapshot } from "@/lib/reports/snapshot";
import { getThroughput } from "@/lib/reports/throughput";
import { getTrends } from "@/lib/reports/trends";
import type { ReportFilters } from "@/lib/reports/types";

function parseDateParam(
  value: string | null,
  name: string
): { date?: Date; error?: string } {
  if (value === null) return {};
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: `Invalid ${name} date: ${value}` };
  }
  return { date };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const fromResult = parseDateParam(searchParams.get("from"), "from");
    if (fromResult.error) {
      return NextResponse.json({ error: fromResult.error }, { status: 400 });
    }
    const toResult = parseDateParam(searchParams.get("to"), "to");
    if (toResult.error) {
      return NextResponse.json({ error: toResult.error }, { status: 400 });
    }
    if (fromResult.date && toResult.date && fromResult.date > toResult.date) {
      return NextResponse.json(
        { error: "from must not be after to" },
        { status: 400 }
      );
    }

    const filters: ReportFilters = {
      projectId: searchParams.get("projectId") ?? undefined,
      from: fromResult.date,
      to: toResult.date,
    };

    const [completedWork, throughput, statusSnapshot, jiraTrail, trends] =
      await Promise.all([
        getCompletedWork(filters),
        getThroughput(filters),
        getStatusSnapshot(filters),
        getJiraTrail(filters),
        getTrends(filters),
      ]);

    return NextResponse.json({
      completedWork,
      throughput,
      statusSnapshot,
      jiraTrail,
      trends,
    });
  } catch (error) {
    console.error("Error building reports:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
