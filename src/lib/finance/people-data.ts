"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll, mapClientRate, type ClientRateRow, type QueryModifier } from "@/lib/finance/db";
import { buildLedgers, type Ledger, type Person, type Position, type WorkEntry } from "@/lib/finance/people";
import type { ClientRate } from "@/lib/finance/finance";

export interface PeopleData {
  people: Person[];
  ledgers: Map<string, Ledger>;
  rates: ClientRate[];
  /** Share of pre-2023 tracked hours that have a person (whole-studio loads only). */
  historyCoverage: number | null;
}

interface ProfileRow { id: string; name: string; position: Position | null; active: boolean; has_account: boolean; start_date: string | null; end_date: string | null }
interface TaskRow { id: string; client_id: string | null; billable: boolean }
interface ClientRow { id: string; name: string; billable: boolean; keys_task_id: string | null }
interface EntryRow { task_id: string; user_id: string | null; date: string; minutes: number | null }
/** A pay row (finance_salaries / finance_freelance): its amount column is named per table. */
type PayRow = { profile_id: string | null; year: number; month: number } & Record<string, unknown>;
/** The tracker's one-call packed history (migration 0051): ids sent once, rows by index. */
interface Packed { tasks: string[]; users: string[]; rows: [string, number, number | null, string, number, number][] }

export interface PeopleScope {
  /** One person only. */
  personId?: string;
  /** One year only (everyone's pay and hours that year). */
  year?: number;
}

/**
 * Everyone's pay and work, one person's (`personId`), or one year's. The whole
 * history comes from the tracker's packed call in one request; a person or a
 * year is a plain filtered read.
 */
export async function loadPeople({ personId, year }: PeopleScope = {}): Promise<PeopleData> {
  const sb = createClient();
  const pay = (table: string, amount: string) =>
    fetchAll<PayRow>(sb, table, `profile_id, year, month, ${amount}`, (q) =>
      personId ? q.eq("profile_id", personId) : year ? q.eq("year", year) : q,
    ).then((rows) =>
      rows
        .filter((r) => r.profile_id)
        .map((r) => ({ profileId: r.profile_id as string, year: r.year, month: r.month, amount: Number(r[amount]) })),
    );
  const entryRows = (filter: (q: QueryModifier) => QueryModifier) =>
    fetchAll<EntryRow>(sb, "time_entries", "task_id, user_id, date, minutes", filter);
  const entriesP: Promise<EntryRow[]> = personId
    ? entryRows((q) => q.eq("user_id", personId))
    : year
      ? entryRows((q) => q.gte("date", `${year}-01-01`).lte("date", `${year}-12-31`))
      : Promise.resolve(sb.rpc("entry_sums_packed")).then(({ data, error }) => {
        if (error) throw error;
        const p = data as Packed;
        return p.rows.map(([, t, u, date, minutes]) => ({
          task_id: p.tasks[t],
          user_id: u == null ? null : p.users[u],
          date,
          minutes,
        }));
      });

  const [profiles, salaries, freelance, entries, tasks, clients, rates] = await Promise.all([
    fetchAll<ProfileRow>(sb, "profiles", "id, name, position, active, has_account, start_date, end_date", (q) =>
      personId ? q.eq("id", personId) : q,
    ),
    pay("finance_salaries", "gross_amount"),
    pay("finance_freelance", "amount"),
    entriesP,
    fetchAll<TaskRow>(sb, "tasks", "id, client_id, billable"),
    fetchAll<ClientRow>(sb, "clients", "id, name, billable, keys_task_id"),
    fetchAll<ClientRateRow>(sb, "client_rates", "id, client_id, client_canon, rate, effective_from, effective_to, note"),
  ]);

  const clientById = new Map(clients.map((c) => [c.id, c]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const work: WorkEntry[] = [];
  let historyAll = 0;
  let historyNamed = 0;
  for (const e of entries) {
    if (e.minutes != null && e.date < "2023-01-01") {
      historyAll += e.minutes;
      if (e.user_id) historyNamed += e.minutes;
    }
    if (!e.user_id || e.minutes == null) continue;
    const task = taskById.get(e.task_id);
    const client = task?.client_id ? clientById.get(task.client_id) : undefined;
    work.push({
      userId: e.user_id,
      date: e.date,
      minutes: e.minutes,
      client: client?.name ?? null,
      billable: !!(task?.billable && client?.billable),
      keys: !!client?.keys_task_id && client.keys_task_id === e.task_id,
    });
  }
  const clientRates = rates.map(mapClientRate);
  return {
    people: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      active: p.active,
      hasAccount: p.has_account,
      startDate: p.start_date,
      endDate: p.end_date,
    })),
    ledgers: buildLedgers({ salaries, freelance, entries: work, rates: clientRates }),
    rates: clientRates,
    historyCoverage: !personId && !year && historyAll ? historyNamed / historyAll : null,
  };
}

/**
 * The whole studio's history is the same for the People list and every person
 * page (everyone's pay and hours, to set one person against), so it is kept
 * for a few minutes rather than re-fetched on every page. A failed load isn't
 * kept.
 */
const SHARED_TTL_MS = 5 * 60_000;
let shared: { at: number; data: Promise<PeopleData> } | null = null;

function loadShared(scope: PeopleScope): Promise<PeopleData> {
  if (scope.personId || scope.year) return loadPeople(scope);
  if (shared && Date.now() - shared.at < SHARED_TTL_MS) return shared.data;
  const entry = { at: Date.now(), data: loadPeople(scope) };
  shared = entry;
  entry.data.catch(() => {
    if (shared === entry) shared = null;
  });
  return entry.data;
}

/** Drop the shared load, so the next page reads afresh — after a write it holds (a position change). */
export function forgetPeople() {
  shared = null;
}

export function usePeople({ personId, year, skip }: PeopleScope & { skip?: boolean } = {}) {
  const [data, setData] = useState<PeopleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    loadShared({ personId, year })
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Failed to load people"));
    return () => {
      live = false;
    };
  }, [personId, year, skip]);
  return { data, error, loading: !data && !error };
}
