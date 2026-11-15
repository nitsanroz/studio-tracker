// What &advice's Claude step may see and say (v1.6.0) — kept apart from
// word.ts so it stays pure and tested. Nitsan, 2026-10-24: Claude words the
// finance advice WITHOUT amounts; the card shows the rule's exact figure.

import type { AdviceRow } from "@/lib/advice/merge";

// Amounts come in every shape the mail and expense rows hold: the symbol or
// code before the number or after it, with or without a space, Hebrew ש"ח —
// "₪120", "152.90 ₪", "USD 46.10", "12 € per seat", "120 ש"ח". JS `\b` is
// ASCII-only (useless beside ₪ or Hebrew), so word edges are lookarounds.
const LETTER = String.raw`A-Za-z֐-׿`;
const SYMBOLS = String.raw`US\$|[₪€$£]`;
const CODES = String.raw`NIS|ILS|EUR|USD|GBP|CHF|CAD|AUD|JPY`;
const WORDS = String.raw`shekels?|euros?|dollars?|pounds?|ש\s?["״'׳]{1,2}\s?ח|שח|שקל(?:ים)?|אירו|יורו|דולר(?:ים)?`;
// Ends on a digit, so a sentence's full stop after "₪3,000." stays.
const NUM = String.raw`\d(?:[\d,.]*\d)?(?:\s?[KMk]\b)?`;
const SIGN = String.raw`[−-]?\+?`;
const AMOUNT = new RegExp(
  [
    // Symbol, then the number.
    String.raw`${SIGN}(?:${SYMBOLS})\s?${NUM}`,
    // A code or word, then the number — "NIS 99", "USD 46.10".
    String.raw`${SIGN}(?<![${LETTER}])(?:${CODES}|${WORDS})\s?${NUM}`,
    // The number, then a symbol — "152.90 ₪", "12 € per seat".
    String.raw`${SIGN}${NUM}\s?(?:${SYMBOLS})`,
    // The number, then a code or word — "12,000 NIS", "120 ש"ח".
    String.raw`${SIGN}${NUM}\s?(?:${CODES}|${WORDS})(?![${LETTER}])`,
  ].join("|"),
  "gi",
);
// Other currency codes before a number (a freelancer can be paid in most
// things). A LIST, not "any three capitals": since the merge the studio's cards
// pass through here too, and "SEO 2026 plan" or "CRO 3" are task names, not
// amounts. Upper case only, or "for 12 days" would go too.
const MORE_CODES = "RSD|BAM|MKD|GEL|ISK|ARS|CLP|COP|PHP|IDR|MYR|VND|NGN|KES|MAD|QAR|KWD|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|TRY|RUB|UAH|INR|CNY|HKD|SGD|NZD|ZAR|BRL|MXN|AED|SAR|EGP|JOD|KRW|THB";
const OTHER_CODE = new RegExp(String.raw`(?<![${LETTER}])(?:${MORE_CODES})\s?\d(?:[\d,.]*\d)?(?![\d%])`, "g");

/** "₪12K", "−₪3,400", "€46.10", "12,000 NIS", "152.90 ₪", "120 ש"ח" → "[amount]". */
export function stripAmounts(text: string): string {
  return text.replace(AMOUNT, "[amount]").replace(OTHER_CODE, "[amount]");
}

/**
 * Amounts swapped for numbered marks — "{{1}}", "{{2}}" — and the amounts
 * themselves, in order. For translation (lib/advice/hebrew.ts): Claude gets the
 * marked text, and the server puts each amount back where its mark landed, so a
 * Hebrew card keeps its figures without one of them leaving the server.
 */
export function maskAmounts(text: string): { masked: string; amounts: string[] } {
  const amounts: string[] = [];
  const mark = (m: string) => {
    amounts.push(m);
    return `{{${amounts.length}}}`;
  };
  return { masked: text.replace(AMOUNT, mark).replace(OTHER_CODE, mark), amounts };
}

const MARK = /\{\{(\d+)\}\}/g;

/** The marks a text carries, sorted — a translation must carry exactly the same. */
export function marksIn(text: string): string {
  return [...text.matchAll(MARK)].map((m) => m[1]).sort().join(",");
}

/** A marked text with its amounts back in place. */
export function unmaskAmounts(masked: string, amounts: string[]): string {
  return masked.replace(MARK, (m, n: string) => amounts[Number(n) - 1] ?? m);
}

const CURRENCY_MENTION = new RegExp(String.raw`[₪€$£]|\[amount\]|(?<![${LETTER}])(?:${CODES}|${WORDS})(?![${LETTER}])`, "i");

/** Does Claude's text carry an amount after all? Then it isn't used. */
export function hasAmount(text: string): boolean {
  return (
    CURRENCY_MENTION.test(text) ||
    /\d{1,3}(?:,\d{3})+/.test(text) ||
    /\d(?:\.\d+)?\s?[KM]\b/.test(text) ||
    // A price with cents ("152.90") — hours and shares ("46.75h", "12.50%", "46.75 שעות") aren't.
    /\d\.\d{2}(?![\d%])(?!\s?(?:h\b|hours?\b|שעות|ש׳))/.test(text)
  );
}

/** Facts a model may see: no money keys, no figure, no internal links (task and lead ids mean nothing to it). */
export function plainFacts(facts: AdviceRow["facts"]): AdviceRow["facts"] {
  const out: AdviceRow["facts"] = {};
  for (const [k, v] of Object.entries(facts)) {
    if (/(?:Ils|Eur)$/.test(k) || ["figure", "href", "action", "focus", "changed", "fix", "list", "basedOn"].includes(k)) continue;
    out[k] = typeof v === "string" ? stripAmounts(v) : v;
  }
  return out;
}

/** What Claude is given — amount-free. */
export function promptFor(rows: AdviceRow[], pulse: { label: string; display: string | null; note: string }[], today: string): string {
  const findings = rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    area: r.area,
    title: stripAmounts(r.title),
    body: stripAmounts(r.body),
    facts: plainFacts(r.facts),
  }));
  const figures = pulse.filter((p) => p.display != null).map((p) => ({ label: p.label, value: stripAmounts(p.display!), note: stripAmounts(p.note) }));
  return JSON.stringify({ today, figures, findings }, null, 1);
}

