// The pure half of `extract-candidate-contacts.mjs`, out here so it can be
// tested — the same reason `legacy-hours.mjs` sits beside its own suite.
//
// ⚠️ THIS IS REGEX WORK OVER 271 REAL PEOPLE'S CONTACT DETAILS, which is the
// classic place for a quiet wrong answer: a loose phone pattern eats dates, a
// loose URL pattern eats the full stop at the end of a sentence, and nobody
// notices until somebody rings the wrong number. Every case in the suite is
// INVENTED — no real candidate's details are in this repo.

// ── patterns ───────────────────────────────────────────────────────────────

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+[\w]/g;

/**
 * ⚠️ ANCHORED AND LENGTH-CHECKED, because a loose phone pattern is the one that
 * does damage here: dates ("21/06/2026"), hour counts and Asana ids are all
 * runs of digits sitting in the same paragraphs. This wants an Israeli mobile
 * or landline shape specifically — +972 followed by 8–9 digits, or a leading 0
 * followed by 8–9 — and nothing else.
 */
const PHONE = /(?:\+972[-.\s]?|\b0)(?:\d[-.\s]?){7,9}\d\b/g;

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/gi;
/** Bare hosts people paste without a scheme — behance.net/name, not a sentence. */
const BARE_HOST =
  /\b(?:www\.)?[a-z0-9-]+\.(?:com|net|co|io|me|design|studio|site|link|xyz|co\.il)\/[^\s<>()"']+/gi;

export const isLinkedIn = (u) => /(^|\.)linkedin\.com\//i.test(u);

export function hostOf(u) {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Only keep a phone once its digits look like a real number, not a date. */
function plausiblePhone(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits.length >= 11 && digits.length <= 12;
  if (digits.startsWith("0")) return digits.length >= 9 && digits.length <= 10;
  return false;
}

export function extract(text) {
  const emails = [...new Set((text.match(EMAIL) ?? []).map((e) => e.trim()))];
  const phones = [...new Set((text.match(PHONE) ?? []).map((p) => p.trim()))].filter(
    plausiblePhone,
  );
  // ⚠️ THE BARE-HOST PASS RUNS OVER THE TEXT WITH THE FULL URLs ALREADY CUT OUT.
  // Both patterns match `https://example.com/work` — one whole, one from
  // `example.com/work` onwards — so running them over the same string yields
  // the same link twice, and every candidate would have gained a duplicate
  // chip. Caught by the suite, not by reading it.
  const full = text.match(URL_RE) ?? [];
  let rest = text;
  for (const u of full) rest = rest.split(u).join(" ");
  const urls = [...new Set([...full, ...(rest.match(BARE_HOST) ?? [])])]
    .map((u) => u.replace(/[.,;:)\]]+$/, ""))
    // A mail address contains no slash, so this cannot swallow one; but a URL
    // that IS an email (mailto:) would, hence the guard.
    .filter((u) => !u.startsWith("mailto:"))
    .filter((u) => hostOf(u));
  return { emails, phones, urls };
}

/**
 * Removes a line only when the contact detail WAS the line. Anything with words
 * around it is left alone — see the header.
 */
export function stripLines(text, { emails, phones, urls }) {
  const found = [...emails, ...phones, ...urls];
  return text
    .split(/\r?\n/)
    .filter((line) => {
      let rest = line;
      for (const f of found) rest = rest.split(f).join(" ");
      // What is left once the details are gone: punctuation and labels like
      // "Phone:" do not count as content worth keeping on their own.
      rest = rest.replace(/\b(phone|tel|mobile|email|mail|e-mail|linkedin|portfolio|site|website)\b/gi, " ");
      rest = rest.replace(/[\s:|,\-–—•*]+/g, "");
      // A line that still holds real words stays.
      return rest.length > 0 || line.trim().length === 0 ? rest.length > 0 : false;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

