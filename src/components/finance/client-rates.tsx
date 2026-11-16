"use client";

// A client's hourly rate, on the Clients page (Nitsan, 2026-11-15: "no need for
// a Rates page — show each client's current rate on Clients, and from it reach
// its changes and old rates in a side panel or a popup, since editing it is
// rare"). Replaces /finance/rates, which now only redirects here.
//
// ⚠️ Full finance only, and read with the VIEWER's session (`client_rates` is
// `is_finance_full_access()` under RLS, 0069): the Clients page asks for it only
// for that tier, and anyone else gets no rows anyway.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui";
import { askConfirm } from "@/components/confirm-dialog";
import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll, type ClientRateRow } from "@/lib/finance/db";
import { addClientRate, deleteClientRate, rateSummary } from "@/lib/finance/client-rate";
import { studioToday } from "@/lib/finance/format";
import { toast } from "@/lib/toast";

/** The rates history marks a parallel service's period "Web work · from the audited sheets". */
const SERVICE_NOTE = /^(.+?) work · from the audited sheets$/;
const service = (r: ClientRateRow) => r.note?.match(SERVICE_NOTE)?.[1];

/** Every rate row, loaded once for the page; `reload` after a change. */
export function useClientRates(enabled: boolean) {
  const [rows, setRows] = useState<ClientRateRow[]>([]);
  const load = useCallback(async () => {
    if (!enabled) return;
    const data = await fetchAll<ClientRateRow>(createClient(), "client_rates", "id, client_id, client_canon, rate, effective_from, effective_to, note", (q) =>
      q.order("client_canon", { ascending: true }).order("effective_from", { ascending: true }),
    ).catch(() => [] as ClientRateRow[]);
    setRows(data);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAll<ClientRateRow>(createClient(), "client_rates", "id, client_id, client_canon, rate, effective_from, effective_to, note", (q) =>
      q.order("client_canon", { ascending: true }).order("effective_from", { ascending: true }),
    )
      .then((data) => live && setRows(data))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled]);
  return { rows, reload: load };
}

/** A client's rows: by its id, or by its name for rows from before ids were kept. */
export function ratesOf(rows: ClientRateRow[], client: { id: string; name: string }): ClientRateRow[] {
  return rows.filter((r) => r.client_id === client.id || (!r.client_id && r.client_canon === client.name));
}

/** The rate in force today — the main service's (a parallel service's period is not "the" rate). */
export function currentRate(rows: ClientRateRow[], today = studioToday()): ClientRateRow | null {
  const live = rows.filter((r) => !service(r) && r.effective_from <= today && (!r.effective_to || r.effective_to >= today));
  return live.sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

/** The rate cell of a Clients row: the current rate, or a quiet "set". A button, so the row's link isn't followed. */
export function RateCell({ rate, onOpen, width }: { rate: ClientRateRow | null; onOpen: () => void; width: number }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      title="Rate history"
      className="flex shrink-0 justify-end"
      style={{ width }}
    >
      {/* A PRICE, so it doesn't read as one more hours column (Nitsan,
          2026-11-16: "make rate look different then all hours data"): a money
          pill in the paid green, "/h" after it; a client with no rate gets a
          dashed "set rate". */}
      {rate ? (
        <span className="inline-flex items-baseline rounded-full bg-[var(--state-final-bg)] px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--state-final-fg)] transition-colors hover:bg-[var(--state-paid-bg)]">
          ₪{Number(rate.rate)}
          <span className="ml-px text-[11px] font-normal opacity-70">/h</span>
        </span>
      ) : (
        <span className="rounded-full border border-dashed border-border-strong px-2 py-0.5 text-[11px] text-faint hover:border-brand hover:text-brand">
          set rate
        </span>
      )}
    </button>
  );
}

/** A client's rates over time, with adding a new one and deleting a row. */
export function ClientRatesDialog({
  client,
  rows,
  initialFrom,
  onClose,
  onChanged,
}: {
  client: { id: string; name: string };
  rows: ClientRateRow[];
  /** a month an &advice "no rate" card asked to cover */
  initialFrom?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const mine = useMemo(() => [...ratesOf(rows, client)].sort((a, b) => b.effective_from.localeCompare(a.effective_from)), [rows, client]);
  const now = currentRate(mine);
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(() => (initialFrom && /^\d{4}-\d{2}-\d{2}$/.test(initialFrom) ? initialFrom : studioToday()));
  const [busy, setBusy] = useState(false);

  async function add() {
    const n = Number(rate);
    if (busy || !Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    try {
      const res = await addClientRate({ name: client.name, clientId: client.id, rate: n, from });
      toast(rateSummary(client.name, n, from, res));
      setRate("");
      onChanged();
    } catch (e: unknown) {
      toast(`Couldn't add the rate: ${e instanceof Error ? e.message : "unknown error"}`, { tone: "info" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: ClientRateRow) {
    const ok = await askConfirm(`Delete ₪${Number(r.rate)}/h from ${r.effective_from}? This rewrites revenue for that period, and there is no undo.`, { action: "Delete", danger: true });
    if (!ok) return;
    try {
      const res = await deleteClientRate(r);
      toast(res.warning ?? `Deleted ₪${Number(r.rate)}/h${res.repriced ? ` — ${res.repriced} Plan month${res.repriced === 1 ? "" : "s"} repriced` : ""}.`);
      onChanged();
    } catch (e: unknown) {
      toast(`Couldn't delete it: ${e instanceof Error ? e.message : "unknown error"}`, { tone: "info" });
    }
  }

  return (
    <Modal onClose={onClose} width="md" labelledBy="client-rates-title">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="client-rates-title" className="card-title bidi-auto">
            {client.name}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {now ? (
              <>
                <span className="font-medium tabular-nums text-foreground">₪{Number(now.rate)}</span> an hour since {now.effective_from}
              </>
            ) : (
              "No rate today — its hours aren't priced."
            )}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-faint hover:bg-background hover:text-foreground">
          <X size={18} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-background p-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          New rate ₪/h
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            inputMode="decimal"
            placeholder={now ? String(Number(now.rate)) : "350"}
            className="w-24 rounded-lg bg-surface px-3 py-1.5 text-sm outline-none ring-brand focus:ring-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg bg-surface px-3 py-1.5 text-sm outline-none ring-brand focus:ring-2" />
        </label>
        <button
          onClick={() => void add()}
          disabled={busy || !(Number(rate) > 0)}
          title="From this date on it is used instead of the earlier rate"
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus size={15} />
          {busy ? "Adding…" : "Add"}
        </button>
      </div>

      <p className="mt-5 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">History</p>
      {mine.length === 0 ? (
        <p className="mt-2 text-sm text-faint">No rate has been set for this client.</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {mine.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-0">
              <span className="w-20 tabular-nums font-medium">₪{Number(r.rate)}/h</span>
              <span className="min-w-0 flex-1 text-muted">
                {r.effective_from} – {r.effective_to ?? "today"}
                {service(r) && <span className="ml-1.5 rounded-full bg-background px-1.5 py-0.5 text-[10px]">{service(r)}</span>}
              </span>
              <button onClick={() => void remove(r)} title="Delete this rate row" className="text-faint hover:text-danger">
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
