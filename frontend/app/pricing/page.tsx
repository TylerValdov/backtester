import Link from "next/link";
import { TerminalNav } from "@/components/TerminalNav";

export const metadata = { title: "Pricing" };

const TIERS = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    line: "Enough to find out whether the idea survives contact with data.",
    features: ["2 strategies", "2 years of daily history", "All built-in signals", "Paper trading, 1 session", "CSV export"],
    cta: { label: "Start free", href: "/signup" },
    highlight: false,
  },
  {
    name: "Pro",
    price: "$19",
    cadence: "per month",
    line: "The full archive and the ML hooks. For a strategy that earned a budget.",
    features: [
      "Unlimited strategies",
      "Full 16-year history",
      "ML model signals (endpoint + local pickle)",
      "Unlimited paper sessions",
      "PDF + CSV export",
      "Custom Python signals",
    ],
    cta: { label: "Go Pro", href: "/signup" },
    highlight: true,
  },
  {
    name: "Quant",
    price: "$49",
    cadence: "per month",
    line: "Team seats and programmatic access for small desks.",
    features: ["Everything in Pro", "Team access (5 seats)", "REST API access", "Priority engine queue"],
    cta: { label: "Go Quant", href: "/signup" },
    highlight: false,
  },
];

const FAQ = [
  {
    q: "Is the market data real?",
    a: "Out of the box, no — the platform ships with a deterministic synthetic feed (16 years of daily bars, regime shifts, a shared market factor) so every feature works offline. Add a Polygon, Alpaca, or Yahoo Finance key in Settings and the same engine runs on real bars.",
  },
  {
    q: "Does paper trading use real money?",
    a: "Never. Paper sessions trade a virtual book against the live feed. The order path is built so a broker paper API (e.g. Alpaca paper) can be wired in without touching the dashboard.",
  },
  {
    q: "What does the ML signal actually do?",
    a: "It builds a standard feature block (21/63-day momentum, 20-day z-score, realized vol) and scores it with your model — either an HTTP inference endpoint or a local sklearn/XGBoost pickle. Without a model it falls back to a labeled linear blend so runs never break.",
  },
  {
    q: "How is slippage modeled?",
    a: "Three components per order: a fixed per-share cost, a proportional basis-point cost, and square-root market impact scaled by participation in daily volume. All three are tunable per strategy version and itemized in results.",
  },
  {
    q: "Can I cancel?",
    a: "Yes, anytime. Strategies and results stay readable on the Free tier; only the gates (strategy count, history depth, ML) re-apply.",
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <TerminalNav />
      <main className="flex-1 px-[var(--page-gutter)] py-[var(--space-2xl)]">
        <div className="mx-auto max-w-[72rem]">
          <h1 style={{ fontSize: "var(--text-display-s)", letterSpacing: "-0.03em" }}>Priced like a tool, not a terminal.</h1>
          <p className="mt-3 max-w-[48ch] text-[var(--color-muted)]">
            One person, one research stack. Every tier runs the same engine — the difference is depth, not quality.
          </p>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {TIERS.map((t) => (
              <section
                key={t.name}
                className={`flex flex-col gap-4 rounded-[6px] border p-6 ${
                  t.highlight ? "border-[var(--color-accent-dim)] bg-[var(--color-paper-2)]" : "border-[var(--color-rule-soft)] bg-[var(--color-paper-2)]"
                }`}
              >
                <header className="flex items-baseline justify-between">
                  <h2 className="text-[var(--text-md)]">{t.name}</h2>
                  {t.highlight && (
                    <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent)]" style={{ fontFamily: "var(--font-mono)" }}>
                      most useful
                    </span>
                  )}
                </header>
                <p className="tnum" style={{ fontFamily: "var(--font-mono)" }}>
                  <span className="text-[var(--text-2xl)] text-[var(--color-ink)]">{t.price}</span>{" "}
                  <span className="text-sm text-[var(--color-neutral)]">{t.cadence}</span>
                </p>
                <p className="text-sm text-[var(--color-neutral)]">{t.line}</p>
                <ul className="flex flex-col gap-1.5 text-sm text-[var(--color-muted)]">
                  {t.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-[var(--color-accent)]">·</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={t.cta.href}
                  className={`press mt-auto inline-flex min-h-10 items-center justify-center rounded-[3px] px-4 text-sm font-medium ${
                    t.highlight
                      ? "bg-[var(--color-accent)] text-[var(--color-paper)] hover:bg-[var(--color-ink)]"
                      : "border border-[var(--color-rule)] text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  }`}
                >
                  {t.cta.label}
                </Link>
              </section>
            ))}
          </div>

          <p className="mt-6 text-xs text-[var(--color-neutral)]">
            Billing is a placeholder in this build — plan switches apply instantly in Settings so every gate is testable.
          </p>

          <section className="mt-[var(--space-3xl)] max-w-[64ch]">
            <h2 className="text-[var(--text-lg)]">Questions, answered plainly</h2>
            <dl className="mt-6 flex flex-col gap-6">
              {FAQ.map((f) => (
                <div key={f.q}>
                  <dt className="font-medium text-[var(--color-ink)]">{f.q}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-[var(--color-neutral)]">{f.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </main>
      <footer className="border-t border-[var(--color-rule-soft)] px-[var(--page-gutter)] py-6">
        <p className="max-w-[90ch] text-xs leading-relaxed text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
          backtester v0.1 · plans change nothing about the math · © 2026.
        </p>
      </footer>
    </div>
  );
}
