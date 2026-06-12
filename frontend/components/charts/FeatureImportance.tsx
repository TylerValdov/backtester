"use client";

// Horizontal bars of relative feature importance (already normalized to sum 1).

export function FeatureImportance({ importances }: { importances: Record<string, number> }) {
  const rows = Object.entries(importances).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map(([, v]) => v), 0.0001);
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(([name, v]) => (
        <li key={name} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
          <span className="truncate text-[var(--color-muted)]" title={name}>{name}</span>
          <span className="h-2 rounded-[2px] bg-[var(--color-paper-3)]">
            <span className="block h-full rounded-[2px] bg-[var(--color-accent)]" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="tnum text-right text-[var(--color-neutral)]">{(v * 100).toFixed(0)}%</span>
        </li>
      ))}
    </ul>
  );
}
