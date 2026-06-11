"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Field } from "@/components/ui";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; devUrl?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password needs at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const resp = await api.post<{ email: string; dev_confirmation_url?: string }>("/api/auth/signup", {
        email,
        password,
        name,
      });
      setDone({ email: resp.email, devUrl: resp.dev_confirmation_url });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Is the backend running?");
      setBusy(false);
    }
  }

  async function google() {
    setError("");
    try {
      const { authorize_url } = await api.get<{ authorize_url: string }>("/api/auth/google");
      window.location.href = authorize_url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Google sign-in unavailable.");
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[var(--text-lg)]">Check your inbox</h1>
        <p className="text-sm text-[var(--color-muted)]">
          A confirmation link is on its way to <span className="text-[var(--color-ink)]">{done.email}</span>. Open it to
          activate the account.
        </p>
        {done.devUrl && (
          <div className="rounded-[6px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-4 text-sm">
            <p className="mb-2 text-xs uppercase tracking-[0.08em] text-[var(--color-warn)]">
              Dev mode — no email service configured
            </p>
            <p className="text-[var(--color-neutral)]">The backend logged the link instead of sending it:</p>
            <a href={done.devUrl} className="mt-2 block break-all text-[var(--color-accent)] underline underline-offset-4">
              {done.devUrl}
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[var(--text-lg)]">Create an account</h1>
      {error && <ErrorNote>{error}</ErrorNote>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" loading={busy}>
          Create account
        </Button>
      </form>
      <Button variant="outline" onClick={google}>
        Continue with Google
      </Button>
      <p className="text-sm text-[var(--color-neutral)]">
        Already registered?{" "}
        <Link href="/login" className="text-[var(--color-accent)] underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
