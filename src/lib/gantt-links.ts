"use client";

import { createClient } from "./supabase/client";

/**
 * The URL of this client's live Gantt link, creating one if it has none.
 * Admin-only (RLS enforced). Mirrors `ensureClientReportLink`.
 *
 * Note the `order by created_at desc` — `limit(1)` without an order is a
 * coin toss once a client has had a link revoked and a new one issued.
 */
export async function ensureClientGanttLink(
  clientId: string,
  userId: string,
): Promise<string | null> {
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("gantt_links")
    .select("token")
    .eq("client_id", clientId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let token = existing?.token as string | undefined;
  if (!token) {
    const { data: created, error } = await supabase
      .from("gantt_links")
      .insert({ client_id: clientId, created_by: userId })
      .select("token")
      .single();
    if (error) {
      console.error("ensureClientGanttLink failed", error.message);
      return null;
    }
    token = created.token;
  }
  return `${window.location.origin}/gantt/${token}`;
}
