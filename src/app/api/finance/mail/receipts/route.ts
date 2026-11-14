import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expensesUser } from "@/lib/finance/advice/owner";
import { MAIL_EVERY_MS } from "@/lib/finance/advice/run";
import { billingUrl } from "@/lib/finance/advice/signals";
import { loadSuggestions } from "@/lib/finance/mail/receipts-data";
import { mailAccounts } from "@/lib/finance/mail/scan";

/**
 * Receipts from the billing mail that no expense row covers yet (v1.14.0) —
 * Expenses' "From your mail" list, for everyone on Expenses since v1.18.0
 * (reference/0022; only the owner's session reads the mail itself).
 * `missing` = reference/0016 hasn't been run.
 */
export async function GET() {
  const auth = await expensesUser();
  if ("res" in auth) return auth.res;
  try {
    const [list, boxes] = await Promise.all([loadSuggestions(auth.sb, auth.owner), auth.owner ? mailAccounts(auth.sb).catch(() => null) : lastScans(auth.sb)]);
    // When the mail was last read, and how often (Nitsan, 2026-11-07: "say when the scan was and when the next one is").
    const live = (boxes ?? []).filter((b) => b.status !== "revoked");
    const last = live.map((b) => b.lastScanAt).filter((x): x is string => !!x).sort().pop() ?? null;
    // `canRead`: only the owner reads the mail on the spot ("Read now").
    const scan = { last, everyHours: MAIL_EVERY_MS / 3_600_000, mailboxes: live.map((b) => b.email), canRead: auth.owner };
    // A vendor's own billing page, for a receipt whose invoice has to be fetched from its site.
    if (list) for (const s of list) if (!s.invoiceUrl) s.billingUrl = billingUrl(s.suggestedVendor);
    // `cleared` and `vendors` ride on the array, which JSON would drop: sent on their own.
    return NextResponse.json(list ? { suggestions: [...list], cleared: list.cleared ?? {}, vendors: list.vendors ?? [], rentLines: list.rentLines ?? [], attached: list.attached ?? 0, filled: list.filled ?? 0, scan } : { suggestions: [], missing: true, scan });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** When each mailbox was last read, for someone who can't see the mailboxes themselves (reference/0022). */
async function lastScans(sb: SupabaseClient): Promise<{ email: string; status: string; lastScanAt: string | null }[] | null> {
  const { data, error } = await sb.rpc("finance_mail_last_scan");
  if (error) return null;
  return ((data ?? []) as { email: string; status: string; last_scan_at: string | null }[]).map((b) => ({ email: b.email, status: b.status, lastScanAt: b.last_scan_at }));
}
