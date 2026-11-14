import type { SupabaseClient } from "@supabase/supabase-js";

export interface FinanceAccess {
  /** Full finance access — sees and edits everything. */
  isAdmin: boolean;
  /** A tracker admin without `finance_full_access` — confined to /expenses
   * everywhere in the app (proxy.ts's redirect, layout.tsx's nav, and every
   * finance table's own RLS policy all key off this same rule). */
  expensesOnly: boolean;
}

/**
 * The ONE place finance permission is DECIDED, given a profile row. Deliberately
 * separate from `profiles.role` — this Supabase project is shared with
 * studio-tracker, where more than one person can hold tracker `role = 'admin'`
 * (e.g. Michal, for team-management reasons) without that implying full
 * finance access. Pure — callers fetch the row however suits them (layout.tsx
 * also needs `name` in the same query, so it can't share the query below).
 */
export function deriveFinanceAccess(
  profile: { role?: string | null; finance_full_access?: boolean | null } | null,
): FinanceAccess {
  const isTrackerAdmin = profile?.role === "admin";
  const isAdmin = isTrackerAdmin && profile?.finance_full_access === true;
  return { isAdmin, expensesOnly: isTrackerAdmin && !isAdmin };
}

/** Convenience wrapper for callers (proxy.ts, actions.ts) that need only the
 * access decision, not the rest of the profile row. */
export async function getFinanceAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<FinanceAccess> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, finance_full_access")
    .eq("id", userId)
    .single();
  return deriveFinanceAccess(profile);
}

/**
 * Whether this viewer may give someone the `owner` position, or take it away.
 * `position = 'owner'` is what the owner's own rights key off (&advice — the
 * database's `is_finance_owner()` — and the tracker's vacation approvals), so
 * only the owner may move it: role admin + position owner + full finance, the
 * same test as `ownerOnly()` (lib/advice/owner.ts). The person page's Position
 * select used to offer it to any full-finance admin, themselves included.
 */
export function canSetOwnerPosition(
  viewer: { role?: string | null; position?: string | null; finance_full_access?: boolean | null } | null,
): boolean {
  return viewer?.role === "admin" && viewer.position === "owner" && viewer.finance_full_access === true;
}
