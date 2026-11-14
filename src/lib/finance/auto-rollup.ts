"use client";

import { runRollup } from "@/lib/finance/actions";

// The P&L recomputes itself: when the Overview or Plan opens, and shortly after
// any edit that feeds it (hours, project income, salaries, freelance,
// expenses). Pages listening for PNL_UPDATED reload their figures when it lands.

export type RollupResult = Awaited<ReturnType<typeof runRollup>>;

/** Window event fired after each automatic recompute; `detail` is the result. */
export const PNL_UPDATED = "finance:pnl-updated";

/** Opening pages back to back doesn't recompute each time. */
const OPEN_THROTTLE_MS = 60_000;
/** A burst of edits recomputes once, after the last of them. */
const EDIT_DEBOUNCE_MS = 1_500;

let inflight: Promise<RollupResult | null> | null = null;
/** An edit landed while a recompute was running — it may have read the rows before it. */
let again = false;
let lastRun = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function run(afterEdit = false): Promise<RollupResult | null> {
  if (inflight) {
    // Run once more when this one ends (2026-11-09): handing an edit the
    // running recompute's promise left the P&L without it until the next trigger.
    if (afterEdit) again = true;
    return inflight;
  }
  // The year when it runs, not when the module loaded: a tab left open over New
  // Year would otherwise keep asking for last year, which runRollup refuses.
  inflight = runRollup(new Date().getFullYear(), { auto: true })
    .then((r) => {
      lastRun = Date.now();
      window.dispatchEvent(new CustomEvent<RollupResult>(PNL_UPDATED, { detail: r }));
      return r;
    })
    // Not every signed-in user may recompute (expenses-only access); their
    // edits are picked up by the next owner's visit.
    .catch(() => null)
    .finally(() => {
      inflight = null;
      if (again) {
        again = false;
        void run();
      }
    });
  return inflight;
}

/** On opening a page: bring this year's P&L up to date (at most once a minute). */
export function refreshPnl(): Promise<RollupResult | null> {
  if (inflight) return inflight;
  if (Date.now() - lastRun < OPEN_THROTTLE_MS) return Promise.resolve(null);
  return run();
}

/** After an edit that feeds the P&L: recompute once the edits settle. */
export function schedulePnlRefresh() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    lastRun = 0;
    void run(true);
  }, EDIT_DEBOUNCE_MS);
}
