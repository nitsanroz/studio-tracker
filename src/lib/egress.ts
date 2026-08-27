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

/**
 * The studio works Sun–Thu, and the difference is enormous — 417 MB on a Tuesday
 * against 3 MB on a Saturday — so a projection that averages them flat is wrong
 * in whichever direction the sample happens to lean.
 */
function isWorkday(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() <= 4; // 0=Sun … 4=Thu
}

/** How many working / weekend days a date range holds, inclusive. */
function shapeOf(fromIso: string, toIso: string): { work: number; wknd: number } {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  let work = 0,
    wknd = 0;
  for (
    let d = new Date(fy, fm - 1, fd);
    d <= new Date(ty, tm - 1, td);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    if (d.getDay() <= 4) work++;
    else wknd++;
  }
  return { work, wknd };
}

export type CycleProjection = {
  /** Cycle-end estimate in bytes, actual-so-far plus the days still to come. */
  bytes: number;
  pct: number;
  perWorkday: number;
  perWeekend: number;
  /** Complete sampled days the rate was derived from. */
  daysSampled: number;
  /** True once there are enough days to act on the number rather than watch it. */
  confident: boolean;
};

/** Minimum complete days before a projection is offered at all. */
export const MIN_PROJECTION_DAYS = 3;
/** …and before it is allowed to raise a banner on its own. */
export const CONFIDENT_PROJECTION_DAYS = 5;

/**
 * What this cycle lands on if the studio carries on as it has been.
 *
 * ⚠️ THE POINT OF THIS IS TO WARN BEFORE THE CLIFF RATHER THAN AFTER IT. The
 * actual-usage figure can only ever report a limit already crossed; on the real
 * numbers (236 MB/day → 7.15 GB against a 5 GB allowance) the cycle was always
 * going to blow the quota, and nothing said so until it had.
 *
 * ⚠️ ONLY COMPLETE DAYS SET THE RATE. Today is partial — at 08:00 it holds a
 * couple of thousand requests — and extrapolating from it reads as a collapse in
 * the morning and a crisis by the evening.
 *
 * ⚠️ WITH NO WEEKEND SAMPLE YET, the weekday rate is used for weekend days too.
 * That OVER-estimates (a Saturday is ~3 MB against a Tuesday's ~400), and
 * over-estimating is the safe direction for an alert — it fires early rather
 * than not at all.
 */
export function projectCycle(
  state: EgressState,
  est: EgressEstimate,
  now: Date,
): CycleProjection | null {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = iso(now);

  const complete = state.samples.filter(
    (s) => s.date < today && s.date >= est.cycle.start && s.date <= est.cycle.end,
  );
  if (complete.length < MIN_PROJECTION_DAYS) return null;

  const work = complete.filter((s) => isWorkday(s.date));
  const wknd = complete.filter((s) => !isWorkday(s.date));
  const mean = (xs: DaySample[]) =>
    xs.length ? xs.reduce((a, s) => a + estimateBytes(s.rest), 0) / xs.length : 0;

  const perWorkday = mean(work);
  // No weekend sample yet → assume a weekend costs a weekday. See the ⚠️ above.
  const perWeekend = wknd.length ? mean(wknd) : perWorkday;

  // Today is already partly counted in est.bytes; replace that partial with a
  // whole day at the going rate, then add every day after it.
  const todayCounted = state.samples
    .filter((s) => s.date === today)
    .reduce((a, s) => a + estimateBytes(s.rest), 0);
  const rateFor = (d: string) => (isWorkday(d) ? perWorkday : perWeekend);

  let bytes = est.bytes - todayCounted + rateFor(today);
  if (today < est.cycle.end) {
    const [ty, tm, td] = today.split("-").map(Number);
    const dayAfter = new Date(ty, tm - 1, td + 1);
    const rest = shapeOf(iso(dayAfter), est.cycle.end);
    bytes += rest.work * perWorkday + rest.wknd * perWeekend;
  }

  return {
    bytes: Math.round(bytes),
    pct: (bytes / ALLOWANCE_BYTES) * 100,
    perWorkday: Math.round(perWorkday),
    perWeekend: Math.round(perWeekend),
    daysSampled: complete.length,
    confident: complete.length >= CONFIDENT_PROJECTION_DAYS,
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

/**
 * Folds the forecast into the level.
 *
 * ⚠️ ACTUAL USAGE STILL DRIVES THE HEADLINE — the projection can only ever RAISE
 * a quiet cycle to `warn`, never soften a loud one, and never reach `critical`.
 * A forecast is a claim about days that have not happened; it is allowed to say
 * "this is heading somewhere bad", not to declare the limit already gone.
 *
 * ⚠️ AND ONLY WHEN CONFIDENT. Two days of samples projected over a month is
 * noise, and a banner that cries on day two is one nobody reads on day twenty.
 *
 * ⚠️ `stale` still outranks everything, for the reason on `egressLevel`.
 */
export function combinedLevel(
  actual: EgressLevel,
  projection: CycleProjection | null,
): EgressLevel {
  if (actual === "stale" || actual === "critical" || actual === "warn") return actual;
  if (projection?.confident && projection.pct >= 100) return "warn";
  return actual;
}
