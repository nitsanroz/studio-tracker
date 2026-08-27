"use client";

import { useEffect } from "react";

/**
 * The fallback a CLIENT sees — shared by `/report/[token]`, `/gantt/[token]` and
 * `/intake/[token]`, which are the three pages people outside the studio open.
 *
 * ⚠️ ONE COMPONENT, THREE THIN `error.tsx` FILES. Each route segment needs its own
 * file (that is how the convention works), but the wording and the reasoning below
 * belong in one place — three hand-written copies would drift, and the one that
 * drifts is the one a client reads.
 *
 * ⚠️ IT SAYS NOTHING TECHNICAL, AND THAT IS THE DESIGN. A stack trace or a raw
 * message in front of a client is worse than useless: they cannot act on it, and
 * a server-side message can carry detail we would never choose to show them
 * (which is exactly why Next replaces it with a digest in production). The digest
 * IS shown, framed as something to quote to the studio, because otherwise a report
 * of "it broke" carries nothing to search the logs with.
 *
 * ⚠️ NO RETRY BUTTON. On these pages the data is fetched on the server for a
 * frozen snapshot or a token-gated form; if it threw once it will almost certainly
 * throw again, and a button that visibly does nothing reads as a second failure.
 * The honest instruction is to reload, or to come back to the studio.
 */
export function PublicError({
  error,
  what,
}: {
  error: Error & { digest?: string };
  /** What the reader was trying to open, in their words — "this report". */
  what: string;
}) {
  useEffect(() => {
    console.error("[public error]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
        <h1 className="font-serif-accent text-2xl leading-tight">{what} couldn&apos;t open</h1>
        <p className="mt-2 text-sm text-muted">
          Something went wrong at our end. Reloading may work; if it doesn&apos;t, let
          Studio&amp;more know and we&apos;ll sort it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Reload
        </button>
        {error.digest && (
          <p className="mt-4 text-[11px] text-faint">
            If you get in touch, quote <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
