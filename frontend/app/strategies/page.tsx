"use client";

// Signal library: browse, search, star, fork, manage saved strategies.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError, fmtNum, fmtPct, signed } from "@/lib/api";
import type { Strategy } from "@/lib/types";

const CATEGORY_TONE: Record<string, "accent" | "warn" | "up"> = {
  momentum: "accent",
  mean_reversion: "warn",
  ml: "up",
};

export default function StrategiesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Strategy[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  function load() {
    api.get<Strategy[]>("/api/strategies").then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    const r = q
      ? rows.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.category.includes(q))
      : rows;
    return [...r].sort((a, b) => Number(b.starred) - Number(a.starred));
  }, [rows, query]);

  async function star(s: Strategy) {
    await api.patch(`/api/strategies/${s.id}`, { starred: !s.starred });
    load();
  }

  async function fork(s: Strategy) {
    setError("");
    try {
      const f = await api.post<Strategy>(`/api/strategies/${s.id}/fork`);
      router.push(`/strategies/${f.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Fork failed.");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[72rem] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[var(--text-lg)]">Signal library</h1>
          <div className="flex items-center gap-3">
            <input
              type="search"
              placeholder="Search strategies"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56 rounded-[3px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-1.5 text-sm placeholder:text-[var(--color-neutral)]"
              aria-label="Search strategies"
            />
            <Link href="/build">
              <Button>New strategy</Button>
            </Link>
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {filtered === null ? (
          <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
            <Spinner /> Loading library…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            what={query ? "Nothing matches that search." : "The library is empty."}
            why={query ? "Try a shorter query or clear the box." : "Strategies you save in the builder appear here with their latest results."}
            action={
              !query ? (
                <Link href="/build">
                  <Button>Open the builder</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => {
              const m = s.last_metrics;
              return (
                <article key={s.id} className="flex flex-col gap-3 rounded-[6px] border border-[var(--color-rule-soft)] bg-[var(--color-paper-2)] p-4">
                  <header className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/strategies/${s.id}`} className="block truncate font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]">
                        {s.name}
                      </Link>
                      <p className="tnum mt-0.5 text-xs text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
                        v{s.latest_version?.version_number ?? 0} · {s.latest_version?.signal_type ?? "—"}
                        {s.forked_from_id && " · fork"}
                      </p>
                    </div>
                    <button
                      onClick={() => star(s)}
                      className="press text-base leading-none"
                      style={{ color: s.starred ? "var(--color-warn)" : "var(--color-rule)" }}
                      aria-label={s.starred ? "Unstar" : "Star"}
                      title={s.starred ? "Unstar" : "Star"}
                    >
                      ★
                    </button>
                  </header>

                  {m ? (
                    <>
                      <div className="tnum grid grid-cols-3 gap-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                        <div>
                          <p className="text-[var(--color-neutral)]">ret</p>
                          <p style={{ color: m.total_return >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                            {signed(m.total_return)}
                            {fmtPct(m.total_return)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[var(--color-neutral)]">sharpe</p>
                          <p className="text-[var(--color-ink)]">{fmtNum(m.sharpe)}</p>
                        </div>
                        <div>
                          <p className="text-[var(--color-neutral)]">max dd</p>
                          <p className="text-[var(--color-down)]">{fmtPct(m.max_drawdown)}</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-[var(--color-neutral)]">No backtest on the latest version yet.</p>
                  )}

                  <footer className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--color-rule-soft)] pt-3">
                    <Badge tone={CATEGORY_TONE[s.category] ?? "plain"}>{s.category.replace("_", " ")}</Badge>
                    <div className="flex gap-1">
                      <Link href={`/build?strategy=${s.id}`}>
                        <Button variant="ghost" className="!px-2 text-xs">
                          iterate
                        </Button>
                      </Link>
                      <Button variant="ghost" className="!px-2 text-xs" onClick={() => fork(s)}>
                        fork
                      </Button>
                      {s.last_backtest_id && (
                        <Link href={`/backtests/${s.last_backtest_id}`}>
                          <Button variant="ghost" className="!px-2 text-xs">
                            results
                          </Button>
                        </Link>
                      )}
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
