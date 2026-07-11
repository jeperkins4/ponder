"use client";

/**
 * /reports — the reporting suite page. One fetch to GET /api/reports returns
 * all four sections; the project selector and date-range presets refetch.
 * All aggregation lives in src/lib/reports/ — this page only renders.
 */

import { Fragment, useEffect, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { COLUMNS } from "@/lib/columns";
import { TimeSeriesChart } from "@/components/reports/TimeSeriesChart";
import { TrendLineChart } from "@/components/reports/TrendLineChart";
import { WeeklyBarChart } from "@/components/reports/WeeklyBarChart";
import type { ReportsPayload } from "@/lib/reports/types";
import type { ProjectWithStats } from "@/lib/types";

const MS_PER_DAY = 86_400_000;

const RANGE_PRESETS: { label: string; days: number | null }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: null },
];

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatDateTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

function toSeriesPoints(buckets: string[], values: number[]) {
  return buckets.map((label, i) => ({ label, value: values[i] }));
}

const EVENT_LABELS: Record<string, string> = {
  moved_to_qa: "Moved to QA",
  verification: "Verification",
  story_completed: "Story completed",
};

export default function ReportsPage() {
  const { isDark, mounted } = useTheme();
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [rangeDays, setRangeDays] = useState<number | null>(30);
  const [report, setReport] = useState<ReportsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dark = mounted && isDark;

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (rangeDays !== null) {
      params.set(
        "from",
        new Date(Date.now() - rangeDays * MS_PER_DAY).toISOString()
      );
    }
    const query = params.toString();

    fetch(`/api/reports${query ? `?${query}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((data: ReportsPayload) => {
        if (!cancelled) setReport(data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load reports.");
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, rangeDays]);

  const textClass = dark ? "text-ponder-dark-text" : "text-ponder-light-text";
  const mutedClass = dark
    ? "text-ponder-dark-text-muted"
    : "text-ponder-light-text-muted";
  const cardClass = dark
    ? "bg-ponder-dark-surface border-ponder-dark-border"
    : "bg-ponder-light-surface border-ponder-light-card-border";

  return (
    <main className={`mx-auto max-w-7xl px-6 py-8 ${textClass}`}>
      <h1 className="font-space-grotesk text-2xl font-bold">Reports</h1>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor="report-project" className={`text-sm ${mutedClass}`}>
          Project
        </label>
        <select
          id="report-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${cardClass}`}
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1" role="group" aria-label="Date range">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setRangeDays(preset.days)}
              aria-pressed={rangeDays === preset.days}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                rangeDays === preset.days
                  ? "border-transparent bg-blue-600 text-white"
                  : cardClass
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-500">
          {error}
        </p>
      )}
      {!error && !report && <p className={`mt-6 text-sm ${mutedClass}`}>Loading…</p>}

      {!error && report && (
        <div className="mt-8 space-y-10">
          {/* 1. Snapshot */}
          <section aria-labelledby="snapshot-heading">
            <h2 id="snapshot-heading" className="font-space-grotesk text-lg font-bold">
              Snapshot
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {COLUMNS.map((column) => (
                <div key={column.key} className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                  <div className={`text-xs ${mutedClass}`}>{column.label}</div>
                  <div className="text-xl font-bold">
                    {report.statusSnapshot.columnTotals[column.key]}
                  </div>
                </div>
              ))}
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Awaiting verification</div>
                <div className="text-xl font-bold">
                  {report.statusSnapshot.awaitingVerification}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Failed verification</div>
                <div className="text-xl font-bold">
                  {report.statusSnapshot.failedVerification}
                </div>
              </div>
            </div>
            {report.statusSnapshot.stories.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>No active cards.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className={mutedClass}>
                      <th className="py-2 pr-4 font-semibold">Story</th>
                      <th className="py-2 pr-4 font-semibold">Status</th>
                      {COLUMNS.map((column) => (
                        <th key={column.key} className="py-2 pr-4 font-semibold">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.statusSnapshot.stories.map((story) => (
                      <tr key={story.jiraKey} className={`border-t ${cardClass}`}>
                        <td className="py-2 pr-4">
                          <span className="font-semibold">{story.jiraKey}</span>{" "}
                          {story.summary}
                        </td>
                        <td className="py-2 pr-4">{story.jiraStatus}</td>
                        {COLUMNS.map((column) => (
                          <td key={column.key} className="py-2 pr-4">
                            {story.columnCounts[column.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Trends */}
          <section aria-labelledby="trends-heading">
            <h2 id="trends-heading" className="font-space-grotesk text-lg font-bold">
              Trends
            </h2>
            {report.trends.buckets.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No activity in this range.
              </p>
            ) : (
              <div className="mt-3 space-y-8">
                <p className={`text-xs ${mutedClass}`}>
                  {report.trends.granularity === "day"
                    ? "Daily buckets"
                    : "Weekly buckets"}
                </p>
                <div>
                  <h3 className="text-sm font-semibold">Created vs Completed</h3>
                  <TimeSeriesChart
                    ariaLabel="Cards created vs completed over time"
                    series={[
                      {
                        name: "Created",
                        colorClass: "text-blue-500",
                        points: toSeriesPoints(report.trends.buckets, report.trends.created),
                      },
                      {
                        name: "Completed",
                        colorClass: "text-emerald-500",
                        points: toSeriesPoints(report.trends.buckets, report.trends.completed),
                      },
                    ]}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Cumulative completed</h3>
                  <TimeSeriesChart
                    ariaLabel="Cumulative completed cards over time"
                    series={[
                      {
                        name: "Completed (cumulative)",
                        colorClass: "text-purple-500",
                        points: toSeriesPoints(
                          report.trends.buckets,
                          report.trends.cumulativeCompleted
                        ),
                      },
                    ]}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">WIP over time</h3>
                  <TimeSeriesChart
                    ariaLabel="Work in progress over time"
                    series={[
                      {
                        name: "WIP",
                        colorClass: "text-amber-500",
                        points: toSeriesPoints(report.trends.buckets, report.trends.wip),
                      },
                    ]}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">JIRA activity</h3>
                  <TimeSeriesChart
                    ariaLabel="JIRA-facing events over time"
                    series={[
                      {
                        name: "Move to QA",
                        colorClass: "text-blue-500",
                        points: toSeriesPoints(
                          report.trends.buckets,
                          report.trends.activity.movedToQa
                        ),
                      },
                      {
                        name: "Verifications",
                        colorClass: "text-emerald-500",
                        points: toSeriesPoints(
                          report.trends.buckets,
                          report.trends.activity.verifications
                        ),
                      },
                      {
                        name: "Story completions",
                        colorClass: "text-purple-500",
                        points: toSeriesPoints(
                          report.trends.buckets,
                          report.trends.activity.storyCompletions
                        ),
                      },
                    ]}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Verification capacity vs generation capacity */}
          <section aria-labelledby="verification-capacity-heading">
            <h2
              id="verification-capacity-heading"
              className="font-space-grotesk text-lg font-bold"
            >
              Verification capacity
            </h2>
            <p className={`mt-1 text-xs ${mutedClass}`}>
              Is checking keeping pace with making?
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>
                  Verified / generated
                </div>
                <div
                  className="text-xl font-bold"
                  data-testid="capacity-ratio"
                >
                  {report.verificationCapacity.capacityRatio ?? "—"}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>
                  Completions verified
                </div>
                <div
                  className="text-xl font-bold"
                  data-testid="verified-completion-rate"
                >
                  {report.verificationCapacity.verifiedCompletionRate !== null
                    ? `${Math.round(
                        report.verificationCapacity.verifiedCompletionRate * 100
                      )}%`
                    : "—"}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Avg verification lag</div>
                <div className="text-xl font-bold">
                  {report.verificationCapacity.avgVerificationLagDays ?? "—"}
                  {report.verificationCapacity.avgVerificationLagDays !== null &&
                    "d"}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>
                  Median verification lag
                </div>
                <div className="text-xl font-bold">
                  {report.verificationCapacity.medianVerificationLagDays ?? "—"}
                  {report.verificationCapacity.medianVerificationLagDays !==
                    null && "d"}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Verification queue</div>
                <div className="text-xl font-bold" data-testid="queue-now">
                  {report.verificationCapacity.queueDepth.length > 0
                    ? report.verificationCapacity.queueDepth[
                        report.verificationCapacity.queueDepth.length - 1
                      ]
                    : "—"}
                </div>
              </div>
            </div>
            {report.verificationCapacity.buckets.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No verification activity in this range.
              </p>
            ) : (
              <div className="mt-3 space-y-8">
                <div>
                  <h3 className="text-sm font-semibold">
                    Generated vs Verified
                  </h3>
                  <TimeSeriesChart
                    ariaLabel="Cards generated vs verifications completed over time"
                    series={[
                      {
                        name: "Generated",
                        colorClass: "text-blue-500",
                        points: toSeriesPoints(
                          report.verificationCapacity.buckets,
                          report.verificationCapacity.generated
                        ),
                      },
                      {
                        name: "Verified",
                        colorClass: "text-emerald-500",
                        points: toSeriesPoints(
                          report.verificationCapacity.buckets,
                          report.verificationCapacity.verified
                        ),
                      },
                    ]}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">
                    Verification queue depth
                  </h3>
                  <TimeSeriesChart
                    ariaLabel="Cards awaiting verification over time"
                    series={[
                      {
                        name: "Awaiting verification",
                        colorClass: "text-amber-500",
                        points: toSeriesPoints(
                          report.verificationCapacity.buckets,
                          report.verificationCapacity.queueDepth
                        ),
                      },
                    ]}
                  />
                </div>
              </div>
            )}
          </section>

          {/* 2. Throughput & cycle time */}
          <section aria-labelledby="throughput-heading">
            <h2 id="throughput-heading" className="font-space-grotesk text-lg font-bold">
              Throughput &amp; cycle time
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Completed</div>
                <div className="text-xl font-bold">{report.throughput.totalCompleted}</div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Avg cycle time</div>
                <div className="text-xl font-bold">
                  {report.throughput.avgCycleTimeDays ?? "—"}
                  {report.throughput.avgCycleTimeDays !== null && "d"}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Median cycle time</div>
                <div className="text-xl font-bold">
                  {report.throughput.medianCycleTimeDays ?? "—"}
                  {report.throughput.medianCycleTimeDays !== null && "d"}
                </div>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${cardClass}`}>
                <div className={`text-xs ${mutedClass}`}>Cards / week</div>
                <div className="text-xl font-bold">
                  {report.throughput.avgCardsPerWeek ?? "—"}
                </div>
              </div>
            </div>
            {report.throughput.weeks.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No throughput data in this range.
              </p>
            ) : (
              <div className="mt-4 space-y-6">
                <WeeklyBarChart
                  ariaLabel="Cards completed per week"
                  data={report.throughput.weeks.map((week) => ({
                    label: week.weekStart,
                    value: week.completedCount,
                  }))}
                />
                <TrendLineChart
                  ariaLabel="Average cycle time per week (days)"
                  data={report.throughput.weeks.map((week) => ({
                    label: week.weekStart,
                    value: week.avgCycleTimeDays,
                  }))}
                />
              </div>
            )}
          </section>

          {/* 3. Completed work */}
          <section aria-labelledby="completed-heading">
            <h2 id="completed-heading" className="font-space-grotesk text-lg font-bold">
              Completed work
            </h2>
            <p className={`mt-1 text-sm ${mutedClass}`}>
              {report.completedWork.totalCards} card(s) across{" "}
              {report.completedWork.totalStories} story(ies)
            </p>
            {report.completedWork.stories.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No completed work in this range.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className={mutedClass}>
                      <th className="py-2 pr-4 font-semibold">Card</th>
                      <th className="py-2 pr-4 font-semibold">Completed</th>
                      <th className="py-2 pr-4 font-semibold">Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.completedWork.stories.map((story) => (
                      <Fragment key={story.jiraKey}>
                        <tr className={`border-t ${cardClass}`}>
                          <td colSpan={3} className="py-2 pr-4 font-semibold">
                            {story.jiraKey}: {story.summary}
                          </td>
                        </tr>
                        {story.cards.map((card) => (
                          <tr key={card.id} className={`border-t ${cardClass}`}>
                            <td className="py-2 pl-6 pr-4">
                              {card.title}
                              {card.subNumber !== null && (
                                <span className={mutedClass}> #{card.subNumber}</span>
                              )}
                            </td>
                            <td className="py-2 pr-4">{formatDate(card.completedAt)}</td>
                            <td className="py-2 pr-4">
                              {card.verificationOutcome === "passed" && (
                                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                  passed
                                </span>
                              )}
                              {card.verificationOutcome === "failed" && (
                                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                                  failed
                                </span>
                              )}
                              {card.verificationOutcome === null && (
                                <span className={mutedClass}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 4. JIRA trail */}
          <section aria-labelledby="trail-heading">
            <h2 id="trail-heading" className="font-space-grotesk text-lg font-bold">
              JIRA trail
            </h2>
            {report.jiraTrail.events.length === 0 ? (
              <p className={`mt-3 text-sm ${mutedClass}`}>
                No JIRA events in this range.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className={mutedClass}>
                      <th className="py-2 pr-4 font-semibold">When</th>
                      <th className="py-2 pr-4 font-semibold">Event</th>
                      <th className="py-2 pr-4 font-semibold">Issue</th>
                      <th className="py-2 pr-4 font-semibold">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.jiraTrail.events.map((event) => (
                      <tr
                        key={`${event.type}-${event.jiraKey}-${event.timestamp}`}
                        className={`border-t ${cardClass}`}
                      >
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {formatDateTime(event.timestamp)}
                        </td>
                        <td className="py-2 pr-4">
                          {EVENT_LABELS[event.type] ?? event.type}
                          {event.outcome && ` (${event.outcome})`}
                        </td>
                        <td className="py-2 pr-4 font-semibold">{event.jiraKey}</td>
                        <td className="py-2 pr-4">{event.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
