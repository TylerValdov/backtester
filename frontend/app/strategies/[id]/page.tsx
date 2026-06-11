"use client";

// Strategy detail: version history + side-by-side diff (params and metrics).

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, ErrorNote, Panel, SelectField, Spinner } from "@/components/ui";
import { api, ApiError, fmtNum, fmtPct } from "@/lib/api";
import type { Metrics, Strategy, VersionDiff } from "@/lib/types";

const DIFF_METRICS: [keyof Metrics, string, (v: number) => string][] = [
  ["total_return", "total return", (v) => fmtPct(v)],
  ["cagr", "cagr", (v) => fmtPct(v)],
  ["sharpe", "sharpe", (v) => fmtNum(v)],
  ["sortino", "sortino", (v) => fmtNum(v)],
  ["max_drawdown", "max drawdown", (v) => fmtPct(v)],
  ["win_rate", "win rate", (v) => fmtPct(v, 0)],
  ["num_trades", "trades", (v) => String(v)],
];

export default function StrategyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Strategy>(`/api/strategies/${id}`).then((s) => {
      setStrategy(s);
      const vs = s.versions ?? [];
      if (vs.length >= 2) {
        setA(vs[vs.length - 2].id);
        setB(vs[vs.length - 1].id);
      } else if (vs.length === 1) {
        setA(vs[0].id);
        setB(vs[0].id);
      }
    }).catch(() => setError("Strategy not found."));
  }, [id]);

  const loadDiff = useCallback(() => {
    if (!a || !b) return;
    api.get<VersionDiff>(`/api/strategies/${id}/diff?a=${a}&b=${b}`).then(setDiff).catch(() => {});
  }, [id, a, b]);

  useEffect(loadDiff, [loadDiff]);

  async function remove() {
    if (!confirm(`Delete "${strategy?.name}" and all its versions? This cannot be undone.`)) return;
    try {
      await api.del(`/api/strategies/${id}`);
      router.push("/strategies");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  const versions = strategy?.versions ?? [];

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[72rem] flex-col gap-5">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!strategy && !error && (
          <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
            <Spinner /> Loading…
          </div>
        )}

        {strategy && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-[var(--text-lg)]">{strategy.name}</h1>
                <p className="text-sm text-[var(--color-neutral)]">{strategy.description || "No notes."}</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/build?strategy=${strategy.id}`}>
                  <Button>New version</Button>
                </Link>
                <Button variant="danger" onClick={remove}>
                  Delete
                </Button>
              </div>
            </div>

            <Panel title={`versions · ${versions.length}`}>
              <ul className="flex flex-col divide-y divide-[var(--color-rule-soft)]">
                {[...versions].reverse().map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                    <span className="tnum w-10 text-[var(--color-accent)]" style={{ fontFamily: "var(--font-mono)" }}>
                      v{v.version_number}
                    </span>
                    <span className="tnum text-xs text-[var(--color-muted)]" style={{ fontFamily: "var(--font-mono)" }}>
                      {v.signal_type} · {v.rebalance} · {v.universe.length} symbols
                    </span>
                    {v.label && <Badge tone="plain">{v.label}</Badge>}
                    <span className="ml-auto text-xs text-[var(--color-neutral)]">{v.created_at.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            {versions.length >= 2 && (
              <Panel
                title="compare versions"
                right={
                  <div className="flex items-center gap-2">
                    <SelectField label="" value={a} onChange={setA} options={versions.map((v) => ({ value: v.id, label: `v${v.version_number}` }))} />
                    <span className="text-xs text-[var(--color-neutral)]">vs</span>
                    <SelectField label="" value={b} onChange={setB} options={versions.map((v) => ({ value: v.id, label: `v${v.version_number}` }))} />
                  </div>
                }
              >
                {diff ? (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-xs uppercase tracking-[0.1em] text-[var(--color-neutral)]">Parameters</h3>
                      <table className="tnum w-full text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                        <thead>
                          <tr className="text-left text-[var(--color-neutral)]">
                            <th className="border-b border-[var(--color-rule-soft)] py-1.5 pr-3 font-normal">key</th>
                            <th className="border-b border-[var(--color-rule-soft)] py-1.5 pr-3 font-normal">v{diff.a.version_number}</th>
                            <th className="border-b border-[var(--color-rule-soft)] py-1.5 font-normal">v{diff.b.version_number}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diff.param_diff.map((d) => (
                            <tr key={d.key} className="border-b border-[var(--color-rule-soft)] last:border-0">
                              <td className="py-1.5 pr-3 text-[var(--color-muted)]">{d.key}</td>
                              <td className={`pr-3 ${d.changed ? "text-[var(--color-down)]" : "text-[var(--color-neutral)]"}`}>{String(d.a ?? "—")}</td>
                              <td className={d.changed ? "text-[var(--color-up)]" : "text-[var(--color-neutral)]"}>{String(d.b ?? "—")}</td>
                            </tr>
                          ))}
                          {diff.code_changed && (
                            <tr>
                              <td className="py-1.5 pr-3 text-[var(--color-muted)]">code</td>
                              <td colSpan={2} className="text-[var(--color-warn)]">
                                changed between versions
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h3 className="mb-2 text-xs uppercase tracking-[0.1em] text-[var(--color-neutral)]">Latest backtest metrics</h3>
                      {diff.metrics_a || diff.metrics_b ? (
                        <table className="tnum w-full text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                          <thead>
                            <tr className="text-left text-[var(--color-neutral)]">
                              <th className="border-b border-[var(--color-rule-soft)] py-1.5 pr-3 font-normal">metric</th>
                              <th className="border-b border-[var(--color-rule-soft)] py-1.5 pr-3 font-normal">v{diff.a.version_number}</th>
                              <th className="border-b border-[var(--color-rule-soft)] py-1.5 font-normal">v{diff.b.version_number}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {DIFF_METRICS.map(([key, label, fmt]) => {
                              const va = diff.metrics_a?.[key] as number | undefined;
                              const vb = diff.metrics_b?.[key] as number | undefined;
                              return (
                                <tr key={key} className="border-b border-[var(--color-rule-soft)] last:border-0">
                                  <td className="py-1.5 pr-3 text-[var(--color-muted)]">{label}</td>
                                  <td className="pr-3 text-[var(--color-ink)]">{va === undefined ? "—" : fmt(va)}</td>
                                  <td className="text-[var(--color-ink)]">{vb === undefined ? "—" : fmt(vb)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-sm text-[var(--color-neutral)]">Run a backtest on each version to compare performance.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-neutral)]">Pick two versions to compare.</p>
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
