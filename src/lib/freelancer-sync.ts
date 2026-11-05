import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_SCHEMA_CODES } from "./db";

// Keeping an approved freelancer line and its tracker time entry in step
// (v1.89.0, migration 0062). Server-only: the callers hold the service key.
//
// ⚠️ THE ENTRY IS NOT A COPY OF THE LINE. A Keys write-down shrinks it (or moves
// it whole onto the client's Keys task) while the freelancer is still paid the
// full hours — so a change is applied as a DIFFERENCE from what was approved,
// never by copying the line's figures over the entry.

/** A freelancer line's own fields, as approved (`freelancer_logs.approved`). */
export interface LogSnap {
  date: string;
  minutes: number;
  description: string;
  task_id: string | null;
  client_id: string | null;
  task_hint: string | null;
}

export function snapOf(l: LogSnap): LogSnap {
  return {
    date: l.date,
    minutes: l.minutes,
    description: l.description,
    task_id: l.task_id,
    client_id: l.client_id,
    task_hint: l.task_hint,
  };
}

/** What a change does to the time entry. Pure, so the Keys arithmetic is tested. */
export function entryPatch(
  entry: { minutes: number; task_id: string },
  from: LogSnap,
  to: LogSnap,
): { error: string } | { patch: { minutes: number; date: string; description: string; task_id?: string } } {
  const minutes = entry.minutes + (to.minutes - from.minutes);
  if (minutes < 1) {
    const keys = from.minutes - entry.minutes;
    return {
      error: `${keys / 60}h of this line were already written down to Keys, so it can't go below ${keys / 60}h. Move hours back from Keys first.`,
    };
  }
  // The task follows only while the entry still sits where it was approved — an
  // entry moved whole to Keys (or anywhere else by hand) stays put.
  const moveTask = !!to.task_id && to.task_id !== from.task_id && entry.task_id === from.task_id;
  return {
    patch: { minutes, date: to.date, description: to.description, ...(moveTask ? { task_id: to.task_id! } : {}) },
  };
}

/**
 * Apply a change to an approved line onto its time entry. Returns "gone" when
 * the entry no longer exists (the caller files it afresh), an error message, or
 * null on success. Keys pieces split off this entry (same person, day and note,
 * `moved_from_task_id` = the approved task) move date and note with it, so the
 * day's write-down doesn't stay behind on the old date.
 */
export async function syncEntry(
  sb: SupabaseClient,
  entryId: string,
  from: LogSnap,
  to: LogSnap,
): Promise<"gone" | string | null> {
  const { data: entry } = await sb
    .from("time_entries")
    .select("id, user_id, task_id, minutes")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return "gone";
  const res = entryPatch(entry, from, to);
  if ("error" in res) return res.error;
  const { error } = await sb.from("time_entries").update(res.patch).eq("id", entryId);
  if (error) return error.message;
  if (from.task_id && (from.date !== to.date || from.description !== to.description)) {
    await sb
      .from("time_entries")
      .update({ date: to.date, description: to.description })
      .eq("user_id", entry.user_id)
      .eq("date", from.date)
      .eq("description", from.description)
      .eq("moved_from_task_id", from.task_id)
      .neq("id", entryId);
  }
  return null;
}

/**
 * The approved snapshot of a line: its `approved` column, or — before 0062 ran,
 * or for a line approved before it — built from the line itself when it is
 * still approved, else from its time entry (right unless Keys took some of it).
 */
export async function approvedSnap(
  sb: SupabaseClient,
  log: LogSnap & { status: string; approved?: LogSnap | null; time_entry_id: string | null },
): Promise<LogSnap | null> {
  if (log.approved) return log.approved;
  if (log.status === "approved") return snapOf(log);
  if (!log.time_entry_id) return null;
  const { data: e } = await sb
    .from("time_entries")
    .select("date, minutes, description, task_id")
    .eq("id", log.time_entry_id)
    .maybeSingle();
  if (!e) return null;
  return {
    date: e.date,
    minutes: e.minutes,
    description: e.description ?? "",
    task_id: e.task_id,
    client_id: log.client_id,
    task_hint: null,
  };
}

/** Write to freelancer_logs, dropping `approved` if 0062 hasn't run yet.
 * `onlyStatus` guards against a concurrent review. Returns the rows written. */
export async function updateLog(sb: SupabaseClient, id: string, row: Record<string, unknown>, onlyStatus?: string) {
  const run = (r: Record<string, unknown>) => {
    let q = sb.from("freelancer_logs").update(r).eq("id", id);
    if (onlyStatus) q = q.eq("status", onlyStatus);
    return q.select("id");
  };
  const first = await run(row);
  if (first.error && "approved" in row && MISSING_SCHEMA_CODES.has(first.error.code)) {
    const rest = { ...row };
    delete rest.approved;
    return run(rest);
  }
  return first;
}
