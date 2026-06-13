"use client";

// Strategy Builder. Reads top-to-bottom as a workflow: pick a signal (left
// rail) → see what it does + tune it → choose tickers → set execution → name
// it and run. Custom signals swap the params card for a CodeMirror editor.

import { python } from "@codemirror/lang-python";
import CodeMirror from "@uiw/react-codemirror";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SignalPreview } from "@/components/build/SignalPreview";
import { FIELD_HELP, PARAM_HELP } from "@/components/build/copy";
import { Badge, Button, ErrorNote, Field, InfoTip, Panel, Progress, SelectField } from "@/components/ui";
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
  ict: "ICT / price action",
};

// Fallback if /api/timeframes hasn't loaded yet (keeps the selector populated).
const FALLBACK_TFS = [
  { key: "1m", label: "1 minute" },
  { key: "5m", label: "5 minute" },
  { key: "15m", label: "15 minute" },
  { key: "1h", label: "1 hour" },
  { key: "1d", label: "1 day" },
];

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
  const [symbols, setSymbols] = useState<string[]>(["AAPL"]);
  const [assetMode, setAssetMode] = useState<"single" | "multi">("single");
  const [timeframe, setTimeframe] = useState("1d");
  const [timeframes, setTimeframes] = useState(FALLBACK_TFS);
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
    api.get<{ key: string; label: string }[]>("/api/timeframes").then(setTimeframes).catch(() => {});
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
          setAssetMode((v.universe?.length ?? 0) > 1 ? "multi" : "single");
          setTimeframe(v.timeframe ?? "1d");
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
  const tfLabel = useMemo(() => timeframes.find((t) => t.key === timeframe)?.label ?? timeframe, [timeframes, timeframe]);
  // ICT/event strategies manage their own entries/exits — rank-and-hold controls don't apply.
  const isEvent = !custom && meta?.category === "ict";

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
    setSymbols((prev) => {
      const next = prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym];
      // "assets to hold" can't exceed what's selected — shrink it to fit
      if (next.length > 0) setTopN((t) => Math.min(t, next.length));
      return next;
    });
  }

  // In single mode a click replaces the selection (radio-style); in multi it
  // toggles. Switching to single collapses to one ticker.
  function pickAsset(sym: string) {
    if (assetMode === "single") setSymbols([sym]);
    else toggleSymbol(sym);
  }

  function switchMode(mode: "single" | "multi") {
    setAssetMode(mode);
    if (mode === "single") setSymbols((prev) => [prev[0] ?? "AAPL"]);
  }

  const tickersBySector = useMemo(() => {
    const g: Record<string, UniverseEntry[]> = {};
    for (const u of universe) (g[u.sector] ??= []).push(u);
    return g;
  }, [universe]);

  async function runBacktest() {
    setError("");
    if (!name.trim()) {
      setError("Give the strategy a name before running.");
      return;
    }
    if (symbols.length === 0) {
      setError("Pick at least one asset to test on.");
      return;
    }
    const versionBody = {
      label: "",
      signal_type: custom ? "custom" : signalType,
      params,
      code: custom ? code : "",
      universe: symbols,
      timeframe,
      rebalance,
      position_mode: positionMode,
      top_n: assetMode === "single" ? 1 : topN,
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

  const pickerButton = (key: string, label: string, active: boolean, onClick: () => void) => (
    <button
      key={key}
      onClick={onClick}
      className={`press w-full rounded-[3px] border px-2.5 py-1.5 text-left text-xs ${
        active
          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
          : "border-[var(--color-rule)] text-[var(--color-muted)] hover:border-[var(--color-rule)] hover:text-[var(--color-ink)]"
      }`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex max-w-[80rem] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[var(--text-lg)]">{existing ? `New version · ${existing.name}` : "Strategy Builder"}</h1>
          <p className="text-sm text-[var(--color-neutral)]">
            {existing
              ? `v${(existing.latest_version?.version_number ?? 0) + 1} will be saved when you run.`
              : "Pick a signal, tune it, choose your tickers — then name it and run. Saving happens on run."}
          </p>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        {/* ── left rail: signal picker (the menu — where you start) ───────── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Panel title="1 · choose a signal">
            <div className="flex flex-col gap-4">
              {Object.entries(grouped).map(([cat, sigs]) => (
                <div key={cat} className="flex flex-col gap-1.5">
                  <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-neutral)]">{CATEGORY_LABEL[cat]}</p>
                  {sigs.map((s) => pickerButton(s.key, s.label, !custom && signalType === s.key, () => {
                    setCustom(false);
                    setSignalType(s.key);
                  }))}
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-neutral)]">Custom</p>
                {pickerButton("custom", "Write Python", custom, () => setCustom(true))}
              </div>
            </div>
          </Panel>
        </div>

        {/* ── main column: explain → tune → tickers → execution → run ─────── */}
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
            meta && (
              <Panel title="what this signal does">
                <div className="grid gap-5 sm:grid-cols-[1fr_320px] sm:items-start">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[var(--text-md)] leading-tight text-[var(--color-ink)]">{meta.label}</h2>
                      <Badge tone="accent">{CATEGORY_LABEL[meta.category]}</Badge>
                    </div>
                    <p className="text-sm leading-relaxed text-[var(--color-muted)]">{meta.description}</p>
                  </div>
                  <SignalPreview signalKey={meta.key} />
                </div>
              </Panel>
            )
          )}

          <Panel title="2 · timeframe">
            <div className="flex flex-wrap items-center gap-1.5">
              {timeframes.map((tf) => {
                const active = timeframe === tf.key;
                return (
                  <button
                    key={tf.key}
                    onClick={() => setTimeframe(tf.key)}
                    className={`press rounded-[3px] border px-3 py-1.5 text-xs ${
                      active
                        ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                        : "border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    }`}
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {tf.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-neutral)]">
              {timeframe === "1d"
                ? "Daily candles. Window lengths below count trading days."
                : `Each candle is ${tfLabel}. Window lengths below count bars at this timeframe — e.g. a fast window of 10 means 10 ${tfLabel} candles. Intraday history is limited to a recent span.`}
            </p>
          </Panel>

          {!custom && (
            <Panel title="3 · parameters">
              {meta && meta.params.length > 0 ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  {meta.params.map((p: ParamSpec) => {
                    const help = PARAM_HELP[`${signalType}.${p.name}`];
                    return (
                      <div key={p.name} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <label htmlFor={`param-${p.name}`} className="flex items-center gap-1.5 text-xs uppercase tracking-[0.08em] text-[var(--color-neutral)]">
                            <span>{p.label}</span>
                            {help && <InfoTip label={`About ${p.label}`}>{help}</InfoTip>}
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
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-neutral)]">This signal has no tunable parameters.</p>
              )}
            </Panel>
          )}

          <Panel
            title="4 · assets"
            right={
              <div className="flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                {([["single", "Single"], ["multi", "Multiple"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => switchMode(m)}
                    className={`press rounded-[3px] border px-2 py-1 ${
                      assetMode === m
                        ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                        : "border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--color-neutral)]">
                {assetMode === "single"
                  ? "Trade a single stock or ETF. The signal goes long/flat (or long/short) on just this one."
                  : "Trade across multiple assets. The signal ranks them and holds the best — set how many under execution."}
              </p>
              {assetMode === "multi" && (
                <div className="flex shrink-0 items-center gap-3 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                  <span className="text-[var(--color-neutral)]">{symbols.length} selected</span>
                  <button onClick={() => setSymbols(universe.map((u) => u.symbol))} className="press text-[var(--color-muted)] hover:text-[var(--color-accent)]">
                    all
                  </button>
                  <button onClick={() => setSymbols((prev) => prev.slice(0, 1))} className="press text-[var(--color-muted)] hover:text-[var(--color-accent)]">
                    clear
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {Object.entries(tickersBySector).map(([sector, entries]) => (
                <div key={sector} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-28 shrink-0 text-[11px] uppercase tracking-[0.08em] text-[var(--color-neutral)]">{sector}</span>
                  {entries.map((u) => {
                    const active = symbols.includes(u.symbol);
                    return (
                      <button
                        key={u.symbol}
                        onClick={() => pickAsset(u.symbol)}
                        className={`press tnum rounded-[3px] border px-2 py-1 text-xs ${
                          active
                            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                            : "border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                        }`}
                        style={{ fontFamily: "var(--font-mono)" }}
                        title={u.name}
                      >
                        {u.symbol}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="5 · execution">
            {isEvent && (
              <p className="mb-3 text-xs text-[var(--color-neutral)]">
                This strategy manages its own entries and exits (stop &amp; target per trade), so rebalance and positioning don&rsquo;t apply — set those rules under parameters above.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {!isEvent && (
                <SelectField
                  label="Rebalance"
                  value={rebalance}
                  onChange={setRebalance}
                  info={FIELD_HELP.rebalance}
                  options={[
                    { value: "every_bar", label: "Every bar" },
                    { value: "daily", label: "Daily" },
                    { value: "weekly", label: "Weekly" },
                    { value: "monthly", label: "Monthly" },
                  ]}
                />
              )}
              {!isEvent && (
                <SelectField
                  label="Positioning"
                  value={positionMode}
                  onChange={setPositionMode}
                  info={FIELD_HELP.positioning}
                  options={[
                    { value: "long_top", label: "Buy best assets" },
                    { value: "long_short", label: "Buy best, short worst" },
                    { value: "signal_weight", label: "Weight by signal" },
                  ]}
                />
              )}
              {!isEvent && assetMode === "multi" && (
                <Field
                  label="Assets to hold"
                  type="number"
                  min={1}
                  max={Math.max(1, symbols.length)}
                  value={topN}
                  onChange={(e) => setTopN(Math.min(Number(e.target.value), Math.max(1, symbols.length)))}
                  info={FIELD_HELP.topN}
                />
              )}
              <Field
                label="Slippage · $/share"
                type="number"
                step="0.001"
                value={slip.fixed_per_share}
                onChange={(e) => setSlip({ ...slip, fixed_per_share: Number(e.target.value) })}
                info={FIELD_HELP.slipFixed}
              />
              <Field
                label="Slippage · bps"
                type="number"
                step="0.5"
                value={slip.pct_bps}
                onChange={(e) => setSlip({ ...slip, pct_bps: Number(e.target.value) })}
                info={FIELD_HELP.slipBps}
              />
              <Field
                label="Impact k (√ model)"
                type="number"
                step="0.05"
                value={slip.impact_k}
                onChange={(e) => setSlip({ ...slip, impact_k: Number(e.target.value) })}
                info={FIELD_HELP.impactK}
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
                  info={FIELD_HELP.mlModel}
                  options={[
                    { value: "logistic", label: "Logistic" },
                    { value: "random_forest", label: "Random forest" },
                    { value: "gradient_boosting", label: "Gradient boosting" },
                    { value: "xgboost", label: "XGBoost" },
                  ]} />
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-xs uppercase tracking-[0.08em] text-[var(--color-neutral)]">
                    <span>Min win probability: <span className="text-[var(--color-accent)]">{mlFilter.threshold.toFixed(2)}</span></span>
                    <InfoTip label="About min win probability">{FIELD_HELP.mlThreshold}</InfoTip>
                  </label>
                  <input type="range" min={0.4} max={0.8} step={0.01} value={mlFilter.threshold}
                    onChange={(e) => setMlFilter({ ...mlFilter, threshold: Number(e.target.value) })}
                    className="accent-[var(--color-accent)]" />
                </div>
                <SelectField label="Retrain cadence" value={String(mlFilter.retrain_days)}
                  info={FIELD_HELP.mlRetrain}
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

          {/* ── final step: name it (required) + window + run ──────────────── */}
          <Panel title="6 · name & run">
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Strategy name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Fast cross, liquid eight"
                  disabled={!!existing}
                  hint={existing ? undefined : "Required — this is how you'll find it in your library."}
                />
                <Field label="Notes" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="what's the hypothesis?" disabled={!!existing} info="Optional. A short note on the idea you're testing." />
              </div>
              <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Start" type="date" value={start} onChange={(e) => setDates({ start: e.target.value, end })} />
                <Field label="End" type="date" value={end} onChange={(e) => setDates({ start, end: e.target.value })} />
                <Field label="Initial capital" type="number" step="1000" value={capital} onChange={(e) => setCapital(Number(e.target.value))} info={FIELD_HELP.capital} />
                <Button onClick={runBacktest} loading={!!running} className="min-h-[38px]">
                  {running ? "Running…" : "Run backtest"}
                </Button>
              </div>
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
