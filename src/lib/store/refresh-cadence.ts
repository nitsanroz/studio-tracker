// Background-refresh cadence.
//
// Constants only, lifted out of the provider so the numbers that decide how
// often the app talks to Supabase are readable in one screen rather than buried
// at line 457 of a 4,000-line file. Egress is this project's tightest
// constraint and the org is shared with two other products, so these are load
// figures, not preferences — change them knowing that.

// ── background refresh cadence ──────────────────────────────────────────
/**
 * ⚠️⚠️ DEVELOPMENT POLLS TEN TIMES SLOWER, AND THIS IS AN EGRESS FIX, NOT A
 * CONVENIENCE. Measured 2026-08-27: one open tab costs **~72 MB/hour** at the
 * production cadence, and a dev server points at the LIVE studio project — so a
 * three-hour build session with a tab open spent ~216 MB of the studio's 5 GB
 * allowance on nobody's work. Against a routine studio day of ~100 MB that is
 * the largest single line in the bill, and separating the two by pointing dev at
 * its own Supabase project is **not available**: the org is on the Free plan,
 * which allows 2 projects, and both are in use (`studio-tracker`, `Lomdoni`).
 * So the traffic is cut where it is generated instead.
 *
 * ⚠️ PRODUCTION IS PROVABLY UNTOUCHED — `NODE_ENV` is `"production"` in the
 * built app, so the multiplier is 1 there and this whole block folds away.
 * ⚠️ Set **`NEXT_PUBLIC_FULL_REFRESH=1`** to restore the real cadence in dev,
 * which is REQUIRED when verifying anything about refresh, staleness or the
 * write-vs-refresh races in `refreshVerdict` — at 10 minutes a tick those are
 * untestable, and a slow tick looks exactly like a broken one.
 */
export const DEV_SLOWDOWN =
  process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_FULL_REFRESH !== "1" ? 10 : 1;
/** Hot poll. A minute is inside "my colleague sees my drag soon" for the plan. */
export const HOT_INTERVAL_MS = 60_000 * DEV_SLOWDOWN;
/** Studio structure (people, clients, sections, tags) every 10th hot tick. */
export const COLD_EVERY_N_TICKS = 10;
/**
 * Every task in the studio, every 3rd hot tick.
 *
 * ⚠️ This is an EGRESS budget, not a guess. The tasks query is ~2.5 MB and was
 * 88% of what a 60-second tick cost; the studio is at 200% of Supabase's 5 GB
 * free allowance with restrictions due 12 Sep, and fitting the tier needs about
 * 233 MB per working day against the ~440 MB measured after the entries moved
 * to cold. Three minutes is the slowest cadence that still reads as "live" for
 * a colleague's rename or reassignment; your OWN edits are optimistic and
 * instant regardless, and the plan grid stays on the 60-second tier.
 */
export const TASKS_EVERY_N_TICKS = 3;
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