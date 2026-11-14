// What a billing email is, from its sender, subject and preview line (v1.12.0)
// — pure, so it's tested. The scan (scan.ts) hands it Gmail's metadata only;
// a receipt's full text is read separately, for its amount (receipts.ts, v1.14.0).
//
// Only mail from a vendor ON THE EXPENSES PAGE is kept (Nitsan, 2026-11-05):
// the point is what happens to the tools the studio already pays for.

export type MailKind = "receipt" | "renewal" | "price" | "plan" | "cancel" | "failed" | "trial";

/** Senders whose mail says a different name than the Expenses row. */
const ALIASES: Record<string, string[]> = {
  "digital river": ["maxon", "digitalriver"],
  claude: ["anthropic"],
  google: ["payments-noreply@google.com", "workspace-noreply@google.com"],
};
/** Recognised by their aliases only: "google" alone is every shared doc and calendar invite. */
const ONLY_ALIASES = new Set(["google"]);
/**
 * Never matched: other businesses send THEIR invoices through Green Invoice,
 * so its name is on mail that isn't about the studio's own subscription; the
 * state's annual fee has no billing mail.
 */
const NEVER = new Set(["חשבונית ירוקה", "מדינת ישראל"]);
/** Words too common to identify a sender on their own. */
const GENERIC = new Set(["digital", "cloud", "basic", "studio", "the", "app", "pro", "max", "plus", "team", "online"]);

/** Lower case, letters and digits only (Hebrew kept): "LS.Graphics" → "lsgraphics". */
export const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9֐-׿]/g, "");

/**
 * How to recognise a vendor's mail: its name squashed ("lsgraphics",
 * "cloudways"), its first word when distinctive ("claude" for "Claude pro"),
 * and known aliases. `search` = the words Gmail's from: is given.
 */
export function vendorTerms(vendor: string): { match: string[]; search: string[]; word?: string } {
  const v = vendor.trim().toLowerCase();
  if (NEVER.has(v)) return { match: [], search: [] };
  const first = v.split(/\s+/)[0] ?? "";
  const aliasKey = Object.keys(ALIASES).find((k) => v === k || first === k);
  const aliases = aliasKey ? ALIASES[aliasKey] : [];
  const match = new Set<string>();
  const search = new Set<string>();
  if (aliasKey && ONLY_ALIASES.has(aliasKey)) return { match: aliases.map(compact), search: aliases };
  const whole = compact(v);
  if (whole.length >= 4) match.add(whole);
  if (first.length >= 4 && !GENERIC.has(first)) {
    match.add(compact(first));
    search.add(first);
  } else if (/^[a-z0-9.]+$/.test(v.replace(/\s+/g, "")) && whole.length >= 4) search.add(v.replace(/\s+/g, ""));
  for (const a of aliases) {
    match.add(compact(a));
    search.add(a);
  }
  // A three-letter name ("Wix") is matched as a whole word, never inside another.
  if (/^[a-z0-9]{3}$/.test(v)) return { match: [...match], search: [...search, v], word: v };
  return { match: [...match], search: [...search] };
}

/** Each vendor's terms, and the whole-word pattern of a three-letter name — worked out once, not per message. */
const termsCache = new Map<string, { match: string[]; wordRe: RegExp | null; word?: string }>();
function termsOf(vendor: string) {
  let t = termsCache.get(vendor);
  if (!t) {
    const terms = vendorTerms(vendor);
    t = { match: terms.match, word: terms.word, wordRe: terms.word ? new RegExp(`(^|[^a-z0-9])${terms.word}([^a-z0-9]|$)`, "i") : null };
    termsCache.set(vendor, t);
  }
  return t;
}

/** The Expenses vendor a sender belongs to — the longest match wins ("Claude pro" over "Claude"). */
export function matchVendor(sender: string, vendors: string[]): string | null {
  const s = compact(sender);
  let best: { vendor: string; len: number } | null = null;
  for (const vendor of vendors) {
    const terms = termsOf(vendor);
    for (const t of terms.match) if (t && s.includes(t) && (!best || t.length > best.len)) best = { vendor, len: t.length };
    if (terms.wordRe && terms.wordRe.test(sender) && !best) best = { vendor, len: terms.word!.length };
  }
  return best?.vendor ?? null;
}

// Strongest first: a failed payment beats a receipt that mentions the card.
// Tuned on nitsan@'s real billing mail, 2026-11-05.
const KINDS: [MailKind, RegExp][] = [
  [
    "failed",
    /payment\b[^.]{0,30}\b(failed|declined|unsuccessful)|payment (issue|problem)|(couldn'?t|could not|unable to) (be )?(process|charge|renew|bill)(ed)?|update your (payment|billing|card)|card (has )?expired|card (is )?expiring|past due|overdue|will be suspended|(account|plan|service|access) (is |has been |was )?(suspended|turned off|paused)|exceeded (its|your) (usage )?quota/i,
  ],
  ["cancel", /\bcancel(l)?ed\b|cancellation|refund request|subscription (has )?(ended|expired|been canceled|been cancelled)|sorry to see you go|ביטול/i],
  ["price", /price (change|increase|update|is changing|will change)|new pric(e|es|ing)|pricing (change|update)|changes to (your|our) (plan|pricing|prices)|increase in (price|your subscription)|העלאת מחיר|שינוי מחיר/i],
  ["plan", /subscription (has )?changed|plan (has )?(changed|been changed)|updates? to your (subscription|plan)|(upgraded|downgraded) (to|your)|has been (upgraded|downgraded)|seats? (were |have been )?(added|removed)/i],
  ["trial", /trial (ends|ending|expires|will end|is ending|has ended|is over)/i],
  // Already renewed is a receipt; "about to renew" is a renewal notice.
  ["receipt", /has been renewed|was renewed|successfully renewed|renewal (receipt|complete|confirmation)|thank(s| you) for renewing/i],
  ["renewal", /\brenew(s|al|ing)?\b|will be charged|upcoming (\w+ )?(payment|charge|invoice|renewal)|next invoice|auto-?renew|(is|are) about to expire|expires (soon|on|in)|חידוש/i],
  ["receipt", /receipt|invoice|payment (has been )?(received|confirmation|successful|processed)|thank(s| you) for your (payment|order|purchase)|billing statement|order confirmation|your order|charged|חשבונית|קבלה|אישור ההזמנה/i],
];
/** Product news and invitations, unless they talk about prices. */
const NOISE = /webinar|newsletter|introducing|what'?s new|new feature|invitation:|invited you|join us|tips for|getting started|weekly digest|product update/i;

export function classify(subject: string, snippet = ""): MailKind | null {
  const text = `${subject} ${snippet}`;
  for (const [kind, re] of KINDS) {
    if (!re.test(kind === "receipt" || kind === "renewal" ? subject || text : text)) continue;
    if (NOISE.test(subject) && kind !== "price") return null;
    return kind;
  }
  return null;
}

/** A currency sign, code or Hebrew ש"ח → its code (lower case keys). receipts.ts adds "שח". */
export const CURRENCY: Record<string, string> = { $: "USD", us$: "USD", usd: "USD", "€": "EUR", eur: "EUR", "₪": "ILS", ils: "ILS", nis: "ILS", "ש\"ח": "ILS", "ש״ח": "ILS" };
/** An amount: "1,234.50" or "152.90" (receipts.ts reads the same). */
export const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const SYM = String.raw`US\$|\$|€|₪|USD|EUR|ILS|NIS`;
// Not global: exec starts from the beginning every time.
const BEFORE = new RegExp(`(${SYM})\\s?(${NUM})`, "i");
const AFTER = new RegExp(`(${NUM})\\s?(${SYM}|ש["״]ח)`, "i");

/** The first amount with a currency in the subject or preview line. */
export function amountIn(text: string): { amount: number; currency: string } | null {
  const before = BEFORE.exec(text);
  const after = AFTER.exec(text);
  const hit = before && (!after || before.index <= after.index) ? { c: before[1], n: before[2] } : after ? { c: after[2], n: after[1] } : null;
  if (!hit) return null;
  const amount = Number(hit.n.replace(/,/g, ""));
  const currency = CURRENCY[hit.c.toLowerCase()];
  return amount > 0 && currency ? { amount, currency } : null;
}

/** The Gmail query for one scan: mail from these vendors that talks about billing. */
export function searchQuery(vendors: string[], after: Date | null): string {
  const terms = [...new Set(vendors.flatMap((v) => vendorTerms(v).search))].map((t) => (/[^a-z0-9.@-]/i.test(t) ? `"${t}"` : t));
  const words = "{receipt invoice renew renewal renews subscription payment price pricing trial cancel cancelled canceled charged billing חשבונית קבלה חידוש מנוי}";
  const since = after ? `after:${Math.floor(after.getTime() / 1000)}` : "newer_than:400d";
  return `from:(${terms.join(" OR ")}) ${words} ${since} -in:chats`;
}
