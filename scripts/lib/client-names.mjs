/**
 * Matching a client between the tracker and the finance plan sheets.
 *
 * The two lists were typed independently years apart, so no exact key survives:
 * "Harmon.ie"/"harmoni", "Mobileye Corporate"/"mobileye", "In-reach"/"inreach",
 * "Volta Solar"/"Volta". Squash to letters, then prefix-match. Without the prefix
 * step a comparison report is ~90% false gaps.
 *
 * This lives here because four scripts need the SAME answer — compare, the
 * missing-client report, the finance backfill and the audit that checks it. When
 * they each had a copy, an alias added to one silently didn't apply in another.
 */

/** Letters and digits only; drops paren asides and corporate suffixes. */
export const canon = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&more|\bltd\b|\binc\b|\bcloud\b|\btasks?\b|corporate|solar|group/g, " ")
    .replace(/[^a-z0-9֐-׿]+/g, "");

/**
 * Same client under two identities, each confirmed by Nitsan 2026-07-29:
 *   double  → donsplus   the client renamed itself mid-relationship
 *   inreach → quadream   one client; some months were billed against the
 *                        In-reach budget, and 11 Quadream task titles say so
 *                        ("UI/UX March 20 (Inreach Budget) - 51.75h")
 *   raven, ravוn → ravin three spellings across the yearly workbooks; the middle
 *                        one has a Hebrew vav from a keyboard-layout slip
 */
export const ALIASES = new Map([
  ["double", "donsplus"],
  ["inreach", "quadream"],
  ["inrich", "quadream"],
  ["raven", "ravin"],
  ["ravוn", "ravin"],
]);

export const alias = (k) => ALIASES.get(k) ?? k;

/** Canon + alias in one step — what callers almost always want. */
export const key = (name) => alias(canon(name));

/**
 * Resolve a key against a set of known keys, prefix-matching either direction.
 * The 5-character floor keeps short names ("csl", "pdq") from swallowing others.
 */
export function resolve(k, known) {
  if (known.has(k)) return k;
  for (const c of known) {
    if (c.length >= 5 && k.length >= 5 && (c.startsWith(k) || k.startsWith(c))) return c;
  }
  return k;
}
