"use client";

// The studio-wide intake form link, in one place. It used to be built inline in
// Settings, which was fine until the intake queue needed to copy the same URL —
// two implementations of "which link is the live one" is one too many.
//
// Mirrors report-links.ts, with one difference: `intake_links` has no created_by
// column, so there is no userId parameter.

import { createClient } from "./supabase/client";

/** `client_id is null` is the generic studio-wide link (per migration 0003). */
async function latestToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("intake_links")
    .select("token")
    .is("client_id", null)
    .eq("active", true)
    // newest wins. Without an order this was whichever row Postgres happened to
    // return first, which is not stable once a second link exists.
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.token as string | undefined) ?? null;
}

/** The live studio intake URL, or null. Never creates one — safe to call on mount. */
export async function studioIntakeLinkUrl(): Promise<string | null> {
  const token = await latestToken();
  return token ? `${window.location.origin}/intake/${token}` : null;
}

/** Same, but mints a link when none exists. Admin-only (RLS enforced). */
export async function ensureStudioIntakeLink(): Promise<string | null> {
  const existing = await latestToken();
  if (existing) return `${window.location.origin}/intake/${existing}`;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("intake_links")
    .insert({ client_id: null })
    .select("token")
    .single();
  if (error) {
    console.error("ensureStudioIntakeLink failed", error.message);
    return null;
  }
  return `${window.location.origin}/intake/${data.token}`;
}
