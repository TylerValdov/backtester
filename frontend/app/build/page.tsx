"use client";

// Strategy Builder: signal picker → parameter sliders → universe → execution
// settings → run. Custom signals get a CodeMirror editor (Python).

import { python } from "@codemirror/lang-python";
import CodeMirror from "@uiw/react-codemirror";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button, ErrorNote, Field, Panel, Progress, SelectField } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { ParamSpec, SignalMeta, Strategy, UniverseEntry } from "@/lib/types";

const DEFAULT_CODE = `def signal(closes, params):
    # closes: DataFrame (index=dates, columns=symbols)
    # return a DataFrame of scores — positive = long conviction
    fast = closes.rolling(int(params.get("fast", 20))).mean()
    slow = closes.rolling(int(params.get("slow", 100))).mean()
    return (fast - slow) / slow
`;

const CATEGORY_LABEL: Record<string, string> = {
  momentum: "Momentum",
  mean_reversion: "Mean reversion",
  ml: "ML-based",
};

function defaultDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - 2);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function BuilderInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [catalog, setCatalog] = useState<SignalMeta[]>([]);
  const [universe, setUniverse] = useState<UniverseEntry[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [signalType, setSignalType] = useState("sma_crossover");
  const [custom, setCustom] = useState(false);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [params, setParams] = useState<Record<string, number>>({});
  const [symbols, setSymbols] = useState<string[]>(["AAPL", "MSFT", "NVDA", "AMZN", "JPM", "XOM", "UNH", "GLD"]);
  const [rebalance, setRebalance] = useState("weekly");
  const [positionMode, setPositionMode] = useState("long_top");
  const [topN, setTopN] = useState(4);
  const [slip, setSlip] = useState({ fixed_per_share: 0.005, pct_bps: 2, impact_k: 0.1 });
  const [mlFilter, setMlFilter] = useState({ enabled: false, model: "random_forest", threshold: 0.55, retrain_days: 63 });
  const [{ start, end }, setDates] = useState(defaultDates());
  const [capital, setCapital] = useState(100000);

  const [existing, setExisting] = useState<Strategy | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState<{ progress: number } | null>(null);

  useEffect(() => {
    api.get<SignalMeta[]>("/api/signals/catalog").then(setCatalog).catch(() => {});
    api.get<UniverseEntry[]>("/api/universe").then(setUniverse).catch(() => {});
    const sid = search.get("strategy");
    if (sid) {
      api.get<Strategy>(`/api/strategies/${sid}`).then((s) => {
        setExisting(s);
        setName(s.name);
        setDescription(s.description);
        const v = s.latest_version;
        if (v) {
          setCustom(v.signal_type === "custom");
          setSignalType(v.signal_type === "custom" ? "sma_crossover" : v.signal_type);
          if (v.code) setCode(v.code);
          setParams(v.params ?? {});
          setSymbols(v.universe);
          setRebalance(v.rebalance);
          setPositionMode(v.position_mode);
          setTopN(v.top_n);
          setSlip({ fixed_per_share: 0.005, pct_bps: 2, impact_k: 0.1, ...v.slippage });
          // always reset from the loaded version (defaults when it had no filter)
          setMlFilter({ enabled: false, model: "random_forest", threshold: 0.55, retrain_days: 63, ...(v.ml_filter as object) });
        }
      }).catch(() => {});
    }
  }, [search]);

  const meta = useMemo(() => catalog.find((c) => c.key === signalType), [catalog, signalType]);

  useEffect(() => {
    // reset params to spec defaults when the signal type changes (unless loaded)
    if (!meta || custom) return;
    setParams((prev) => {
      const next: Record<string, number> = {};
      for (const p of meta.params) next[p.name] = prev[p.name] ?? p.default;
      return next;
    });
  }, [meta, custom]);

  function toggleSymbol(sym: string) {
    setSymbols((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
  }

  async function runBacktest() {
    setError("");
    if (!name.trim()) {
      setError("Give the strategy a name before running.");
      return;
    }
    if (symbols.length === 0) {
      setError("Pick at least one symbol for the universe.");
      return;
    }
    const versionBody = {
      label: "",
      signal_type: custom ? "custom" : signalType,
      params,
      code: custom ? code : "",
      universe: symbols,
      rebalance,
      position_mode: positionMode,
      top_n: topN,
      slippage: slip,
      ml_filter: mlFilter.enabled ? mlFilter : {},
    };
    setRunning({ progress: 0 });
    try {
      let versionId: string;
      if (existing) {
        const v = await api.post<{ id: string }>(`/api/strategies/${existing.id}/versions`, versionBody);
        versionId = v.id;
      } else {
        const s = await api.post<Strategy>("/api/strategies", {
          name,
          description,
          category: custom ? "momentum" : (meta?.category ?? "momentum"),
          version: versionBody,
        });
        versionId = s.latest_version!.id;
        setExisting(s);
      }
      const bt = await api.post<{ id: string }>("/api/backtests", {
        strategy_version_id: versionId,
        start_date: start,
        end_date: end,
        initial_capital: capital,
      });
      // poll progress, then hand off to the results page
      const poll = async (): Promise<void> => {
        const st = await api.get<{ status: string; progress: number; error: string }>(`/api/backtests/${bt.id}/status`);
        if (st.status === "done") {
          router.push(`/backtests/${bt.id}`);
          return;
        }
        if (st.status === "error") {
          setError(st.error || "The backtest failed.");
          setRunning(null);
          return;
        }
        setRunning({ progress: st.progress });
        setTimeout(poll, 600);
      };
      poll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The run could not be submitted.");
      setRunning(null);
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, SignalMeta[]> = {};
    for (const c of catalog) (g[c.category] ??= []).push(c);
    return g;
  }, [catalog]);

  return (
    <div className="mx-auto flex max-w-[80rem] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[var(--text-lg)]">{existing ? `New version · ${existing.name}` : "Strategy Builder"}</h1>
          <p className="text-sm text-[var(--color-neutral)]">
            {existing
              ? `v${(existing.latest_version?.version_number ?? 0) + 1} will be saved when you run.`
              : "Configure a signal, then run it against history. Saving happens on run."}
          </p>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* ── left rail: identity + signal picker ─────────────────────────── */}
        <div className="flex flex-col gap-5">
          <Panel title="strategy">
            <div className="flex flex-col gap-4">
              <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fast cross, liquid eight" disabled={!!existing} />
              <Field label="Notes" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="what's the hypothesis?" disabled={!!existing} />
            </div>
          </Panel>

          <Panel title="signal">
            <div className="flex flex-col gap-3">
              {Object.entries(grouped).map(([cat, sigs]) => (
                <div key={cat}>
                  <p className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-[var(--color-neutral)]">{CATEGORY_LABEL[cat]}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sigs.map((s) => {
                      const active = !custom && signalType === s.key;
                      return (
                        <button
                          key={s.key}
                          onClick={() => {
                            setCustom(false);
                            setSignalType(s.key);
                          }}
                          className={`press rounded-[3px] border px-2 py-1 text-xs ${
                            active
                              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                              : "border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                          }`}
                          style={{ fontFamily: "var(--font-mono)" }}
                          title={s.description}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div>
                <p className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-[var(--color-neutral)]">Custom</p>
                <button
                  onClick={() => setCustom(true)}
                  className={`press rounded-[3px] border px-2 py-1 text-xs ${
                    custom
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Write Python
                </button>
              </div>
              {!custom && meta && <p className="text-xs leading-relaxed text-[var(--color-neutral)]">{meta.description}</p>}
            </div>
          </Panel>

          <Panel title="universe" right={<span className="text-xs text-[var(--color-neutral)]">{symbols.length} selected</span>}>
            <div className="flex max-h-56 flex-wrap content-start gap-1.5 overflow-y-auto">
              {universe.map((u) => {
                const active = symbols.includes(u.symbol);
                return (
                  <button
                    key={u.symbol}
                    onClick={() => toggleSymbol(u.symbol)}
                    className={`press tnum rounded-[3px] border px-2 py-1 text-xs ${
                      active
                        ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                        : "border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    }`}
                    style={{ fontFamily: "var(--font-mono)" }}
                    title={`${u.name} · ${u.sector}`}
                  >
                    {u.symbol}
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* ── right: params/code + execution + run ────────────────────────── */}
        <div className="flex flex-col gap-5">
          {custom ? (
            <Panel title="signal code · python">
              <CodeMirror
                value={code}
                onChange={setCode}
                extensions={[python()]}
                theme="dark"
                height="320px"
                basicSetup={{ lineNumbers: true, foldGutter: false }}
              />
              <p className="mt-2 text-xs text-[var(--color-neutral)]">
                Runs with numpy + pandas in a restricted namespace. No imports, no I/O. Define{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>signal(closes, params)</code> returning a score DataFrame.
              </p>
            </Panel>
          ) : (
            <Panel title="parameters">
              {meta && meta.params.length > 0 ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  {meta.params.map((p: ParamSpec) => (
                    <div key={p.name} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between">
                        <label htmlFor={`param-${p.name}`} className="text-xs uppercase tracking-[0.08em] text-[var(--color-neutral)]">
                          {p.label}
                        </label>
                        <span className="tnum text-sm text-[var(--color-accent)]" style={{ fontFamily: "var(--font-mono)" }}>
                          {params[p.name] ?? p.default}
                        </span>
                      </div>
                      <input
                        id={`param-${p.name}`}
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        value={params[p.name] ?? p.default}
                        onChange={(e) => setParams({ ...params, [p.name]: Number(e.target.value) })}
                        className="accent-[var(--color-accent)]"
                      />
                      <div className="tnum flex justify-between text-[10px] text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
                        <span>{p.min}</span>
                        <span>{p.max}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-neutral)]">This signal has no tunable parameters.</p>
              )}
            </Panel>
          )}

          <Panel title="execution">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField
                label="Rebalance"
                value={rebalance}
                onChange={setRebalance}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
              <SelectField
                label="Positioning"
                value={positionMode}
                onChange={setPositionMode}
                options={[
                  { value: "long_top", label: "Long top N" },
                  { value: "long_short", label: "Long/short N" },
                  { value: "signal_weight", label: "Signal-weighted" },
                ]}
              />
              <Field label="Top N" type="number" min={1} max={20} value={topN} onChange={(e) => setTopN(Number(e.target.value))} />
              <Field
                label="Slippage · $/share"
                type="number"
                step="0.001"
                value={slip.fixed_per_share}
                onChange={(e) => setSlip({ ...slip, fixed_per_share: Number(e.target.value) })}
              />
              <Field
                label="Slippage · bps"
                type="number"
                step="0.5"
                value={slip.pct_bps}
                onChange={(e) => setSlip({ ...slip, pct_bps: Number(e.target.value) })}
              />
              <Field
                label="Impact k (√ model)"
                type="number"
                step="0.05"
                value={slip.impact_k}
                onChange={(e) => setSlip({ ...slip, impact_k: Number(e.target.value) })}
              />
            </div>
          </Panel>

          <Panel title="ml trade filter" right={
            <button
              onClick={() => setMlFilter({ ...mlFilter, enabled: !mlFilter.enabled })}
              className="press text-xs"
              style={{ fontFamily: "var(--font-mono)", color: mlFilter.enabled ? "var(--color-accent)" : "var(--color-neutral)" }}
            >
              {mlFilter.enabled ? "on" : "off"}
            </button>
          }>
            {mlFilter.enabled ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField label="Model" value={mlFilter.model} onChange={(v) => setMlFilter({ ...mlFilter, model: v })}
                  options={[
                    { value: "logistic", label: "Logistic" },
                    { value: "random_forest", label: "Random forest" },
                    { value: "gradient_boosting", label: "Gradient boosting" },
                    { value: "xgboost", label: "XGBoost" },
                  ]} />
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs uppercase tracking-[0.08em] text-[var(--color-neutral)]">
                    Min win probability: <span className="text-[var(--color-accent)]">{mlFilter.threshold.toFixed(2)}</span>
                  </label>
                  <input type="range" min={0.4} max={0.8} step={0.01} value={mlFilter.threshold}
                    onChange={(e) => setMlFilter({ ...mlFilter, threshold: Number(e.target.value) })}
                    className="accent-[var(--color-accent)]" />
                </div>
                <SelectField label="Retrain cadence" value={String(mlFilter.retrain_days)}
                  onChange={(v) => setMlFilter({ ...mlFilter, retrain_days: Number(v) })}
                  options={[{ value: "21", label: "Monthly" }, { value: "63", label: "Quarterly" }, { value: "126", label: "Semiannual" }]} />
                <p className="text-xs text-[var(--color-neutral)] sm:col-span-3">
                  Trains on this strategy&rsquo;s own past trades (walk-forward) and skips entries below the win-probability threshold. Pro feature.
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-neutral)]">
                Off. Enable to train a model on this strategy&rsquo;s trades and skip the ones it predicts will lose.
              </p>
            )}
          </Panel>

          <Panel title="backtest window">
            <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Start" type="date" value={start} onChange={(e) => setDates({ start: e.target.value, end })} />
              <Field label="End" type="date" value={end} onChange={(e) => setDates({ start, end: e.target.value })} />
              <Field label="Initial capital" type="number" step="1000" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
              <Button onClick={runBacktest} loading={!!running} className="min-h-[38px]">
                {running ? "Running…" : "Run backtest"}
              </Button>
            </div>
            {running && (
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1">
                  <Progress value={running.progress} />
                </div>
                <span className="tnum w-12 text-right text-xs text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
                  {Math.round(running.progress * 100)}%
                </span>
              </div>
            )}
            <p className="mt-3 text-xs text-[var(--color-neutral)]">
              Free plan: two years of history. The engine simulates daily fills at close with your slippage settings.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export default function BuildPage() {
  return (
    <AppShell>
      <Suspense>
        <BuilderInner />
      </Suspense>
    </AppShell>
  );
}
