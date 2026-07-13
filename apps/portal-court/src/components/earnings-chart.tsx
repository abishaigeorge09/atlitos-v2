import { formatINR } from "@atlitos/theme";

export interface EarningsChartPoint {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  amount: number;
}

/**
 * Hand-rolled SVG bar chart, no charting library: a single magnitude series
 * (daily gross court booking revenue) needs one hue and no legend (the card
 * title names the series). Bars are the accent color read straight off the
 * token CSS variable so light/dark both work with zero extra logic;
 * direct-labels only the most recent day (never a number on every bar,
 * per the dataviz skill's mark spec), everything else surfaces its exact
 * value on hover via a native SVG <title> tooltip, which is enough for a
 * small embedded widget on a page that already has full numeric detail
 * elsewhere.
 */
export function EarningsChart({ points }: { points: EarningsChartPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.amount));
  const hasData = points.some((p) => p.amount > 0);
  const width = 100;
  const height = 40;
  const barGap = 0.6;
  const barWidth = points.length > 0 ? width / points.length - barGap : 0;

  if (!hasData) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        No earnings yet in this period.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" preserveAspectRatio="none" role="img" aria-label="Daily gross earnings, trailing period">
        <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke="hsl(var(--color-border))" strokeWidth={0.4} />
        {points.map((p, i) => {
          const barHeight = (p.amount / max) * (height - 4);
          const x = i * (barWidth + barGap);
          const y = height - barHeight;
          const isLast = i === points.length - 1;
          return (
            <rect
              key={p.date}
              x={x}
              y={y}
              width={Math.max(barWidth, 0.1)}
              height={Math.max(barHeight, 0.5)}
              rx={0.8}
              fill={isLast ? "hsl(var(--color-accent))" : "hsl(var(--color-accent) / 0.55)"}
            >
              <title>
                {p.date}: {formatINR(p.amount)}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
        <span>{points[0]?.date.slice(5)}</span>
        <span className="text-foreground">
          {formatINR(points[points.length - 1]?.amount ?? 0)} today
        </span>
      </div>
    </div>
  );
}
