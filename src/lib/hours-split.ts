// Splitting a stretch of logged hours three ways: billable, KEYS (hours written
// down to a client's non-billable Keys task), and everything else non-billable.
//
// ⚠️⚠️ WHY KEYS IS ITS OWN CATEGORY. "62% billable" says a designer's other 38%
// went on internal work — but some of it was billable work the studio chose not
// to charge for (a task that ran slow, written down before the client report).
// That is a completely different fact about a person and about a client, and
// rolling the two together hides the one the studio actually acts on. Every
// per-designer share now shows it as a red slice of the non-billable part, with
// the three-way split in the tooltip; the billable percentage itself is unchanged.
//
// ⚠️ KEYS IS A SUBSET OF NON-BILLABLE, NEVER OF BILLABLE. A keys task is
// non-billable by construction (`updateClient` never mass-flips them back, and the
// picker only offers non-billable tasks), so `billable + keys + other === total`
// with no overlap. Do not "fix" a rounding difference by taking keys off the
// billable side.

import type { Client } from "./types";

export type HoursSplit = {
  total: number;
  billable: number;
  /** non-billable hours sitting on some client's Keys task */
  keys: number;
  /** non-billable and not keys — internal work, studio time, admin */
  other: number;
};

export const EMPTY_SPLIT: HoursSplit = { total: 0, billable: 0, keys: 0, other: 0 };

/**
 * Every client's chosen Keys task (migration 0037).
 *
 * ⚠️ FROM `clients.keys_task_id`, NEVER FROM A TITLE. The real data holds
 * `--- Keys ---` separator tasks and keys-shaped tasks still marked billable, so
 * matching on the name would colour a separator red and miss a real one — the same
 * reason the write-down destination is chosen rather than guessed.
 */
export function keysTaskIds(clients: Client[]): Set<string> {
  const s = new Set<string>();
  for (const c of clients) if (c.keysTaskId) s.add(c.keysTaskId);
  return s;
}

/**
 * One entry's minutes added to a split.
 *
 * ⚠️ PURE — it returns a new split rather than mutating one, and that is not
 * fastidiousness: the mutating version made the React Compiler give up on the
 * `useMemo` around the reports page's per-designer loop ("existing memoization
 * could not be preserved"), so an aggregation over a whole period re-ran on every
 * render. These maps hold a dozen entries; the allocation costs nothing.
 */
export function addEntry(
  split: HoursSplit,
  minutes: number,
  kind: { billable: boolean; keys: boolean },
): HoursSplit {
  return {
    total: split.total + minutes,
    billable: split.billable + (kind.billable ? minutes : 0),
    keys: split.keys + (!kind.billable && kind.keys ? minutes : 0),
    other: split.other + (!kind.billable && !kind.keys ? minutes : 0),
  };
}

export function newSplit(): HoursSplit {
  return { total: 0, billable: 0, keys: 0, other: 0 };
}

export function billablePct(s: HoursSplit): number | null {
  return s.total > 0 ? Math.round((s.billable / s.total) * 100) : null;
}

export function keysPct(s: HoursSplit): number {
  return s.total > 0 ? (s.keys / s.total) * 100 : 0;
}

/**
 * The three-way split as a hover line.
 *
 * ⚠️ It names all three parts even at 0%, because the reason this exists is to
 * answer "how much of the non-billable part was written down?" — and "keys 0h" is
 * that answer, whereas an omitted line reads as "not measured".
 */
export function splitTitle(s: HoursSplit, who?: string): string {
  if (s.total <= 0) return who ? `${who} — no hours in this period` : "No hours in this period";
  const pct = (n: number) => `${Math.round((n / s.total) * 100)}%`;
  const hrs = (n: number) => `${Math.round((n / 60) * 100) / 100}h`;
  const parts = [
    `billable ${hrs(s.billable)} (${pct(s.billable)})`,
    `keys ${hrs(s.keys)} (${pct(s.keys)})`,
    `other non-billable ${hrs(s.other)} (${pct(s.other)})`,
  ];
  return `${who ? `${who} — ` : ""}${hrs(s.total)}: ${parts.join(" · ")}`;
}
