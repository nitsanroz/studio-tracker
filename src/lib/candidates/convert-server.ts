import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_SCHEMA_CODES, updateWithOptional } from "@/lib/db";
import { CONVERT_EVENT, type ConvertedAs } from "./convert";

// Server half of "Convert to…" (v1.90.0), shared by the two routes that make
// people: /api/admin/users (a team member) and /api/admin/freelancers "create"
// (a freelancer). Each passes a service-role client and has already checked
// the caller is an admin.

/**
 * Refuses a second conversion BEFORE anything is created — so a double press,
 * or two tabs, cannot make two accounts or two freelancers for one person.
 *
 * ⚠️ BOTH SIGNS ARE CHECKED: 0061's `profile_id` (stepping down when the
 * column is missing) and the conversion event, which is written with or
 * without 0061. Returns the reason to show, or null to go ahead.
 */
export async function convertBlocked(admin: SupabaseClient, candidateId: string): Promise<string | null> {
  const linked = await admin.from("candidates").select("id,profile_id").eq("id", candidateId).maybeSingle();
  let exists = Boolean(linked.data);
  if (linked.error) {
    if (!MISSING_SCHEMA_CODES.has(linked.error.code ?? "")) return "The candidate could not be read.";
    const plain = await admin.from("candidates").select("id").eq("id", candidateId).maybeSingle();
    if (plain.error) return "The candidate could not be read.";
    exists = Boolean(plain.data);
  } else if ((linked.data as { profile_id?: string | null } | null)?.profile_id) {
    return "This candidate has already been converted.";
  }
  if (!exists) return "That candidate no longer exists.";
  const { count } = await admin
    .from("candidate_events")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", candidateId)
    .in("kind", Object.values(CONVERT_EVENT));
  return count ? "This candidate has already been converted." : null;
}

/**
 * Finishes the hire once the new person exists: what the application holds
 * that has a home goes into their HR file, the candidate is archived as hired
 * and linked to the profile, and History gets the conversion.
 *
 * ⚠️ RUNS AFTER THE PERSON EXISTS, SO NOTHING HERE FAILS THE REQUEST. They are
 * real by now; refusing would leave a person the admin was told was not made,
 * and a retry would make a second. Each step that misses comes back as a line
 * the page shows, so it can be finished by hand.
 *
 * ⚠️ ONLY EMAIL AND PHONE CROSS OVER — they are all an application holds that
 * `member_hr` has a column for (admin-only, so a freelancer's go there too).
 * The candidate's email goes to PERSONAL email: it is the address they applied
 * from, and an account may use a studio one. Links and the CV stay on the
 * candidate, which the new record links back to.
 */
export async function finishConversion(
  admin: SupabaseClient,
  as: ConvertedAs,
  candidateId: string,
  profileId: string,
  name: string,
  actorId: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const { data: cand, error } = await admin
    .from("candidates")
    .select("email,phone")
    .eq("id", candidateId)
    .maybeSingle();
  if (error || !cand) return ["The candidate could not be read, so nothing was copied from it."];

  const now = new Date().toISOString();
  if (cand.email || cand.phone) {
    const { error: hrErr } = await admin.from("member_hr").upsert({
      profile_id: profileId,
      personal_email: cand.email ?? null,
      phone: cand.phone ?? null,
      updated_at: now,
    });
    if (hrErr) warnings.push("Their email and phone were not copied to HR details.");
  }

  // ⚠️ `profile_id` is 0061's and optional: without it they are still marked
  // hired, just not linked to their new page.
  const { error: cErr, degraded } = await updateWithOptional(
    admin,
    "candidates",
    { id: candidateId },
    {
      status: "archived",
      outcome: "hired",
      archived_at: now,
      archived_by: actorId,
      last_activity_at: now,
    },
    { profile_id: profileId },
  );
  if (cErr) warnings.push("The candidate was not marked as hired.");
  else if (degraded) warnings.push("Migration 0061 has not run, so the candidate is not linked to their new page.");

  const { error: evErr } = await admin
    .from("candidate_events")
    .insert({ candidate_id: candidateId, kind: CONVERT_EVENT[as], detail: name, actor_id: actorId });
  if (evErr) warnings.push("History did not record the conversion.");

  return warnings;
}
