"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { ErrorNote, Spinner } from "@/components/ui";

function ConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState("");
  const fired = useRef(false);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("This confirmation link is missing its token.");
      return;
    }
    if (fired.current) return;
    fired.current = true;
    api
      .post(`/api/auth/confirm?token=${encodeURIComponent(token)}`)
      .then(() => router.replace("/dashboard"))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Confirmation failed."));
  }, [params, router]);

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[var(--text-lg)]">Confirmation failed</h1>
        <ErrorNote>{error}</ErrorNote>
        <Link href="/signup" className="text-sm text-[var(--color-accent)] underline underline-offset-4">
          Sign up again
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
      <Spinner /> Confirming your account…
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmInner />
    </Suspense>
  );
}
