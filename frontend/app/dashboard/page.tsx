"use client";

// Paper trading dashboard. One session selected at a time; ticks stream over
// the WebSocket (2s cadence) into the P&L strip, positions table, intraday
// curve, allocation donut, and order blotter.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Donut } from "@/components/charts/Donut";
import { LineChart } from "@/components/charts/LineChart";
import { Badge, Button, EmptyState, ErrorNote, Field, Panel, SelectField, Spinner, Stat } from "@/components/ui";
import { api, ApiError, fmtMoney, fmtNum, fmtPct, signed } from "@/lib/api";
import { openPaperSocket } from "@/lib/ws";
import type { OrderFrame, PaperOrder, PaperSession, Strategy, TickFrame } from "@/lib/types";

const MAX_POINTS = 420;

export default function DashboardPage() {
  const [sessions, setSessions] = useState<PaperSession[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState<TickFrame | null>(null);
  const [curve, setCurve] = useState<{ ts: string[]; eq: number[] }>({ ts: [], eq: [] });
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [wsState, setWsState] = useState<"connecting" | "live" | "closed">("connecting");
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  // new-session form
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [newVersion, setNewVersion] = useState("");
  const [capital, setCapital] = useState(100000);
  const [creating, setCreating] = useState(false);

  const loadSessions = useCallback(async () => {
    const rows = await api.get<PaperSession[]>("/api/paper/sessions");
    setSessions(rows);
    setSelected((cur) => cur ?? rows.find((s) => s.status === "running")?.id ?? rows[0]?.id ?? null);
  }, []);

  useEffect(() => {
    loadSessions().catch(() => setSessions([]));
    api.get<Strategy[]>("/api/strategies").then((rows) => {
      setStrategies(rows);
      const first = rows.find((s) => s.latest_version);
      if (first?.latest_version) setNewVersion(first.latest_version.id);
    }).catch(() => {});
  }, [loadSessions]);

  // WebSocket lifecycle per selected session
  useEffect(() => {
    if (!selected) return;
    let closed = false;
    setTick(null);
    setCurve({ ts: [], eq: [] });
    setWsState("connecting");
    api.get<PaperOrder[]>(`/api/paper/sessions/${selected}/orders`).then(setOrders).catch(() => setOrders([]));

    openPaperSocket(selected).then((ws) => {
      if (closed) {
        ws.close();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => setWsState("live");
      ws.onclose = () => setWsState("closed");
      ws.onmessage = (ev) => {
        const frame = JSON.parse(ev.data) as TickFrame | OrderFrame;
        if (frame.type === "order") {
          const f = frame as OrderFrame;
          setOrders((prev) => [
            { id: `${f.ts}-${f.symbol}`, symbol: f.symbol, side: f.side, qty: f.qty, fill_price: f.fill_price, slippage_cost: f.slippage_cost, status: "filled", ts: f.ts },
            ...prev.slice(0, 199),
          ]);
          return;
        }
        const t = frame as TickFrame;
        setTick(t);
        setCurve((prev) => {
          let ts = prev.ts;
          let eq = prev.eq;
          if (t.type === "snapshot" && t.equity_series && t.equity_series.length > 0) {
            ts = t.equity_series.map((p) => p[0]);
            eq = t.equity_series.map((p) => p[1]);
          }
          return {
            ts: [...ts, t.ts].slice(-MAX_POINTS),
            eq: [...eq, t.equity].slice(-MAX_POINTS),
          };
        });
      };
    });

    return () => {
      closed = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [selected]);

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!newVersion) {
      setError("Save a strategy in the builder first — sessions trade a strategy version.");
      return;
    }
    setCreating(true);
    try {
      const s = await api.post<PaperSession>("/api/paper/sessions", {
        strategy_version_id: newVersion,
        initial_capital: capital,
      });
      await loadSessions();
      setSelected(s.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the session.");
    } finally {
      setCreating(false);
    }
  }

  async function stopResume(s: PaperSession) {
    const verb = s.status === "running" ? "stop" : "resume";
    await api.post(`/api/paper/sessions/${s.id}/${verb}`);
    await loadSessions();
  }

  const current = sessions?.find((s) => s.id === selected) ?? null;
  const positions = tick?.positions ?? current?.positions ?? [];
  const equity = tick?.equity ?? current?.equity ?? 0;
  const pnl = tick?.pnl ?? current?.pnl ?? 0;
  const pnlPct = tick?.pnl_pct ?? (current ? current.pnl / current.initial_capital : 0);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[80rem] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[var(--text-lg)]">Paper trading</h1>
          {current && (
            <div className="flex items-center gap-2">
              <Badge tone={wsState === "live" ? "up" : wsState === "connecting" ? "warn" : "down"}>
                {wsState === "live" ? "● live" : wsState}
              </Badge>
              <Badge tone={current.status === "running" ? "accent" : "plain"}>{current.status}</Badge>
            </div>
          )}
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {sessions === null ? (
          <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
            <Spinner /> Loading sessions…
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            what="No paper sessions yet."
            why="A session points a saved strategy version at the live feed and trades a virtual book."
            action={
              strategies.length === 0 ? (
                <Link href="/build">
                  <Button>Build a strategy first</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={`press rounded-[3px] border px-3 py-1.5 text-xs ${
                  s.id === selected
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                }`}
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {s.name} {s.status !== "running" && `· ${s.status}`}
              </button>
            ))}
          </div>
        )}

        {current && (
          <>
            {/* P&L strip */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-[6px] border border-[var(--color-rule-soft)] bg-[var(--color-paper-2)] p-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Equity" value={fmtMoney(equity)} />
              <Stat label="P&L" value={`${signed(pnl)}${fmtMoney(pnl)}`} tone={pnl >= 0 ? "up" : "down"} sub={`${signed(pnlPct)}${fmtPct(pnlPct, 2)}`} />
              <Stat label="Cash" value={fmtMoney(tick?.cash ?? current.cash)} />
              <Stat label="Positions" value={positions.length} />
              <Stat label="Strategy" value={<span className="text-sm">{current.strategy?.name ?? "—"}</span>} sub={`v${current.version_number} · ${current.signal_type}`} />
              <div className="flex items-center">
                <Button variant={current.status === "running" ? "danger" : "primary"} onClick={() => stopResume(current)}>
                  {current.status === "running" ? "Stop session" : "Resume"}
                </Button>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
              <Panel title="intraday equity">
                {curve.ts.length > 2 ? (
                  <LineChart
                    labels={curve.ts}
                    series={[{ name: "equity", values: curve.eq, color: "var(--color-accent)", width: 1.5 }]}
                    height={240}
                    yFmt={(v) => fmtMoney(v, 0)}
                  />
                ) : (
                  <p className="flex h-[240px] items-center justify-center text-sm text-[var(--color-neutral)]">
                    Collecting ticks — the curve appears within a few seconds.
                  </p>
                )}
              </Panel>
              <Panel title="allocation">
                {positions.length > 0 ? (
                  <Donut
                    slices={[
                      ...positions.map((p) => ({ label: p.symbol, value: Math.abs(p.market_value ?? p.qty * p.last_price) })),
                      { label: "cash", value: Math.max(tick?.cash ?? current.cash, 0) },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-[var(--color-neutral)]">All cash — waiting for the first rebalance (~30s).</p>
                )}
              </Panel>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="open positions">
                {positions.length === 0 ? (
                  <p className="text-sm text-[var(--color-neutral)]">No open positions.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="tnum w-full text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                      <thead>
                        <tr className="text-left text-[var(--color-neutral)]">
                          {["sym", "qty", "avg", "last", "value", "unrlzd"].map((h) => (
                            <th key={h} className="border-b border-[var(--color-rule-soft)] py-1.5 pr-3 font-normal uppercase tracking-[0.06em]">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((p) => (
                          <tr key={p.symbol} className="border-b border-[var(--color-rule-soft)] last:border-0">
                            <td className="py-1.5 pr-3 text-[var(--color-ink)]">{p.symbol}</td>
                            <td className="pr-3 text-[var(--color-muted)]">{p.qty}</td>
                            <td className="pr-3 text-[var(--color-muted)]">{fmtNum(p.avg_price)}</td>
                            <td className="pr-3 text-[var(--color-ink)]">{fmtNum(p.last_price)}</td>
                            <td className="pr-3 text-[var(--color-muted)]">{fmtMoney(p.market_value ?? p.qty * p.last_price, 0)}</td>
                            <td style={{ color: (p.unrealized_pnl ?? 0) >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                              {signed(p.unrealized_pnl ?? 0)}
                              {fmtMoney(p.unrealized_pnl ?? 0, 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel title="order blotter">
                {orders.length === 0 ? (
                  <p className="text-sm text-[var(--color-neutral)]">No fills yet — the engine rebalances about twice a minute.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="tnum w-full text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                      <thead>
                        <tr className="text-left text-[var(--color-neutral)]">
                          {["time", "sym", "side", "qty", "fill", "slip"].map((h) => (
                            <th key={h} className="sticky top-0 border-b border-[var(--color-rule-soft)] bg-[var(--color-paper-2)] py-1.5 pr-3 font-normal uppercase tracking-[0.06em]">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id} className="border-b border-[var(--color-rule-soft)] last:border-0">
                            <td className="whitespace-nowrap py-1.5 pr-3 text-[var(--color-neutral)]">{o.ts.slice(11, 19)}</td>
                            <td className="pr-3 text-[var(--color-ink)]">{o.symbol}</td>
                            <td className="pr-3" style={{ color: o.side === "buy" ? "var(--color-up)" : "var(--color-down)" }}>
                              {o.side}
                            </td>
                            <td className="pr-3 text-[var(--color-muted)]">{o.qty}</td>
                            <td className="pr-3 text-[var(--color-muted)]">{fmtNum(o.fill_price)}</td>
                            <td className="text-[var(--color-neutral)]">{fmtNum(o.slippage_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          </>
        )}

        {/* new session */}
        {strategies.length > 0 && (
          <Panel title="start a session">
            <form onSubmit={createSession} className="grid items-end gap-4 sm:grid-cols-3">
              <SelectField
                label="Strategy version"
                value={newVersion}
                onChange={setNewVersion}
                options={strategies
                  .filter((s) => s.latest_version)
                  .map((s) => ({ value: s.latest_version!.id, label: `${s.name} · v${s.latest_version!.version_number}` }))}
              />
              <Field label="Virtual capital" type="number" step="1000" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
              <Button type="submit" loading={creating}>
                Start paper trading
              </Button>
            </form>
            <p className="mt-3 text-xs text-[var(--color-neutral)]">
              Live prices are simulated off the last close until a real-time feed key is configured in Settings.
            </p>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
