"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import { Card, ConfirmDialog } from "@/components/finance/ui";

/**
 * Billing mail for &advice (v1.12.0), owner only: the mailboxes the scan reads
 * (Nitsan, 2026-11-05: nitsan@, office@ and studio@studionmore.com). Anyone
 * else gets a 403 from /api/mail and sees nothing.
 */

const SUGGESTED = ["nitsan@studionmore.com", "office@studionmore.com", "studio@studionmore.com"];

interface Account {
  email: string;
  status: string;
  lastError: string | null;
  lastScanAt: string | null;
  kept: number;
}

const RESULT: Record<string, string> = {
  connected: "Connected. The first scan reads the last 400 days.",
  declined: "Google's screen was closed — nothing was connected.",
  expired: "That took too long or came from another tab — try Connect again.",
  "no-token": "Google didn't hand back a lasting key — try again.",
  "wrong-scope": "Google granted more than read-only access, so it was refused.",
  "wrong-domain": "Only @studionmore.com mailboxes can be connected.",
  "no-table": "The mailbox table is missing — run reference/0015_finance_mail.sql first.",
  "not-configured": "Google isn't set up in this Vercel project yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FINANCE_MAIL_TOKEN_KEY).",
  error: "Something went wrong connecting — try again.",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function MailSettings() {
  const params = useSearchParams();
  const [state, setState] = useState<{ configured: boolean; accounts: Account[] } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(RESULT[params.get("mail") ?? ""] ?? null);
  // The mailbox waiting on "Disconnect?" — the app's dialog, as window.confirm returns false at once in the desktop pane.
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/finance/mail").catch(() => null);
    if (!res) return setError("Couldn't reach the server.");
    if (res.status === 401 || res.status === 403) return setHidden(true);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.error ?? "Something went wrong.");
    setError(null);
    setState(j);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function scan() {
    setScanning(true);
    const res = await fetch("/api/finance/mail/scan", { method: "POST" }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) setNote(j.error ?? "The scan didn't run.");
    else {
      const results = (j.results ?? []) as { email: string; read: number; kept: number; receipts?: number; error: string | null }[];
      setNote(
        results
          .map((r) => (r.error ? `${r.email}: ${r.error}` : `${r.email}: ${r.kept} billing emails of ${r.read} read${r.receipts ? `, ${r.receipts} receipts read for Expenses` : ""}`))
          .join(" · ") || "No mailbox to scan.",
      );
    }
    setScanning(false);
    void load();
  }

  async function disconnect(email: string) {
    const res = await fetch(`/api/finance/mail?email=${encodeURIComponent(email)}`, { method: "DELETE" }).catch(() => null);
    // A failed DELETE used to reload as if the mailbox were gone.
    if (!res?.ok) {
      const j = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      setNote(`Couldn't disconnect ${email}: ${j.error ?? "couldn't reach the server."}`);
    }
    void load();
  }

  if (hidden) return null;
  const connected = new Map((state?.accounts ?? []).map((a) => [a.email, a]));
  const rows = [...new Set([...SUGGESTED, ...connected.keys()])];

  return (
    <Card className="mt-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-brand-soft p-2 text-brand-dark">
          <Mail size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium">Billing mail for &amp;advice</h2>
          <p className="mt-0.5 text-sm text-muted">
            &amp;advice reads the sender, subject and preview line of billing mail from vendors on the Expenses page — receipts,
            renewal notices, price changes, cancellations, failed payments. Receipts are also read in full for their amount, so
            Expenses can suggest adding them, and their PDF or scan is kept with the expense for you to preview and download
            (privately — only you and whoever has Expenses can open them). It never keeps an email&apos;s text, and its access is read-only: it can&apos;t send,
            move or delete anything.
          </p>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          {state && (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {rows.map((email) => {
                const a = connected.get(email);
                return (
                  <li key={email} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{email}</span>
                    {a ? (
                      <>
                        <span className={`text-xs ${a.status === "ok" ? "text-muted" : "text-danger"}`}>
                          {a.status === "ok"
                            ? a.lastScanAt
                              ? `${a.kept} kept · scanned ${when(a.lastScanAt)}`
                              : "not scanned yet"
                            : a.status === "revoked"
                              ? "access was revoked — connect again"
                              : `last scan failed${a.lastError ? `: ${a.lastError}` : ""}`}
                        </span>
                        {a.status === "revoked" && (
                          <a href={`/api/finance/mail/connect?hint=${encodeURIComponent(email)}`} className="text-xs font-medium text-brand hover:underline">
                            Reconnect
                          </a>
                        )}
                        <button onClick={() => setDisconnecting(email)} className="text-xs text-faint hover:text-danger">
                          Disconnect
                        </button>
                      </>
                    ) : state.configured ? (
                      <a href={`/api/finance/mail/connect?hint=${encodeURIComponent(email)}`} className="text-xs font-medium text-brand hover:underline">
                        Connect
                      </a>
                    ) : (
                      <span className="text-xs text-faint">not connected</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void scan()}
              disabled={scanning || !state?.configured || !state.accounts.length}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {scanning ? "Scanning…" : "Scan now"}
            </button>
            {state && !state.configured && <span className="text-xs text-faint">{RESULT["not-configured"]}</span>}
          </div>
          {note && <p className="mt-2 text-xs text-muted">{note}</p>}
          <p className="mt-3 text-xs text-faint">
            Connecting opens Google&apos;s screen — sign in as that mailbox. It then scans by itself about every 6 hours,
            from whichever page is open.
          </p>
        </div>
      </div>
      {disconnecting &&
        createPortal(
          <ConfirmDialog
            title={`Disconnect ${disconnecting}?`}
            body="Finance stops reading this mailbox and forgets its key; what was already read stays. The tracker's own Gmail connection isn't touched — to withdraw Google access altogether, remove the app at myaccount.google.com."
            confirmLabel="Disconnect"
            danger
            onConfirm={() => {
              const email = disconnecting;
              setDisconnecting(null);
              void disconnect(email);
            }}
            onCancel={() => setDisconnecting(null)}
          />,
          document.body,
        )}
    </Card>
  );
}
