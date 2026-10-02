"use client";

// Settings → Leads: the board's stages (with their stall limits), the reasons a
// lead is lost, and the website form's webhook address.
//
// ⚠️ ITS OWN TAB, like Hiring — selling is a different job from how the
// studio's own work is labelled. Shaped after `candidate-settings.tsx`.

import { useCallback, useEffect, useState } from "react";
import { Copy, GripVertical, Mail, Plus, Trash2 } from "lucide-react";
import {
  loadGmailStatus,
  loadInboundToken,
  loadMailSettings,
  loadVocabulary,
  type GmailStatus,
  type Vocabulary,
} from "@/lib/leads/data";
import { useData } from "@/lib/store";
import {
  saveMailSetting,
  addLostReason,
  addStage,
  removeLostReason,
  removeStage,
  renameLostReason,
  reorderStages,
  updateStage,
} from "@/lib/leads/actions";

const CARD = "rounded-xl border border-border bg-surface p-4 shadow-card";
const HEAD = "text-sm font-semibold";
const NOTE = "mt-1 text-xs leading-relaxed text-muted";
const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm sm:min-h-0";

function EditableName({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  return (
    <input
      defaultValue={value}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== value) onCommit(v);
        else e.target.value = value;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      className="bidi-auto min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-border focus:border-border focus:bg-surface focus:outline-none"
    />
  );
}

const KIND_TAG: Record<string, string> = {
  won: "bg-[#eaf6ee] text-[#12693d]",
  lost: "bg-background text-muted",
};

/**
 * Who gets the morning email and the "offer waiting for review" alert.
 *
 * ⚠️ NOTHING SAVED MEANS EVERY ADMIN — the default the mail routes apply —
 * so the boxes start ticked until somebody changes them.
 */
function MailCard() {
  const { profiles } = useData();
  const admins = profiles.filter((p) => p.active && p.role === "admin").sort((a, b) => a.name.localeCompare(b.name));
  const [saved, setSaved] = useState<{ digest: string[] | null; approvers: string[] | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadMailSettings().then((v) => alive && setSaved(v));
    return () => {
      alive = false;
    };
  }, []);

  if (!saved) return null;
  const all = admins.map((a) => a.id);
  const row = (key: "digest_recipients" | "approver_ids", title: string, note: string) => {
    const current = (key === "digest_recipients" ? saved.digest : saved.approvers) ?? all;
    return (
      <div className="mt-3">
        <div className="text-[12.5px] font-medium">{title}</div>
        <div className="text-[11.5px] text-faint">{note}</div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {admins.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5 text-[12.5px]">
              <input
                type="checkbox"
                checked={current.includes(a.id)}
                onChange={async (e) => {
                  const next = e.target.checked ? [...current, a.id] : current.filter((x) => x !== a.id);
                  setErr(null);
                  try {
                    await saveMailSetting(key, next);
                    setSaved((p) => (p ? { ...p, [key === "digest_recipients" ? "digest" : "approvers"]: next } : p));
                  } catch (ex) {
                    setErr(ex instanceof Error ? ex.message : "Could not save.");
                  }
                }}
              />
              {a.name}
            </label>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className={CARD}>
      <h3 className={HEAD}>Emails</h3>
      <p className={NOTE}>Sent from notifications@studionmore.com. Nothing is sent on a day with nothing to report.</p>
      {row("digest_recipients", "Morning email", "Sun–Thu ~7:00 — replies owed, steps due, suggestions waiting.")}
      {row("approver_ids", "Offer waiting for review", "When an offer is set to In review. The person who set it isn't emailed.")}
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
    </div>
  );
}

/** What `/api/gmail/callback` reports back in `?gmail=`. */
const GMAIL_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Gmail connected. Open leads are being searched for their history now — give it a minute." },
  cancelled: { ok: false, text: "Gmail wasn't connected — the Google screen was closed." },
  "bad-state": { ok: false, text: "That sign-in link had expired. Press Connect Gmail again." },
  "no-scope": { ok: false, text: "Google didn't grant read access. Press Connect and leave the Gmail box ticked." },
  "no-refresh-token": { ok: false, text: "Google didn't hand over a lasting token. Remove the app at myaccount.google.com → Security → Third-party access, then connect again." },
  "wrong-domain": { ok: false, text: "Only @studionmore.com mailboxes can be connected." },
  "not-configured": { ok: false, text: "Gmail isn't set up on the server yet — see docs/gmail-setup.md." },
  failed: { ok: false, text: "Connecting Gmail failed. Try again; if it repeats, tell Claude." },
};

/**
 * Connect / disconnect YOUR mailbox, and see who else has.
 *
 * ⚠️ EACH PERSON CONNECTS THEIR OWN. The button starts Google's consent screen
 * for whoever is signed in here; nobody can connect a colleague's mailbox, and
 * Disconnect only ever removes your own.
 */
function GmailCard() {
  const [status, setStatus] = useState<GmailStatus | null | undefined>(undefined);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => setStatus(await loadGmailStatus()), []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await loadGmailStatus();
      if (!alive) return;
      setStatus(s);
      const q = new URLSearchParams(window.location.search).get("gmail");
      if (q) {
        setResult(q);
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete("gmail");
          window.history.replaceState(null, "", u.pathname + u.search);
        } catch {
          // The flag is only a message.
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const mine = status?.connections.find((c) => c.profile_id === status.me) ?? null;
  const msg = result ? GMAIL_RESULT[result] : null;

  return (
    <div className={CARD}>
      <h3 className={`${HEAD} flex items-center gap-1.5`}>
        <Mail size={15} strokeWidth={1.75} /> Gmail
      </h3>
      <p className={NOTE}>
        Read-only. Threads with a lead&rsquo;s contacts or company domain attach to the lead by themselves, with who
        owes the next reply. Only matching threads are stored — headers and text, never attachments. Each of you
        connects your own mailbox.
      </p>
      {msg && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] ${msg.ok ? "bg-[#eaf6ee] text-[#12693d]" : "bg-danger/5 text-danger"}`}>
          {msg.text}
        </p>
      )}
      {status === undefined && <p className="mt-3 text-[12.5px] text-faint">Loading…</p>}
      {status === null && <p className="mt-3 text-[12.5px] text-danger">Could not read the Gmail status.</p>}
      {status && !status.installed && (
        <p className="mt-3 text-[12.5px] text-warning">Run migration 0043 first.</p>
      )}
      {status && status.installed && !status.configured && (
        <p className="mt-3 text-[12.5px] text-warning">
          Waiting on the Google Cloud setup (docs/gmail-setup.md) — then Connect appears here.
        </p>
      )}
      {status && status.installed && (
        <div className="mt-3 flex flex-col gap-1.5">
          {status.connections.map((c) => (
            <div key={c.profile_id} className="flex items-center gap-2 text-[12.5px]">
              <span
                className={`size-2 shrink-0 rounded-full ${c.status === "ok" ? "bg-success" : "bg-danger"}`}
                aria-hidden
              />
              <span className="font-medium">{c.email}</span>
              <span className="text-faint">
                {c.status === "ok"
                  ? c.last_sync_at
                    ? `synced ${new Date(c.last_sync_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`
                    : "connected"
                  : c.status === "revoked"
                    ? "access removed — reconnect"
                    : `error: ${c.last_error ?? "unknown"}`}
              </span>
            </div>
          ))}
          {status.connections.length === 0 && <p className="text-[12.5px] text-faint">No mailbox connected yet.</p>}
          {status.configured && (
            <div className="mt-2 flex gap-2">
              {!mine || mine.status !== "ok" ? (
                <a
                  href="/api/gmail/connect"
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white"
                >
                  <Mail size={13} /> {mine ? "Reconnect my Gmail" : "Connect my Gmail"}
                </a>
              ) : (
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(`Disconnect ${mine.email}? Threads already on leads stay there.`)) return;
                    setBusy(true);
                    await fetch("/api/gmail/disconnect", { method: "POST" }).catch(() => undefined);
                    await reload();
                    setBusy(false);
                  }}
                  className="h-8 rounded-lg border border-border px-3 text-[12.5px] hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  Disconnect my Gmail
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LeadSettings() {
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newStage, setNewStage] = useState("");
  const [newReason, setNewReason] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    setVocab(await loadVocabulary());
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [v, t] = await Promise.all([loadVocabulary(), loadInboundToken()]);
        if (!alive) return;
        setVocab(v);
        setToken(t);
        setOrigin(window.location.origin);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the lead settings.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      setNotice(null);
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That change could not be saved.");
      }
    },
    [reload],
  );

  if (!vocab) return <p className="text-sm text-muted">{error ?? "Loading…"}</p>;

  const webhook = token ? `${origin}/api/leads/inbound/${token}` : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {(error || notice) && (
        <div
          className={`rounded-lg px-3 py-2 text-sm lg:col-span-2 ${
            error ? "border border-danger/30 bg-danger/5 text-danger" : "border border-border bg-background text-muted"
          }`}
        >
          {error ?? notice}
        </div>
      )}

      <div className={CARD}>
        <h3 className={HEAD}>Stages</h3>
        <p className={NOTE}>
          The board&rsquo;s columns, in order. Drag to reorder. <strong className="font-medium text-foreground">Stall
          after</strong> is how many working days (Sun–Thu) a lead can sit in that stage with no activity before it is
          flagged; leave it empty for never. Won and Lost are fixed in kind — rename them freely.
        </p>
        <div className="mt-3 flex flex-col gap-1">
          {vocab.stages.map((s) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId && dragId !== s.id) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragId || dragId === s.id) return;
                const ids = vocab.stages.map((x) => x.id).filter((x) => x !== dragId);
                ids.splice(ids.indexOf(s.id), 0, dragId);
                setDragId(null);
                void run(() => reorderStages(ids));
              }}
              className="group flex items-center gap-1 rounded-lg border border-transparent px-1 py-0.5 hover:border-border"
            >
              <GripVertical size={14} className="shrink-0 cursor-grab text-faint opacity-0 group-hover:opacity-100" aria-hidden />
              <EditableName value={s.name} onCommit={(v) => void run(() => updateStage(s.id, { name: v }))} />
              {s.kind === "open" ? (
                <label className="flex shrink-0 items-center gap-1 text-[11.5px] text-faint">
                  Stall after
                  <input
                    type="number"
                    min={1}
                    max={60}
                    key={`${s.id}-${s.stallDays}`}
                    defaultValue={s.stallDays ?? ""}
                    placeholder="—"
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const n = raw === "" ? null : Math.round(Number(raw));
                      if (n !== null && !(n > 0)) {
                        e.target.value = s.stallDays?.toString() ?? "";
                        return;
                      }
                      if (n !== s.stallDays) void run(() => updateStage(s.id, { stallDays: n }));
                    }}
                    className="w-12 rounded border border-border px-1 py-0.5 text-right text-[12px] text-foreground"
                  />
                  days
                </label>
              ) : (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${KIND_TAG[s.kind]}`}>
                  {s.kind === "won" ? "Won" : "Lost"}
                </span>
              )}
              <button
                onClick={() =>
                  void run(async () => {
                    const res = await removeStage(s, vocab.stages);
                    if (!res.ok) setNotice(res.reason);
                  })
                }
                aria-label={`Remove ${s.name}`}
                className="shrink-0 rounded p-1.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newStage.trim();
            if (!name) return;
            setNewStage("");
            void run(() => addStage(name, Math.max(0, ...vocab.stages.map((s) => s.position)) + 1));
          }}
          className="mt-3 flex gap-2"
        >
          <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="Add a stage" className={FIELD} />
          <button
            type="submit"
            disabled={!newStage.trim()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-40"
          >
            <Plus size={15} strokeWidth={2} /> Add
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-4">
        <GmailCard />
        <MailCard />
        <div className={CARD}>
          <h3 className={HEAD}>Lost reasons</h3>
          <p className={NOTE}>Asked when a lead moves to Lost. Removing one leaves its leads lost, untagged.</p>
          <div className="mt-3 flex flex-col gap-1">
            {vocab.lostReasons.map((r) => (
              <div key={r.id} className="group flex items-center gap-1 rounded-lg border border-transparent px-1 py-0.5 hover:border-border">
                <EditableName value={r.name} onCommit={(v) => void run(() => renameLostReason(r.id, v))} />
                <button
                  onClick={() => void run(() => removeLostReason(r.id))}
                  aria-label={`Remove ${r.name}`}
                  className="shrink-0 rounded p-1.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = newReason.trim();
              if (!name) return;
              setNewReason("");
              void run(() => addLostReason(name, Math.max(0, ...vocab.lostReasons.map((r) => r.position)) + 1));
            }}
            className="mt-3 flex gap-2"
          >
            <input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Add a reason" className={FIELD} />
            <button
              type="submit"
              disabled={!newReason.trim()}
              className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-40"
            >
              <Plus size={15} strokeWidth={2} /> Add
            </button>
          </form>
        </div>

        <div className={CARD}>
          <h3 className={HEAD}>Website form</h3>
          <p className={NOTE}>
            In Framer, open the contact form&rsquo;s settings → <strong className="font-medium text-foreground">Send to
            → Webhook</strong> and paste this address. Each submission lands on the board as a new lead in the first
            stage and emails you both. <strong className="font-medium text-foreground">Keep it private</strong> —
            anyone with it can add leads.
          </p>
          {webhook ? (
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-[11.5px]">
                {webhook}
              </code>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(webhook);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  } catch {
                    window.prompt("Copy this:", webhook);
                  }
                }}
                className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-[12.5px]"
              >
                <Copy size={13} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-warning">No secret found — run migration 0042.</p>
          )}
        </div>
      </div>
    </div>
  );
}
