"use client";

// Backtest results: equity vs benchmark, drawdown, rolling Sharpe, metrics,
// trade log, slippage breakdown. Export: CSV (server) + PDF (print).

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AreaChart } from "@/components/charts/AreaChart";
import { LineChart } from "@/components/charts/LineChart";
import { Badge, Button, ErrorNote, Panel, Progress, Spinner, Stat } from "@/components/ui";
import { api, fmtMoney, fmtNum, fmtPct, signed } from "@/lib/api";
import type { Backtest } from "@/lib/types";

const PAGE = 25;

export default function BacktestPage() {
  const { id } = useParams<{ id: string }>();
  const [bt, setBt] = useState<Backtest | null>(null);
  const [error, setError] = useState("");
  const [tradePage, setTradePage] = useState(0);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const data = await api.get<Backtest>(`/api/backtests/${id}`);
        if (stop) return;
        setBt(data);
        if (data.status === "queued" || data.status === "running") setTimeout(load, 700);
      } catch {
        if (!stop) setError("Backtest not found.");
      }
    }
    load();
    return () => {
      stop = true;
    };
  }, [id]);

  const r = bt?.result;
  const m = r?.metrics;

  const trades = useMemo(() => (r ? [...r.trades].reverse() : []), [r]);
  const tradeSlice = trades.slice(tradePage * PAGE, (tradePage + 1) * PAGE);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[80rem] flex-col gap-5 print:max-w-none">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!bt && !error && (
          <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
            <Spinner /> Loading backtest…
          </div>
        )}

        {bt && (bt.status === "queued" || bt.status === "running") && (
          <Panel title="running">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Progress value={bt.progress} />
              </div>
              <span className="tnum text-sm text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
                {Math.round(bt.progress * 100)}%
              </span>
            </div>
          </Panel>
        )}

        {bt && bt.status === "error" && <ErrorNote>The engine reported: {bt.error}</ErrorNote>}

        {bt && r && m && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
              <div>
                <h1 className="text-[var(--text-lg)]">
                  {bt.strategy?.name ?? "Backtest"}{" "}
                  <span className="text-[var(--color-neutral)]">v{bt.version_number}</span>
                </h1>
                <p className="tnum text-sm text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
                  {r.config.signal_type} · {r.config.rebalance} · {r.config.start} → {r.config.end} · {fmtMoney(r.config.initial_capital)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`/api/backtests/${bt.id}/export/equity.csv`} download>
                  <Button variant="outline">Equity CSV</Button>
                </a>
                <a href={`/api/backtests/${bt.id}/export/trades.csv`} download>
                  <Button variant="outline">Trades CSV</Button>
                </a>
                <Button variant="outline" onClick={() => window.print()}>
                  Save as PDF
                </Button>
                {bt.strategy && (
                  <Link href={`/build?strategy=${bt.strategy.id}`}>
                    <Button>Iterate</Button>
                  </Link>
                )}
              </div>
            </div>

            {/* headline metrics */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-[6px] border border-[var(--color-rule-soft)] bg-[var(--color-paper-2)] p-4 sm:grid-cols-4 lg:grid-cols-8">
              <Stat label="Total return" value={`${signed(m.total_return)}${fmtPct(m.total_return)}`} tone={m.total_return >= 0 ? "up" : "down"} />
              <Stat label="CAGR" value={fmtPct(m.cagr)} tone={m.cagr >= 0 ? "up" : "down"} />
              <Stat label="Sharpe" value={fmtNum(m.sharpe)} tone="accent" />
              <Stat label="Sortino" value={fmtNum(m.sortino)} />
              <Stat label="Max drawdown" value={fmtPct(m.max_drawdown)} tone="down" />
              <Stat label="Win rate" value={fmtPct(m.win_rate, 0)} sub={`${m.num_trades} trades`} />
              <Stat label="Avg hold" value={`${fmtNum(m.avg_holding_days, 1)}d`} />
              <Stat label="vs SPY" value={`${signed(m.total_return - m.benchmark_total_return)}${fmtPct(m.total_return - m.benchmark_total_return)}`} tone={m.total_return >= m.benchmark_total_return ? "up" : "down"} sub={`SPY ${fmtPct(m.benchmark_total_return)}`} />
            </div>

            <Panel title="equity curve · strategy vs SPY">
              <LineChart
                labels={r.dates}
                series={[
                  { name: "strategy", values: r.equity, color: "var(--color-accent)", width: 1.6 },
                  { name: "SPY", values: r.benchmark, color: "var(--color-neutral)", width: 1, dashed: true },
                ]}
                height={320}
              />
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="drawdown">
                <AreaChart labels={r.dates} values={r.drawdown} height={200} />
              </Panel>
              <Panel title="rolling sharpe · 63d">
                <LineChart
                  labels={r.dates}
                  series={[{ name: "sharpe", values: r.rolling_sharpe, color: "var(--color-warn)", width: 1.25 }]}
                  height={200}
                  yFmt={(v) => v.toFixed(1)}
                  baseline={0}
                />
              </Panel>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <Panel
                title={`trade log · ${r.trades_total} closed`}
                right={
                  trades.length > PAGE ? (
                    <div className="flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                      <button className="press text-[var(--color-neutral)] hover:text-[var(--color-ink)] disabled:opacity-40" disabled={tradePage === 0} onClick={() => setTradePage(tradePage - 1)}>
                        ←
                      </button>
                      <span className="tnum text-[var(--color-neutral)]">
                        {tradePage + 1}/{Math.ceil(trades.length / PAGE)}
                      </span>
                      <button
                        className="press text-[var(--color-neutral)] hover:text-[var(--color-ink)] disabled:opacity-40"
                        disabled={(tradePage + 1) * PAGE >= trades.length}
                        onClick={() => setTradePage(tradePage + 1)}
                      >
                        →
                      </button>
                    </div>
                  ) : undefined
                }
              >
                <div className="overflow-x-auto">
                  <table className="tnum w-full text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                    <thead>
                      <tr className="text-left text-[var(--color-neutral)]">
                        {["sym", "side", "qty", "entry", "exit", "in", "out", "P&L", "ret", "days"].map((h) => (
                          <th key={h} className="whitespace-nowrap border-b border-[var(--color-rule-soft)] py-1.5 pr-3 font-normal uppercase tracking-[0.06em]">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tradeSlice.map((t, i) => (
                        <tr key={i} className="border-b border-[var(--color-rule-soft)] text-[var(--color-muted)] last:border-0">
                          <td className="py-1.5 pr-3 text-[var(--color-ink)]">{t.symbol}</td>
                          <td className="pr-3">{t.side}</td>
                          <td className="pr-3">{t.qty}</td>
                          <td className="whitespace-nowrap pr-3">{t.entry_date}</td>
                          <td className="whitespace-nowrap pr-3">{t.exit_date}</td>
                          <td className="pr-3">{fmtNum(t.entry_price)}</td>
                          <td className="pr-3">{fmtNum(t.exit_price)}</td>
                          <td className="pr-3" style={{ color: t.pnl >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                            {signed(t.pnl)}
                            {fmtMoney(t.pnl, 0)}
                          </td>
                          <td className="pr-3" style={{ color: t.return_pct >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                            {fmtPct(t.return_pct)}
                          </td>
                          <td>{t.holding_days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <div className="flex flex-col gap-5">
                <Panel title="slippage impact">
                  <dl className="tnum flex flex-col gap-2 text-sm" style={{ fontFamily: "var(--font-mono)" }}>
                    {(
                      [
                        ["fixed / share", r.slippage_breakdown.fixed],
                        ["spread (bps)", r.slippage_breakdown.pct],
                        ["√ market impact", r.slippage_breakdown.impact],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-[var(--color-rule-soft)] pb-2">
                        <dt className="text-[var(--color-neutral)]">{k}</dt>
                        <dd className="text-[var(--color-ink)]">{fmtMoney(v, 0)}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1">
                      <dt className="text-[var(--color-muted)]">total cost</dt>
                      <dd className="text-[var(--color-down)]">{fmtMoney(r.slippage_breakdown.total, 0)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-[var(--color-neutral)]">
                    {m.turnover_orders} orders across the test. Costs already reflected in the equity curve.
                  </p>
                </Panel>

                <Panel title="risk detail">
                  <dl className="tnum grid grid-cols-2 gap-x-4 gap-y-2 text-sm" style={{ fontFamily: "var(--font-mono)" }}>
                    {(
                      [
                        ["volatility", fmtPct(m.volatility)],
                        ["beta", fmtNum(m.beta)],
                        ["alpha (ann)", fmtPct(m.alpha)],
                        ["profit factor", fmtNum(m.profit_factor)],
                        ["avg win", fmtMoney(m.avg_win, 0)],
                        ["avg loss", fmtMoney(m.avg_loss, 0)],
                        ["SPY sharpe", fmtNum(m.benchmark_sharpe)],
                        ["SPY max DD", fmtPct(m.benchmark_max_drawdown)],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-[var(--color-neutral)]">{k}</dt>
                        <dd className="text-right text-[var(--color-ink)]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Panel>

                {r.open_positions.length > 0 && (
                  <Panel title="open at test end">
                    <ul className="tnum flex flex-col gap-1.5 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                      {r.open_positions.map((p) => (
                        <li key={p.symbol} className="flex justify-between">
                          <span className="text-[var(--color-ink)]">{p.symbol}</span>
                          <span className="text-[var(--color-neutral)]">
                            {p.qty} @ {fmtNum(p.avg_price)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--color-neutral)]">
              <Badge tone="plain">sample data</Badge>
              <span>
                Computed on the deterministic synthetic feed. Plug a market-data key in Settings to test against real bars.
              </span>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
