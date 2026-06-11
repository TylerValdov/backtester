"use client";

// Backtest history list.

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";
import { api, fmtNum, fmtPct, signed } from "@/lib/api";
import type { Backtest } from "@/lib/types";

export default function BacktestsPage() {
  const [rows, setRows] = useState<Backtest[] | null>(null);

  useEffect(() => {
    api.get<Backtest[]>("/api/backtests").then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[64rem] flex-col gap-5">
        <h1 className="text-[var(--text-lg)]">Backtests</h1>
        {rows === null ? (
          <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
            <Spinner /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            what="No backtests yet."
            why="A backtest runs a saved strategy version against history and stores the full result."
            action={
              <Link href="/build">
                <Button>Open the builder</Button>
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-rule-soft)] rounded-[6px] border border-[var(--color-rule-soft)] bg-[var(--color-paper-2)]">
            {rows.map((bt) => (
              <li key={bt.id}>
                <Link href={`/backtests/${bt.id}`} className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 hover:bg-[var(--color-paper-3)]">
                  <span className="tnum w-44 shrink-0 text-xs text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
                    {bt.created_at.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="tnum text-xs text-[var(--color-muted)]" style={{ fontFamily: "var(--font-mono)" }}>
                    {bt.start_date} → {bt.end_date}
                  </span>
                  <span className="ml-auto flex items-center gap-4">
                    {bt.metrics && (
                      <>
                        <span className="tnum text-xs" style={{ fontFamily: "var(--font-mono)", color: bt.metrics.total_return >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                          {signed(bt.metrics.total_return)}
                          {fmtPct(bt.metrics.total_return)}
                        </span>
                        <span className="tnum text-xs text-[var(--color-muted)]" style={{ fontFamily: "var(--font-mono)" }}>
                          sharpe {fmtNum(bt.metrics.sharpe)}
                        </span>
                      </>
                    )}
                    <Badge tone={bt.status === "done" ? "up" : bt.status === "error" ? "down" : "warn"}>{bt.status}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
