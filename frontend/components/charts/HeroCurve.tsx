"use client";

// Landing-page hero canvas: an equity curve that draws itself across the fold,
// then keeps ticking like a live feed — benchmark ghosted underneath, with a
// mono readout of both running returns. Functional motion: it demonstrates the
// product's output. prefers-reduced-motion renders the finished curve, static.

import { useEffect, useRef } from "react";

const N = 480;
const DRAW_MS = 2600;
const TICK_MS = 480; // cadence of the live extension after the draw completes

export function HeroCurve() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const readout = readoutRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // deterministic LCG so the initial draw is identical on every visit;
    // the live extension continues the same stream
    let seedA = 42;
    let seedB = 7;
    const randA = () => ((seedA = (seedA * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
    const randB = () => ((seedB = (seedB * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;

    const strategy: number[] = [100];
    const benchmark: number[] = [100];
    for (let i = 1; i < N; i++) {
      strategy.push(strategy[i - 1] * (1 + 0.0014 + randA() * 0.018));
      benchmark.push(benchmark[i - 1] * (1 + 0.0006 + randB() * 0.012));
    }
    // baselines for the % readout (index 0 of the visible window drifts as we scroll)
    const strat0 = strategy[0];
    const bench0 = benchmark[0];

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    const colAccent = css.getPropertyValue("--color-accent").trim() || "#7adfe8";
    const colNeutral = css.getPropertyValue("--color-neutral").trim() || "#6b7686";
    const colRule = css.getPropertyValue("--color-rule-soft").trim() || "#262c38";

    function updateReadout() {
      if (!readout) return;
      const s = (strategy[strategy.length - 1] / strat0 - 1) * 100;
      const b = (benchmark[benchmark.length - 1] / bench0 - 1) * 100;
      readout.textContent = `sim · strategy ${s >= 0 ? "+" : ""}${s.toFixed(1)}% · spy ${b >= 0 ? "+" : ""}${b.toFixed(1)}%`;
    }

    function paint(progress: number) {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas!.width !== Math.round(w * dpr)) {
        canvas!.width = Math.round(w * dpr);
        canvas!.height = Math.round(h * dpr);
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);

      const n = strategy.length;
      const all = [...strategy, ...benchmark];
      const lo = Math.min(...all);
      const hi = Math.max(...all);
      const x = (i: number) => (i / (n - 1)) * w;
      const y = (v: number) => h - ((v - lo) / (hi - lo)) * (h * 0.82) - h * 0.06;

      // faint horizontal grid — the instrument backdrop
      ctx!.strokeStyle = colRule;
      ctx!.lineWidth = 1;
      for (let g = 1; g < 5; g++) {
        const gy = (h / 5) * g;
        ctx!.beginPath();
        ctx!.moveTo(0, gy);
        ctx!.lineTo(w, gy);
        ctx!.stroke();
      }

      const upto = Math.max(2, Math.floor(n * progress));

      // benchmark, ghosted
      ctx!.strokeStyle = colNeutral;
      ctx!.globalAlpha = 0.45;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (let i = 0; i < upto; i++) (i === 0 ? ctx!.moveTo : ctx!.lineTo).call(ctx!, x(i), y(benchmark[i]));
      ctx!.stroke();
      ctx!.globalAlpha = 1;

      // strategy — soft underglow fill, then the line
      const lastI = upto - 1;
      ctx!.fillStyle = colAccent;
      ctx!.globalAlpha = 0.05;
      ctx!.beginPath();
      ctx!.moveTo(x(0), h);
      for (let i = 0; i < upto; i++) ctx!.lineTo(x(i), y(strategy[i]));
      ctx!.lineTo(x(lastI), h);
      ctx!.closePath();
      ctx!.fill();
      ctx!.globalAlpha = 1;

      ctx!.strokeStyle = colAccent;
      ctx!.lineWidth = 1.6;
      ctx!.beginPath();
      for (let i = 0; i < upto; i++) (i === 0 ? ctx!.moveTo : ctx!.lineTo).call(ctx!, x(i), y(strategy[i]));
      ctx!.stroke();

      // leading dot
      ctx!.fillStyle = colAccent;
      ctx!.beginPath();
      ctx!.arc(x(lastI), y(strategy[lastI]), 2.5, 0, Math.PI * 2);
      ctx!.fill();
    }

    let raf = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let start: number | null = null;

    function tickLive() {
      // slide the window: drop the oldest point, append the next from the stream
      strategy.push(strategy[strategy.length - 1] * (1 + 0.0014 + randA() * 0.018));
      benchmark.push(benchmark[benchmark.length - 1] * (1 + 0.0006 + randB() * 0.012));
      strategy.shift();
      benchmark.shift();
      raf = requestAnimationFrame(() => paint(1));
      updateReadout();
    }

    if (reduced) {
      paint(1);
      updateReadout();
    } else {
      const frame = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / DRAW_MS, 1);
        paint(p);
        if (p < 1) {
          raf = requestAnimationFrame(frame);
        } else {
          updateReadout();
          timer = setInterval(tickLive, TICK_MS); // the curve stays alive
        }
      };
      raf = requestAnimationFrame(frame);
    }

    // hidden tabs are throttled by the browser; no manual pause needed
    const onResize = () => paint(1);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      <span
        ref={readoutRef}
        className="tnum absolute right-[var(--page-gutter)] top-4 text-[11px] uppercase tracking-[0.08em] text-[var(--color-neutral)]"
        style={{ fontFamily: "var(--font-mono)" }}
        aria-hidden="true"
      />
    </div>
  );
}
