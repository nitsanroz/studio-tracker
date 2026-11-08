// The hours typed into a Keys write-down field, as whole minutes — or why not.
//
// Shared by both write-down hooks in `components/keys-write-down.tsx`, whose header
// says the rules must live in ONE place: a client's bill is decided by this figure.
//
// ⚠️ A FIGURE THAT DOES NOT LAND ON A WHOLE MINUTE IS STILL REFUSED, NOT ROUNDED —
// rounding down under-bills the studio a minute at a time, rounding up over-bills
// the client (v1.45.0). What changed on 2026-11-08 is only what counts as "landing":
//  · FLOAT NOISE IS NOT A FRACTION. `4.1 * 60` is 245.99999999999997 in JavaScript,
//    so an exact figure was refused; a result within 1e-6 of a whole minute is that
//    minute.
//  · THE UNTOUCHED PRE-FILL IS THE ENTRY'S OWN MINUTES. The field opens showing the
//    entry to two decimals, and for any entry not a multiple of 3 minutes that text
//    is not whole minutes (20m shows "0.33" = 19.8m) — so the default action, "write
//    the whole entry down", was refused. While the field still holds that exact text
//    it means exactly `prefill.minutes`.

export type WriteDownProblem = "positive" | "minute" | "over";

export interface ParsedWriteDown {
  /** whole minutes to move, or null when nothing (valid) can be moved */
  minutes: number | null;
  /** why the figure is refused; null for a valid figure or an empty field */
  problem: WriteDownProblem | null;
}

export function parseWriteDown(
  text: string,
  max: number,
  prefill?: { text: string; minutes: number },
): ParsedWriteDown {
  const t = text.trim();
  if (!t) return { minutes: null, problem: null };
  let minutes: number;
  if (prefill && t === prefill.text.trim()) {
    minutes = prefill.minutes;
  } else {
    const raw = Number(t);
    if (!Number.isFinite(raw) || raw <= 0) return { minutes: null, problem: "positive" };
    minutes = Math.round(raw * 60);
    if (Math.abs(raw * 60 - minutes) > 1e-6) return { minutes: null, problem: "minute" };
  }
  if (minutes <= 0) return { minutes: null, problem: "positive" };
  if (minutes > max) return { minutes: null, problem: "over" };
  return { minutes, problem: null };
}
