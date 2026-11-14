"use client";

import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll, mapClientRate, updatePreservingLock, type ClientRateRow } from "@/lib/finance/db";
import { isForecastMonth, newRateCovers, rateForMonth, round2, type ClientRate, type FinanceState } from "@/lib/finance/finance";
import { studioYear } from "@/lib/finance/format";

/**
 * Adding a client's hourly rate, and everything it touches (Nitsan,
 * 2026-10-25: "make sure nothing was forgotten on adding a new client"). The
 * Rates page and the new-client prompt both go through here.
 *
 * 1. `client_rates` row — named exactly as the tracker names the client
 *    (`client_canon`, which is how hours find their rate) and linked by
 *    `client_id`, so a later rename in the tracker can be spotted.
 * 2. This year's Plan rows for the client (`finance_client_monthly`) from the
 *    rate's start on: rows already there are repriced (hours × the new rate —
 *    an hours row synced before the rate existed holds ₪0, and the Overview's
 *    client breakdown reads it); months with tracker hours and no row get one,
 *    as "Sync tracker hours" would write it. Final rows are left as they are.
 *    One undo-log batch, like the sync.
 * 3. The P&L recomputes — a `client_rates` write is one of the saves that
 *    feed it (supabase/client.ts `FEEDS_PNL`).
 *
 * Closed years are kept as booked (CLAUDE.md): only the current year's Plan rows change.
 * Deleting a rate (`deleteClientRate`) walks the same steps backwards.
 */

export interface RateResult {
  /** Plan rows written: new months brought in from the tracker, and rows repriced */
  added: number;
  repriced: number;
  /** a Plan step that failed after the rate itself was saved */
  warning?: string;
}

interface CmRow {
  id: string;
  month: number;
  client_id: string | null;
  client_canon: string;
  discipline: string | null;
  /** Nullable in reference/0005; this app writes "" for a client's main row. */
  sub_account: string | null;
  hours: number | string;
  rate: number | string | null;
  revenue_gross: number | string;
  state: FinanceState;
}

type Change = { match: object; before: object | null; after: object };

/**
 * Reprice this year's main Plan rows in the months `covers` picks to
 * `rateOf(month)` (hours × rate); returns the undo-log changes. A sub-account
 * row (a parallel service) carries its own rate, and final rows stay as booked
 * — both left alone. Shared by adding and deleting a rate, so the Plan follows
 * either the way the P&L does.
 */
async function repricePlanRows(rows: CmRow[], year: number, covers: (month: number) => boolean, rateOf: (month: number) => number, clientId: string | null): Promise<Change[]> {
  const sb = createClient();
  const reprice = rows.filter((r) => r.sub_account === "" && r.state !== "final" && covers(r.month) && Number(r.rate) !== rateOf(r.month));
  const changes: Change[] = [];
  // Distinct rows, none final: plain updates, all at once.
  const errors = await Promise.all(
    reprice.map((r) => {
      const rate = rateOf(r.month);
      const after = { rate, revenue_gross: round2(Number(r.hours) * rate) };
      const match = { year, month: r.month, client_canon: r.client_canon, sub_account: "" };
      const base = { ...match, client_id: r.client_id, discipline: r.discipline, hours: Number(r.hours), state: r.state };
      changes.push({ match, before: { ...base, rate: r.rate == null ? null : Number(r.rate), revenue_gross: Number(r.revenue_gross) }, after: { ...base, ...after } });
      return updatePreservingLock(sb, "finance_client_monthly", r.id, { ...after, client_id: r.client_id ?? clientId }, r.state);
    }),
  );
  const failed = errors.find(Boolean);
  if (failed) throw new Error(failed.message);
  return changes;
}


/**
 * One tracker client's billable hours per month of `year` — the Plan's "Sync
 * tracker hours" definition (actions.ts trackerHoursBetween: a billable task of a billable
 * client), for that client alone. Joined in one query: time_entries has two
 * links to tasks, so the embed names `task_id`'s.
 */
export async function clientHoursByMonth(clientId: string, year: number): Promise<Map<number, number>> {
  const sb = createClient();
  const entries = await fetchAll<{ date: string; minutes: number | null }>(
    sb,
    "time_entries",
    "date, minutes, tasks!time_entries_task_id_fkey!inner(client_id, billable)",
    (q) => q.eq("tasks.client_id", clientId).eq("tasks.billable", true).gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).not("minutes", "is", null),
  );
  const out = new Map<number, number>();
  for (const e of entries) {
    const m = Number(e.date.slice(5, 7));
    out.set(m, (out.get(m) ?? 0) + Number(e.minutes) / 60);
  }
  return out;
}

export async function addClientRate(input: { name: string; clientId: string | null; rate: number; from: string }): Promise<RateResult> {
  const sb = createClient();
  const { error } = await sb.from("client_rates").insert({
    client_canon: input.name,
    client_id: input.clientId,
    rate: input.rate,
    effective_from: input.from,
  });
  if (error) throw new Error(error.message);

  const year = new Date().getFullYear();
  if (Number(input.from.slice(0, 4)) > year) return { added: 0, repriced: 0 };
  try {
    // The months the new rate covers this year — a rate applies to a month by
    // its 15th (finance.ts revenueForCell), until a later rate takes over: a
    // backdated rate leaves the newer rate's months alone.
    const rates = (await fetchAll<ClientRateRow>(sb, "client_rates", "id, client_id, client_canon, rate, effective_from, effective_to, note", (q) => q.eq("client_canon", input.name))).map(mapClientRate);
    const added: ClientRate = { clientId: input.clientId, clientCanon: input.name, rate: input.rate, effectiveFrom: input.from, effectiveTo: null };
    // The read already holds the insert; `added` again makes sure of it.
    const covers = (month: number) => newRateCovers([...rates, added], added, year, month);
    const [rows, hours] = await Promise.all([
      fetchAll<CmRow>(sb, "finance_client_monthly", "id, month, client_id, client_canon, discipline, sub_account, hours, rate, revenue_gross, state", (q) =>
        q.eq("year", year).eq("client_canon", input.name),
      ),
      // No tracker client behind the name → no hours to bring in, only repricing.
      input.clientId ? clientHoursByMonth(input.clientId, year) : new Map<number, number>(),
    ]);
    const changes = await repricePlanRows(rows, year, covers, () => input.rate, input.clientId);
    const repriced = changes.length;
    // A month with ANY row — the main one or a sub-account's (Mobileye
    // Corporate / HR) — is already on the Plan; adding a main row beside
    // sub-accounts would count its hours twice.
    const have = new Set(rows.map((r) => r.month));
    const fresh = [...hours]
      .map(([month, h]) => ({ month, hours: h }))
      .filter((h) => h.hours > 0 && covers(h.month) && !have.has(h.month))
      .map((h) => ({
        year,
        month: h.month,
        client_id: input.clientId,
        client_canon: input.name,
        discipline: null,
        sub_account: "",
        hours: round2(h.hours),
        rate: input.rate,
        revenue_gross: round2(round2(h.hours) * input.rate),
        state: (isForecastMonth(year, h.month) ? "predicted" : "actual") as FinanceState,
      }));
    if (fresh.length) {
      const { error: e } = await sb.from("finance_client_monthly").upsert(fresh, { onConflict: "year,month,client_canon,sub_account" });
      if (e) throw new Error(e.message);
      for (const after of fresh) changes.push({ match: { year, month: after.month, client_canon: input.name, sub_account: "" }, before: null, after });
    }
    if (changes.length) {
      await sb.from("finance_undo_log").insert({
        action_label: `Rate for ${input.name}: ${fresh.length ? `${fresh.length} month${fresh.length === 1 ? "" : "s"} from the tracker` : ""}${fresh.length && repriced ? ", " : ""}${repriced ? `${repriced} repriced` : ""}`,
        table_name: "finance_client_monthly",
        changes,
      });
    }
    return { added: fresh.length, repriced };
  } catch (e: unknown) {
    return { added: 0, repriced: 0, warning: `The rate is saved, but the Plan wasn't updated: ${e instanceof Error ? e.message : "unknown error"}. "Sync tracker hours" on the Plan brings the hours in.` };
  }
}

/**
 * After `gone` is deleted, the rate a month of `year` falls back to — the
 * rate now in effect, 0 with none left — or null when the deleted rate didn't
 * price that month (asked of the rates as they were, with it: a later rate had
 * taken over, or it started after the 15th).
 */
export function rateAfterDelete(remaining: ClientRate[], gone: ClientRate, year: number, month: number): number | null {
  if (!newRateCovers([...remaining, gone], gone, year, month)) return null;
  return rateForMonth(remaining, gone.clientCanon, year, month) ?? 0;
}

/**
 * Deleting a client's rate: the mirror of `addClientRate`. Deleting used to
 * remove only the `client_rates` row — the P&L repriced (a `client_rates`
 * write feeds it) while this year's Plan rows kept revenue at the deleted
 * rate, so the Plan and the P&L disagreed. Now the months the deleted rate
 * priced fall back to the rate now in effect (₪0 with none, as "Sync tracker
 * hours" writes a month with no rate), in one undo-log batch. Final rows stay
 * as booked; closed years are never touched.
 */
export async function deleteClientRate(row: ClientRateRow): Promise<RateResult> {
  const sb = createClient();
  const { error } = await sb.from("client_rates").delete().eq("id", row.id);
  if (error) throw new Error(error.message);

  const year = studioYear();
  if (Number(row.effective_from.slice(0, 4)) > year) return { added: 0, repriced: 0 };
  try {
    const remaining = (await fetchAll<ClientRateRow>(sb, "client_rates", "id, client_id, client_canon, rate, effective_from, effective_to, note", (q) => q.eq("client_canon", row.client_canon))).map(mapClientRate);
    const gone = mapClientRate(row);
    const covers = (month: number) => rateAfterDelete(remaining, gone, year, month) != null;
    const rateNow = (month: number) => rateAfterDelete(remaining, gone, year, month) ?? 0;
    const rows = await fetchAll<CmRow>(sb, "finance_client_monthly", "id, month, client_id, client_canon, discipline, sub_account, hours, rate, revenue_gross, state", (q) =>
      q.eq("year", year).eq("client_canon", row.client_canon),
    );
    const changes = await repricePlanRows(rows, year, covers, rateNow, row.client_id);
    if (changes.length) {
      await sb.from("finance_undo_log").insert({
        action_label: `Rate deleted for ${row.client_canon}: ${changes.length} repriced`,
        table_name: "finance_client_monthly",
        changes,
      });
    }
    return { added: 0, repriced: changes.length };
  } catch (e: unknown) {
    return { added: 0, repriced: 0, warning: `The rate is deleted, but the Plan wasn't repriced: ${e instanceof Error ? e.message : "unknown error"}.` };
  }
}

/**
 * A client renamed in the tracker: its rates move to the new name, and so do
 * this year's Plan rows — "Sync tracker hours" matches rows by name, so rows
 * left under the old one would be offered again under the new one and count
 * twice. Final rows stay as booked (and a month the new name already has is
 * left alone); `left` counts them. Not in the undo log: "Undo last sync"
 * restores rows by name, which would bring the old name back beside the new.
 */
export async function renameClient(oldName: string, newName: string, clientId: string): Promise<{ moved: number; left: number }> {
  const sb = createClient();
  const { error } = await sb.from("client_rates").update({ client_canon: newName }).eq("client_id", clientId);
  if (error) throw new Error(error.message);
  const year = new Date().getFullYear();
  const rows = await fetchAll<CmRow>(sb, "finance_client_monthly", "id, month, client_id, client_canon, discipline, sub_account, hours, rate, revenue_gross, state", (q) =>
    q.eq("year", year).in("client_canon", [oldName, newName]),
  );
  const taken = new Set(rows.filter((r) => r.client_canon === newName).map((r) => `${r.month}|${r.sub_account}`));
  const old = rows.filter((r) => r.client_canon === oldName);
  const move = old.filter((r) => r.state !== "final" && !taken.has(`${r.month}|${r.sub_account}`));
  const errors = await Promise.all(move.map((r) => sb.from("finance_client_monthly").update({ client_canon: newName, client_id: r.client_id ?? clientId }).eq("id", r.id)));
  const failed = errors.find((e) => e.error);
  if (failed?.error) throw new Error(failed.error.message);
  return { moved: move.length, left: old.length - move.length };
}

/** One line for the person: what saving the rate also did. */
export function rateSummary(name: string, rate: number, from: string, r: RateResult): string {
  const plan = [r.added ? `${r.added} month${r.added === 1 ? "" : "s"} of hours added to the Plan` : "", r.repriced ? `${r.repriced} Plan month${r.repriced === 1 ? "" : "s"} repriced` : ""].filter(Boolean);
  return r.warning ?? `Added ₪${rate}/h for ${name} from ${from}${plan.length ? ` — ${plan.join(", ")}` : ""}.`;
}
