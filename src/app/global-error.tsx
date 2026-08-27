"use client";

import "./globals.css";

/**
 * The last resort: a throw in the ROOT layout, or in `AppShell` (which the app
 * layout renders, and which `(app)/error.tsx` therefore cannot catch).
 *
 * ⚠️ IT REPLACES THE ROOT LAYOUT, so it must bring its own `<html>` and `<body>`
 * and its own styles — nothing above it is rendered. That is why `globals.css` is
 * imported here rather than inherited, and why the markup is deliberately plain:
 * whatever broke may be the very thing that styles the page, so this leans on the
 * stylesheet for colour but stays legible without it.
 *
 * ⚠️ NO `unstable_retry` BUTTON HERE, deliberately. At this level the failure is
 * the shell or the root layout, so re-rendering the same children is very likely
 * to throw again and trap somebody in a loop. A full reload is the honest offer.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            textAlign: "center",
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-card">
            <h1 className="font-serif-accent text-2xl leading-tight">The tracker stopped</h1>
            <p className="mt-2 text-sm text-muted">
              Something failed before the app could draw. Reloading usually fixes it — your
              data is untouched.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Reload
            </button>
            {error.digest && (
              <p className="mt-4 text-[11px] text-faint">
                Reference <span className="font-mono">{error.digest}</span>
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
