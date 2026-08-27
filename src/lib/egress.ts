/**
 * Estimating the org's Supabase egress against the 5 GB free allowance, so the
 * studio hears about 80% before a client hears about 402.
 *
 * ⚠️⚠️ WHY THIS IS AN ESTIMATE AND NOT A READING, stated first because everything
 * below depends on it. **Supabase's public API has no egress endpoint.** Every
 * usage/billing/quota path under `/v1/` returns 404 with a valid personal access
 * token, and the dashboard's internal `/platform/` API rejects a token outright
 * (401 — it wants a browser session). What IS available is
 * `/v1/projects/{ref}/analytics/endpoints/usage.api-counts`: exact REQUEST COUNTS,
 * project-wide, covering every client and the server. So egress is modelled as
 * requests × a measured bytes-per-request factor.
 *
 * ⚠️ THE FACTOR IS CALIBRATED AGAINST A REAL DASHBOARD READING, not guessed.
 * On 2026-08-26 Nitsan's dashboard showed **256.011 MB of PostgREST egress**, and
 * this API reported **8,431 REST requests** for the same day → **31.1 KB per
 * request**. Cross-checked against the following week (53,545 requests over
 * 20–27 Aug = 238 MB/day) which matches the post-v1.19.11 level, so the model is
 * at least self-consistent.
 * ⚠️ RE-CALIBRATE when query shapes change. `tasks` moving to a slower tier or a
 * new heavy query would move this number and nothing here would notice.
 *
 * ⚠️ THE 7-DAY WALL IS WHY THERE IS A SAMPLE STORE AT ALL. `usage.api-counts`
 * looks back at most 7 days (`interval` maxes at `7day`, daily buckets). A billing
 * cycle is ~30, so the cycle total CANNOT be read in one call — it has to be
 * accumulated. Samples are kept in `app_settings`, and because every fetch pulls
 * a 7-day window, any gap shorter than a week is backfilled automatically the next
 * time an admin opens the app. That is deliberately instead of a cron: the Vercel
 * account is Hobby (daily crons only, 2 slots) and somebody opens this app every
 * working day.
 *
 * ⚠️ AND THE CURRENT CYCLE HAS TO BE SEEDED, because its first three weeks
 * happened before any of this existed and cannot be recovered from a 7-day window.
 * `seedBytes` is a number read off the dashboard by hand, with the date it was
 * read; the estimate is `seed + Σ(days after the seed)`. Re-seeding whenever
 * somebody looks at the dashboard is what keeps the drift bounded.
 */

/** The free tier's monthly egress allowance. */
export const ALLOWANCE_BYTES = 5 * 1024 ** 3;

/**
 * ⚠️ Measured, not assumed — see the header. Change it only with a new dashboard
 * reading to justify it, and say so in the working log.
 */
export const KB_PER_REST_REQUEST = 31.1;

/**
 * Auth, storage and realtime were 2.4% of egress on the day this was calibrated
 * (0.1% + 2.3%), so they are carried as a flat uplift rather than modelled. If
 * storage traffic ever grows — a client downloading big attachments — this is the
 * first thing that stops being true.
 */
export const NON_REST_UPLIFT = 1.025;

/**
 * ⚠️ CONFIGURED, NOT FETCHED. The billing cycle resets on the 5th (the cycle
 * running when this was built was documented as ending 5 Sep). There is no API to
 * confirm it, so if invoices say otherwise this is the number to change — an alert
 * measuring the wrong window is worse than none.
 */
export const CYCLE_RESET_DAY = 5;

export type DaySample = {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** REST requests that day, summed across every project in the org. */
  rest: number;
};

export type EgressState = {
  /** Bytes read off the dashboard by hand for the CURRENT cycle. */
  seedBytes: number;
  /** ISO date the seed was read. Days after this are added from samples. */
  seedDate: string;
  /** The cycle the seed belongs to, so a stale seed cannot leak into the next one. */
  seedCycleStart: string;
  /** Daily request counts, newest kept. */
  samples: DaySample[];
  /** ISO timestamp of the last successful poll — drives the staleness warning. */
  lastPolledAt: string | null;
};

/**
 * The cycle containing `now`, as inclusive ISO dates.
 *
 * ⚠️ Built with local calendar arithmetic (`new Date(y, m, d)`), never
 * `Date.now() ± n * 86_400_000` — the ms form is an hour short across a clocks
 * change and lands on the wrong day, which is the arithmetic v1.23.0 deleted from
 * this app.
 */
export function cycleWindow(now: Date): { start: string; end: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = now.getFullYear();
  const m = now.getMonth();
  // Before the reset day, the cycle began in the previous month.
  const start =
    now.getDate() >= CYCLE_RESET_DAY
      ? new Date(y, m, CYCLE_RESET_DAY)
      : new Date(y, m - 1, CYCLE_RESET_DAY);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, CYCLE_RESET_DAY - 1);
  return { start: iso(start), end: iso(end) };
}

/** Requests → bytes, with the non-REST tail added. */
export function estimateBytes(restRequests: number): number {
  return Math.round(restRequests * KB_PER_REST_REQUEST * 1024 * NON_REST_UPLIFT);
}

export type EgressEstimate = {
  bytes: number;
  pct: number;
  cycle: { start: string; end: string };
  /** Days of sampled data actually counted, for honesty in the UI. */
  daysCounted: number;
  /** True when the seed is for an older cycle and so was ignored. */
  seedIgnored: boolean;
};

/**
 * The cycle-to-date estimate: the hand-read seed plus every sampled day AFTER it.
 *
 * ⚠️ STRICTLY AFTER the seed date, or the seed's own day is counted twice — the
 * dashboard figure already includes it. This is the whole reason `seedDate` is
 * stored alongside the number rather than just the number.
 *
 * ⚠️ A seed from a PREVIOUS cycle is discarded rather than carried forward. Left
 * in, the alert would open the new cycle already at 11 GB and scream on day one,
 * which is exactly how a monitor gets ignored.
 */
export function estimateCycle(state: EgressState, now: Date): EgressEstimate {
  const cycle = cycleWindow(now);
  const seedValid = state.seedCycleStart === cycle.start;
  const from = seedValid ? state.seedDate : cycle.start;

  let rest = 0;
  let daysCounted = 0;
  for (const s of state.samples) {
    // `>` for a valid seed (its day is already inside the seed), `>=` otherwise.
    const after = seedValid ? s.date > from : s.date >= from;
    if (!after || s.date > cycle.end) continue;
    rest += s.rest;
    daysCounted++;
  }

  const bytes = (seedValid ? state.seedBytes : 0) + estimateBytes(rest);
  return {
    bytes,
    pct: (bytes / ALLOWANCE_BYTES) * 100,
    cycle,
    daysCounted,
    seedIgnored: !seedValid && state.seedBytes > 0,
  };
}

export type EgressLevel = "ok" | "warn" | "critical" | "stale";

/**
 * What the banner should say.
 *
 * ⚠️ `stale` OUTRANKS a comfortable percentage, and that is the point of having
 * it. If the poll has been failing — an expired token is the likely cause, since
 * Nitsan's is set to 90 days — the number on screen is old, and showing a
 * reassuring 40% from last week is worse than showing nothing. A monitor that can
 * die quietly is not a monitor.
 */
export function egressLevel(
  est: EgressEstimate,
  lastPolledAt: string | null,
  now: Date,
  staleHours = 48,
): EgressLevel {
  const polled = lastPolledAt ? new Date(lastPolledAt).getTime() : 0;
  if (!polled || now.getTime() - polled > staleHours * 3600_000) return "stale";
  if (est.pct >= 95) return "critical";
  if (est.pct >= 80) return "warn";
  return "ok";
}

/** Keeps the sample list bounded and sorted — two cycles is plenty of history. */
export function mergeSamples(existing: DaySample[], incoming: DaySample[], keep = 70): DaySample[] {
  const by = new Map(existing.map((s) => [s.date, s]));
  // ⚠️ Incoming wins: a day is re-reported by every 7-day window it appears in,
  // and the later read is the more complete one for a day still in progress.
  for (const s of incoming) by.set(s.date, s);
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-keep);
}
