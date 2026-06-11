"use client";

// Multi-series line chart with hover crosshair + mono readout.
// Used for: equity curves (strategy vs benchmark), rolling Sharpe, intraday P&L.

import { useMemo, useState } from "react";
import { AxisLabels, CHART, dateTickIndices, fmtTick, linearScale, niceTicks, pathFrom, useMeasure } from "./base";

export type Series = {
  name: string;
  values: (number | null)[];
  color: string; // token reference, e.g. "var(--color-accent)"
  width?: number;
  dashed?: boolean;
};

export function LineChart({
  labels,
  series,
  height = 280,
  yFmt = fmtTick,
  baseline,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  yFmt?: (v: number) => string;
  baseline?: number; // draw a reference line (e.g. 0 for Sharpe)
}) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const width = size.width || 600;
  const m = CHART.margin;

  const { yScale, xScale, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && !Number.isNaN(v)));
    let lo = Math.min(...all, baseline ?? Infinity);
    let hi = Math.max(...all, baseline ?? -Infinity);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    const pad = (hi - lo) * 0.06 || 1;
    const yScale = linearScale([lo - pad, hi + pad], [height - m.bottom, m.top]);
    const xScale = linearScale([0, Math.max(labels.length - 1, 1)], [m.left, width - m.right]);
    return { yScale, xScale, ticks: niceTicks(lo, hi, 5) };
  }, [series, labels.length, width, height, baseline, m.bottom, m.left, m.right, m.top]);

  const xLabels = dateTickIndices(labels.length).map((i) => ({ x: xScale(i), label: shortDate(labels[i]) }));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.round(((x - m.left) / (width - m.left - m.right)) * (labels.length - 1));
    setHover(i >= 0 && i < labels.length ? i : null);
  }

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
        <AxisLabels width={width} height={height} yTicks={ticks} yScale={yScale} xLabels={xLabels} fmt={yFmt} />
        {baseline !== undefined && (
          <line
            x1={m.left}
            x2={width - m.right}
            y1={yScale(baseline)}
            y2={yScale(baseline)}
            stroke="var(--color-neutral)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        )}
        {series.map((s) => {
          const pts: [number, number][] = [];
          s.values.forEach((v, i) => {
            if (v !== null && !Number.isNaN(v)) pts.push([xScale(i), yScale(v)]);
          });
          return (
            <path
              key={s.name}
              d={pathFrom(pts)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 1.5}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              strokeLinejoin="round"
            />
          );
        })}
        {hover !== null && (
          <line x1={xScale(hover)} x2={xScale(hover)} y1={m.top} y2={height - m.bottom} stroke="var(--color-rule)" strokeWidth={1} />
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-[3px] border border-[var(--color-rule)] bg-[var(--color-paper)] px-2.5 py-1.5 text-xs"
          style={{
            left: Math.min(Math.max(xScale(hover) + 8, m.left), width - 170),
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            zIndex: "var(--z-tooltip)",
          }}
        >
          <div className="text-[var(--color-neutral)]">{labels[hover]}</div>
          {series.map((s) => {
            const v = s.values[hover];
            return (
              <div key={s.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-[2px] w-3" style={{ background: s.color }} />
                  <span className="text-[var(--color-muted)]">{s.name}</span>
                </span>
                <span className="text-[var(--color-ink)]">{v === null || v === undefined ? "—" : yFmt(v)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function shortDate(d: string): string {
  // "2019-04-03" -> "Apr ’19"; intraday ISO -> hh:mm
  if (d.includes("T")) return d.slice(11, 16);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, mo] = d.split("-");
  return `${months[Number(mo) - 1]} ’${y.slice(2)}`;
}
