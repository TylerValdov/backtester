import Link from "next/link";
import { HeroCurve } from "@/components/charts/HeroCurve";
import { CountUp } from "@/components/CountUp";
import { ScrollReveal } from "@/components/ScrollReveal";
import { TerminalNav } from "@/components/TerminalNav";

// Macrostructure: Marquee Hero — the fold is one declarative statement over a
// live equity-curve canvas that keeps ticking after it draws. Below the fold:
// step sequence → spec sheet → signal catalog → single CTA → dense colophon.
// Motion discipline (Emil): one entrance per section, reveal-once, elevation
// via lightness on dark, exits faster than enters, reduced-motion respected.

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <TerminalNav />

      {/* ── fold ─────────────────────────────────────────────────────────── */}
      {/* Orchestrated load: status eyebrow → headline lines mask up one beat at
          a time → lede → CTAs → stat strip counts. The curve draws behind it
          all over ~2.6s, then keeps ticking. Reduced-motion collapses every
          spatial step to a fast fade. */}
      <section className="relative flex min-h-[82svh] flex-col justify-end overflow-hidden border-b-2 border-[var(--color-rule)]">
        <div className="absolute inset-0">
          <HeroCurve />
        </div>
        <div className="relative max-w-[64rem] px-[var(--page-gutter)] pb-[var(--space-2xl)] pt-[var(--space-3xl)]">
          <p
            className="load-rise mb-6 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-[var(--color-neutral)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-up)]" />
            engine online — synthetic feed, 31 instruments
          </p>

          <h1
            className="text-[var(--color-ink)]"
            style={{ fontSize: "var(--text-display)", letterSpacing: "-0.035em", lineHeight: 1.0, overflowWrap: "anywhere", minWidth: 0 }}
          >
            <span className="line-mask" style={{ "--i": 1 } as React.CSSProperties}>
              <span className="line-inner">Write the signal.</span>
            </span>
            <span className="line-mask" style={{ "--i": 2 } as React.CSSProperties}>
              <span className="line-inner">Test a decade.</span>
            </span>
            <span className="line-mask" style={{ "--i": 3 } as React.CSSProperties}>
              <span className="line-inner text-[var(--color-accent)]">Trade it live.</span>
            </span>
          </h1>

          <p className="load-rise mt-6 max-w-[46ch] text-[var(--text-md)] leading-relaxed text-[var(--color-muted)]" style={{ "--i": 4 } as React.CSSProperties}>
            A research environment for one quant: you. Nine signals, a custom
            Python hook, honest slippage, and a live paper book — no Bloomberg
            terminal, no Quantopian shutdown grief.
          </p>

          <div className="load-rise mt-8 flex flex-wrap items-center gap-4" style={{ "--i": 5 } as React.CSSProperties}>
            <Link
              href="/signup"
              className="press inline-flex min-h-11 items-center rounded-[3px] bg-[var(--color-accent)] px-6 text-sm font-medium text-[var(--color-paper)] hover:bg-[var(--color-ink)]"
            >
              Start testing
            </Link>
            <Link
              href="/login"
              className="arrow-link text-sm text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-ink)]"
            >
              Sign in <span className="arrow">→</span>
            </Link>
          </div>

          <dl
            className="load-rise mt-10 flex flex-wrap gap-x-10 gap-y-4 border-t border-[var(--color-rule-soft)] pt-6"
            style={{ "--i": 6 } as React.CSSProperties}
          >
            {[
              { value: <CountUp to={9} delayMs={820} />, label: "built-in signals" },
              { value: <CountUp to={16} delayMs={920} suffix="yr" />, label: "of daily bars" },
              { value: <CountUp to={31} delayMs={1020} />, label: "instruments + SPY" },
            ].map((s, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <dd className="text-[var(--text-xl)] leading-none text-[var(--color-ink)]">{s.value}</dd>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-neutral)]">{s.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── how it runs · genuinely ordinal step sequence ────────────────── */}
      <section className="px-[var(--page-gutter)] py-[var(--space-3xl)]">
        <div className="grid max-w-[72rem] gap-[var(--space-2xl)] md:grid-cols-3">
          {[
            {
              n: "1.0",
              title: "Write the signal",
              body: "Nine built-ins — SMA cross, momentum, RSI, MACD, breakout, z-score, Bollinger, pairs spread, ML hook — or write your own in Python against the close matrix. Every parameter is a slider.",
            },
            {
              n: "2.0",
              title: "Backtest it honestly",
              body: "Daily event loop, FIFO trade pairing, and a three-part slippage model: per-share, basis points, square-root market impact. SPY rides along as the benchmark on every run.",
            },
            {
              n: "3.0",
              title: "Paper trade it live",
              body: "Point the same version at the live feed. Positions, fills, and P&L stream over a WebSocket into the dashboard — watch the strategy breathe before any real money does.",
            },
          ].map((s, i) => (
            <ScrollReveal key={s.n} index={i}>
              <div className="flex flex-col gap-2">
                <span className="tnum text-sm text-[var(--color-accent)]" style={{ fontFamily: "var(--font-mono)" }}>
                  {s.n}
                </span>
                <h2 className="text-[var(--text-md)]">{s.title}</h2>
                <p className="text-sm leading-relaxed text-[var(--color-neutral)]">{s.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── spec sheet · what the engine actually computes ───────────────── */}
      <section className="border-t border-[var(--color-rule-soft)] px-[var(--page-gutter)] py-[var(--space-2xl)]">
        <div className="grid max-w-[72rem] gap-[var(--space-xl)] lg:grid-cols-[0.8fr_1.2fr]">
          <ScrollReveal>
            <h2 className="max-w-[18ch] text-[var(--text-xl)]">Every run returns the numbers that matter.</h2>
          </ScrollReveal>
          <ScrollReveal index={1}>
            <dl className="tnum divide-y divide-[var(--color-rule-soft)] text-sm" style={{ fontFamily: "var(--font-mono)" }}>
              {[
                ["sharpe · sortino", "annualized, 252-day convention, downside deviation for Sortino"],
                ["max drawdown", "peak-to-trough, plus every underwater period charted"],
                ["cagr · volatility", "geometric growth and annualized σ, vs SPY on the same axis"],
                ["win rate · holding period", "FIFO-paired trades with per-trade P&L in the log"],
                ["slippage breakdown", "fixed + basis-point + √impact components, itemized"],
                ["alpha · beta", "OLS against the benchmark return series"],
                ["rolling sharpe", "63-day window, charted across the whole test"],
              ].map(([k, v]) => (
                <div key={k} className="spec-row grid gap-1 px-2 py-2.5 sm:grid-cols-[14rem_1fr]">
                  <dt className="text-[var(--color-accent)]">{k}</dt>
                  <dd className="text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-body)" }}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </ScrollReveal>
        </div>
      </section>

      {/* ── signal categories ────────────────────────────────────────────── */}
      <section id="signals" className="border-t border-[var(--color-rule-soft)] px-[var(--page-gutter)] py-[var(--space-2xl)]">
        <div className="max-w-[72rem]">
          <ScrollReveal>
            <h2 className="text-[var(--text-xl)]">Three families, one contract.</h2>
            <p className="mt-2 max-w-[52ch] text-sm text-[var(--color-neutral)]">
              A signal is a function from prices to conviction. Everything downstream — sizing,
              rebalancing, costs — is shared, so families compare on equal footing.
            </p>
          </ScrollReveal>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {[
              {
                tag: "momentum",
                items: ["SMA crossover", "Price momentum (skip-month)", "RSI regime", "MACD histogram", "Channel breakout"],
              },
              {
                tag: "mean reversion",
                items: ["Z-score reversion", "Bollinger fade", "Pairs spread vs correlated peer"],
              },
              {
                tag: "ml-based",
                items: ["Hosted inference endpoint", "Local sklearn / XGBoost pickle", "Standard feature block: momentum, z-score, realized vol"],
              },
            ].map((c, i) => (
              <ScrollReveal key={c.tag} index={i}>
                <div className="lift h-full rounded-[6px] border border-[var(--color-rule-soft)] bg-[var(--color-paper-2)] p-5">
                  <h3 className="text-sm uppercase tracking-[0.1em] text-[var(--color-accent)]" style={{ fontFamily: "var(--font-mono)" }}>
                    {c.tag}
                  </h3>
                  <ul className="mt-3 flex flex-col gap-1.5 text-sm text-[var(--color-muted)]">
                    {c.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── single CTA strip ─────────────────────────────────────────────── */}
      <section className="border-t border-[var(--color-rule-soft)] px-[var(--page-gutter)] py-[var(--space-2xl)]">
        <ScrollReveal>
          <div className="flex max-w-[72rem] flex-wrap items-center justify-between gap-5">
            <p className="max-w-[36ch] text-[var(--text-md)]">
              Free tier ships with two strategies and two years of history. Enough to find out.
            </p>
            <Link
              href="/signup"
              className="press inline-flex min-h-10 items-center rounded-[3px] bg-[var(--color-accent)] px-5 text-sm font-medium text-[var(--color-paper)] hover:bg-[var(--color-ink)]"
            >
              Create an account
            </Link>
          </div>
        </ScrollReveal>
      </section>

      {/* ── footer · Ft4 dense colophon ──────────────────────────────────── */}
      <footer className="mt-auto border-t border-[var(--color-rule-soft)] px-[var(--page-gutter)] py-6">
        <p className="max-w-[90ch] text-xs leading-relaxed text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
          backtester v0.1 — a personal quant research platform. FastAPI engine · Next.js front ·
          deterministic sample data (16y daily bars) until you plug a market-data key in Settings.
          Sharpe assumes 252 trading days; nothing here is investment advice. Set in Geist and
          Geist Mono. © 2026.
        </p>
      </footer>
    </div>
  );
}
