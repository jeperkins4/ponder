/**
 * Minimal hand-rolled SVG line chart for weekly trends. Null values (weeks
 * with no completions) get an axis label but no point; the line connects the
 * non-null points in order.
 */

interface TrendDatum {
  label: string; // YYYY-MM-DD week start
  value: number | null;
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = { top: 16, right: 16, bottom: 24, left: 16 };

export function TrendLineChart({
  data,
  ariaLabel,
}: {
  data: TrendDatum[];
  ariaLabel: string;
}) {
  const points = data
    .map((d, index) => ({ ...d, index }))
    .filter((d): d is { label: string; value: number; index: number } =>
      d.value !== null
    );
  if (points.length === 0) return null;

  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(...points.map((p) => p.value), 1);
  const xAt = (index: number) =>
    data.length === 1
      ? PADDING.left + chartWidth / 2
      : PADDING.left + (index / (data.length - 1)) * chartWidth;
  const yAt = (value: number) =>
    PADDING.top + chartHeight - (value / max) * chartHeight;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full max-w-2xl"
    >
      <polyline
        points={points.map((p) => `${xAt(p.index)},${yAt(p.value)}`).join(" ")}
        className="fill-none stroke-purple-500"
        strokeWidth={2}
      />
      {points.map((p) => (
        <g key={p.label}>
          <circle
            data-testid="point"
            cx={xAt(p.index)}
            cy={yAt(p.value)}
            r={3.5}
            className="fill-purple-500"
          />
          <text
            x={xAt(p.index)}
            y={yAt(p.value) - 8}
            textAnchor="middle"
            className="fill-current text-[10px]"
          >
            {p.value}
          </text>
        </g>
      ))}
      {data.map((d, index) => (
        <text
          key={d.label}
          x={xAt(index)}
          y={HEIGHT - 8}
          textAnchor="middle"
          className="fill-current text-[10px]"
        >
          {d.label.slice(5)}
        </text>
      ))}
    </svg>
  );
}
