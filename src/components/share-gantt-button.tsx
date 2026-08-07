"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { ensureClientGanttLink } from "@/lib/gantt-links";

/**
 * Copies a public, LIVE link to this client's schedule.
 *
 * The URL is fetched on mount, not on click: `ensureClientGanttLink` may have to
 * INSERT a row, and `navigator.clipboard.writeText` after an `await` has already
 * lost the user-gesture that permits it in Safari. Prefetching keeps the write
 * synchronous. (Same reason the intake "copy form link" button prefetches.)
 *
 * Confirmation is an in-button label swap rather than the bottom toast: this
 * button lives in a toolbar, and a toast for a copy is a lot of screen for
 * "yes, that worked".
 */
export function ShareGanttButton({ clientId }: { clientId: string }) {
  const { currentUserId } = useData();
  const isAdmin = useIsAdmin();
  const url = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    ensureClientGanttLink(clientId, currentUserId).then((u) => {
      if (live) url.current = u;
    });
    return () => {
      live = false;
    };
  }, [clientId, currentUserId, isAdmin]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(id);
  }, [copied]);

  if (!isAdmin) return null;

  async function copy() {
    // The prefetch can still be in flight on a fast click, or have failed.
    let u = url.current;
    if (!u) {
      setBusy(true);
      u = await ensureClientGanttLink(clientId, currentUserId);
      setBusy(false);
      url.current = u;
    }
    if (!u) return;
    await navigator.clipboard.writeText(u);
    setCopied(true);
  }

  return (
    <button
      onClick={copy}
      disabled={busy}
      title="Copy a link to this schedule for the client — read-only, no hours, and it stays up to date"
      className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
    >
      {copied ? <Check size={13} className="text-success" /> : <Share2 size={13} />}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
