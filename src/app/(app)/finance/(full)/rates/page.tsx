"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll, type ClientRateRow } from "@/lib/finance/db";
import { PageHeader, Loading, ErrorState, ConfirmDialog } from "@/components/finance/ui";
import { CLIENT_VIEWS, PageViews } from "@/components/page-views";
import { addClientRate, deleteClientRate, rateSummary } from "@/lib/finance/client-rate";
import { studioYear } from "@/lib/finance/format";

/** The rates history marks a parallel service's period "Web work · from the audited sheets". */
const SERVICE_NOTE = /^(.+?) work · from the audited sheets$/;
const service = (r: ClientRateRow) => r.note?.match(SERVICE_NOTE)?.[1];

export default function RatesPage() {
  const [rows, setRows] = useState<ClientRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // An &advice "no rate" card (or the new-client prompt) names the client and the month to cover.
  const params = useSearchParams();
  const [form, setForm] = useState(() => ({
    client: params.get("client") ?? "",
    rate: "",
    from: /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") ?? "") ? params.get("from")! : `${studioYear()}-01-01`,
  }));
  const [pendingDelete, setPendingDelete] = useState<ClientRateRow | null>(null);
  // A second click while the first insert is in flight wrote two identical rate rows.
  const [adding, setAdding] = useState(false);
  // The tracker's clients: a rate must carry the tracker's exact name, or its hours never find it.
  const [trackerClients, setTrackerClients] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = createClient();
      void fetchAll<{ id: string; name: string; archived: boolean }>(sb, "clients", "id, name, archived")
        .then((cs) => setTrackerClients(cs.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name))))
        .catch(() => {});
      const data = await fetchAll<ClientRateRow>(
        sb,
        "client_rates",
        "id, client_id, client_canon, rate, effective_from, effective_to, note",
        (q) => q.order("client_canon", { ascending: true }).order("effective_from", { ascending: true }),
      );
      setRows(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load rates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const m = new Map<string, ClientRateRow[]>();
    for (const r of rows) {
      const arr = m.get(r.client_canon) ?? [];
      arr.push(r);
      m.set(r.client_canon, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  async function addRate() {
    if (adding) return;
    const client = form.client.trim();
    const rate = Number(form.rate);
    if (!client || !Number.isFinite(rate) || rate <= 0) {
      setNote("Enter a client name and a positive rate.");
      return;
    }
    const tracker = trackerClients.find((c) => c.name === client) ?? null;
    // A name the tracker doesn't have can't price any hours — say so (an old or parallel name is still allowed).
    const unknown = !tracker && !rows.some((r) => r.client_canon === client);
    setAdding(true);
    try {
      const res = await addClientRate({ name: client, clientId: tracker?.id ?? null, rate, from: form.from });
      setForm({ client: "", rate: "", from: `${studioYear()}-01-01` });
      setNote(rateSummary(client, rate, form.from, res) + (unknown ? ` No tracker client is called "${client}", so no hours will use it until the names match.` : ""));
      await load();
    } catch (e: unknown) {
      setNote(`Add failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setAdding(false);
    }
  }

  // Through client-rate.ts, like adding: a bare delete repriced the P&L but left this year's
  // Plan rows at the deleted rate.
  async function remove(row: ClientRateRow) {
    try {
      const res = await deleteClientRate(row);
      setNote(res.warning ?? `Deleted ₪${Number(row.rate)}/h for ${row.client_canon}${res.repriced ? ` — ${res.repriced} Plan month${res.repriced === 1 ? "" : "s"} repriced` : ""}.`);
    } catch (e: unknown) {
      setNote(`Delete failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    await load();
  }

  function confirmRemove() {
    if (!pendingDelete) return;
    const row = pendingDelete;
    setPendingDelete(null);
    void remove(row);
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Clients | Rates — this is the Clients page's money view. */}
      <PageViews views={CLIENT_VIEWS} className="mb-3" />
      <PageHeader
        title="Rates"
        subtitle="Per-client hourly rate over time. A rate change = a new row dated to the change (e.g. 300 → 350)."
      />
      {note && (
        <div className="mb-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">{note}</div>
      )}

      <datalist id="tracker-clients">
        {trackerClients.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <div data-advice="add-rate" className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Client
          <input
            value={form.client}
            onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
            placeholder="Client name"
            list="tracker-clients"
            className="bidi-auto w-44 rounded-lg border border-border-strong px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Rate ₪/h
          <input
            value={form.rate}
            onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
            inputMode="decimal"
            placeholder="350"
            className="w-24 rounded-lg border border-border-strong px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Effective from
          <input
            type="date"
            value={form.from}
            onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
        </label>
        <button
              title="Add a client rate from a given date — from then on it's used instead of the earlier rate"
          onClick={addRate}
          disabled={adding}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          <Plus size={15} />
          {adding ? "Adding…" : "Add rate"}
        </button>
      </div>

      <div className="space-y-4">
        {grouped.map(([client, rates]) => (
          <div key={client} className="rounded-xl border border-border bg-surface p-4">
            <p className="mb-2 font-medium bidi-auto">{client}</p>
            <table className="w-full text-sm">
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id} className="border-t border-border first:border-0">
                    <td className="py-1.5 tabular-nums">
                      ₪{Number(r.rate)}/h
                      {/* A parallel service billed at its own rate (e.g. "Web work"). */}
                      {service(r) && (
                        <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{service(r)}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-muted">from {r.effective_from}</td>
                    <td className="py-1.5 text-muted">
                      {r.effective_to ? `until ${r.effective_to}` : "current"}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => setPendingDelete(r)}
                        className="text-faint hover:text-danger"
                        title="Delete rate row"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {grouped.length === 0 && (
          <p className="py-10 text-center text-sm text-faint">No rates yet.</p>
        )}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete this rate?"
          body={`₪${Number(pendingDelete.rate)}/h for ${pendingDelete.client_canon} (from ${pendingDelete.effective_from}) will be permanently removed. This rewrites revenue history for that period — there is no undo.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
