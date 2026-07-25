"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Admin "Sync Everhour" — pulls recent Everhour hours on demand, for when you
 * want the very latest before running client reports. The same endpoint runs on
 * a cron; this is just the manual nudge.
 */
export function EverhourSyncButton({ days = 14 }: { days?: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/everhour-sync?days=${days}`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: j.error ?? "Sync failed" });
      } else if (j.inserted > 0) {
        const missed = j.skippedNoMatch > 0 ? ` · ${j.skippedNoMatch} skipped (unknown task)` : "";
        setMsg({ ok: true, text: `${j.inserted} new ${j.inserted === 1 ? "entry" : "entries"}${missed}` });
        setTimeout(() => window.location.reload(), 900);
      } else {
        const missed = j.skippedNoMatch > 0 ? ` — ${j.skippedNoMatch} skipped (unknown task)` : "";
        setMsg({ ok: true, text: `Already up to date${missed}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={sync}
        disabled={busy}
        title={`Pull the last ${days} days of hours from Everhour`}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:border-brand hover:text-brand disabled:opacity-50"
      >
        <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        {busy ? "Syncing…" : "Sync Everhour"}
      </button>
      {msg && (
        <span className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>
      )}
    </div>
  );
}
