// Background-refresh cadence.
//
// Constants only, lifted out of the provider so the numbers that decide how
// often the app talks to Supabase are readable in one screen rather than buried
// at line 457 of a 4,000-line file. Egress is this project's tightest
// constraint and the org is shared with two other products, so these are load
// figures, not preferences — change them knowing that.

// ── background refresh cadence ──────────────────────────────────────────
/**
 * Kept as a named dial at 1 — dev and production now poll identically.
 *
 * ⚠️ IT WAS 10 IN DEVELOPMENT, and that was an egress fix rather than a
 * preference: a dev server points at the LIVE studio project, one open tab cost
 * ~72 MB/hour, and a three-hour build session spent ~216 MB of a **5 GB**
 * monthly allowance on nobody's work. Against Pro's 250 GB that same session is
 * ~0.1%, and the tax was never free: at a 10-minute tick, refresh, staleness
 * and the write-vs-refresh races in `refreshVerdict` are untestable, and a slow
 * tick looks exactly like a broken one.
 *
 * ⚠️ If the org ever drops back to a small allowance this is the first thing
 * to put back: `process.env.NODE_ENV === "development" ? 10 : 1`.
 */
export const DEV_SLOWDOWN = 1;
/** Hot poll. A minute is inside "my colleague sees my drag soon" for the plan. */
export const HOT_INTERVAL_MS = 60_000 * DEV_SLOWDOWN;
/**
 * Studio structure (people, clients, sections, tags) every 10th hot tick.
 *
 * Left at 10 deliberately: people, clients, sections and tags change a few
 * times a WEEK, so a faster tick would buy nothing anybody could notice.
 */
export const COLD_EVERY_N_TICKS = 10;
/**
 * Every task in the studio, every hot tick.
 *
 * ⚠️ IT WAS 3 (three minutes), and that was an EGRESS budget rather than a
 * judgement about freshness: the query is ~3.2 MB today and was 88% of what a
 * 60-second tick cost, while the studio sat at 200% of a 5 GB allowance with
 * restrictions due 12 Sep 2026. What it bought was a colleague's rename or
 * reassignment taking up to three minutes to show up on your screen.
 *
 * ⚠️ BACK TO EVERY TICK BECAUSE THE CEILING MOVED (Pro, 250 GB) — measured
 * 2026-09-29, the whole studio runs at ~6 GB a month, about 2.3% of the
 * allowance. THE TIER MACHINERY STAYS: this is a number, so going back is
 * editing one digit rather than restoring a mechanism.
 */
export const TASKS_EVERY_N_TICKS = 1;

/**
 * Every time entry's totals, every hot tick.
 *
 * ⚠️ The other half of the same story: ~5 MB over 25 pages, moved to the
 * 10-minute cold tier on 2026-08-13 because pulling ten years of history every
 * minute per open tab was the single largest driver of the 402. What it cost
 * was that every total on the site — client hours, task hours, dashboards,
 * weekly timesheets — could be ten minutes behind, which is what had people
 * hitting Refresh to be sure. See `fetchEntrySums`.
 */
export const SUMS_EVERY_N_TICKS = 1;
/**
 * How long focus in a field may hold a background refresh off.
 *
 * Long enough that ordinary typing is never interrupted, short enough that a
 * cursor left in a box cannot freeze the studio's data. See the ⚠️ in `refresh`.
 */
export const FOCUS_MAX_STALE_MS = 5 * 60_000;
/** Don't refetch for an alt-tab. */
export const FOCUS_MIN_GAP_MS = 20_000;
/** Coming back after this long is worth a full refresh, not just the hot half. */
export const COLD_AFTER_AWAY_MS = 5 * 60_000;
/**
 * How long a VISIBLE tab may sit untouched before polling stops entirely.
 *
 * ⚠️ The single largest remaining egress lever, and the arithmetic is measured:
 * an open tab costs ~110 MB/hour in polling, so one person leaving the tracker
 * on a second monitor for a working day spends ~880 MB — a fifth of the org's
 * 5 GB monthly allowance without touching it. `document.hidden` already covered
 * background tabs; this covers the tab that is on screen and ignored, which is
 * how the studio reached 284% of its allowance and was cut off with a 402.
 *
 * 15 minutes because it must be far longer than any pause in real work — reading
 * a brief, a phone call, a conversation over a desk — so that nobody ever
 * notices it. Waking is instant on the first pointer/key/scroll, and cold if the
 * pause outran COLD_AFTER_AWAY_MS, so no one can act on stale figures.
 */
export const IDLE_AFTER_MS = idleAfterMs();
export function idleAfterMs(): number {
  // ⚠️ Verifying this at 15 minutes a cycle is impractical, and an unverified
  // idle-stop fails as PERMANENTLY STALE DATA — so dev may shorten it, the same
  // affordance NEXT_PUBLIC_FULL_REFRESH gives the tick above. Gated on NODE_ENV,
  // so production is provably 15 minutes whatever the environment says.
  const override =
    process.env.NODE_ENV === "development" ? Number(process.env.NEXT_PUBLIC_IDLE_AFTER_MS) : 0;
  return override > 0 ? override : 15 * 60_000;
}
/** How long an in-flight write blocks a refresh before we assume it leaked. */
export const WRITE_SETTLE_MS = 15_000;

/** prev values of exactly the patched keys — the inverse patch for undo */