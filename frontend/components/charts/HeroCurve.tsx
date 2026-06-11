"use client";

// Landing-page hero canvas: an equity curve that draws itself across the fold
// once on load, benchmark ghosted underneath, then settles and stays still — a
// single demonstrative moment, not a perpetual ticker. A mono readout of both
// final returns sits in the corner once the draw completes.

import { useEffect, useRef } from "react";

const N = 480;
const DRAW_MS = 2400;

export function HeroCurve() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const readout = readoutRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // deterministic LCG so the curve is identical on every visit
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

    const css = getComputedStyle(document.documentElement);
    const colAccent = css.getPropertyValue("--color-accent").trim() || "#7adfe8";
    const colNeutral = css.getPropertyValue("--color-neutral").trim() || "#6b7686";
    const colRule = css.getPropertyValue("--color-rule-soft").trim() || "#262c38";

    function setReadout() {
      if (!readout) return;
      const s = (strategy[N - 1] / strategy[0] - 1) * 100;
      const b = (benchmark[N - 1] / benchmark[0] - 1) * 100;
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

      const all = [...strategy, ...benchmark];
      const lo = Math.min(...all);
      const hi = Math.max(...all);
      const x = (i: number) => (i / (N - 1)) * w;
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

      const upto = Math.max(2, Math.floor(N * progress));
      const lastI = upto - 1;

      // benchmark, ghosted
      ctx!.strokeStyle = colNeutral;
      ctx!.globalAlpha = 0.45;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (let i = 0; i < upto; i++) (i === 0 ? ctx!.moveTo : ctx!.lineTo).call(ctx!, x(i), y(benchmark[i]));
      ctx!.stroke();
      ctx!.globalAlpha = 1;

      // strategy — soft underglow fill, then the line
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

      // leading dot only while drawing; gone once settled
      if (progress < 1) {
        ctx!.fillStyle = colAccent;
        ctx!.beginPath();
        ctx!.arc(x(lastI), y(strategy[lastI]), 2.5, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let start: number | null = null;

    if (reduced) {
      // honor the preference for the larger canvas motion: render the final
      // curve at rest (the brief text entrance still plays — see globals.css)
      paint(1);
      setReadout();
    } else {
      const frame = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / DRAW_MS, 1);
        paint(p);
        if (p < 1) {
          raf = requestAnimationFrame(frame);
        } else {
          setReadout(); // draw done — settle, no further motion
        }
      };
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => paint(1);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
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
