"use client";

// Authenticated app chrome: mono top bar with section links + account strip.
// Horizontal scroll on phones keeps every destination reachable one-handed.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

const LINKS = [
  { href: "/dashboard", label: "paper" },
  { href: "/build", label: "build" },
  { href: "/strategies", label: "library" },
  { href: "/backtests", label: "backtests" },
  { href: "/analytics", label: "analytics" },
  { href: "/settings", label: "settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api.get<User>("/api/auth/me").then(setUser).catch(() => router.replace("/login"));
  }, [router]);

  async function logout() {
    await api.post("/api/auth/logout");
    router.replace("/");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 border-b border-[var(--color-rule-soft)] bg-[var(--color-paper)]" style={{ zIndex: "var(--z-sticky)" }}>
        <div className="flex items-center gap-1 px-[var(--page-gutter)]">
          <Link
            href="/dashboard"
            className="mr-3 shrink-0 py-3 text-[13px] text-[var(--color-ink)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <span className="text-[var(--color-accent)]">&gt;</span> backtester
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="App">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`shrink-0 whitespace-nowrap px-2.5 py-3 text-[13px] leading-none ${
                    active
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-neutral)] hover:text-[var(--color-ink)]"
                  }`}
                  style={{ fontFamily: "var(--font-mono)" }}
                  aria-current={active ? "page" : undefined}
                >
                  --{l.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden shrink-0 items-center gap-3 sm:flex">
            {user && (
              <span className="max-w-44 truncate text-xs text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
                {user.email} · {user.plan}
              </span>
            )}
            <button
              onClick={logout}
              className="press text-[13px] text-[var(--color-neutral)] underline underline-offset-4 hover:text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              --exit
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 px-[var(--page-gutter)] py-6">{children}</main>
    </div>
  );
}
