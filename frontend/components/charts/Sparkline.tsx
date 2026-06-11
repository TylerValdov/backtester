"use client";

// Tiny inline equity sparkline for strategy cards / comparison tables.

import { linearScale, pathFrom, useMeasure } from "./base";

export function Sparkline({
  values,
  height = 36,
  color,
}: {
  values: number[];
  height?: number;
  color?: string;
}) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const width = size.width || 120;
  if (values.length < 2) return <div ref={ref} style={{ height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const y = linearScale([lo, hi === lo ? lo + 1 : hi], [height - 2, 2]);
  const x = linearScale([0, values.length - 1], [0, width]);
  const stroke = color ?? (values[values.length - 1] >= values[0] ? "var(--color-up)" : "var(--color-down)");
  const pts: [number, number][] = values.map((v, i) => [x(i), y(v)]);
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <svg width={width} height={height} aria-hidden="true">
        <path d={pathFrom(pts)} fill="none" stroke={stroke} strokeWidth={1.25} />
      </svg>
    </div>
  );
}
