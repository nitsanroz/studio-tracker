import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveFinanceAccess } from "@/lib/finance/finance-access";
import { createClient } from "@/lib/supabase/server";

/** Full finance (lib/finance-access.ts decides it) AND position owner. */
const isOwner = (p: { role?: string | null; position?: string | null; finance_full_access?: boolean | null; active?: boolean | null } | null) =>
  deriveFinanceAccess(p).isAdmin && p?.position === "owner";

// &advice's own gate is lib/advice/owner.ts — one pane, one test (the finance
// merge, stage 4). Re-exported so the mail routes keep one import.
export { ownerOnly } from "@/lib/advice/owner";

/**
 * Anyone who works on Expenses (v1.18.0, Nitsan 2026-11-08: "make sure Michal
 * sees the expenses orange suggestions"): tracker role admin — full finance
 * AND expenses-only (lib/finance-access.ts) — the same people `is_admin()`
 * lets into the mail receipts under RLS (reference/0022). `owner` says whether
 * this caller may also READ the mail (its tokens are the owner's alone).
 */
export async function expensesUser(): Promise<{ sb: SupabaseClient; owner: boolean } | { res: NextResponse }> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { res: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: p } = await sb.from("profiles").select("role, position, finance_full_access, active").eq("id", user.id).single();
  // An archived admin is not an Expenses user: the page layout already turns
  // them away (`getAccess()`), and the route must give the same answer.
  if (p?.role !== "admin" || p.active === false) return { res: NextResponse.json({ error: "Expenses users only" }, { status: 403 }) };
  return { sb, owner: isOwner(p) };
}

/** Postgres/PostgREST codes for a table or column that isn't there — 0010 not run yet. */
const MISSING_SCHEMA_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

/** Before reference/0010 is run the advice tables don't exist: say so instead of a bare 500. */
export function adviceError(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (MISSING_SCHEMA_CODES.has(String(err.code)) || /finance_advice_\w+.*(does not exist|schema cache)|Could not find the table/i.test(err.message ?? ""))
    return NextResponse.json({ error: "A table is missing — has reference/0010_finance_advice.sql been run?", detail: err.message }, { status: 503 });
  return NextResponse.json({ error: err.message ?? "Something went wrong" }, { status: 500 });
}

