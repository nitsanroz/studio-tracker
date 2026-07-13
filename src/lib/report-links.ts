"use client";

import { createClient } from "./supabase/client";

/**
 * Returns the URL of the client's latest active report link, creating a
 * rolling "This month" link if none exists. Admin-only (RLS enforced).
 */
export async function ensureClientReportLink(
  clientId: string,
  userId: string,
): Promise<string | null> {
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("report_links")
    .select("token")
    .eq("client_id", clientId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let token = existing?.token as string | undefined;
  if (!token) {
    const { data: created, error } = await supabase
      .from("report_links")
      .insert({ client_id: clientId, preset: "This month", created_by: userId })
      .select("token")
      .single();
    if (error) {
      console.error("ensureClientReportLink failed", error.message);
      return null;
    }
    token = created.token;
  }
  return `${window.location.origin}/report/${token}`;
}
