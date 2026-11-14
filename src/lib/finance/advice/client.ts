"use client";

// The browser side of &advice's background work (v1.13.0): the billing-mail
// scan, which any page starts when it's due, and a card's one-click fix.

import { schedulePnlRefresh } from "@/lib/finance/auto-rollup";

/** Window event after a card's fix changed Expenses rows — the Expenses page reloads. */
export const EXPENSES_CHANGED = "finance:expenses-changed";

let scanning: Promise<boolean> | null = null;

/**
 * Read the billing mail now — one scan at a time, however many callers ask
 * (the corner button's peek and the open pane both may). The server decides
 * whether it's due (run.ts MAIL_EVERY_MS); this only keeps it from running twice.
 */
export function scanMail(): Promise<boolean> {
  scanning ??= fetch("/api/finance/mail/scan", { method: "POST" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      scanning = null;
    });
  return scanning;
}

type Row = Record<string, unknown> & { id: string };

export async function applyFix(id: string): Promise<{ done: string; undo: () => Promise<boolean> } | { error: string }> {
  const res = await fetch(`/api/finance/advice/${id}/fix`, { method: "POST" }).catch(() => null);
  const j = (res ? await res.json().catch(() => ({})) : {}) as { error?: string; done?: string; before?: Row[]; added?: string | null };
  if (!res?.ok) return { error: j.error ?? "Couldn't make that change — try again" };
  changed();
  const before = j.before ?? [];
  return {
    done: j.done ?? "Done",
    undo: async () => {
      const r = await fetch(`/api/finance/advice/${id}/fix`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ undo: before, added: j.added ?? undefined }) }).catch(() => null);
      if (r?.ok) changed();
      return !!r?.ok;
    },
  };
}

/** Expenses feed the P&L: recompute it, and tell an open Expenses page to reload. */
export function changed() {
  schedulePnlRefresh();
  window.dispatchEvent(new Event(EXPENSES_CHANGED));
}
