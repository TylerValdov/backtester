"use client";

// Filled area chart — drawdown (underwater) plots and exposure.

import { useMemo } from "react";
import { AxisLabels, CHART, dateTickIndices, linearScale, niceTicks, pathFrom, useMeasure } from "./base";

export function AreaChart({
  labels,
  values,
  height = 180,
  color = "var(--color-down)",
  yFmt = (v: number) => `${(v * 100).toFixed(0)}%`,
}: {
  labels: string[];
  values: number[];
  height?: number;
  color?: string;
  yFmt?: (v: number) => string;
}) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const width = size.width || 600;
  const m = CHART.margin;

  const { yScale, xScale, ticks } = useMemo(() => {
    const lo = Math.min(...values, 0);
    const hi = Math.max(...values, 0);
    const pad = (hi - lo) * 0.08 || 0.01;
    const yScale = linearScale([lo - pad, hi + pad], [height - m.bottom, m.top]);
    const xScale = linearScale([0, Math.max(values.length - 1, 1)], [m.left, width - m.right]);
    return { yScale, xScale, ticks: niceTicks(lo, hi, 4) };
  }, [values, width, height, m.bottom, m.left, m.right, m.top]);

  const pts: [number, number][] = values.map((v, i) => [xScale(i), yScale(v)]);
  const area = `${pathFrom(pts)}L${xScale(values.length - 1).toFixed(1)},${yScale(0).toFixed(1)}L${xScale(0).toFixed(1)},${yScale(0).toFixed(1)}Z`;
  const xLabels = dateTickIndices(labels.length).map((i) => ({ x: xScale(i), label: shortDate(labels[i]) }));

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <svg width={width} height={height} role="img">
        <AxisLabels width={width} height={height} yTicks={ticks} yScale={yScale} xLabels={xLabels} fmt={yFmt} />
        <path d={area} fill={color} opacity={0.18} />
        <path d={pathFrom(pts)} fill="none" stroke={color} strokeWidth={1.25} />
        <line x1={m.left} x2={width - m.right} y1={yScale(0)} y2={yScale(0)} stroke="var(--color-neutral)" strokeWidth={1} />
      </svg>
    </div>
  );
}

function shortDate(d: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, mo] = d.split("-");
  return `${months[Number(mo) - 1]} ’${y.slice(2)}`;
}
