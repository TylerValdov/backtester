"use client";

// Landing-page hero canvas: an equity curve drawing itself across the fold,
// with its benchmark ghosted underneath. Functional motion — it demonstrates
// what the product produces. One animation, linear time, no loops of
// decorative noise. prefers-reduced-motion renders the finished curve.

import { useEffect, useRef } from "react";

function makeSeries(n: number, seed: number, drift: number, vol: number): number[] {
  // deterministic LCG so the hero is identical on every visit
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
  const out = [100];
  for (let i = 1; i < n; i++) {
    out.push(out[i - 1] * (1 + drift + rand() * vol));
  }
  return out;
}

export function HeroCurve() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const N = 480;
    const strategy = makeSeries(N, 42, 0.0014, 0.018);
    const benchmark = makeSeries(N, 7, 0.0006, 0.012);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const css = getComputedStyle(document.documentElement);
    const colAccent = css.getPropertyValue("--color-accent").trim() || "#7adfe8";
    const colNeutral = css.getPropertyValue("--color-neutral").trim() || "#6b7686";
    const colRule = css.getPropertyValue("--color-rule-soft").trim() || "#262c38";

    let raf = 0;
    let start: number | null = null;
    const DRAW_MS = 2800;

    function paint(progress: number) {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas!.width !== w * dpr) {
        canvas!.width = w * dpr;
        canvas!.height = h * dpr;
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

      // benchmark, ghosted
      ctx!.strokeStyle = colNeutral;
      ctx!.globalAlpha = 0.45;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (let i = 0; i < upto; i++) (i === 0 ? ctx!.moveTo : ctx!.lineTo).call(ctx!, x(i), y(benchmark[i]));
      ctx!.stroke();
      ctx!.globalAlpha = 1;

      // strategy
      ctx!.strokeStyle = colAccent;
      ctx!.lineWidth = 1.6;
      ctx!.beginPath();
      for (let i = 0; i < upto; i++) (i === 0 ? ctx!.moveTo : ctx!.lineTo).call(ctx!, x(i), y(strategy[i]));
      ctx!.stroke();

      // leading dot
      if (progress < 1) {
        ctx!.fillStyle = colAccent;
        ctx!.beginPath();
        ctx!.arc(x(upto - 1), y(strategy[upto - 1]), 2.5, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    if (reduced) {
      paint(1);
      const onResize = () => paint(1);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    function frame(ts: number) {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / DRAW_MS, 1);
      paint(p);
      if (p < 1) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    const onResize = () => paint(1);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} className="h-full w-full" aria-hidden="true" />;
}
