"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // /auth/confirm bounces here with ?error=link when a link can't be redeemed
  // (already used, expired, or opened after the token was consumed). Without
  // this the member lands on a blank form with no idea why.
  useEffect(() => {
    setLinkFailed(new URLSearchParams(window.location.search).get("error") === "link");
  }, []);

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
      // This path goes through Supabase's own auth mailer, which fails in two
      // ways that both used to reach the member as raw noise — a 429 when the
      // built-in mailer's ~2/hour cap is hit, and a 500 "Error sending recovery
      // email" when SMTP is misconfigured. supabase-js surfaces the latter as an
      // AuthRetryableFetchError whose message is the literal string "{}", which
      // rendered as a red "{}" on the form. Neither is the member's problem, and
      // in both cases an admin can send a link directly (see /api/admin/invite,
      // which uses Resend and doesn't touch this mailer at all).
      console.error("reset email failed", error.name, error.status, error.message);
      const rateLimited = error.status === 429 || /rate limit|after \d+ seconds/i.test(error.message);
      const unhelpful = !error.message || /^[{[\s\]}]*$/.test(error.message);
      setError(
        rateLimited
          ? "Too many requests just now — wait a few minutes and try again, or ask an admin to send you a link directly."
          : error.status && error.status >= 500
            ? "We couldn't send the email right now. Ask an admin to send you a link directly."
            : unhelpful
              ? "Something went wrong — please try again, or ask an admin to send you a link directly."
              : error.message,
      );
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
        {linkFailed && !sent && (
          <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
            That link couldn&apos;t be used — it may have expired or already been opened. Enter your
            email below and we&apos;ll send a fresh one.
          </p>
        )}
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
