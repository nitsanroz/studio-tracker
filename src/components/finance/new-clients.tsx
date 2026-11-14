"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll } from "@/lib/finance/db";
import { formatHours, formatShortDay, isoDate } from "@/lib/finance/format";
import { addClientRate, rateSummary, renameClient } from "@/lib/finance/client-rate";

/**
 * New clients from the tracker (Nitsan, 2026-10-25): clients are created in
 * studio-tracker, so finance first hears of one when its hours come in at ₪0.
 * On the first finance page of a browser session, a billable, live tracker
 * client with no rate here — created in the last 120 days or with billable
 * hours this year (or in the last 120 days, early in January) — gets a prompt
 * to set its hourly rate, its start defaulting to the month of its first such
 * hours, so none of this year's are left at ₪0.
 *
 * "Later" waits for the next session; "Not billed hourly" stops asking about that
 * client — kept in `finance_not_hourly` (reference/0013), so on every device;
 * before 0013 is run, in this browser only (&advice's "no rate" card still
 * says it if hours come in). Saving goes through lib/client-rate.ts, as the Rates page does:
 * the rate, the client's Plan row from the tracker's hours, the P&L.
 *
 * A client renamed in the tracker loses its rates (hours find a rate by
 * name). When a rate row is linked to the client by id under another name,
 * the prompt offers to move the rates — and this year's Plan rows — to the
 * new name instead (client-rate.ts `renameClient`).
 * Mounted for full-finance users only (AppShell).
 */

const SEEN = "finance.newClients.seen"; // sessionStorage: asked this session
const NOT_HOURLY = "finance.newClients.notHourly"; // localStorage: client ids not to ask about — until finance_not_hourly exists, then moved there

interface NewClient {
  id: string;
  name: string;
  hours: number;
  /** the first billable day this year (or the last 120 days), else the day it was created */
  since: string;
  /** its rates' name when they're linked to it under another one — renamed in the tracker */
  renamedFrom: string | null;
}

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
};

function readSet(store: Storage | undefined, key: string): Set<string> {
  try {
    return new Set(JSON.parse(store?.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

type Row = Record<string, unknown>;

/**
 * The clients not to ask about: `finance_not_hourly`, plus — the first time
 * the table is there — what this browser held before, moved into it. Without
 * the table (0013 not run), this browser's list alone.
 */
async function notHourlyIds(sb: ReturnType<typeof createClient>): Promise<Set<string>> {
  const local = readSet(typeof window === "undefined" ? undefined : window.localStorage, NOT_HOURLY);
  const { data, error } = await sb.from("finance_not_hourly").select("client_id");
  if (error) return local;
  const ids = new Set((data ?? []).map((r: { client_id: string }) => r.client_id));
  const moving = [...local].filter((id) => !ids.has(id));
  if (moving.length) {
    const { error: e } = await sb.from("finance_not_hourly").upsert(moving.map((client_id) => ({ client_id })), { onConflict: "client_id" });
    if (!e) {
      moving.forEach((id) => ids.add(id));
      try {
        localStorage.removeItem(NOT_HOURLY);
      } catch {
        // ignore
      }
    }
  }
  return new Set([...ids, ...local]);
}

async function findNewClients(): Promise<NewClient[]> {
  const sb = createClient();
  const [clients, rates, skip] = await Promise.all([
    fetchAll<Row>(sb, "clients", "id, name, billable, archived, created_at"),
    fetchAll<Row>(sb, "client_rates", "client_id, client_canon, effective_from"),
    notHourlyIds(sb),
  ]);
  const rated = new Set(rates.map((r) => String(r.client_canon)));
  // A client's rates under one or more other names: the latest rate's name is the one it went by.
  const oldName = new Map(
    rates
      .filter((r) => r.client_id)
      .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)))
      .map((r) => [String(r.client_id), String(r.client_canon)]),
  );
  const open = clients.filter((c) => c.billable !== false && c.archived !== true && !rated.has(String(c.name)) && !skip.has(String(c.id)));
  if (!open.length) return [];

  // Billable hours of those clients this year — any of them unrated is ₪0 in
  // this year's P&L — or the last 120 days if that reaches further back (early
  // in January). One joined query (a list of task ids could outgrow the
  // request URL); time_entries has two links to tasks, so the embed names `task_id`'s.
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const from = daysAgo(120) < yearStart ? daysAgo(120) : yearStart;
  const entries = await fetchAll<{ date: string; minutes: number | null; tasks: { client_id: string } }>(
    sb,
    "time_entries",
    "date, minutes, tasks!time_entries_task_id_fkey!inner(client_id, billable)",
    (q) => q.in("tasks.client_id", open.map((c) => String(c.id))).eq("tasks.billable", true).gte("date", from).not("minutes", "is", null),
  );
  const hours = new Map<string, { hours: number; first: string }>();
  for (const e of entries) {
    const id = String(e.tasks.client_id);
    const cur = hours.get(id) ?? { hours: 0, first: e.date };
    cur.hours += Number(e.minutes) / 60;
    if (e.date < cur.first) cur.first = e.date;
    hours.set(id, cur);
  }

  const recent = daysAgo(120);
  return open
    .filter((c) => hours.has(String(c.id)) || oldName.has(String(c.id)) || String(c.created_at ?? "").slice(0, 10) >= recent)
    .map((c) => {
      const h = hours.get(String(c.id));
      return {
        id: String(c.id),
        name: String(c.name),
        hours: h?.hours ?? 0,
        since: h?.first ?? String(c.created_at ?? "").slice(0, 10),
        renamedFrom: oldName.get(String(c.id)) ?? null,
      };
    })
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
}

export function NewClientsPrompt() {
  const [clients, setClients] = useState<NewClient[]>([]);
  const [form, setForm] = useState<Record<string, { rate: string; from: string }>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  // What saving did — shown once every client is dealt with, instead of closing at once.
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SEEN)) return;
    } catch {
      // no storage: ask anyway
    }
    let live = true;
    void findNewClients()
      .then((found) => {
        if (!live) return;
        // Asked once a session: with nothing to ask, the next page load doesn't look again.
        if (!found.length) {
          try {
            sessionStorage.setItem(SEEN, "1");
          } catch {
            // ignore
          }
          return;
        }
        setClients(found);
        setForm(Object.fromEntries(found.map((c) => [c.id, { rate: "", from: `${(c.since || isoDate(new Date())).slice(0, 7)}-01` }])));
      })
      .catch(() => {}); // a hiccup just means no prompt this time
    return () => {
      live = false;
    };
  }, []);

  if (!clients.length && !saved.length) return null;

  const done = () => {
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {
      // ignore
    }
    setClients([]);
    setSaved([]);
  };
  const drop = (id: string) => setClients((cs) => cs.filter((c) => c.id !== id));
  // A click beside the card closes it only when nothing would be lost — not
  // with a rate typed in, nor mid-save. "Later" still closes it either way.
  const typed = clients.some((c) => form[c.id]?.rate.trim());
  const away = () => {
    if (!typed && !busy) done();
  };
  // A real dialog: Esc is a click beside it; Tab stays inside it.
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return away();
    if (e.key !== "Tab") return;
    const all = [...(card.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input") ?? [])];
    const [first, last] = [all[0], all[all.length - 1]];
    const wrapTo = e.shiftKey ? (document.activeElement === first ? last : null) : document.activeElement === last ? first : null;
    if (wrapTo) {
      e.preventDefault();
      wrapTo.focus();
    }
  };

  async function save(c: NewClient) {
    // Enter in the rate field bypasses the button's `disabled`: a second Enter mid-save inserted the rate twice.
    if (busy) return;
    const f = form[c.id];
    const rate = Number(f?.rate);
    if (!Number.isFinite(rate) || rate <= 0) return setNote((n) => ({ ...n, [c.id]: "Enter a positive rate." }));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from)) return setNote((n) => ({ ...n, [c.id]: "Pick a start date." }));
    setBusy(c.id);
    try {
      const res = await addClientRate({ name: c.name, clientId: c.id, rate, from: f.from });
      setSaved((s) => [...s, rateSummary(c.name, rate, f.from, res)]);
      drop(c.id);
    } catch (e: unknown) {
      setNote((n) => ({ ...n, [c.id]: `Couldn't save: ${e instanceof Error ? e.message : "unknown error"}` }));
    } finally {
      setBusy(null);
    }
  }

  /** Renamed in the tracker: its rates and this year's open Plan rows follow it to the new name. */
  async function rename(c: NewClient) {
    if (busy) return;
    setBusy(c.id);
    try {
      const r = await renameClient(c.renamedFrom!, c.name, c.id);
      const plan = r.moved ? `, with ${r.moved} Plan month${r.moved === 1 ? "" : "s"}` : "";
      const left = r.left ? ` ${r.left} final or already-taken month${r.left === 1 ? " keeps" : "s keep"} the old name.` : "";
      setSaved((s) => [...s, `${c.renamedFrom}'s rates now go by ${c.name}${plan}.${left}`]);
      drop(c.id);
    } catch (e: unknown) {
      setNote((n) => ({ ...n, [c.id]: `Couldn't rename: ${e instanceof Error ? e.message : "unknown error"}` }));
    } finally {
      setBusy(null);
    }
  }

  /** Kept in finance_not_hourly; in this browser only while that table isn't there (0013 not run). */
  async function notHourly(c: NewClient) {
    setBusy(c.id);
    const { error } = await createClient().from("finance_not_hourly").upsert({ client_id: c.id }, { onConflict: "client_id" });
    setBusy(null);
    if (error) {
      try {
        const skip = readSet(localStorage, NOT_HOURLY);
        skip.add(c.id);
        localStorage.setItem(NOT_HOURLY, JSON.stringify([...skip]));
      } catch {
        // ignore — it just asks again next session
      }
    }
    drop(c.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={away}>
      <div
        ref={card}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={keys}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-clients-title"
        className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-lg"
      >
        <h3 id="new-clients-title" className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          {clients.length === 0 && <Check size={16} className="text-[var(--state-final-fg)]" aria-hidden />}
          {clients.length === 0 ? "Saved" : clients.length === 1 ? "A new client from the tracker" : `${clients.length} new clients from the tracker`}
        </h3>
        {clients.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            Billable in the tracker but no rate here yet, so their hours count as ₪0 in the P&amp;L. Set the hourly rate and the date it starts — saving also
            brings their tracker hours into the Plan.
          </p>
        )}
        {saved.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {saved.map((t) => (
              <li key={t} className="rounded-lg bg-background/60 px-3 py-1.5">
                {t}
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-4 space-y-3">
          {clients.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-background/60 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="bidi-auto font-medium">{c.name}</p>
                <p className="shrink-0 text-xs text-faint">{c.hours > 0 ? `${formatHours(c.hours)}h since ${formatShortDay(c.since)}` : `added ${formatShortDay(c.since)}, no hours yet`}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Rate ₪/h
                  <input
                    value={form[c.id]?.rate ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, [c.id]: { ...f[c.id], rate: e.target.value } }))}
                    onKeyDown={(e) => e.key === "Enter" && void save(c)}
                    inputMode="decimal"
                    placeholder="e.g. 350"
                    aria-describedby={note[c.id] ? `new-client-note-${c.id}` : undefined}
                    autoFocus={c.id === clients[0].id}
                    className="w-24 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  From
                  <input
                    type="date"
                    value={form[c.id]?.from ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, [c.id]: { ...f[c.id], from: e.target.value } }))}
                    title="Defaults to the month of its first billable hours this year"
                    className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                  />
                </label>
                <button
                  onClick={() => void save(c)}
                  disabled={busy === c.id}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Save rate
                </button>
                <button
                  onClick={() => void notHourly(c)}
                  disabled={busy === c.id}
                  title="A retainer or fixed fee — don't ask about this client again (&advice's no-rate card still flags its hours)"
                  className="px-1 py-1.5 text-sm text-faint hover:text-foreground"
                >
                  Not billed hourly
                </button>
              </div>
              {c.renamedFrom && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted">
                  <span className="min-w-0 flex-1">
                    Renamed in the tracker? Its rates are under <span className="bidi-auto font-medium text-foreground">{c.renamedFrom}</span>.
                  </span>
                  <button onClick={() => void rename(c)} disabled={busy === c.id} className="font-medium text-brand hover:underline disabled:opacity-50">
                    Move them to {c.name}
                  </button>
                </div>
              )}
              {note[c.id] && (
                <p id={`new-client-note-${c.id}`} role="alert" className="mt-1.5 text-xs text-danger">
                  {note[c.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <Link href="/finance/rates" onClick={done} className="text-muted hover:text-foreground hover:underline">
            Open Rates
          </Link>
          <button onClick={done} className="rounded-lg border border-border-strong px-3 py-1.5 hover:bg-background">
            {clients.length ? "Later" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
