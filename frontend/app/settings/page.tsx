"use client";

// Settings: profile, data-provider API keys (encrypted at rest), broker link
// placeholder, notifications, plan.

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, ErrorNote, Field, Panel, SelectField } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";

type StoredKey = { id: string; provider: string; last_four: string; created_at: string };
type Notifs = { backtest_complete: boolean; paper_fill: boolean; weekly_summary: boolean };

const PROVIDER_LABEL: Record<string, string> = {
  polygon: "Polygon.io — historical + live market data",
  alpaca: "Alpaca — market data + paper broker",
  yahoo: "Yahoo Finance — historical data",
  broker_paper: "Broker paper account (e.g. Alpaca paper)",
  ml_endpoint: "ML inference endpoint token",
};

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [provider, setProvider] = useState("polygon");
  const [newKey, setNewKey] = useState("");
  const [notifs, setNotifs] = useState<Notifs | null>(null);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState("");

  useEffect(() => {
    api.get<User>("/api/auth/me").then((u) => {
      setUser(u);
      setName(u.name);
    }).catch(() => {});
    loadKeys();
    api.get<Notifs>("/api/settings/notifications").then(setNotifs).catch(() => {});
  }, []);

  function loadKeys() {
    api.get<StoredKey[]>("/api/settings/api-keys").then(setKeys).catch(() => {});
  }

  function flash(msg: string) {
    setSavedFlash(msg);
    setTimeout(() => setSavedFlash(""), 2500);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    await api.patch("/api/settings/profile", { name });
    flash("Profile saved.");
  }

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/api/settings/api-keys", { provider, key: newKey });
      setNewKey("");
      loadKeys();
      flash("Key stored (encrypted).");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not store the key.");
    }
  }

  async function removeKey(id: string) {
    await api.del(`/api/settings/api-keys/${id}`);
    loadKeys();
  }

  async function saveNotifs(next: Notifs) {
    setNotifs(next);
    await api.patch("/api/settings/notifications", next);
  }

  async function changePlan(plan: string) {
    await api.post("/api/settings/plan", { plan });
    const u = await api.get<User>("/api/auth/me");
    setUser(u);
    flash(`Plan switched to ${plan}.`);
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[56rem] flex-col gap-5">
        <div className="flex items-center justify-between">
          <h1 className="text-[var(--text-lg)]">Settings</h1>
          {savedFlash && (
            <span className="text-xs text-[var(--color-up)]" style={{ fontFamily: "var(--font-mono)" }} role="status">
              {savedFlash}
            </span>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}

        <Panel title="profile">
          <form onSubmit={saveProfile} className="flex flex-wrap items-end gap-4">
            <div className="min-w-56 flex-1">
              <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="min-w-56 flex-1">
              <Field label="Email" value={user?.email ?? ""} disabled hint="Email is the account identity and can't change here." />
            </div>
            <Button type="submit">Save profile</Button>
          </form>
        </Panel>

        <Panel title="data provider api keys">
          <p className="mb-4 text-sm text-[var(--color-neutral)]">
            Keys are encrypted at rest (Fernet) and never returned by the API — only the provider and last four characters
            are shown. Adding a market-data key is what switches the engine off sample data.
          </p>
          {keys.length > 0 && (
            <ul className="mb-4 flex flex-col divide-y divide-[var(--color-rule-soft)] rounded-[3px] border border-[var(--color-rule-soft)]">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="text-[var(--color-ink)]">{PROVIDER_LABEL[k.provider] ?? k.provider}</span>
                  <span className="tnum text-xs text-[var(--color-neutral)]" style={{ fontFamily: "var(--font-mono)" }}>
                    ····{k.last_four}
                  </span>
                  <button onClick={() => removeKey(k.id)} className="press ml-auto text-xs text-[var(--color-down)] underline underline-offset-4">
                    Remove key
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addKey} className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <SelectField
              label="Provider"
              value={provider}
              onChange={setProvider}
              options={Object.entries(PROVIDER_LABEL).map(([value, label]) => ({ value, label }))}
            />
            <Field label="API key" type="password" required minLength={4} value={newKey} onChange={(e) => setNewKey(e.target.value)} autoComplete="off" />
            <Button type="submit">Store key</Button>
          </form>
        </Panel>

        <Panel title="broker paper account">
          <p className="text-sm text-[var(--color-neutral)]">
            Routing paper orders to a real broker paper API (Alpaca paper is the natural fit) is wired as a placeholder:
            store a <span className="text-[var(--color-ink)]">broker_paper</span> key above, then implement the order hook
            marked <code style={{ fontFamily: "var(--font-mono)" }}>PLACEHOLDER[BROKER PAPER ACCOUNT]</code> in{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>backend/app/paper/engine.py</code>. The dashboard contract
            doesn&rsquo;t change.
          </p>
        </Panel>

        {notifs && (
          <Panel title="notifications">
            <div className="flex flex-col gap-3">
              {(
                [
                  ["backtest_complete", "Backtest finished", "Email when a queued run completes."],
                  ["paper_fill", "Paper trading fills", "Email on simulated fills in live sessions."],
                  ["weekly_summary", "Weekly summary", "Monday digest of strategy performance."],
                ] as const
              ).map(([key, label, hint]) => (
                <label key={key} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={notifs[key]}
                    onChange={(e) => saveNotifs({ ...notifs, [key]: e.target.checked })}
                    className="mt-1 accent-[var(--color-accent)]"
                  />
                  <span>
                    <span className="block text-sm text-[var(--color-ink)]">{label}</span>
                    <span className="block text-xs text-[var(--color-neutral)]">{hint}</span>
                  </span>
                </label>
              ))}
              <p className="text-xs text-[var(--color-neutral)]">
                Delivery requires an email service key (<code style={{ fontFamily: "var(--font-mono)" }}>EMAIL_API_KEY</code> in backend/.env); until then events are logged.
              </p>
            </div>
          </Panel>
        )}

        <Panel title="subscription">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-[var(--color-muted)]">Current plan:</span>
            <Badge tone="accent">{user?.plan ?? "—"}</Badge>
            <div className="ml-auto flex gap-2">
              {(["free", "pro", "quant"] as const).map((p) => (
                <Button key={p} variant={user?.plan === p ? "primary" : "outline"} onClick={() => changePlan(p)} disabled={user?.plan === p}>
                  {p}
                </Button>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--color-neutral)]">
            Billing is a placeholder (PLACEHOLDER[BILLING — STRIPE] in backend/app/api/settings_api.py): switches apply
            instantly so plan gates are testable.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
