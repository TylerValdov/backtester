"use client";

// Count-up for the hero stat strip. Animates 0 → target once on mount with an
// ease-out-expo curve. One orchestrated number per stat — reduced-motion shows
// the final value immediately (no spatial motion, no ticking).

import { useEffect, useRef, useState } from "react";

export function CountUp({
  to,
  duration = 1100,
  delayMs = 0,
  prefix = "",
  suffix = "",
}: {
  to: number;
  duration?: number;
  delayMs?: number;
  prefix?: string;
  suffix?: string;
}) {
  const [value, setValue] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    // Counts on every load — a brief one-shot, played regardless of the OS
    // reduced-motion setting (see globals.css reduced-motion policy).
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const elapsed = ts - start - delayMs;
      if (elapsed < 0) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(elapsed / duration, 1);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // ease-out-expo
      setValue(Math.round(eased * to));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, duration, delayMs]);

  return (
    <span className="tnum" style={{ fontFamily: "var(--font-mono)" }}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
