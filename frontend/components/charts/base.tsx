"use client";

// Chart kit foundations: responsive measurement, scales, axis rendering.
// Charts are hand-built SVG — instruments, not infographics. Shared rules:
// hairline grid, mono tabular tick labels, no decorative animation.

import { useEffect, useRef, useState } from "react";

export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export type Scale = (v: number) => number;

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (count * step) / span;
  const mult = err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1;
  const niceStep = step * mult;
  const start = Math.ceil(min / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += niceStep) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export function fmtTick(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(0)}k`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) < 1 && v !== 0) return v.toFixed(2);
  return v.toFixed(0);
}

export function dateTickIndices(n: number, target = 6): number[] {
  if (n <= target) return Array.from({ length: n }, (_, i) => i);
  const step = Math.floor(n / target);
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  return out;
}

export const CHART = {
  margin: { top: 10, right: 12, bottom: 22, left: 48 },
  rule: "var(--color-rule-soft)",
  axisText: "var(--color-neutral)",
  fontMono: "var(--font-mono)",
};

export function AxisLabels({
  width,
  height,
  yTicks,
  yScale,
  xLabels,
  fmt = fmtTick,
}: {
  width: number;
  height: number;
  yTicks: number[];
  yScale: Scale;
  xLabels: { x: number; label: string }[];
  fmt?: (v: number) => string;
}) {
  const m = CHART.margin;
  return (
    <g>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={m.left} x2={width - m.right} y1={yScale(t)} y2={yScale(t)} stroke={CHART.rule} strokeWidth={1} />
          <text
            x={m.left - 6}
            y={yScale(t) + 3}
            textAnchor="end"
            fontSize={10}
            fill={CHART.axisText}
            style={{ fontFamily: CHART.fontMono, fontVariantNumeric: "tabular-nums" }}
          >
            {fmt(t)}
          </text>
        </g>
      ))}
      {xLabels.map((l, i) => (
        <text
          key={`x${i}`}
          x={l.x}
          y={height - 6}
          textAnchor="middle"
          fontSize={10}
          fill={CHART.axisText}
          style={{ fontFamily: CHART.fontMono, fontVariantNumeric: "tabular-nums" }}
        >
          {l.label}
        </text>
      ))}
    </g>
  );
}

export function pathFrom(points: [number, number][]): string {
  if (points.length === 0) return "";
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}
