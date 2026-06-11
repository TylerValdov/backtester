"use client";

// Return distribution histogram. Bars below zero render in --color-down,
// above in --color-up — the one place semantic colors carry the chart.

import { useMemo } from "react";
import { CHART, linearScale, useMeasure } from "./base";

export function Histogram({
  counts,
  edges,
  height = 220,
}: {
  counts: number[];
  edges: number[];
  height?: number;
}) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const width = size.width || 600;
  const m = { ...CHART.margin, left: 36 };

  const { xScale, yScale } = useMemo(() => {
    const maxC = Math.max(...counts, 1);
    return {
      xScale: linearScale([edges[0], edges[edges.length - 1]], [m.left, width - m.right]),
      yScale: linearScale([0, maxC], [height - m.bottom, m.top]),
    };
  }, [counts, edges, width, height, m.left, m.right, m.bottom, m.top]);

  const zero = xScale(0);

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <svg width={width} height={height} role="img">
        {counts.map((c, i) => {
          const x0 = xScale(edges[i]);
          const x1 = xScale(edges[i + 1]);
          const mid = (edges[i] + edges[i + 1]) / 2;
          return (
            <rect
              key={i}
              x={x0 + 0.5}
              width={Math.max(x1 - x0 - 1, 1)}
              y={yScale(c)}
              height={height - m.bottom - yScale(c)}
              fill={mid >= 0 ? "var(--color-up)" : "var(--color-down)"}
              opacity={0.65}
            />
          );
        })}
        <line x1={zero} x2={zero} y1={m.top} y2={height - m.bottom} stroke="var(--color-neutral)" strokeWidth={1} strokeDasharray="2 3" />
        <line x1={m.left} x2={width - m.right} y1={height - m.bottom} y2={height - m.bottom} stroke={CHART.rule} />
        {[edges[0], 0, edges[edges.length - 1]].map((v, i) => (
          <text
            key={i}
            x={xScale(v)}
            y={height - 6}
            textAnchor="middle"
            fontSize={10}
            fill={CHART.axisText}
            style={{ fontFamily: CHART.fontMono, fontVariantNumeric: "tabular-nums" }}
          >
            {(v * 100).toFixed(1)}%
          </text>
        ))}
      </svg>
    </div>
  );
}
