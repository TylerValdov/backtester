"use client";

// Signal correlation heatmap. Diverging scale: −1 down-red → 0 paper → +1 up-green.

export function Heatmap({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  const n = labels.length;
  return (
    <div className="overflow-x-auto">
      <table className="tnum border-collapse text-xs" style={{ fontFamily: "var(--font-mono)" }}>
        <thead>
          <tr>
            <th />
            {labels.map((l) => (
              <th key={l} className="px-1 pb-2 font-normal text-[var(--color-neutral)]" style={{ maxWidth: 72 }}>
                <span className="block truncate" title={l}>{l}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <th className="pr-2 text-right font-normal text-[var(--color-neutral)]" style={{ maxWidth: 110 }}>
                <span className="block truncate" title={labels[i]}>{labels[i]}</span>
              </th>
              {row.map((v, j) => (
                <td
                  key={j}
                  className="h-9 w-12 border border-[var(--color-paper)] text-center"
                  style={{ background: cellColor(v, i === j), color: Math.abs(v) > 0.6 ? "var(--color-paper)" : "var(--color-ink)" }}
                  title={`${labels[i]} × ${labels[j]}: ${v.toFixed(2)}`}
                >
                  {v.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellColor(v: number, diagonal: boolean): string {
  if (diagonal) return "var(--color-paper-3)";
  const t = Math.min(Math.abs(v), 1);
  // interpolate opacity over the up/down hue
  return v >= 0
    ? `color-mix(in oklch, var(--color-up) ${Math.round(t * 75)}%, var(--color-paper-2))`
    : `color-mix(in oklch, var(--color-down) ${Math.round(t * 75)}%, var(--color-paper-2))`;
}
