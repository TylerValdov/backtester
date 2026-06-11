"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Field } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post("/api/auth/login", { email, password });
      router.replace(params.get("next") ?? "/dashboard");
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

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[var(--text-lg)]">Sign in</h1>
      {error && <ErrorNote>{error}</ErrorNote>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
      </form>
      <Button variant="outline" onClick={google}>
        Continue with Google
      </Button>
      <p className="text-sm text-[var(--color-neutral)]">
        New here?{" "}
        <Link href="/signup" className="text-[var(--color-accent)] underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
