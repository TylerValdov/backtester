"use client";

// Cross-strategy analytics: comparison table with sparklines, correlation
// heatmap, return distribution, deepest drawdown periods.

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Heatmap } from "@/components/charts/Heatmap";
import { Histogram } from "@/components/charts/Histogram";
import { Sparkline } from "@/components/charts/Sparkline";
import { Badge, Button, EmptyState, Panel, Spinner } from "@/components/ui";
import { api, fmtNum, fmtPct, signed } from "@/lib/api";
import type { AnalyticsOverview } from "@/lib/types";

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get<AnalyticsOverview>("/api/analytics/overview")
      .then(setData)
      .finally(() => setLoaded(true));
  }, []);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[80rem] flex-col gap-5">
        <h1 className="text-[var(--text-lg)]">Analytics</h1>

        {!loaded ? (
          <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
            <Spinner /> Aggregating results…
          </div>
        ) : !data || data.comparison.length === 0 ? (
          <EmptyState
            what="Nothing to analyze yet."
            why="Analytics compares finished backtests across strategies — run at least one."
            action={
              <Link href="/build">
                <Button>Open the builder</Button>
              </Link>
            }
          />
        ) : (
          <>
            <Panel title="strategy comparison · latest backtest per strategy">
              <div className="overflow-x-auto">
                <table className="tnum w-full text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                  <thead>
                    <tr className="text-left text-[var(--color-neutral)]">
                      {["strategy", "", "ret", "cagr", "sharpe", "sortino", "max dd", "win", "trades", ""].map((h, i) => (
                        <th key={i} className="whitespace-nowrap border-b border-[var(--color-rule-soft)] py-1.5 pr-4 font-normal uppercase tracking-[0.06em]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparison.map((c) => {
                      const m = c.metrics;
                      return (
                        <tr key={c.strategy_id} className="border-b border-[var(--color-rule-soft)] last:border-0">
                          <td className="max-w-48 truncate py-2 pr-4">
                            <Link href={`/strategies/${c.strategy_id}`} className="text-[var(--color-ink)] hover:text-[var(--color-accent)]">
                              {c.strategy_name}
                            </Link>
                            <span className="ml-2 text-[var(--color-neutral)]">v{c.version_number}</span>
                          </td>
                          <td className="w-28 pr-4">
                            <Sparkline values={c.equity_sparkline} height={24} />
                          </td>
                          {m ? (
                            <>
                              <td className="pr-4" style={{ color: m.total_return >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                                {signed(m.total_return)}
                                {fmtPct(m.total_return)}
                              </td>
                              <td className="pr-4 text-[var(--color-muted)]">{fmtPct(m.cagr)}</td>
                              <td className="pr-4 text-[var(--color-ink)]">{fmtNum(m.sharpe)}</td>
                              <td className="pr-4 text-[var(--color-muted)]">{fmtNum(m.sortino)}</td>
                              <td className="pr-4 text-[var(--color-down)]">{fmtPct(m.max_drawdown)}</td>
                              <td className="pr-4 text-[var(--color-muted)]">{fmtPct(m.win_rate, 0)}</td>
                              <td className="pr-4 text-[var(--color-muted)]">{m.num_trades}</td>
                            </>
                          ) : (
                            <td colSpan={7} className="pr-4 text-[var(--color-neutral)]">
                              no finished backtest
                            </td>
                          )}
                          <td>
                            <Link href={`/backtests/${c.backtest_id}`} className="text-[var(--color-accent)] underline underline-offset-4">
                              open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="signal correlation · daily returns">
                {data.correlation ? (
                  <Heatmap labels={data.correlation.labels} matrix={data.correlation.matrix} />
                ) : (
                  <p className="text-sm text-[var(--color-neutral)]">
                    Needs finished backtests from at least two strategies with overlapping dates.
                  </p>
                )}
              </Panel>
              <Panel title="daily return distribution · all strategies">
                {data.histogram ? (
                  <Histogram counts={data.histogram.counts} edges={data.histogram.edges} />
                ) : (
                  <p className="text-sm text-[var(--color-neutral)]">No return series available yet.</p>
                )}
              </Panel>
            </div>

            <Panel title="deepest drawdown periods · best-sharpe strategy">
              {data.drawdown_periods.length === 0 ? (
                <p className="text-sm text-[var(--color-neutral)]">No underwater periods found.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-[var(--color-rule-soft)]">
                  {data.drawdown_periods.map((d, i) => (
                    <li key={i} className="tnum flex flex-wrap items-center gap-x-5 gap-y-1 py-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                      <span className="w-44 text-[var(--color-muted)]">
                        {d.start} → {d.end}
                      </span>
                      <span className="text-[var(--color-neutral)]">trough {d.trough_date}</span>
                      <span className="ml-auto flex items-center gap-3">
                        {d.ongoing && <Badge tone="warn">ongoing</Badge>}
                        <span className="text-[var(--color-down)]">{fmtPct(d.depth)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </div>
    </AppShell>
  );
}
