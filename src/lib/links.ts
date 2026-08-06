// Titled reference links (migration 0022) — the studio pastes Google Doc and
// Dropbox URLs into briefs today, where they render as 200 characters of noise.
//
// Everything here exists because these strings become an `href`. A stored
// `javascript:` or `data:` URL would run when a colleague clicked the title,
// and the title is the ONLY thing shown — nobody would see what they were
// clicking. So the allowlist below is a real boundary, not tidiness.

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Accepts what a person actually pastes and returns a URL safe to put in an
 * `href`, or null if it can't be made into one. A bare `docs.google.com/…`
 * gets `https://`, because typing the scheme is not something anyone does.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // No scheme at all → assume https. Note the guard: "mailto:x" and
  // "javascript:…" both contain a colon, so this must not fire for them.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
  return url.toString();
}

/** Whether a stored URL is still safe to render — links predate no migration, but rows can be edited directly in SQL. */
export function isSafeUrl(raw: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/**
 * A short, human label for a URL — used as the fallback title when someone
 * pastes a link and doesn't name it. "docs.google.com" beats an empty row.
 */
export function hostLabel(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}
