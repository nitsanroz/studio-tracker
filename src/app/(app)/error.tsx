"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

/**
 * The studio-facing safety net.
 *
 * ⚠️⚠️ WHY THIS EXISTS, AND IT IS NOT HYPOTHETICAL. Until now there was NO
 * `error.tsx` anywhere in `src/app`, which is the multiplier that turned a
 * one-character mistake into an outage in v1.32.2: a designer typed `33` into a
 * task's Figma field, React 19 refuses to render a `javascript:`-shaped href by
 * THROWING, and with no boundary the throw unmounted the whole tree — My Tasks
 * and that client's page went blank **for everyone**, persistently, until somebody
 * edited the row in SQL. One member, one field, one row. With this file the same
 * throw costs a panel and a Try again button.
 *
 * ⚠️ IT WRAPS THE PAGES, NOT THE LAYOUT ABOVE IT — that is the documented shape of
 * `error.js` and it is the good outcome here: `AppLayout` renders `AppShell`,
 * which owns the store, the sidebar and the header, so all of that survives and
 * the person can still navigate away. A throw inside the SHELL itself escapes to
 * `global-error.tsx` instead.
 *
 * ⚠️ `unstable_retry`, NOT `reset` — this Next version renamed it, and the two do
 * different things: `unstable_retry()` re-fetches and re-renders the segment,
 * while `reset()` only clears the error state and re-renders the same data, which
 * for a render-time bug means throwing again immediately. Read
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`
 * before changing this; the name is not what training data says.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // There is no error service wired up, so the console is the only record.
    // ⚠️ In production a Server Component's real message is replaced by a generic
    // one and only `digest` identifies it — so log the digest, not just the text.
    console.error("[app error]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
        <h2 className="font-serif-accent text-2xl leading-tight">This part didn&apos;t load</h2>
        <p className="mt-2 text-sm text-muted">
          Something went wrong drawing this screen. Nothing you did is lost — your hours and
          tasks are safe.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => unstable_retry()}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            <RefreshCw size={14} /> Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-background hover:text-foreground"
          >
            Reload the page
          </button>
        </div>
        {/* The digest is the only handle on a server-side error in production, so
            it is shown rather than hidden — it is meaningless to a stranger and
            the difference between a debuggable report and "it broke". */}
        {error.digest && (
          <p className="mt-4 text-[11px] text-faint">
            Reference <span className="font-mono">{error.digest}</span> — worth sending to
            Nitsan.
          </p>
        )}
      </div>
    </div>
  );
}
