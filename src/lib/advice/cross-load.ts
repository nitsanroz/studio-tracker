// What cross.ts's freelancer rule needs beyond the two data sets: who is on a
// sliding rate, at which terms, and how many hours they logged last month.
//
// ⚠️ SERVER ONLY, the owner's session. Rates are money: they go no further than
// run.ts, which turns them into findings for the owner's store.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, isMissingSchema } from "@/lib/db";
import { HOURLY_TERMS } from "@/lib/hourly-terms";
import type { RateTerms } from "@/lib/freelance-rate";
import { lastMonthOf, type CrossFreelancer } from "./cross";
import type { AdviceData as StudioData } from "./signals";

type Row = Record<string, unknown>;

/**
 * Sliding-rate freelancers (the `freelancers` table, plus HOURLY_TERMS for
 * anyone priced there and not kept on the Freelancers page), with last month's
 * hours: a login's own time entries, else their link's logs that weren't turned
 * down — the same split as hours-goal-server.ts `slidingRateFreelancers`.
 * Any failure reads as "nobody" — the rule stays quiet, the pane stays up — and is logged.
 */
export async function loadCrossFreelancers(sb: SupabaseClient, studio: StudioData): Promise<CrossFreelancer[]> {
  try {
    const month = lastMonthOf(studio.today).key;
    const [y, m] = month.split("-").map(Number);
    const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    // ⚠️ Not fetchAll: it pages ORDER BY id, and `freelancers` is keyed on profile_id —
    // it has no id (0054). Naming one failed the whole select, which the catch below
    // read as "nobody", and the rule never fired (found in review, 2026-11-14).
    const res = await sb.from("freelancers").select("profile_id, currency, rate_high, rate_low, hours_low, hours_high");
    if (res.error) throw Object.assign(new Error(`freelancers: ${res.error.message}`), res.error);
    const people = (res.data ?? []) as Row[];
    const terms = new Map<string, RateTerms>(Object.entries(HOURLY_TERMS));
    for (const p of people)
      terms.set(String(p.profile_id), {
        currency: String(p.currency),
        rateHigh: Number(p.rate_high),
        rateLow: Number(p.rate_low),
        hoursLow: Number(p.hours_low),
        hoursHigh: Number(p.hours_high),
      });
    const ids = [...terms.keys()];
    if (!ids.length) return [];
    const [profiles, logs, fxRes] = await Promise.all([
      fetchAll<Row>(sb, "profiles", "id, name, has_account", (q) => q.in("id", ids)),
      fetchAll<Row>(sb, "freelancer_logs", "id, profile_id, minutes", (q) =>
        q.in("profile_id", ids).neq("status", "rejected").gte("date", `${month}-01`).lte("date", monthEnd),
      ),
      sb.from("fx_rates").select("year, month, usd_ils, eur_ils").lte("year", y).order("year", { ascending: false }).order("month", { ascending: false }),
    ]);
    const fxRows = (fxRes.data ?? []) as Row[];
    // That month's official rate, else the latest stored for the currency before it.
    const fxOf = (currency: string) => {
      if (currency === "ILS") return 1;
      const col = currency === "USD" ? "usd_ils" : "eur_ils";
      const row = fxRows.find((r) => (Number(r.year) < y || (Number(r.year) === y && Number(r.month) <= m)) && r[col] != null);
      return Number(row?.[col] ?? 0);
    };
    const withLogin = new Set(profiles.filter((p) => p.has_account).map((p) => String(p.id)));
    const hoursOf = (pid: string) =>
      withLogin.has(pid)
        ? studio.entries.filter((e) => e.userId === pid && e.date.startsWith(month)).reduce((t, e) => t + e.minutes / 60, 0)
        : logs.filter((l) => String(l.profile_id) === pid).reduce((t, l) => t + Number(l.minutes) / 60, 0);
    return ids
      .map((pid) => ({
        profileId: pid,
        name: String(profiles.find((p) => String(p.id) === pid)?.name ?? ""),
        terms: terms.get(pid)!,
        fx: fxOf(terms.get(pid)!.currency),
        monthHours: hoursOf(pid),
      }))
      .filter((f) => f.fx > 0 && f.name);
  } catch (e) {
    // Quiet for the pane, never for the log: a failure here looks exactly like
    // "no freelancers", so it has to say so somewhere.
    console.error(`&advice: freelancer terms failed to load${isMissingSchema(e) ? " (a table or column is missing)" : ""} — the freelancer rule is off:`, (e as Error).message);
    return [];
  }
}
