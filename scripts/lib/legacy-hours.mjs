/**
 * Parser for the pre-Everhour hour convention.
 *
 * Before the Everhour cutover (2022-12-04) the studio logged hours in Asana task
 * COMMENTS and hand-copied the running total into the task title, with the budget
 * in parentheses. Section names carried the same convention plus a closing date:
 *
 *   "Logo Update (8) - 5.25h"                              budget 8,     actual 5.25
 *   "Website Wireframes (32-42) - 16.75h"                  budget 32–42, actual 16.75
 *   "אינטרקציית מפה 2-3 - 1.5"                              budget 2–3,   actual 1.5
 *   "Leg 2 (181h) - 150.75h"                    [section]  budget 181,   actual 150.75
 *   "Website (232+61/134) (Total 293-366) - 388.5 (27/1/2021)"  [messy — flagged]
 *
 * Every rule below exists because a simpler version got a REAL row wrong; the
 * counter-example is named next to it. Covered by scripts/lib/legacy-hours.test.mjs.
 */

/**
 * A "key" / "מפתח" row records an hours REDUCTION against a client's pool, not
 * work delivered. Per Nitsan (2026-07-28) the two that carry figures —
 * "מפתח שנעשה - 18.25h" and "- 15.75h" — are notes recording how big a reduction
 * was, and must NOT be counted in either direction: adding them overstates the
 * hours delivered, and negating them would silently reduce a historical total
 * that was already netted off in the studio's own sheet.
 */
const KEY_ROW = /(^|\s|-)(keys?|מפתח)(\s|$|\b)/i;

/**
 * HTTP status codes get used as PAGE NAMES, so a trailing figure equal to one and
 * carrying no h/hrs unit is a page, not hours. Nitsan confirmed 2026-07-28 that
 * "Storemaven - 404" is a 404 page — and it slipped back in once because this rule
 * originally lived in recover-title-hours.mjs instead of here, so the reconciler
 * (which shares this parser) re-recovered 404h from it. Rules like this belong in
 * the parser, where every consumer inherits them.
 *
 * Titles that name a code AND state hours are unaffected — they have the unit:
 * "404 page - 1.25h", "Grip - 404 page - (2h) -2".
 */
const PAGE_NAME_CODES = new Set([301, 302, 400, 401, 403, 404, 410, 418, 500, 502, 503, 504]);
const HAS_HOUR_UNIT = /\d\s*(?:h\b|hr\b|hrs\b|hours?\b|שעות|שעה)/i;

/** "(27/1/2021)", "(9/12/21)", "(1/9/2020ׁ)" — a date, never a budget. */
const DATE_PAREN = /\(\s*\d{1,2}[/.]\d{1,2}[/.]\d{2,4}[^)]{0,3}\)/g;
/** Trailing "- FINAL", "- final" — a status marker that hid the actual behind it. */
const FINAL_SUFFIX = /[-–—]\s*FINAL\s*$/i;

const num = (s) => Number(String(s).replace(/,/g, ""));

/**
 * Is this parenthesised group purely a figure, e.g. "(64)", "(32-42)",
 * "(40 hours from client + 40 = 80)", "(92h & 64h & 40h)"?
 *
 * Only those may be stripped from a name. Prose parentheses carry meaning and
 * must survive: "Homepage Design (Graphic Language) (64) - 64h" has to clean to
 * "Homepage Design (Graphic Language)", not "Homepage Design".
 */
function isFigureParen(inner) {
  if (!/\d/.test(inner)) return false; // "(Graphic Language)", "(כתבה)"
  const residue = inner
    // A number with its unit attached — "181h", "40 hours". Must go first: a
    // \bh\b word match never fires inside "181h" (no boundary between 1 and h),
    // which left an "h" behind and made every "(181h)" look like prose.
    .replace(/\d+(?:[.,]\d+)?\s*(?:hours?|hrs?|h|שעות|שעה)?/gi, " ")
    .replace(/\b(final|totals?|from|client|dev|and)\b/gi, " ")
    .replace(/[\s.,;:+\-/=&×*]/g, " ")
    .trim();
  return residue === "";
}

/**
 * @param {string} raw task title or section name
 * @returns {{budget:number|null, budgetMax:number|null, actual:number|null,
 *            closedOn:string|null, clean:string, flags:string[]}}
 *   `budget` is the low end of a range, `budgetMax` the high end (equal when not
 *   a range). `closedOn` is ISO. `clean` is the name with the numbers stripped.
 */
export function parseLegacyName(raw) {
  const flags = [];
  let s = String(raw ?? "").trim().replace(/\s+/g, " ");

  // 1. Dates first. Stripping them later left "…- 171.75h |" and the actual was
  //    never matched ("Movies - 171.75h (2/5/21)" parsed as no hours at all).
  let closedOn = null;
  const dateMatch = s.match(DATE_PAREN);
  if (dateMatch) {
    const last = dateMatch[dateMatch.length - 1];
    const [, d, m, y] = last.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    if (year >= 2000 && year <= 2035 && Number(m) >= 1 && Number(m) <= 12) {
      closedOn = `${year}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    }
    s = s.replace(DATE_PAREN, " ").replace(/\s+/g, " ").trim();
  }

  // 2. "Branding (8) - 7.25 (1/9/2020) - FINAL" — the suffix blocked the actual.
  s = s.replace(FINAL_SUFFIX, "").trim();

  // 3. Budget: the last parenthesised group holding a number.
  let budget = null;
  let budgetMax = null;
  const parens = [...s.matchAll(/\(([^)]*)\)/g)];
  for (let i = parens.length - 1; i >= 0; i--) {
    const inner = parens[i][1];
    const nums = inner.match(/\d+(?:\.\d+)?/g);
    if (!nums) continue;

    const eq = inner.match(/=\s*(\d+(?:\.\d+)?)/); // "(40 from client + 40 = 80)" → 80
    const fin = inner.match(/final\s*(\d+(?:\.\d+)?)/i); // "(105-146- final 200.5)" → 200.5
    const range = inner.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*h?\s*$/);

    if (eq) {
      budget = budgetMax = num(eq[1]);
    } else if (fin) {
      budget = budgetMax = num(fin[1]);
    } else if (range) {
      // "(32-42)" is an estimate range, not a single figure.
      budget = num(range[1]);
      budgetMax = num(range[2]);
      flags.push("budget-range");
    } else if (/\+/.test(inner) && nums.length > 1) {
      // "(110+80+16+64)" is a sum. Guarded by the `eq` branch above so
      // "(110+80+16+64=270)" yields 270 rather than double-counting to 540.
      budget = budgetMax = nums.reduce((a, b) => a + num(b), 0);
      flags.push("budget-sum");
    } else {
      budget = budgetMax = num(nums[nums.length - 1]);
      if (nums.length > 1) flags.push("budget-multi");
    }
    break;
  }

  // 4/5. Actual: a trailing figure OUTSIDE the parentheses.
  const outside = s.replace(/\([^)]*\)/g, " | ").replace(/\s+/g, " ").trim();
  let actual = null;

  // "A-B - C" is a budget range followed by the actual; a bare trailing "A-B" is
  // just the range. Without this, "אינטרקציית מפה 2-3 - 1.5" lost its 1.5 because
  // a greedy range pattern matched "3 - 1.5".
  //
  // A range's own dash must be TIGHT (no surrounding spaces). That is what tells
  // "2-3", "8-10" apart from a name that merely ends in a number: "Feb 19 - 90h"
  // and "March 19 - 85.75h" were being read as the range 19–90 and losing their
  // hours entirely.
  const UNIT = "(?:h|hr|hrs|hours)";
  const rangeThenActual = outside.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)-(\\d+(?:\\.\\d+)?)\\s*[-–—]\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*$`, "i"),
  );
  const bareRange = outside.match(
    new RegExp(`(?:^|\\s)(\\d+(?:\\.\\d+)?)-(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*$`, "i"),
  );

  if (rangeThenActual) {
    if (budget == null) {
      budget = num(rangeThenActual[1]);
      budgetMax = num(rangeThenActual[2]);
      flags.push("budget-range");
    }
    actual = num(rangeThenActual[3]);
  } else if (bareRange && budget == null) {
    budget = num(bareRange[1]);
    budgetMax = num(bareRange[2]);
    flags.push("budget-range");
  } else if (!bareRange) {
    // Require a separator or an explicit "h". A bare trailing number is part of
    // the name far more often than it is an hour count ("404 basic page",
    // "November 2022", "Animation corrections for 1 video").
    // "24hrs" and "165hrs" are as common as "24h" in the older boards, and a
    // pattern anchored on a bare trailing "h" skipped every one of them.
    const m =
      outside.match(new RegExp(`[-–—|]\\s*(\\d+(?:\\.\\d+)?(?:\\s*\\+\\s*\\d+(?:\\.\\d+)?)*)\\s*${UNIT}\\s*$`, "i")) ??
      outside.match(/[-–—|]\s*(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*)\s*$/) ??
      outside.match(new RegExp(`(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\s*$`, "i"));
    if (m) {
      const v = m[1].includes("+")
        ? m[1].split("+").reduce((a, b) => a + num(b), 0) // "8+15h"
        : num(m[1]);
      const hasH = new RegExp(`${UNIT}\\s*$`, "i").test(outside);
      if (v >= 1990 && v <= 2100 && !hasH) flags.push("looks-like-year");
      else if (v > 2000) flags.push("implausible-hours");
      else actual = v;
    }
  }

  // 6. Clean name: strip the parens and the trailing "- N[h]" only. Stripping any
  //    trailing digits turned "Leg 2 (181h) - 150.75h" into "Leg".
  let clean = s.replace(/\(([^)]*)\)/g, (m, inner) => (isFigureParen(inner) ? " " : m));
  clean = clean
    // " - 150.75h", " - 6-8", " - 8+15h". Requires whitespace BEFORE the dash so
    // a name's own number survives: "Leg 2 - 150.75h" must clean to "Leg 2", and
    // a pattern that allowed a bare dash matched "2 - 150.75" and left "Leg".
    .replace(/\s[-–—]\s*[\d\s.,+\-/]*\d\s*(?:h|hr|hrs|hours)?\s*$/i, "")
    .replace(/[-–—]\s*\d+(?:[.,]\d+)?\s*(?:h|hr|hrs|hours)\s*$/i, "") // "-28h", no space
    .replace(/\s\d+(?:[.,]\d+)?\s*(?:h|hr|hrs|hours)\s*$/i, ""); // " 8.75h", no dash
  // A bare trailing range is only a budget if it parsed as one — otherwise it is
  // part of the name ("Leg 2", "January 22"). Tight dash, matching the detection.
  if (flags.includes("budget-range")) {
    clean = clean.replace(/\s\d+(?:\.\d+)?-\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours)?\s*$/i, "");
  }
  clean = clean
    .replace(/\s*[-–—]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) {
    clean = String(raw ?? "").trim();
    flags.push("clean-empty");
  }

  if (budget != null && actual != null && (actual > budget * 3 || budget > actual * 3)) {
    flags.push("budget-vs-actual-far");
  }

  // A bare status code is a page name, not an hour count.
  if (actual != null && PAGE_NAME_CODES.has(actual) && !HAS_HOUR_UNIT.test(String(raw ?? ""))) {
    flags.push("looks-like-a-page-name");
    actual = null;
  }

  // A reduction note carries no deliverable hours. The figure stays visible in
  // the (unchanged) name and in the review sheet.
  const isKeyRow = KEY_ROW.test(String(raw ?? ""));
  if (isKeyRow && actual != null) {
    flags.push("key-reduction-not-counted");
    actual = null;
  }

  return { budget, budgetMax, actual, closedOn, clean, flags, isKeyRow };
}

/**
 * Hours mentioned in an Asana comment body ("3h", "2.5", "עשיתי 4 שעות").
 * Conservative on purpose: a comment is prose, so anything that could be a date,
 * a version or a count of things is skipped rather than guessed.
 * @returns {number|null} hours
 */
export function parseCommentHours(body) {
  const text = String(body ?? "")
    .replace(/<[^>]+>/g, " ") // Asana returns html_text on some endpoints
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  // Drop dates and clock times so they can't be read as hours. Note a plain
  // "d.m" is NOT treated as a date: "2.5" is far more often two and a half
  // hours, and scrubbing it swallowed every decimal figure. A dotted date has
  // to be the full three-part form.
  const scrubbed = text
    .replace(/\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/g, " ") // 12/5/21, 12.5.2021
    .replace(/\d{1,2}\/\d{1,2}/g, " ") // 12/5
    .replace(/\d{1,2}:\d{2}/g, " "); // 14:30

  // The figure has to sit at the START of the comment, after an optional date
  // prefix ("23/11 5.75h …", "3/1 3h", "2.75h תיקונים"). That is how the studio
  // logged: the hours first, then what was done.
  //
  // Requiring the leading position is what separates a log line from prose that
  // merely mentions a number. On one Volta QA task, 25 comments summed to 69h
  // against a title figure of 17.5h — and the biggest single contributor was
  // "כל עבודה שמושקעת מעל 17.5 שעות מבוטלת…" ("work beyond 17.5 hours is
  // written off"), a CAP being quoted, not hours worked. A mid-sentence number is
  // not a time log.
  // No extra date-stripping here: `scrubbed` has already removed them, and a
  // second pass with a `d.d` pattern ate the decimal out of "1.5h" and "1.75 hrs".
  const lead = scrubbed.trim();

  // A leading minus marks a מפתח / "key" — an hours REDUCTION against the
  // client's pool ("-11.5h מפתח", "-2.25h מפתח על שעות אור"). Counting these as
  // positive was inflating every task that had one, which is exactly the
  // convention Nitsan described.
  const m = lead.match(/^(-)?\s*(\d+(?:[.,]\d+)?)\s*(?:h\b|hr\b|hrs\b|hours?\b|שעות|שעה)/i);
  if (!m) return null;
  const v = num(m[2].replace(",", ".")) * (m[1] ? -1 : 1);
  // A single comment is one person's slice of one task; >24h either way is a
  // parse error. 0 carries no information.
  return v !== 0 && Math.abs(v) <= 24 ? v : null;
}
