"use client";

// Core UI primitives. Every color/font references a token (tokens.css).

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

// ── Button ────────────────────────────────────────────────────────────────
// States: default · hover · focus-visible · active (scale .97) · disabled · loading

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading = false, className = "", children, disabled, ...rest },
  ref,
) {
  const base =
    "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[3px] px-4 py-2 text-sm font-medium leading-none min-h-9 disabled:opacity-45 disabled:pointer-events-none";
  const variants: Record<string, string> = {
    primary:
      "bg-[var(--color-accent)] text-[var(--color-paper)] hover:bg-[var(--color-ink)]",
    outline:
      "border border-[var(--color-rule)] text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
    ghost: "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
    danger:
      "border border-[var(--color-down)] text-[var(--color-down)] hover:bg-[var(--color-down)] hover:text-[var(--color-paper)]",
  };
  return (
    <button ref={ref} className={`${base} ${variants[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
});

// ── Spinner ───────────────────────────────────────────────────────────────

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="animate-spin"
      style={{ animationDuration: "650ms" }}
      aria-label="Loading"
      role="status"
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--color-rule)" strokeWidth="2" />
      <path d="M8 1.5 a 6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Inputs ────────────────────────────────────────────────────────────────

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; info?: ReactNode; required?: boolean };

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, info, required, id, className = "", ...rest },
  ref,
) {
  const fieldId = id ?? `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="flex items-center gap-1.5 text-xs uppercase tracking-[0.08em] text-[var(--color-neutral)]">
        <span>
          {label}
          {required && <span className="ml-1 text-[var(--color-accent)]" aria-hidden>*</span>}
        </span>
        {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </label>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={!!error}
        className={`rounded-[3px] border bg-[var(--color-paper-2)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-neutral)] ${
          error ? "border-[var(--color-down)]" : "border-[var(--color-rule)]"
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-[var(--color-down)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--color-neutral)]">{hint}</p>
      ) : null}
    </div>
  );
});

export function SelectField({
  label,
  value,
  onChange,
  options,
  info,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  info?: ReactNode;
}) {
  const fieldId = `s-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="flex items-center gap-1.5 text-xs uppercase tracking-[0.08em] text-[var(--color-neutral)]">
        <span>{label}</span>
        {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </label>
      <select
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[3px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-2 text-sm text-[var(--color-ink)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── InfoTip ───────────────────────────────────────────────────────────────
// Accessible help popover: a small "?" that reveals a tip on hover OR keyboard
// focus. Origin below the trigger, exponential ease-out, no perpetual motion.

export function InfoTip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className="press grid h-4 w-4 place-items-center rounded-full border border-[var(--color-rule)] text-[9px] font-medium leading-none text-[var(--color-neutral)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus-visible:border-[var(--color-accent)] focus-visible:text-[var(--color-accent)] focus-visible:outline-none"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        ?
      </button>
      <span
        role="tooltip"
        className="invisible pointer-events-none absolute bottom-full left-1/2 z-[var(--z-tooltip)] mb-2 w-56 -translate-x-1/2 translate-y-1 rounded-[5px] border border-[var(--color-rule)] bg-[var(--color-paper-3)] px-2.5 py-2 text-[11px] normal-case leading-relaxed tracking-normal text-[var(--color-muted)] opacity-0 shadow-lg transition-[opacity,transform] duration-150 ease-[var(--ease-out)] group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {children}
      </span>
    </span>
  );
}

// ── Surfaces ──────────────────────────────────────────────────────────────

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[6px] border border-[var(--color-rule-soft)] bg-[var(--color-paper-2)] ${className}`}>
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-3 border-b border-[var(--color-rule-soft)] px-4 py-2.5">
          {title && (
            <h3 className="mono text-xs uppercase tracking-[0.1em] text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
              {title}
            </h3>
          )}
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: "up" | "down" | "accent" | "plain";
  sub?: ReactNode;
}) {
  const color =
    tone === "up"
      ? "var(--color-up)"
      : tone === "down"
        ? "var(--color-down)"
        : tone === "accent"
          ? "var(--color-accent)"
          : "var(--color-ink)";
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-neutral)]">{label}</span>
      <span className="mono tnum text-lg leading-tight" style={{ color, fontFamily: "var(--font-mono)" }}>
        {value}
      </span>
      {sub && <span className="text-xs text-[var(--color-neutral)]">{sub}</span>}
    </div>
  );
}

export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: "up" | "down" | "accent" | "warn" | "plain" }) {
  const colors: Record<string, string> = {
    up: "text-[var(--color-up)] border-[var(--color-up)]",
    down: "text-[var(--color-down)] border-[var(--color-down)]",
    accent: "text-[var(--color-accent)] border-[var(--color-accent-dim)]",
    warn: "text-[var(--color-warn)] border-[var(--color-warn)]",
    plain: "text-[var(--color-neutral)] border-[var(--color-rule)]",
  };
  return (
    <span
      className={`mono inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-[11px] uppercase tracking-[0.06em] ${colors[tone]}`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </span>
  );
}

// ── Feedback ──────────────────────────────────────────────────────────────

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-[3px] border border-[var(--color-down)] bg-[var(--color-paper-2)] px-3 py-2 text-sm text-[var(--color-down)]">
      {children}
    </p>
  );
}

export function EmptyState({
  what,
  why,
  action,
}: {
  what: string;
  why: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[6px] border border-dashed border-[var(--color-rule)] p-6">
      <p className="text-sm font-medium text-[var(--color-ink)]">{what}</p>
      <p className="text-sm text-[var(--color-neutral)]">{why}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ── Progress bar (backtest runs) ──────────────────────────────────────────

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-paper-3)]" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="h-full bg-[var(--color-accent)]"
        style={{ width: `${Math.max(2, value * 100)}%`, transition: "width 300ms linear" }}
      />
    </div>
  );
}
