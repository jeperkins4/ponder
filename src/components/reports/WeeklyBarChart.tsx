/**
 * Minimal hand-rolled SVG bar chart for weekly counts — no charting
 * dependency by design (see the reporting-suite spec). Scales via viewBox;
 * colors use Tailwind fill classes so it follows the app theme.
 */

interface BarDatum {
  label: string; // YYYY-MM-DD week start
  value: number;
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = { top: 16, right: 8, bottom: 24, left: 8 };

export function WeeklyBarChart({
  data,
  ariaLabel,
}: {
  data: BarDatum[];
  ariaLabel: string;
}) {
  if (data.length === 0) return null;

  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = chartWidth / data.length;
  const barWidth = Math.min(slot * 0.7, 48);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full max-w-2xl"
    >
      {data.map((d, i) => {
        const barHeight = (d.value / max) * chartHeight;
        const xCenter = PADDING.left + i * slot + slot / 2;
        const y = PADDING.top + chartHeight - barHeight;
        return (
          <g key={d.label}>
            <rect
              data-testid="bar"
              x={xCenter - barWidth / 2}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={3}
              className="fill-blue-500"
            />
            <text
              x={xCenter}
              y={y - 4}
              textAnchor="middle"
              className="fill-current text-[10px]"
            >
              {d.value}
            </text>
            <text
              x={xCenter}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-current text-[10px]"
            >
              {d.label.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
