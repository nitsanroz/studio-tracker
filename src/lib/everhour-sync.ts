import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Incremental Everhour → Supabase time-entry sync (TS port of
 * scripts/sync-everhour.mjs, so the cron and the script behave identically).
 *
 * Insert-only and idempotent: an entry is written once, keyed by everhour_id.
 * Entries whose task or user isn't mapped in the tracker are skipped and
 * reported, never guessed at.
 */

export interface EverhourSyncSummary {
  from: string;
  to: string;
  fetched: number;
  inserted: number;
  skippedSeen: number;
  skippedNoMatch: number;
  /** unmapped Everhour tasks, so the report says what was missed */
  unmatchedTasks: { id: string; name: string; minutes: number }[];
}

interface EverhourEntry {
  id: number | string;
  date: string;
  time: number; // seconds
  comment?: string;
  user: number | string;
  task?: { id?: string; name?: string };
  history?: { previousTask?: string }[];
  createdAt?: string;
}

/** ISO date `days` before today (UTC-safe enough for a date-only window). */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchAll<T>(supabase: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function runEverhourSync(
  supabase: SupabaseClient,
  apiKey: string,
  from: string,
  to: string,
): Promise<EverhourSyncSummary> {
  // paginated team time
  const entries: EverhourEntry[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.everhour.com/team/time?from=${from}&to=${to}&limit=1000&page=${page}`,
      { headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" }, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Everhour /team/time failed (${res.status})`);
    const batch = (await res.json()) as EverhourEntry[];
    entries.push(...batch);
    if (batch.length < 1000) break;
    if (page > 20) break; // safety valve
  }

  const [tasks, users, existing] = await Promise.all([
    fetchAll<{ id: string; everhour_id: string | null }>(supabase, "tasks", "id, everhour_id"),
    fetchAll<{ id: string; everhour_id: string | number | null }>(supabase, "profiles", "id, everhour_id"),
    fetchAll<{ everhour_id: string | null }>(supabase, "time_entries", "everhour_id"),
  ]);

  const taskMap = new Map(tasks.filter((t) => t.everhour_id).map((t) => [t.everhour_id!, t.id]));
  const userMap = new Map(users.filter((u) => u.everhour_id).map((u) => [String(u.everhour_id), u.id]));
  const seen = new Set(existing.map((e) => e.everhour_id).filter(Boolean) as string[]);

  const rows: Record<string, unknown>[] = [];
  const unmatched = new Map<string, { name: string; minutes: number }>();
  let skippedSeen = 0;
  let skippedNoMatch = 0;

  for (const e of entries) {
    const ehId = String(e.id);
    if (seen.has(ehId)) {
      skippedSeen++;
      continue;
    }
    const taskId = e.task?.id ? taskMap.get(e.task.id) : undefined;
    const userId = userMap.get(String(e.user));
    if (!taskId || !userId) {
      skippedNoMatch++;
      const key = e.task?.id ?? "(no task)";
      const cur = unmatched.get(key) ?? { name: e.task?.name ?? "?", minutes: 0 };
      cur.minutes += Math.round(e.time / 60);
      unmatched.set(key, cur);
      continue;
    }
    const moved = (e.history ?? []).filter((h) => h.previousTask).at(-1);
    rows.push({
      task_id: taskId,
      user_id: userId,
      date: e.date,
      minutes: Math.round(e.time / 60),
      description: e.comment ?? "",
      moved_from_task_id: moved?.previousTask ? (taskMap.get(moved.previousTask) ?? null) : null,
      everhour_id: ehId,
      ...(e.createdAt ? { created_at: new Date(e.createdAt + "Z").toISOString() } : {}),
    });
  }

  let inserted = 0;
  if (rows.length) {
    const { error, count } = await supabase.from("time_entries").insert(rows, { count: "exact" });
    if (error) throw new Error(`insert failed: ${error.message}`);
    inserted = count ?? rows.length;
  }

  return {
    from,
    to,
    fetched: entries.length,
    inserted,
    skippedSeen,
    skippedNoMatch,
    unmatchedTasks: [...unmatched.entries()]
      .map(([id, v]) => ({ id, name: v.name, minutes: v.minutes }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}
