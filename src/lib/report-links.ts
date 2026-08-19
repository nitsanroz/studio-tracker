"use client";

import { createClient } from "./supabase/client";
import { canonicalReportLink, mapReportLink } from "./db";

/**
 * Returns the URL of the client's report link, creating a rolling "This month"
 * link if none exists. Admin-only (RLS enforced).
 *
 * ⚠️ Resolves through `canonicalReportLink`, NOT "newest active row". This button
 * hands a client a permanent URL, so it has to agree with what Publish writes to —
 * picking differently is how a client ends up holding a token the studio stopped
 * publishing to. See the rule's own comment in `db.ts`.
 */
export async function ensureClientReportLink(
  clientId: string,
  userId: string,
): Promise<string | null> {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("report_links")
    .select("*")
    .eq("client_id", clientId)
    .eq("active", true);

  let token = canonicalReportLink((rows ?? []).map(mapReportLink))?.token;
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
