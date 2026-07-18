"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { TrendLineChart } from "@/components/reports/TrendLineChart";
import type { EquilibriumPayload } from "@/lib/equilibrium/types";

const BAND_LABEL: Record<EquilibriumPayload["band"], string> = {
  equilibrium: "In Equilibrium",
  drifting: "Drifting",
  out: "Out of Equilibrium",
};

const BAND_COLOR_CLASS: Record<EquilibriumPayload["band"], string> = {
  equilibrium: "bg-emerald-500 text-white",
  drifting: "bg-amber-500 text-white",
  out: "bg-red-500 text-white",
};

const AXIS_LABELS: { key: keyof EquilibriumPayload["axes"]; label: string }[] = [
  { key: "decomposition", label: "Decomposition" },
  { key: "rigor", label: "Rigor" },
  { key: "wip", label: "WIP" },
  { key: "staleness", label: "Staleness" },
];

export default function EquilibriumMeterWidget() {
  const { isDark, mounted } = useTheme();
  const [payload, setPayload] = useState<EquilibriumPayload | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/equilibrium")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setPayload(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dark = mounted && isDark;
  const panelClass = dark
    ? "bg-ponder-dark-surface border-ponder-dark-border text-ponder-dark-text"
    : "bg-ponder-light-surface border-ponder-light-card-border text-ponder-light-text";

  if (!payload) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`Equilibrium meter: ${payload.overall}, ${BAND_LABEL[payload.band]}`}
        className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${BAND_COLOR_CLASS[payload.band]}`}
      >
        <span>{payload.overall}</span>
        <span className="hidden sm:inline">{BAND_LABEL[payload.band]}</span>
      </button>

      {expanded && (
        <div
          role="dialog"
          aria-label="Equilibrium meter details"
          className={`absolute right-0 z-50 mt-2 w-80 rounded-lg border p-4 shadow-lg ${panelClass}`}
        >
          <h3 className="mb-2 font-space-grotesk text-sm font-bold">Axes</h3>
          <ul className="mb-3 space-y-1 text-sm">
            {AXIS_LABELS.map(({ key, label }) => (
              <li key={key} className="flex justify-between">
                <span>{label}</span>
                <span>{payload.axes[key]}</span>
              </li>
            ))}
          </ul>

          <p className="mb-3 text-sm">
            Churn: {payload.churnEvents} event{payload.churnEvents === 1 ? "" : "s"} · damper{" "}
            {Math.round(payload.churnDamper * 100)}%
          </p>

          <p className="mb-3 text-sm">
            Rigor streak: {payload.streaks.rigorStreak} · Balance streak:{" "}
            {payload.streaks.balanceStreak}
          </p>

          <h3 className="mb-2 font-space-grotesk text-sm font-bold">Badges</h3>
          <ul className="mb-3 space-y-1 text-sm">
            {payload.badges.map((badge) => (
              <li
                key={badge.key}
                className={badge.earnedAt ? "" : "opacity-40"}
                title={badge.earnedAt ? undefined : badge.condition}
              >
                {badge.label}
              </li>
            ))}
          </ul>

          {payload.history.length > 1 && (
            <TrendLineChart
              ariaLabel="Equilibrium score history"
              data={payload.history.map((h) => ({ label: h.date, value: h.overall }))}
            />
          )}
        </div>
      )}
    </div>
  );
}
