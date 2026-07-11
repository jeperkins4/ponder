/**
 * Multi-series hand-rolled SVG line chart — the time-series member of the
 * reports chart family (no charting dependency by design). All series share
 * one label array (parallel to the trends DTO's bucket array). Legend above,
 * a value label at each series' last point, axis labels thinned to <= 10.
 */

interface TimeSeriesPoint {
  label: string; // YYYY-MM-DD bucket start
  value: number;
}

export interface TimeSeries {
  name: string;
  colorClass: string; // Tailwind text color, e.g. "text-blue-500"
  points: TimeSeriesPoint[];
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = { top: 16, right: 16, bottom: 24, left: 16 };
const MAX_AXIS_LABELS = 10;

export function TimeSeriesChart({
  series,
  ariaLabel,
}: {
  series: TimeSeries[];
  ariaLabel: string;
}) {
  const nonEmpty = series.filter((s) => s.points.length > 0);
  if (nonEmpty.length === 0) return null;

  const labels = nonEmpty[0].points.map((p) => p.label);
  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(1, ...nonEmpty.flatMap((s) => s.points.map((p) => p.value)));

  const xAt = (i: number) =>
    labels.length === 1
      ? PADDING.left + chartWidth / 2
      : PADDING.left + (i / (labels.length - 1)) * chartWidth;
  const yAt = (value: number) =>
    PADDING.top + chartHeight - (value / max) * chartHeight;

  const stride =
    labels.length <= MAX_AXIS_LABELS
      ? 1
      : Math.ceil((labels.length - 1) / (MAX_AXIS_LABELS - 1));
  const shownLabels = new Set<number>();
  for (let i = 0; i < labels.length; i += stride) shownLabels.add(i);
  shownLabels.add(labels.length - 1);
  // Guard: the stride walk plus the forced last label can exceed the cap by
  // one when they land adjacently; drop the second-to-last shown label then.
  if (shownLabels.size > MAX_AXIS_LABELS) {
    const shown = [...shownLabels].sort((a, b) => a - b);
    shownLabels.delete(shown[shown.length - 2]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-4" data-testid="ts-legend">
        {nonEmpty.map((s) => (
          <span key={s.name} className={`flex items-center gap-1.5 text-xs ${s.colorClass}`}>
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current" />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-1 w-full max-w-4xl"
      >
        {nonEmpty.map((s) => {
          const lastIndex = s.points.length - 1;
          const lastPoint = s.points[lastIndex];
          return (
            <g key={s.name} className={s.colorClass}>
              <polyline
                points={s.points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(" ")}
                className="fill-none stroke-current"
                strokeWidth={2}
              />
              <circle
                data-testid="ts-point"
                cx={xAt(lastIndex)}
                cy={yAt(lastPoint.value)}
                r={3.5}
                className="fill-current"
              />
              <text
                x={xAt(lastIndex)}
                y={yAt(lastPoint.value) - 8}
                textAnchor="middle"
                className="fill-current text-[10px]"
              >
                {lastPoint.value}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) =>
          shownLabels.has(i) ? (
            <text
              key={label}
              data-testid="ts-axis-label"
              x={xAt(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-current text-[10px]"
            >
              {label.slice(5)}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
