// Marketing nav — N8 terminal command. The flags are the links; the caret is
// the only blinking element on the site (it earns it: "you'd type next").

import Link from "next/link";

export function TerminalNav() {
  return (
    <header className="border-b border-[var(--color-rule-soft)]">
      <pre
        className="m-0 overflow-x-auto px-[var(--page-gutter)] py-3 text-[13px] leading-none"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <span className="text-[var(--color-accent)]">&gt;</span> backtester{" "}
        <Link href="/#signals" className="text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-ink)]">
          --signals
        </Link>{" "}
        <Link href="/pricing" className="text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-ink)]">
          --pricing
        </Link>{" "}
        <Link href="/login" className="text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-ink)]">
          --login
        </Link>{" "}
        <Link href="/signup" className="text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-ink)]">
          --start
        </Link>
        <span className="caret-blink" aria-hidden="true">
          ▮
        </span>
      </pre>
    </header>
  );
}
