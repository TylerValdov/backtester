"use client";

// Portfolio allocation donut. Neutral ink ramp + accent for the largest slice;
// up/down stay reserved for P&L.

const RAMP = [
  "var(--color-accent)",
  "oklch(70% 0.06 240)",
  "oklch(58% 0.05 240)",
  "oklch(48% 0.04 240)",
  "oklch(40% 0.035 240)",
  "oklch(33% 0.03 240)",
  "oklch(27% 0.025 240)",
];

export function Donut({
  slices,
  size = 180,
}: {
  slices: { label: string; value: number }[];
  size?: number;
}) {
  const total = slices.reduce((a, s) => a + Math.abs(s.value), 0) || 1;
  const sorted = [...slices].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const r = size / 2 - 6;
  const cx = size / 2;
  const stroke = 22;

  let angle = -Math.PI / 2;
  const arcs = sorted.map((s, i) => {
    const frac = Math.abs(s.value) / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    return { ...s, a0, a1, color: RAMP[i % RAMP.length], frac };
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} role="img" aria-label="Portfolio allocation">
        {arcs.map((a, i) => (
          <path key={i} d={arcPath(cx, cx, r - stroke / 2, a.a0, Math.min(a.a1, a.a0 + Math.PI * 1.9999))} fill="none" stroke={a.color} strokeWidth={stroke} />
        ))}
        <circle cx={cx} cy={cx} r={r - stroke - 4} fill="var(--color-paper-2)" />
      </svg>
      <ul className="flex flex-col gap-1 text-xs" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
        {arcs.map((a, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: a.color }} />
            <span className="text-[var(--color-muted)]">{a.label}</span>
            <span className="ml-auto pl-4 text-[var(--color-ink)]">{(a.frac * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}
