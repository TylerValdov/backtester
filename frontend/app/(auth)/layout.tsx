import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--color-rule-soft)] px-[var(--page-gutter)] py-3">
        <Link href="/" className="text-[13px] text-[var(--color-ink)]" style={{ fontFamily: "var(--font-mono)" }}>
          <span className="text-[var(--color-accent)]">&gt;</span> backtester
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-[var(--page-gutter)] py-[var(--space-2xl)]">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
