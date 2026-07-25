import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Incremental Everhour → Supabase time-entry sync (TS port of
 * scripts/sync-everhour.mjs, so the cron and the script behave identically).
 *
 * Insert-only and idempotent: an entry is written once, keyed by everhour_id.
 *
 * Entries whose task or person isn't mapped in the tracker are NEVER dropped
 * quietly — each one is written to the `sync_issues` queue for an admin to
 * resolve (see migration 0014). Those hours are real and usually billable, so
 * silently skipping them could understate a published client report.
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
  /** issues newly added to the queue this run */
  newIssues: number;
  /** previously-open issues that imported cleanly this run */
  closedIssues: number;
  /** total still awaiting an admin decision */
  openIssues: number;
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

interface UnmatchedEntry {
  everhour_id: string;
  kind: "unmapped_task" | "unmapped_user" | "unmapped_both";
  entry_date: string;
  minutes: number;
  description: string;
  everhour_task_id: string | null;
  everhour_task_name: string;
  everhour_user_id: string;
  everhour_user_name: string;
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

/**
 * Everhour person names, so the queue can say "Shaked Gozlan isn't mapped"
 * instead of "user 1453915". Best-effort — a failure here must not fail a sync.
 */
async function fetchUserNames(apiKey: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const res = await fetch("https://api.everhour.com/team/users", {
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return names;
    const users = (await res.json()) as { id: number | string; name?: string; email?: string }[];
    for (const u of users) names.set(String(u.id), u.name ?? u.email ?? "");
  } catch {
    // leave the map empty; the queue falls back to the raw id
  }
  return names;
}

/**
 * Write this run's unimportable entries to the queue, and close any open issue
 * whose entry has since made it in (an admin mapped the task, or the script
 * imported it). One row per Everhour entry id, so re-running the sync over an
 * overlapping window never double-counts and never loses an older gap.
 */
async function reconcileSyncIssues(
  supabase: SupabaseClient,
  unmatched: UnmatchedEntry[],
  importedIds: Set<string>,
): Promise<{ newIssues: number; closedIssues: number; openIssues: number }> {
  const now = new Date().toISOString();

  // ── close what no longer needs attention
  const { data: openRows } = await supabase
    .from("sync_issues")
    .select("everhour_id")
    .eq("source", "everhour")
    .eq("status", "open");
  const nowImported = ((openRows ?? []) as { everhour_id: string }[])
    .map((r) => r.everhour_id)
    .filter((id) => importedIds.has(id));
  if (nowImported.length) {
    await supabase
      .from("sync_issues")
      .update({ status: "imported", resolved_at: now })
      .in("everhour_id", nowImported);
  }

  // ── record what still can't be imported
  let newIssues = 0;
  if (unmatched.length) {
    const ids = unmatched.map((u) => u.everhour_id);
    const { data: existingRows } = await supabase
      .from("sync_issues")
      .select("everhour_id, status")
      .eq("source", "everhour")
      .in("everhour_id", ids);
    const existing = new Map(
      ((existingRows ?? []) as { everhour_id: string; status: string }[]).map((r) => [
        r.everhour_id,
        r.status,
      ]),
    );

    const fresh = unmatched.filter((u) => !existing.has(u.everhour_id));
    if (fresh.length) {
      const { error } = await supabase
        .from("sync_issues")
        .insert(fresh.map((u) => ({ ...u, source: "everhour", first_seen_at: now, last_seen_at: now })));
      if (error) throw new Error(`sync_issues insert failed: ${error.message}`);
      newIssues = fresh.length;
    }

    // Still unmatched but already queued: bump last_seen_at. An entry marked
    // 'imported' that reappears here was never really imported — reopen it.
    // 'ignored' is a deliberate admin decision and is left alone.
    const stale = unmatched.filter((u) => existing.has(u.everhour_id));
    for (const u of stale) {
      const patch: Record<string, unknown> = { last_seen_at: now };
      if (existing.get(u.everhour_id) === "imported") {
        patch.status = "open";
        patch.resolved_at = null;
      }
      await supabase
        .from("sync_issues")
        .update(patch)
        .eq("source", "everhour")
        .eq("everhour_id", u.everhour_id);
    }
  }

  const { count } = await supabase
    .from("sync_issues")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  return { newIssues, closedIssues: nowImported.length, openIssues: count ?? 0 };
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

  const [tasks, users, existing, userNames] = await Promise.all([
    fetchAll<{ id: string; everhour_id: string | null }>(supabase, "tasks", "id, everhour_id"),
    fetchAll<{ id: string; everhour_id: string | number | null }>(supabase, "profiles", "id, everhour_id"),
    fetchAll<{ everhour_id: string | null }>(supabase, "time_entries", "everhour_id"),
    fetchUserNames(apiKey),
  ]);

  const taskMap = new Map(tasks.filter((t) => t.everhour_id).map((t) => [t.everhour_id!, t.id]));
  const userMap = new Map(users.filter((u) => u.everhour_id).map((u) => [String(u.everhour_id), u.id]));
  const seen = new Set(existing.map((e) => e.everhour_id).filter(Boolean) as string[]);

  const rows: Record<string, unknown>[] = [];
  const unmatchedEntries: UnmatchedEntry[] = [];
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

      unmatchedEntries.push({
        everhour_id: ehId,
        kind: !taskId && !userId ? "unmapped_both" : !taskId ? "unmapped_task" : "unmapped_user",
        entry_date: e.date,
        minutes: Math.round(e.time / 60),
        description: e.comment ?? "",
        everhour_task_id: e.task?.id ?? null,
        everhour_task_name: e.task?.name ?? "",
        everhour_user_id: String(e.user),
        everhour_user_name: userNames.get(String(e.user)) ?? "",
      });
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

  // everything the tracker now holds, so already-queued gaps can be closed
  const importedIds = new Set(seen);
  for (const r of rows) importedIds.add(r.everhour_id as string);

  const queue = await reconcileSyncIssues(supabase, unmatchedEntries, importedIds);

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
    ...queue,
  };
}
