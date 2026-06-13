"use client";

// Illustrative mini-charts that show, at a glance, what each signal *does*.
// These are hand-drawn from a fixed synthetic price path — not live data —
// so a newcomer can see "two averages crossing" or "a band being faded"
// before committing to a backtest. Same instrument aesthetic as the real
// charts: hairline frame, token colors, semantic up/down only for buy/sell.

import type { ReactNode } from "react";

const W = 320;
const H = 132;
const PAD = { l: 10, r: 10, t: 14, b: 14 };
const N = 64;

// A smooth rise-then-fall with gentle wiggle — enough structure to make
// crossovers, breakouts, and band touches legible.
const PRICE: number[] = Array.from({ length: N }, (_, i) => {
  const t = i / (N - 1);
  return 100 + 17 * Math.sin(t * Math.PI * 1.12) + 4.5 * Math.sin(i / 3.3) + 2.2 * Math.sin(i / 1.7);
});

const x = (i: number) => PAD.l + (i / (N - 1)) * (W - PAD.l - PAD.r);

function yScale(min: number, max: number) {
  const span = max - min || 1;
  return (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);
}

function path(pts: [number, number][]): string {
  return pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
}

function sma(a: number[], w: number): number[] {
  return a.map((_, i) => {
    const s = a.slice(Math.max(0, i - w + 1), i + 1);
    return s.reduce((p, c) => p + c, 0) / s.length;
  });
}

function ema(a: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const out: number[] = [];
  a.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

function rolling(a: number[], w: number, fn: (s: number[]) => number): number[] {
  return a.map((_, i) => fn(a.slice(Math.max(0, i - w + 1), i + 1)));
}

const mean = (s: number[]) => s.reduce((p, c) => p + c, 0) / s.length;
const std = (s: number[]) => {
  const m = mean(s);
  return Math.sqrt(s.reduce((p, c) => p + (c - m) ** 2, 0) / s.length) || 1;
};

const C = {
  price: "var(--color-neutral)",
  signal: "var(--color-accent)",
  signalDim: "var(--color-accent-dim)",
  rule: "var(--color-rule-soft)",
  up: "var(--color-up)",
  down: "var(--color-down)",
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" preserveAspectRatio="xMidYMid meet">
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={4} fill="none" stroke={C.rule} />
      {children}
    </svg>
  );
}

function priceDomain() {
  return yScale(Math.min(...PRICE) - 2, Math.max(...PRICE) + 2);
}

// ── per-signal renders ──────────────────────────────────────────────────────

function CrossoverChart() {
  const fast = sma(PRICE, 6);
  const slow = sma(PRICE, 18);
  const y = priceDomain();
  // first index where fast crosses above slow (after warmup)
  let cross = -1;
  for (let i = 19; i < N; i++) if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) { cross = i; break; }
  return (
    <Frame>
      <path d={path(PRICE.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.price} strokeWidth={1} opacity={0.5} />
      <path d={path(slow.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.signalDim} strokeWidth={1.5} />
      <path d={path(fast.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.signal} strokeWidth={1.5} />
      {cross >= 0 && <circle cx={x(cross)} cy={y(fast[cross])} r={3.5} fill={C.up} stroke="var(--color-paper-2)" strokeWidth={1} />}
    </Frame>
  );
}

function MomentumChart() {
  const y = priceDomain();
  const lbStart = Math.round(N * 0.45);
  return (
    <Frame>
      <rect x={x(lbStart)} y={PAD.t} width={x(N - 1) - x(lbStart)} height={H - PAD.t - PAD.b} fill="var(--color-accent)" opacity={0.06} />
      <line x1={x(lbStart)} x2={x(lbStart)} y1={PAD.t} y2={H - PAD.b} stroke={C.signalDim} strokeWidth={1} strokeDasharray="2 3" />
      <path d={path(PRICE.slice(0, lbStart + 1).map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.price} strokeWidth={1} opacity={0.5} />
      <path d={path(PRICE.slice(lbStart).map((v, i) => [x(i + lbStart), y(v)]))} fill="none" stroke={C.signal} strokeWidth={1.5} />
      <text x={x(lbStart) + 4} y={PAD.t + 9} fontSize={8} fill="var(--color-neutral)" style={{ fontFamily: "var(--font-mono)" }}>lookback →</text>
    </Frame>
  );
}

function OscChart({ kind }: { kind: "rsi" | "macd" }) {
  const splitY = PAD.t + (H - PAD.t - PAD.b) * 0.52;
  const yP = yScale(Math.min(...PRICE) - 2, Math.max(...PRICE) + 2);
  // squeeze price into the top half
  const yPrice = (v: number) => PAD.t + (yP(v) - PAD.t) * 0.46;

  let osc: number[];
  if (kind === "rsi") {
    const diff = PRICE.map((v, i) => (i === 0 ? 0 : v - PRICE[i - 1]));
    const gain = ema(diff.map((d) => Math.max(0, d)), 14);
    const loss = ema(diff.map((d) => Math.max(0, -d)), 14);
    osc = gain.map((g, i) => 100 - 100 / (1 + g / (loss[i] || 1e-6))); // 0..100
  } else {
    const m = ema(PRICE, 12).map((v, i) => v - ema(PRICE, 26)[i]);
    const sig = ema(m, 9);
    osc = m.map((v, i) => v - sig[i]); // histogram, centered ~0
  }
  const lo = Math.min(...osc), hi = Math.max(...osc);
  const yO = (v: number) => splitY + 6 + (1 - (v - lo) / ((hi - lo) || 1)) * (H - PAD.b - (splitY + 6));

  return (
    <Frame>
      <path d={path(PRICE.map((v, i) => [x(i), yPrice(v)]))} fill="none" stroke={C.price} strokeWidth={1} opacity={0.55} />
      <line x1={PAD.l} x2={W - PAD.r} y1={splitY} y2={splitY} stroke={C.rule} strokeWidth={1} />
      {kind === "rsi" ? (
        <>
          <line x1={PAD.l} x2={W - PAD.r} y1={yO(50)} y2={yO(50)} stroke={C.rule} strokeDasharray="2 3" />
          <path d={path(osc.map((v, i) => [x(i), yO(v)]))} fill="none" stroke={C.signal} strokeWidth={1.5} />
        </>
      ) : (
        <>
          <line x1={PAD.l} x2={W - PAD.r} y1={yO(0)} y2={yO(0)} stroke={C.rule} />
          {osc.map((v, i) => (
            <line key={i} x1={x(i)} x2={x(i)} y1={yO(0)} y2={yO(v)} stroke={v >= 0 ? C.up : C.down} strokeWidth={2.4} opacity={0.85} />
          ))}
        </>
      )}
    </Frame>
  );
}

function ChannelChart() {
  const lb = 16;
  const hi = rolling(PRICE, lb, (s) => Math.max(...s));
  const lo = rolling(PRICE, lb, (s) => Math.min(...s));
  const y = priceDomain();
  let brk = -1;
  for (let i = lb + 1; i < N; i++) if (PRICE[i] >= hi[i - 1] && PRICE[i] > PRICE[i - 1]) { brk = i; break; }
  return (
    <Frame>
      <path d={path(hi.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.signalDim} strokeWidth={1} strokeDasharray="3 3" />
      <path d={path(lo.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.signalDim} strokeWidth={1} strokeDasharray="3 3" />
      <path d={path(PRICE.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.signal} strokeWidth={1.5} />
      {brk >= 0 && <circle cx={x(brk)} cy={y(PRICE[brk])} r={3.5} fill={C.up} stroke="var(--color-paper-2)" strokeWidth={1} />}
    </Frame>
  );
}

function BandChart({ touches }: { touches: boolean }) {
  const w = 18;
  const mid = sma(PRICE, w);
  const sd = rolling(PRICE, w, std);
  const up = mid.map((m, i) => m + 1.6 * sd[i]);
  const dn = mid.map((m, i) => m - 1.6 * sd[i]);
  const y = yScale(Math.min(...dn) - 1, Math.max(...up) + 1);
  const area =
    path(up.map((v, i) => [x(i), y(v)])) +
    " " + dn.map((v, i) => `L${x(N - 1 - i).toFixed(1)},${y(dn[N - 1 - i]).toFixed(1)}`).join(" ") + " Z";
  // mark the most stretched points (price near a band)
  const markers: { i: number; up: boolean }[] = [];
  PRICE.forEach((v, i) => {
    if (i < w) return;
    if (v >= up[i] - 0.3) markers.push({ i, up: true });
    else if (v <= dn[i] + 0.3) markers.push({ i, up: false });
  });
  return (
    <Frame>
      <path d={area} fill="var(--color-accent)" opacity={0.06} />
      <path d={path(up.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.signalDim} strokeWidth={1} />
      <path d={path(dn.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.signalDim} strokeWidth={1} />
      <path d={path(mid.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.rule} strokeWidth={1} strokeDasharray="2 3" />
      <path d={path(PRICE.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.price} strokeWidth={1.2} opacity={0.7} />
      {touches && markers.slice(0, 6).map((m, k) => (
        <circle key={k} cx={x(m.i)} cy={y(PRICE[m.i])} r={2.6} fill={m.up ? C.down : C.up} />
      ))}
    </Frame>
  );
}

function PairsChart() {
  const a = PRICE;
  const b = PRICE.map((v, i) => 100 + (v - 100) * 0.6 + 7 * Math.sin(i / 5 + 1)); // a related peer
  const all = [...a, ...b];
  const y = yScale(Math.min(...all) - 2, Math.max(...all) + 2);
  const spread: [number, number][] = a.map((v, i) => [x(i), 0]).map(([px], i) => [px, (y(a[i]) + y(b[i])) / 2]);
  void spread;
  return (
    <Frame>
      {a.map((v, i) => (
        <line key={i} x1={x(i)} x2={x(i)} y1={y(a[i])} y2={y(b[i])} stroke="var(--color-accent)" strokeWidth={1.4} opacity={0.07} />
      ))}
      <path d={path(a.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.signal} strokeWidth={1.5} />
      <path d={path(b.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.price} strokeWidth={1.3} opacity={0.7} />
    </Frame>
  );
}

function MlChart() {
  // model ranks the universe: sorted prediction bars, top in accent
  const vals = [0.92, 0.74, 0.61, 0.43, 0.22, 0.05, -0.18, -0.37, -0.58, -0.81];
  const n = vals.length;
  const rowH = (H - PAD.t - PAD.b) / n;
  const cx0 = W / 2;
  const maxBar = W / 2 - PAD.r - 24;
  return (
    <Frame>
      <line x1={cx0} x2={cx0} y1={PAD.t - 2} y2={H - PAD.b + 2} stroke={C.rule} />
      {vals.map((v, i) => {
        const yc = PAD.t + i * rowH + rowH / 2;
        const w = Math.abs(v) * maxBar;
        const pos = v >= 0;
        return (
          <g key={i}>
            <rect x={pos ? cx0 : cx0 - w} y={yc - rowH * 0.3} width={w} height={rowH * 0.6} rx={1.5} fill={pos ? "var(--color-accent)" : "var(--color-accent-dim)"} opacity={pos ? 0.9 : 0.5} />
          </g>
        );
      })}
      <text x={cx0 + 6} y={PAD.t + 8} fontSize={8} fill="var(--color-neutral)" style={{ fontFamily: "var(--font-mono)" }}>long</text>
      <text x={cx0 - 6} y={H - PAD.b - 2} fontSize={8} textAnchor="end" fill="var(--color-neutral)" style={{ fontFamily: "var(--font-mono)" }}>short</text>
    </Frame>
  );
}

function FvgChart() {
  const y = priceDomain();
  const gi = 24; // gap forms around here, on the up-move
  const top = PRICE[gi];
  const bottom = top - 6;
  const x0 = x(gi);
  const x1 = x(N - 1);
  // first later bar that retraces down to tap the gap's near edge
  let tap = -1;
  for (let i = gi + 4; i < N; i++) if (PRICE[i] <= top) { tap = i; break; }
  return (
    <Frame>
      <rect x={x0} y={y(top)} width={x1 - x0} height={y(bottom) - y(top)} fill="var(--color-accent)" opacity={0.12} />
      <line x1={x0} x2={x1} y1={y(top)} y2={y(top)} stroke={C.signalDim} strokeWidth={1} strokeDasharray="3 3" />
      <line x1={x0} x2={x1} y1={y(bottom)} y2={y(bottom)} stroke={C.signalDim} strokeWidth={1} strokeDasharray="3 3" />
      <path d={path(PRICE.map((v, i) => [x(i), y(v)]))} fill="none" stroke={C.price} strokeWidth={1.3} opacity={0.7} />
      {tap >= 0 && <circle cx={x(tap)} cy={y(PRICE[tap])} r={3.5} fill={C.up} stroke="var(--color-paper-2)" strokeWidth={1} />}
      <text x={x0 + 4} y={y(top) - 4} fontSize={8} fill="var(--color-neutral)" style={{ fontFamily: "var(--font-mono)" }}>fair value gap</text>
    </Frame>
  );
}

const RENDER: Record<string, () => ReactNode> = {
  sma_crossover: () => <CrossoverChart />,
  momentum: () => <MomentumChart />,
  rsi: () => <OscChart kind="rsi" />,
  macd: () => <OscChart kind="macd" />,
  breakout: () => <ChannelChart />,
  zscore: () => <BandChart touches />,
  bollinger: () => <BandChart touches />,
  pairs: () => <PairsChart />,
  ml_model: () => <MlChart />,
  ml_trained: () => <MlChart />,
  ict_fvg: () => <FvgChart />,
};

const CAPTION: Record<string, string> = {
  sma_crossover: "Fast average (bright) crossing above the slow one marks a long.",
  momentum: "Measures trailing return over the highlighted lookback window.",
  rsi: "Oscillator below the price: above the midline reads as trend strength.",
  macd: "Histogram of trend acceleration — green builds, red fades.",
  breakout: "Price (bright) pushing through the dashed high/low channel.",
  zscore: "Distance from the mean band; far stretches snap back.",
  bollinger: "Touches of the outer bands are faded back toward the mean.",
  pairs: "Each name against its closest peer; the gap is the tradable spread.",
  ml_model: "Model scores every name, then ranks longs over shorts.",
  ml_trained: "Walk-forward model ranks the universe by predicted return.",
  ict_fvg: "A 3-candle imbalance (shaded). Price retraces to tap it, then continues — entry on the tap.",
};

export function SignalPreview({ signalKey }: { signalKey: string }) {
  const render = RENDER[signalKey];
  if (!render) return null;
  return (
    <figure className="flex flex-col gap-2">
      <div className="rounded-[5px] bg-[var(--color-paper)] p-1.5">{render()}</div>
      <figcaption className="text-[11px] leading-relaxed text-[var(--color-neutral)]">
        {CAPTION[signalKey]} <span className="text-[var(--color-neutral)] opacity-70">Illustrative — not live data.</span>
      </figcaption>
    </figure>
  );
}
