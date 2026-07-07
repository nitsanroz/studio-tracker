"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset/update`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-surface p-8 shadow-sm"
      >
        <span className="brand-wordmark w-44 bg-brand" aria-label="Studio&more" />
        <h1 className="text-lg">Reset password</h1>
        {sent ? (
          <p className="text-sm text-muted">
            Check your inbox — if <span className="font-medium text-foreground">{email}</span> has
            an account, a reset link is on its way. The link opens a page where you choose a new
            password.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              First time here, or forgot your password? Enter your studio email and we&apos;ll send
              you a link to set a new one.
            </p>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-border-strong px-3 py-2 outline-none focus:border-brand"
              />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              disabled={loading}
              className="rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}
        <Link href="/login" className="text-sm text-brand hover:underline">
          ← Back to sign in
        </Link>
      </form>
    </div>
  );
}
