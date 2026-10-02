import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BOI_USD_URL, isStale, latestRate, type StoredRate } from "@/lib/leads/fx";

/**
 * Refreshes the USD→ILS rate behind the pipeline's shekel totals.
 *
 * ⚠️ SERVER-SIDE ONLY because the CSP forbids the browser from reaching
 * boi.gov.il. Runs with the CALLER'S session, not the service key: the row it
 * writes is in `lead_settings`, which `admin all` already lets an admin write,
 * so there is nothing here that needs more privilege than the person asking.
 *
 * ⚠️ SELF-LIMITING: it asks the bank only when the stored rate is stale, so a
 * board opened twenty times a day costs the bank about two requests.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: row } = await supabase
    .from("lead_settings")
    .select("value")
    .eq("key", "fx_usd_ils")
    .maybeSingle();
  const v = (row as { value?: { official?: number; date?: string; checkedAt?: string } } | null)?.value;
  const stored: StoredRate | null =
    v && typeof v.official === "number" && typeof v.date === "string"
      ? { official: v.official, date: v.date, checkedAt: v.checkedAt }
      : null;
  const now = new Date();
  if (!isStale(stored, now)) return NextResponse.json({ rate: stored });

  // Ten days back covers a long holiday weekend; the latest row wins.
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(new Date(now.getTime() - 10 * 86_400_000));
  try {
    const res = await fetch(BOI_USD_URL(from, iso(now)), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const latest = latestRate(await res.text()) ?? stored;
    if (!latest) return NextResponse.json({ rate: null });
    // ⚠️ STORED EVEN WHEN THE RATE DID NOT CHANGE, so `checkedAt` moves and the
    // weekend does not turn every page load into a request to the bank.
    const fresh: StoredRate = { official: latest.official, date: latest.date, checkedAt: now.toISOString() };
    const { error } = await supabase
      .from("lead_settings")
      .upsert({ key: "fx_usd_ils", value: fresh, updated_at: now.toISOString() });
    if (error) console.error("leads fx: could not store the rate", error.message);
    return NextResponse.json({ rate: fresh });
  } catch (e) {
    console.error("leads fx: Bank of Israel unreachable", e);
    return NextResponse.json({ rate: stored });
  }
}
