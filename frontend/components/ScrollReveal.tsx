"use client";

// Reveal-once on scroll. One orchestrated entrance per section — content
// settles and then stays put (no perpetual animate-on-scroll).
// IntersectionObserver, never scroll listeners; reduced-motion collapses to a
// fast opacity fade via the global .reveal rules.

import { useEffect, useRef, type ReactNode } from "react";

export function ScrollReveal({
  children,
  index = 0,
  className = "",
}: {
  children: ReactNode;
  index?: number; // stagger slot (60ms steps, capped by CSS)
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          el.classList.add("reveal");
          io.disconnect();
        }
      },
      { rootMargin: "-60px 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`pre-reveal ${className}`} style={{ "--i": index } as React.CSSProperties}>
      {children}
    </div>
  );
}
