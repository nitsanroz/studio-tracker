/**
 * Parsing and accumulation for Content-Security-Policy violation reports.
 *
 * ⚠️ WHY THIS EXISTS: the CSP shipped in v1.39.0 immediately turned up a live
 * dependency nobody knew about — 17 avatars still served from Everhour's retired
 * CloudFront CDN — and it was found only because someone happened to be looking at
 * the browser console. Without a report sink the next unknown third party fails
 * silently in a colleague's browser and we hear about it as "the app looks broken".
 *
 * ⚠️ THE ENDPOINT IS UNAUTHENTICATED BY NECESSITY — browsers post violation
 * reports without credentials — so everything here is written to be cheap and
 * bounded under a hostile caller: noise is dropped before it can be stored, the
 * distinct-signature count is CAPPED, and repeats of a known signature are
 * throttled so they cannot drive one DB write per request. Egress is already the
 * project's tightest constraint (see `src/lib/egress.ts`).
 *
 * ⚠️ `dropped` IS PART OF THE STORE ON PURPOSE. A full cap that silently discarded
 * new signatures would read as "no new violations", which is the one thing this
 * feature must never claim falsely.
 */

/** One violation, reduced to the fields worth keeping. */
export type Violation = {
  /** The directive that refused it, e.g. `img-src`. */
  directive: string;
  /** What was refused. Reduced to an ORIGIN where it is a URL — see `blockedKey`. */
  blocked: string;
  /** The page it happened on. */
  documentUri: string;
};

export type ReportEntry = Violation & {
  sig: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
};

export type ReportStore = {
  items: ReportEntry[];
  updatedAt: string | null;
  /** Distinct signatures refused because `cap` was already full. */
  dropped: number;
};

export const EMPTY_STORE: ReportStore = { items: [], updatedAt: null, dropped: 0 };

/** Distinct signatures kept. Beyond this, only known ones are counted. */
export const SIGNATURE_CAP = 50;
/** A repeat of a known signature is persisted at most this often. */
export const THROTTLE_MS = 10 * 60_000;

/**
 * Schemes that produce violations we can do nothing about.
 *
 * ⚠️ BROWSER EXTENSIONS ARE THE BULK OF REAL-WORLD CSP REPORTS. Ad blockers,
 * password managers and translators all inject into the page, and every injection
 * is a violation of a strict policy. Keeping them would bury the one report that
 * means something under noise from software we do not ship.
 */
const NOISE_SCHEMES = [
  "chrome-extension:",
  "moz-extension:",
  "safari-extension:",
  "safari-web-extension:",
  "webkit-masked-url:",
  "about:",
  "data:text/html",
];

/**
 * ⚠️ THE FILTER CANNOT CATCH EVERY EXTENSION-CAUSED VIOLATION, and the first real
 * report proved it: within minutes of shipping, the viewer showed `font-src`
 * blocking `https://fonts.gstatic.com` twice. The app turned out to be clean —
 * `next/font/google` self-hosts Rubik, and the entire production build contains
 * ZERO references to gstatic or googleapis — so an extension had injected a
 * stylesheet asking for a Google font ON our page. That produces a blocked URL
 * which is an ordinary https origin and a document URL which is genuinely ours,
 * so nothing here can distinguish it from our own code doing it.
 *
 * ⚠️ THE PRACTICAL RULE FOR WHOEVER READS THIS LIST: before changing the policy to
 * allow something, check whether the app actually asks for it —
 * `grep -rl gstatic .next-build/static/` and the equivalent for the origin in
 * question. Widening `font-src` for that report would have weakened the policy for
 * a font we never load.
 */
function isNoisyValue(v: string): boolean {
  const lower = v.toLowerCase();
  return NOISE_SCHEMES.some((s) => lower.startsWith(s));
}

/**
 * Reduce a blocked value to something that groups usefully.
 *
 * A URL becomes its ORIGIN: seventeen blocked avatars on one CDN are one problem,
 * not seventeen, and keeping full paths would also store data we have no reason to
 * keep. Keywords the spec uses — `inline`, `eval`, `self` — pass through as-is.
 */
export function blockedKey(raw: string): string {
  if (!raw) return "unknown";
  if (!raw.includes("://")) return raw;
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

/** `directive|blocked-origin` — what makes two reports "the same problem". */
export function signature(v: Violation): string {
  return `${v.directive}|${blockedKey(v.blocked)}`;
}

type LegacyReport = {
  "csp-report"?: {
    "effective-directive"?: string;
    "violated-directive"?: string;
    "blocked-uri"?: string;
    "document-uri"?: string;
  };
};
type ModernReport = {
  type?: string;
  body?: {
    effectiveDirective?: string;
    blockedURL?: string;
    documentURL?: string;
  };
};

/**
 * Normalise either report format into `Violation[]`.
 *
 * ⚠️ BOTH FORMATS ARE LIVE AND WE NEED BOTH. Chrome sends the Reporting API shape
 * (an ARRAY of `{type, body}` with camelCase keys, `content-type:
 * application/reports+json`) via `report-to`; Firefox and Safari still send the
 * legacy single object `{"csp-report": {...}}` with hyphenated keys via
 * `report-uri`. Handling only one silently halves the browsers we hear from —
 * and the deprecated one is the one Safari uses, which is most of the studio.
 */
export function parseReports(payload: unknown): Violation[] {
  const out: Violation[] = [];
  const push = (directive?: string, blocked?: string, documentUri?: string) => {
    const d = (directive ?? "").trim();
    if (!d) return;
    out.push({
      directive: d,
      blocked: (blocked ?? "").trim() || "unknown",
      documentUri: (documentUri ?? "").trim(),
    });
  };

  if (Array.isArray(payload)) {
    for (const item of payload as ModernReport[]) {
      // A reporting endpoint receives deprecation and intervention reports on the
      // same channel; only CSP ones belong here.
      if (item?.type && item.type !== "csp-violation") continue;
      push(item?.body?.effectiveDirective, item?.body?.blockedURL, item?.body?.documentURL);
    }
    return out;
  }

  const legacy = (payload as LegacyReport)?.["csp-report"];
  if (legacy) {
    push(
      legacy["effective-directive"] || legacy["violated-directive"],
      legacy["blocked-uri"],
      legacy["document-uri"],
    );
  }
  return out;
}

/**
 * Drop what we cannot act on: extension noise, and anything claiming to come from
 * a page that is not ours.
 *
 * ⚠️ `allowedOrigins` MATTERS BECAUSE THE ROUTE IS OPEN. Without it, anyone could
 * fill the store with invented violations attributed to someone else's site, and
 * the cap would then hide our own.
 */
export function keepViolation(v: Violation, allowedOrigins: string[]): boolean {
  if (!v.directive) return false;
  if (isNoisyValue(v.blocked)) return false;
  if (isNoisyValue(v.documentUri)) return false;
  if (!v.documentUri) return false;
  let origin: string;
  try {
    origin = new URL(v.documentUri).origin;
  } catch {
    return false;
  }
  return allowedOrigins.includes(origin);
}

/**
 * Fold new violations into the store.
 *
 * Returns `changed` so the caller can skip the write entirely — the point of the
 * throttle.
 *
 * ⚠️⚠️ WHEN NOTHING EARNS A WRITE THIS RETURNS THE STORE IT WAS GIVEN, UNTOUCHED,
 * and that is a correctness fix rather than tidiness. It used to increment `count`
 * and hand back a store the caller then DISCARDED (the route only persists when
 * `changed`), so the returned object described a state that never reached the
 * database — and the unit tests, which thread the returned store forward, agreed
 * with it while production did not. Returning `existing` makes the two the same.
 *
 * ⚠️ CONSEQUENCE, AND IT IS THE HONEST READING OF `count`: repeats inside
 * `THROTTLE_MS` are COLLAPSED, so `count` is "times recorded", a FLOOR on the real
 * number, not a tally of violations. That is the deliberate trade — accuracy here
 * would cost one Supabase write per report on an unauthenticated endpoint, and
 * egress is this project's tightest constraint. Anything reading `count` must say
 * so — and it must say it about the WHOLE list, not per row: once repeats have
 * been collapsed an entry is indistinguishable from a single sighting, so there is
 * no way to mark the affected rows. The viewer carries one footnote instead.
 */
export function mergeReports(
  existing: ReportStore,
  incoming: Violation[],
  now: Date,
  cap = SIGNATURE_CAP,
  throttleMs = THROTTLE_MS,
): { store: ReportStore; changed: boolean } {
  const iso = now.toISOString();
  const items = existing.items.map((i) => ({ ...i }));
  const bySig = new Map(items.map((i) => [i.sig, i]));
  let changed = false;
  let dropped = existing.dropped;

  for (const v of incoming) {
    const sig = signature(v);
    const hit = bySig.get(sig);
    if (hit) {
      hit.count += 1;
      const age = now.getTime() - new Date(hit.lastSeen).getTime();
      // ⚠️ Compare BEFORE overwriting `lastSeen`, or the age is always zero and
      // every single report earns a write — the throttle would do nothing.
      if (age >= throttleMs) changed = true;
      hit.lastSeen = iso;
      continue;
    }
    if (bySig.size >= cap) {
      // Counted, not stored. `dropped` is what stops a full store from reading
      // like a clean one.
      dropped += 1;
      changed = true;
      continue;
    }
    const entry: ReportEntry = {
      sig,
      directive: v.directive,
      blocked: blockedKey(v.blocked),
      documentUri: v.documentUri,
      count: 1,
      firstSeen: iso,
      lastSeen: iso,
    };
    items.push(entry);
    bySig.set(sig, entry);
    changed = true;
  }

  // ⚠️ Nothing earned a write, so hand back exactly what came in — see the note
  // above. Returning the mutated copy would describe a state the caller discards.
  if (!changed) return { store: existing, changed: false };

  // Most recent first: the list is read to answer "what is breaking now?".
  items.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0));
  return { store: { items, updatedAt: iso, dropped }, changed: true };
}
