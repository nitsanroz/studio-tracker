// The nightly erase of deleted leads (0047). Server-side only: it takes the
// service-role client the cron hands it.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How old a delete must be before the purge may erase it. The purge runs once
 * a night, so in practice a deleted lead can be undone until that night; this
 * only stops a lead deleted moments before the cron from losing its Undo.
 */
const MIN_AGE_MS = 10 * 60_000;

/**
 * Erase leads deleted more than `MIN_AGE_MS` ago — run by the daily cron so
 * the erase never depends on somebody opening the board. Best-effort: a
 * failure leaves hidden rows for the next night. Returns how many went.
 */
export async function purgeDeletedLeads(sb: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const { count, error } = await sb.from("leads").delete({ count: "exact" }).lt("deleted_at", cutoff);
  if (error) {
    console.warn("purgeDeletedLeads:", error.message);
    return 0;
  }
  return count ?? 0;
}
