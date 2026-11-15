// Receipts in the billing mail → expenses to add (v1.14.0, Nitsan 2026-11-05:
// "it can appear as a suggestion so it can be reviewed and approved to add to
// the list of expenses"). Pure, so it's tested: the scan (scan.ts) hands it
// what Gmail returns; the Expenses page's "From your mail" list and &advice
// read what it decides.
//
// ⚠️ RECEIPT TEXT IS READ FOR SHORT FIELDS ONLY (Nitsan's choice, 2026-11-05):
// the scan fetches the full text of mail already sorted as a receipt, takes
// the total, and keeps vendor, date, subject and amount — since then also the
// invoice number and card (v1.15.1), what was bought, the invoice's link and
// the attached documents (v1.16.0–v1.17.0). The text itself is never stored.

import { GUR_VENDOR_CANON } from "@/lib/finance/finance";
import { CURRENCY as CURRENCY_BASE, NUM, classify, compact } from "./classify";
import { billPeriod, isPaymentNotice, monthsHolding, monthsPaid, rentLineOf, rentMonthsFor, rentNet, splitBill } from "./rent";

/* ── reading a receipt ──────────────────────────────────────────────────── */

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

/** The most a saved document may weigh (the bucket's own limit, reference/0019). */
const MAX_DOC_BYTES = 15 * 1024 * 1024;
const DOC_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|heic|gif))$/i;

export interface Attachment {
  filename: string;
  mime: string;
  /** Gmail's id for it — NOT stable: a new one on every read of the message */
  attachmentId: string;
  size: number;
  /** a small attachment Gmail sends inline instead of by id */
  data?: string;
}

const BY_EXT: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", gif: "image/gif" };

/**
 * What the file is: its own type when it's one we keep, else by its name —
 * Wolt's invoices come as "application/octet-stream" (Nitsan, 2026-11-07:
 * "the file is in the mail").
 */
function docType(mime: string, name: string): string | null {
  if (DOC_TYPES.test(mime)) return mime;
  if (/pdf/.test(mime)) return "application/pdf";
  if (mime && !/^(application\/(octet-stream|binary|force-download|download|x-download)|binary\/octet-stream)$/.test(mime)) return null;
  return BY_EXT[/\.(\w+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? null;
}

/**
 * A receipt's documents (v1.16.0, Nitsan 2026-11-06: "preview and download
 * them"): its PDFs, and images big enough to be a scan rather than a logo or
 * a signature (inline pictures under 30 KB, or named like image001.png).
 * In the order the email has them, one per name and size.
 */
export function attachmentsOf(payload: GmailPart | undefined): Attachment[] {
  const out: Attachment[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    const id = p.body?.attachmentId ?? "";
    const data = id ? undefined : p.body?.data;
    const name = (p.filename ?? "").trim();
    const mime = docType((p.mimeType ?? "").toLowerCase(), name);
    const size = p.body?.size ?? 0;
    if ((id || data) && name && mime && size <= MAX_DOC_BYTES) {
      const inline = (p.headers ?? []).some((h) => /^content-disposition$/i.test(h.name) && /^inline/i.test(h.value));
      const logo = mime !== "application/pdf" && (size < 30_000 || /^(image\d*|logo|icon|signature)[\w-]*\./i.test(name) || inline);
      const twin = out.some((a) => a.filename === name && a.size === size);
      if (!logo && !twin) out.push({ filename: name, mime, attachmentId: id, size, ...(data ? { data } : {}) });
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  return out;
}

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", euro: "€", "#8362": "₪" };

/** An HTML mail as plain text: tags out, cells and rows apart, entities read. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(td|th)>/gi, " \t ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+|#\d+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** A message's text: its text/plain part, else its HTML as text. */
export function bodyText(payload: GmailPart | undefined): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.body?.data && p.mimeType === "text/plain") plain.push(decode(p.body.data));
    else if (p.body?.data && p.mimeType === "text/html") html.push(decode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(payload);
  // HTML first when there is some: many plain parts are a stub ("view this receipt online").
  const fromHtml = html.map(htmlToText).join("\n");
  return fromHtml.length > 80 ? fromHtml : plain.join("\n") || fromHtml;
}

/** Where the invoice is for a receipt that doesn't attach it — words on its button, strongest first. */
const LINK_INVOICE = /\b(view|download|get|see|open|access)\b[^<]{0,20}\b(invoice|receipt|bill)s?\b|\b(invoice|receipt)s?\b|לצפי[י]?ה|להורדה|להדפסה|הדפסת|לחשבונית|חשבונית|קבלה|אישור\s+התשלום/i;
// "לחץ כאן" — Idan Shani's building-fee confirmation is a bare "click here" (2026-11-09).
const LINK_ACCOUNT = /\b(billing|log\s?in|sign\s?in|dashboard|account|manage)\b|כניסה|התחבר|לאזור האישי|לחץ\s+כאן|לחצו\s+כאן/i;
const LINK_NOISE = /unsubscribe|preferences|privacy|terms|legal|help|support|status|mailto:|tel:|facebook|twitter|x\.com|linkedin|instagram|youtube|apps\.apple|play\.google|הסרה|מדיניות/i;

/**
 * The link to get the invoice from, for a receipt whose email has none
 * attached — Cloudflare's "View invoice", a "Log in to download" (Nitsan,
 * 2026-11-07: "give the button directing to that place"). https only; its
 * button text says invoice/receipt (else billing/log in); never an
 * unsubscribe, help or social link. Null when there's none.
 */
export function invoiceLink(payload: GmailPart | undefined): string | null {
  const html: string[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.body?.data && p.mimeType === "text/html") html.push(decode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(payload);
  let best: { url: string; score: number } | null = null;
  for (const h of html) {
    for (const m of h.matchAll(/<a\b[^>]*?href\s*=\s*["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = m[1].replace(/&amp;/g, "&");
      const label = htmlToText(m[2]);
      if (!label || LINK_NOISE.test(url) || LINK_NOISE.test(label) || url.length > 2000) continue;
      const score = LINK_INVOICE.test(label) ? 2 : LINK_ACCOUNT.test(label) ? 1 : 0;
      if (score && (!best || score > best.score)) best = { url, score };
    }
  }
  return best?.url ?? null;
}

/**
 * The email's own link to a supplier's site (v1.24.6, Nitsan 2026-11-09: "the
 * Mei Avivim link is general, not the one from the mail"): for a bill behind a
 * login, whatever its button says — the first https link on that site (or a
 * subdomain), never an unsubscribe, help or social one. Null when there's none.
 */
export function linkTo(payload: GmailPart | undefined, site: string): string | null {
  const html: string[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.body?.data && p.mimeType === "text/html") html.push(decode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(payload);
  for (const h of html) {
    for (const m of h.matchAll(/<a\b[^>]*?href\s*=\s*["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = m[1].replace(/&amp;/g, "&");
      let host = "";
      try {
        host = new URL(url).host;
      } catch {
        continue;
      }
      if ((host === site || host.endsWith(`.${site}`)) && !LINK_NOISE.test(url) && !LINK_NOISE.test(htmlToText(m[2]))) return url;
    }
  }
  return null;
}

const CURRENCY: Record<string, string> = { ...CURRENCY_BASE, "שח": "ILS" };
const SYM = String.raw`US\$|\$|€|₪|USD|EUR|ILS|NIS|ש["״]?ח`;
const MONEY = new RegExp(String.raw`(?:(${SYM})\s?(${NUM}))|(?:(${NUM})\s?(${SYM}))`, "gi");

interface Money {
  amount: number;
  currency: string;
  at: number;
}

function amountsIn(text: string): Money[] {
  const out: Money[] = [];
  for (const m of text.matchAll(MONEY)) {
    const sym = (m[1] ?? m[4] ?? "").toLowerCase();
    const n = Number((m[2] ?? m[3] ?? "").replace(/,/g, ""));
    const currency = CURRENCY[sym] ?? CURRENCY[sym.replace(/["״]/g, "")];
    if (currency && n > 0) out.push({ amount: n, currency, at: m.index ?? 0 });
  }
  return out;
}

/**
 * The words a receipt puts before what was actually paid, strongest first.
 * "Subtotal" never counts; "Total" does when nothing says "paid".
 */
const PAID = /amount paid|total paid|you paid|paid amount|amount charged|total charged|charged to|payment amount|סכום ששולם|שולם|סה["״]?כ לתשלום/gi;
const TOTAL = /(?<!sub)(?<!sub-)(?<!sub )\btotal\b(?! (?:excl|before))|grand total|סה["״]?כ|סך הכל/gi;

/**
 * A Hebrew PDF whose text comes out right-to-left (Partner's bill, 2026-11-09): "סה"כלתשלוí18.140{" is
 * ₪140.18 — the ₪ sign reads as "{" and the shekels and agorot swap sides of the dot. Only that exact
 * shape is taken: the total to pay, then the swapped number, then the "{".
 */
export function rtlPdfTotal(text: string): { amount: number; currency: string } | null {
  // IEC's bill: the number comes before its label — "1,864.83 סה"כ כולל מע"מ לתקופת חשבון". Its notes
  // also name the previous bill ("ח-ן 06/2026 בסך 921.21 ש"ח נשלח לגביה"), which was read instead (2026-11-09).
  const iec = /([\d,]+\.\d{2})\s*סה["״]?כ\s*כולל\s*מע["״]?מ\s*לתקופת\s*חשבון/.exec(text);
  if (iec) return { amount: Number(iec[1].replace(/,/g, "")), currency: "ILS" };
  const m = /סה["״]?כ\s*לתשלו\S\s*(\d{1,2})\.(\d{1,3}(?:,\d{3})*)\s*\{/.exec(text);
  if (!m) return null;
  const amount = Number(`${m[2].replace(/,/g, "")}.${m[1].padEnd(2, "0")}`);
  return amount > 0 ? { amount, currency: "ILS" } : null;
}

/** A number right after its label, the currency elsewhere ("סה״כ לתשלום152.90"). Not global: exec is stateless. */
const STUCK_NUM = new RegExp(String.raw`^\s*[:\-]?\s*(${NUM})(?![\d%])`);

/** What a receipt says was paid: the amount after "Amount paid", else after "Total", else the largest. */
export function receiptAmount(text: string): { amount: number; currency: string } | null {
  const all = amountsIn(text);
  for (const label of [PAID, TOTAL]) {
    let best: Money | null = null;
    for (const m of text.matchAll(label)) {
      const end = (m.index ?? 0) + m[0].length;
      // The first amount within a short reach after the label (a table cell or two).
      const hit = all.find((a) => a.at >= end && a.at - end <= 60);
      if (hit) best = hit; // the last labelled one: receipts end with the paid total
    }
    if (best) return { amount: best.amount, currency: best.currency };
  }
  // A number stuck to its label with the currency elsewhere — Wolt's "(₪) סה״כ לתשלום152.90" (2026-11-07);
  // or none at all in a Hebrew email — Idan Shani's "סכום ששולם 199" (2026-11-09) is in shekels.
  const cur = docCurrency(text) ?? (/[\u0590-\u05ff]{3}/.test(text) ? "ILS" : null);
  if (cur) {
    for (const label of [PAID, TOTAL]) {
      let best: number | null = null;
      for (const m of text.matchAll(label)) {
        const n = STUCK_NUM.exec(text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 24))?.[1];
        if (n && Number(n.replace(/,/g, "")) > 0) best = Number(n.replace(/,/g, ""));
      }
      if (best != null) return { amount: best, currency: cur };
    }
  }
  if (!all.length) return null;
  const top = all.reduce((a, b) => (b.amount > a.amount ? b : a));
  return { amount: top.amount, currency: top.currency };
}

/** The currency a document is in, by the signs it uses most. */
function docCurrency(text: string): string | null {
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const tally: [string, number][] = [
    ["ILS", count(/₪|\bILS\b|\bNIS\b|ש["״]ח/g)],
    ["USD", count(/\$|\bUSD\b/g)],
    ["EUR", count(/€|\bEUR\b/g)],
  ];
  const [cur, n] = tally.reduce((a, b) => (b[1] > a[1] ? b : a));
  return n > 0 ? cur : null;
}

/* ── its paperwork ──────────────────────────────────────────────────────── */

const BRANDS: [RegExp, string][] = [
  [/visa|ויזה/i, "Visa"],
  [/master\s?card|מאסטרקארד/i, "Mastercard"],
  [/amex|american express|אמריקן/i, "Amex"],
  [/isracard|ישראכרט/i, "Isracard"],
  [/diners|דיינרס/i, "Diners"],
];
const brandOf = (s: string) => BRANDS.find(([re]) => re.test(s))?.[1] ?? null;

// "חשבונית מרכזת - SI266000087": Aluel's consolidated rent invoice (2026-11-09).
const INVOICE_LABEL = String.raw`(?:invoice|receipt|order|tax invoice|חשבונית(?:\s*(?:מס|מרכזת))?(?:\s*\/\s*קבלה)?|קבלה)`;
// Not global: exec is stateless.
const INVOICE_NUMBERED = new RegExp(String.raw`${INVOICE_LABEL}\s*(?:no\.?|number|num\.?|#|מס['׳"]?|מספר)?\s*[:#–-]?\s*#?\s*([A-Z]{0,4}-?\d[\dA-Z-]{3,})`, "i");
const INVOICE_HASH = /#\s?([A-Z]{0,4}-?\d[\dA-Z-]{3,})/i;

/**
 * A receipt's invoice number and what paid it (v1.15.1, Nitsan 2026-11-06:
 * "invoice number, way of payment, what credit card"). Only these two short
 * strings are kept — "70860076", "Visa ••3562" — never the text around them.
 */
export function receiptDetails(text: string, subject = ""): { invoice: string | null; paidWith: string | null } {
  const pick = (s: string) => INVOICE_NUMBERED.exec(s)?.[1] ?? INVOICE_HASH.exec(s)?.[1] ?? null;
  const invoice = (pick(subject) ?? pick(text))?.replace(/-+$/, "") ?? null;

  let paidWith: string | null = null;
  const branded = /(visa|master\s?card|amex|american express|isracard|diners|ויזה|מאסטרקארד|ישראכרט|דיינרס|אמריקן אקספרס)[^\d\n]{0,30}?(\d{4})\b/i.exec(text);
  const ending = /(?:ending|ends)\s+(?:in|with)\s*[:#]?\s*(\d{4})\b/i.exec(text) ?? /[•*·xX]{2,}\s?(\d{4})\b/.exec(text) ?? /(?:כרטיס|אשראי)[^\d\n]{0,30}?(\d{4})\b/.exec(text);
  if (branded) paidWith = `${brandOf(branded[1])} ••${branded[2]}`;
  else if (ending) {
    const around = text.slice(Math.max(0, ending.index - 40), ending.index + ending[0].length);
    paidWith = `${brandOf(around) ?? "Card"} ••${ending[1]}`;
  } else if (/bank transfer|wire transfer|העברה בנקאית/i.test(text)) paidWith = "Bank transfer";
  else if (/paypal/i.test(text)) paidWith = "PayPal";
  return { invoice, paidWith };
}

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
/** Where a line item's name ends: a date, a quantity and price, a price, or the next heading. */
const ITEM_END = String.raw`(?=\s+(?:(?:${MONTHS})[a-z]*\.?\s+\d|\d+\s+(?:[$€₪]|US\$)|[$€₪]|\d[\d,]*\.\d{2}|פרטי|סכום|כמות|מחיר|סה["״]?כ|תאריך|Qty|Quantity|Unit price|Amount|Total|Subtotal)|\s*$)`;
const HE_MONTHS = "ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר";
const ITEM_RULES: RegExp[] = [
  // "סכום ששולם 199 שולם לחודש מאי - 2026": the month a payment is for, not the day it came (2026-11-09:
  // Idan Shani's 98342 came on 17 April and was May's building fee).
  new RegExp(String.raw`שולם\s+(לחודש\s+(?:${HE_MONTHS})\s*-?\s*\d{4})`),
  // "קבלה בגין רכישת יום פינוק עם עיסוי - זוגי - Kedem Spa"
  new RegExp(String.raw`בגין\s+(?:רכישת\s+|רכישה\s+של\s+)?(.{3,120}?)${ITEM_END}`),
  // Stripe and most invoices: a table under "Description Qty Unit price Amount".
  new RegExp(String.raw`Description\s+(?:Qty|Quantity)\s+(?:Unit\s+price|Price)\s+(?:Tax\s+)?Amount\s+(.{3,120}?)${ITEM_END}`, "i"),
  new RegExp(String.raw`תיאור\s+(?:כמות\s+)?(?:מחיר(?:\s+ליחידה)?\s+)?(?:סכום\s+)?(.{3,120}?)${ITEM_END}`),
  // A labelled line: "Item: Pro plan", "מוצר: ..."
  // ("עבור:" is left out: Hebrew receipts use it for who was billed, not what.)
  new RegExp(String.raw`(?:^|\s)(?:Description|Item|Product|Plan|Service|פריט|מוצר|שירות)\s*:\s*(.{3,120}?)${ITEM_END}`, "i"),
];

/**
 * What was bought, as the receipt names it (Nitsan, 2026-11-07: "the
 * expense's description should say what it was — 'יום פינוק עם עיסוי - זוגי
 * - Kedem Spa'"), from the email's text or its PDF. One short line, or null.
 */
export function receiptDescription(...texts: string[]): string | null {
  const flats = texts.map((t) => t.replace(/\s+/g, " "));
  // The strongest rule wins whichever text it's in — the PDF's "בגין רכישת" beats a label in the email.
  for (const re of ITEM_RULES) {
    for (const flat of flats) {
      const got = cleanItem(re.exec(flat)?.[1] ?? "");
      if (got && goodItem(got)) return got.slice(0, 120);
    }
  }
  return null;
}

/** An item line without the start of a period cut off after it ("Plnty Pro (Monthly) — From"). */
export const cleanItem = (s: string) =>
  s
    .replace(/\s*[-–—]\s*(from|for|period|billed)\s*$/i, "")
    .replace(/\s*[-–—:,|]\s*$/, "")
    .trim();

/**
 * A name of something bought — not a number, a sentence, or who was billed
 * (the studio's name, a company or ID number: "סטודיו אנד מור ח.פ/ת.ז/ע.מ:
 * …" came through once and must never be kept).
 */
export function goodItem(s: string): boolean {
  if (!/[a-zA-Z\u0590-\u05ff]{2}/.test(s) || s.split(" ").length > 14) return false;
  if (/^(qty|quantity|amount|total|כמות|סכום)\b/i.test(s)) return false;
  if (/ח["״.]?\s?פ\b|ת["״.]?\s?ז\b|ע["״.]?\s?מ\b|עוסק|לכבוד|סטודיו\s*(אנד|ו|&)\s*מור|studio\s*(&|and|n)\s*more|\b\d{8,9}\b/i.test(s)) return false;
  return true;
}

/**
 * A request to pay, not the tax invoice (Nitsan, 2026-11-07: "BuyMe sent a
 * payment request — we only need the tax invoice"): a proforma, a quote.
 */
const PAYMENT_REQUEST = /דרישת\s+תשלום|חשבון\s+עסקה|פרופורמה|הצעת\s+מחיר|payment\s+request|request\s+for\s+payment|pro-?forma|\bquotation\b/i;

/* ── who sent it ────────────────────────────────────────────────────────── */

/** "Figma <billing@figma.com>" → "figma.com"; a subdomain is folded to its site. */
export function senderDomain(from: string): string {
  const email = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  const host = email.split("@")[1] ?? "";
  const parts = host.split(".");
  // mail.anthropic.com → anthropic.com; something.co.il keeps three labels.
  const keep = parts.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

const NOISE_NAME = /\b(billing|receipts?|invoices?|payments?|no-?reply|notifications?|support|team|accounts?|orders?|store|via|payables?|bookkeeping)\b|,?\s*(inc|llc|ltd|gmbh|b\.v|pbc|corp)\.?$/gi;
/** Mail providers anyone can use: the site says nothing about the business. */
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "walla.co.il", "live.com"]);
/** Payment processors that send receipts in each seller's name: the display name is the vendor. */
const PROCESSORS = new Set(["stripe.com", "polar.sh", "paddle.com", "fastspring.com", "lemonsqueezy.com", "digitalriver.com", "chargebee.com", "recurly.com"]);

const firstWordOf = (s: string) => s.trim().split(/\s+/)[0] ?? "";
const canon = (s: string) => s.trim().toLowerCase();
const displayOf = (from: string) => /^\s*"?([^"<]+?)"?\s*</.exec(from)?.[1]?.trim() ?? "";
/** The site's own name: "notraffic.tech" → "notraffic". */
const siteLabel = (domain: string) => domain.split(".")[0] ?? "";

/**
 * A name for a sender Expenses doesn't know — the COMPANY, not the person
 * who wrote (Nitsan, 2026-11-06: "Hadas from NoTraffic" is NoTraffic). The
 * display name when it is the company's ("Cloudflare", "Wolt"), or the sender
 * is a payment processor writing in a seller's name; otherwise the site.
 */
export function vendorFromSender(from: string): string {
  const domain = senderDomain(from);
  const label = siteLabel(domain);
  const tidy = displayOf(from).replace(NOISE_NAME, " ").replace(/[,.\s-]+$/g, "").replace(/\s+/g, " ").trim();
  const usable = tidy.length >= 2 && !/@/.test(tidy);
  const site = label ? label[0].toUpperCase() + label.slice(1) : "";
  if (!usable) return site;
  if (PROCESSORS.has(domain) || FREE_MAIL.has(domain)) return tidy;
  // The display name and the site share a name → it's the company's.
  const words = tidy.split(" ").map(compact).filter((w) => w.length >= 3);
  if (compact(tidy).includes(label) || words.some((w) => label.includes(w))) return tidy;
  return site || tidy;
}

/* ── one vendor, however it's spelled ───────────────────────────────────── */

const HE: Record<string, string> = { ב: "b", ג: "g", ד: "d", ז: "z", ח: "k", ט: "t", כ: "k", ך: "k", ק: "k", ל: "l", מ: "m", ם: "m", נ: "n", ן: "n", ס: "s", ש: "s", פ: "p", ף: "p", צ: "c", ץ: "c", ר: "r", ת: "t" };

/**
 * A name's consonants, the same for its Hebrew and English spelling (Nitsan,
 * 2026-11-07: "Wolt, וולט; BuyMe, באיימי"): "Wolt" and "וולט" → "blt",
 * "BuyMe", "ביימי" and "באיימי" → "bm". Vowels and the letters Hebrew uses
 * for them drop; b/v/w, f/p, c/k/q fold together.
 */
export function skeleton(name: string): string {
  const s = name.toLowerCase().trim();
  let out = "";
  if (/[\u0590-\u05ff]/.test(s)) {
    const w = s.replace(/[^\u05d0-\u05ea]/g, "");
    for (let i = 0; i < w.length; i++) {
      const c = w[i];
      // ו is a vowel inside a word; at the start, or doubled, it's v/w.
      if (c === "ו") {
        if (i === 0 || w[i + 1] === "ו") out += "b";
        if (w[i + 1] === "ו") i++;
        continue;
      }
      out += HE[c] ?? "";
    }
  } else {
    out = s
      .replace(/[^a-z]/g, "")
      .replace(/sh/g, "s")
      .replace(/ch/g, "k")
      .replace(/ph/g, "p")
      .replace(/t[sz]/g, "c")
      .replace(/ck/g, "k")
      .replace(/[cq]/g, "k")
      .replace(/x/g, "ks")
      .replace(/f/g, "p")
      .replace(/[vw]/g, "b")
      .replace(/j/g, "g")
      .replace(/[aeiouyh]/g, "");
  }
  return out.replace(/(.)\1+/g, "$1");
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** The Expenses vendor this name surely is — same letters, or the same name in the other script. */
export function existingVendor(name: string, vendors: string[]): string | null {
  const n = compact(name);
  if (n.length < 2) return null;
  const exact = vendors.find((v) => compact(v) === n);
  if (exact) return exact;
  const k = skeleton(name);
  return k.length >= 3 ? (vendors.find((v) => skeleton(v) === k) ?? null) : null;
}

/**
 * Expenses vendors whose name is close to this one, closest first (Nitsan,
 * 2026-11-07: "suggest similar names so we pick an existing one rather than
 * open a new one by mistake"): the other script, one inside the other, the
 * same first word, or a letter or two apart.
 */
export function similarVendors(name: string, vendors: string[], max = 4): string[] {
  const n = compact(name);
  const k = skeleton(name);
  const first = firstWordOf(name);
  if (n.length < 2) return [];
  const scored: [string, number][] = [];
  for (const v of vendors) {
    const vn = compact(v);
    if (!vn) continue;
    const vk = skeleton(v);
    const vf = firstWordOf(v);
    let score = -1;
    if (vn === n) score = 0;
    else if (k.length >= 2 && vk === k) score = 1;
    else if (Math.min(n.length, vn.length) >= 4 && (vn.includes(n) || n.includes(vn))) score = 2;
    else if ((first.length >= 3 && compact(vf) === compact(first)) || (skeleton(first).length >= 2 && skeleton(vf) === skeleton(first))) score = 3;
    else if (Math.min(n.length, vn.length) >= 4 && editDistance(n, vn) <= (n.length >= 7 ? 2 : 1)) score = 4;
    if (score >= 0) scored.push([v, score]);
  }
  const seen = new Set<string>();
  return scored
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length)
    .map(([v]) => v)
    .filter((v) => (seen.has(canon(v)) ? false : (seen.add(canon(v)), true)))
    .slice(0, max);
}

/**
 * Never suggested: invoicing and payment platforms other businesses send
 * through (the sender isn't the vendor), and the studio's own mail.
 */
const PLATFORMS = /greeninvoice|morning\.co|icount|ezcount|rivhit|invoice4u|tranzila|cardcom|payplus|paypal|studionmore\.com|nmore\.co/i;
/** Money coming IN — the studio was paid, it didn't pay. */
const SELLER_SIDE = /you('ve| have)? (received|got paid)|payment from|new order|you sold|payout|deposit|קיבלת תשלום/i;

/** Is this mail a receipt for something the studio paid? */
export function isPaidReceipt(from: string, subject: string, snippet = ""): boolean {
  if (PLATFORMS.test(from) || SELLER_SIDE.test(subject) || PAYMENT_REQUEST.test(subject)) return false;
  return classify(subject, snippet) === "receipt";
}

/** The Gmail search for receipts from anyone (Expenses vendors are caught by the vendor search too). */
export function receiptQuery(after: Date | null, days: number): string {
  const since = after ? `after:${Math.floor(after.getTime() / 1000)}` : `newer_than:${days}d`;
  return `subject:(receipt OR invoice OR "payment received" OR "payment confirmation" OR "order confirmation" OR "thanks for your purchase" OR "thank you for your purchase" OR "renewal receipt" OR קבלה OR חשבונית OR "אישור תשלום") ${since} -in:chats -in:sent -from:studionmore.com`;
}

/* ── which receipts need a row ──────────────────────────────────────────── */

/** Investment added 2026-11-08 (Nitsan: "no option to add an expense as investment"). */
export type SuggestCategory = "monthly" | "yearly" | "misc" | "investment" | "rent";

export interface Receipt {
  id: string;
  /** the Expenses vendor the scan matched, if any */
  vendor: string | null;
  /** what to call it on a new row */
  suggestedVendor: string;
  /** the From line, for matching it to vendors, clients and freelancers */
  sender: string;
  domain: string;
  date: string;
  subject: string;
  account: string;
  amount: number | null;
  currency: string | null;
  /** read from the receipt (reference/0018); "" = read, none found */
  invoiceNumber?: string | null;
  paidWith?: string | null;
  /** what was bought, as the receipt names it (reference/0020); "" = read, none found */
  itemDescription?: string | null;
  /** where to get the invoice when the email doesn't attach it (reference/0021) */
  invoiceUrl?: string | null;
}

export interface ExpenseLite {
  id: string;
  date: string;
  endDate: string | null;
  category: string;
  vendor: string;
  description: string;
  currency: string;
  gross: number;
  renewMonths: number | null;
  /** predicted / actual / final — a Rent cell still at its plan is filled by the bill */
  state?: string;
}

/**
 * Who the studio deals with, to tell a supplier's receipt from the rest
 * (Nitsan, 2026-11-06): its clients (the tracker's) are paid BY the studio's
 * invoices, its freelancers are on the Freelance page, and some suppliers are
 * on their own Plan line rather than Expenses.
 */
export interface Known {
  /** every Expenses vendor, every category */
  vendors: string[];
  clients: string[];
  freelancers: string[];
  /** a sender (site, or a processor's seller) → the Expenses vendor its receipt became before */
  learned: Record<string, string>;
  /** rent-private.ts `NOT_STUDIO`, set by the server loader: a subject that is never a studio Rent bill */
  notStudio?: RegExp;
}

export interface Suggestion extends Receipt {
  category: SuggestCategory;
  description: string;
  /** monthly/yearly guessed from a row the vendor already has */
  why: string | null;
  /** later monthly receipts of the same vendor the one new row would cover */
  repeats: number;
  /** every mailbox it arrived in — one receipt, however many copies */
  accounts: string[];
  /** for a vendor Expenses doesn't have: its vendors with a close name, to pick instead */
  similar: string[];
  /**
   * The vendor's monthly row ENDED before this receipt (Nitsan, 2026-11-07:
   * Framer's row stopped 31 Jul, a receipt came 17 Aug — "maybe a mistake,
   * maybe real"): flagged on the suggestion and on that row.
   */
  afterEnd?: { expenseId: string; vendor: string; endDate: string } | null;
  /** its saved documents (reference/0019), filled by the loader */
  docs?: DocRef[];
  /** the email in Gmail, filled by the loader */
  mailUrl?: string;
  /** the vendor's billing page (signals BILLING_URLS), filled by the route */
  billingUrl?: string | null;
  /** a Rent tab bill (v1.24.0): its line, the months it covers, and what each cell holds now */
  rentLine?: string;
  rentMonths?: string[];
  rentNow?: (number | null)[];
  /** the bill's total includes VAT, taken off before it goes into the grid */
  rentVat?: boolean;
  /** each month's cell is final on the Rent tab */
  rentFinal?: boolean[];
  /** each month is locked on the Rent tab (Finalize month): the bill's file and number go on its cell, its amount stays — filled by the loader */
  rentLocked?: boolean[];
  /** the bill is behind the supplier's login (water): no file in the email, the amount typed without VAT */
  rentLogin?: { site: string; url: string } | null;
  /** each month's cell (its row id), when it has one */
  rentCells?: (string | null)[];
}

/**
 * A file's name as a Storage path allows it (v1.24.2, 2026-11-09): Supabase
 * Storage refuses any key with a non-ASCII letter ("Invalid key"), so a Hebrew
 * name — Aluel's "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000087.pdf" — failed
 * the upload and the receipt read as having no file. ASCII only, the extension
 * kept; the real name stays in finance_documents.filename for the pages.
 */
export function storageName(name: string, fallback = "document"): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8) : "";
  const base =
    (dot > 0 ? name.slice(0, dot) : name)
      .replace(/[^\w.\- ]+/g, " ")
      .replace(/[\s_]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(-100) || fallback;
  return ext ? `${base}.${ext}` : base;
}

/** A saved document, as the pages list it. */
export interface DocRef {
  id: string;
  filename: string;
  mime: string;
  size: number;
  /** saved from a receipt email by the scan, not uploaded by hand */
  fromMail?: boolean;
  /** the month it's the invoice for, "YYYY-MM" (v1.22.0): its receipt's day, the month it was added under, else when it was saved */
  month?: string;
}

/** A receipt already on Expenses, and the row its files go on (`coveredBy`). */
export interface Attach {
  receiptId: string;
  expenseId: string;
  date: string;
  /** a two-month Rent bill: the other month's cell, which gets a copy of its files (v1.24.0) */
  also?: { expenseId: string; month: string }[];
  /** a Rent bill: its cells keep the bill's link when there's no file (v1.24.4) */
  rent?: boolean;
}

export type SuggestionsOut = Suggestion[] & { cleared?: Partial<Record<Cleared, number>>; attach?: Attach[] };

/** Why a receipt isn't suggested — counted, so the list can say what it cleared. */
export type Cleared = "reply" | "request" | "client" | "freelance" | "plan-line" | "duplicate" | "on-expenses";

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const daysApart = (a: string, b: string) => Math.abs(dayMs(a) - dayMs(b)) / 86_400_000;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.03);
const firstWord = (s: string) => compact(firstWordOf(s));

/** A reply or a forward is a conversation about an invoice, not the invoice. */
const REPLY = /^\s*(re|fwd?|fw|aw|tr|השב|הועבר)\s*:/i;
/** The studio's OWN invoice threads ("Studio&more | July Invoice") and a client's payables desk. */
const STUDIO_INVOICE = /^\s*(studio\s*&?\s*(and\s*)?more|סטודיו)\s*[|/–-]/i;
const PAYING_US = /accounts payable|\bAP team\b|remittance|payment advice|has been (received|approved) by our/i;
/** Suppliers on their own Plan line, not Expenses (finance.ts *_VENDOR_CANON): their invoices aren't rows to add. */
const PLAN_LINE_SITES: Record<string, string> = { "gurg.co.il": GUR_VENDOR_CANON };
/** Client names too common to recognise a sender by. */
const COMMON = new Set(["studio", "first", "prime", "fashion", "waves", "story", "union", "private", "garden"]);

/** Does this name belong to the sender — its site, or its display name? */
function senderIs(name: string, r: Receipt): boolean {
  const n = compact(name);
  if (n.length < 4 || COMMON.has(n)) return false;
  const free = FREE_MAIL.has(r.domain) || PROCESSORS.has(r.domain);
  const label = free ? "" : compact(siteLabel(r.domain));
  const display = compact(displayOf(r.sender));
  if (label && (label === n || (n.length >= 5 && label.includes(n)))) return true;
  if (n.length >= 5 && display.includes(n)) return true;
  // A person's surname alone ("AB Babaei" for Abolfazi Babaei).
  return name
    .split(/\s+/)
    .map(compact)
    .some((w) => w.length >= 5 && (display.includes(w) || (!!label && label.includes(w))));
}

/** The key a sender is learned by: a processor's seller, else the site. */
export const senderKey = (r: Pick<Receipt, "sender" | "domain">) => (PROCESSORS.has(r.domain) ? `${r.domain}:${compact(displayOf(r.sender))}` : r.domain);

/** The Expenses vendor this receipt is from: the scan's match, a learned one, or the sender's name. */
function vendorOf(r: Receipt, known: Known | undefined, match: (from: string, vendors: string[]) => string | null): string | null {
  if (r.vendor) return r.vendor;
  if (!known) return null;
  const named = r.sender ? vendorFromSender(r.sender) : r.suggestedVendor;
  // The same vendor in the other script or another spelling ("וולט" on Expenses, "Wolt" in the mail).
  return known.learned[senderKey(r)] ?? match(r.sender, known.vendors) ?? existingVendor(named, known.vendors) ?? existingVendor(displayOf(r.sender), known.vendors);
}

/**
 * The vendor's row this receipt belongs to (v1.22.0, Nitsan 2026-11-09: "why
 * didn't the Anthropic invoice reach the table?"): the monthly subscription
 * running that day, else a payment of the vendor's within ten days — its own
 * name before its family's ("Claude pro" carries on from "Claude max").
 * A receipt that has one gets its files put on that row, not suggested.
 */
export function coveredBy(r: Receipt, rows: ExpenseLite[]): ExpenseLite | null {
  if (!r.vendor) return null;
  const mine = rows.filter((x) => canon(x.vendor) === canon(r.vendor!));
  const family = firstWord(r.vendor).length >= 4 ? rows.filter((x) => firstWord(x.vendor) === firstWord(r.vendor!)) : mine;
  for (const set of [mine, family]) {
    // A monthly subscription running that day is this receipt — its price is receiptMismatch's business.
    const running = set.filter((x) => x.category === "monthly" && x.date <= r.date && (!x.endDate || x.endDate >= r.date)).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (running) return running;
    // A payment of the vendor's within ten days (a renewal, a one-off, a seat added).
    const near10 = set.filter((x) => x.category !== "monthly" && daysApart(x.date, r.date) <= 10).sort((a, b) => daysApart(a.date, r.date) - daysApart(b.date, r.date))[0];
    if (near10) return near10;
  }
  return null;
}

/** Is there already a row for this receipt? */
export function covered(r: Receipt, rows: ExpenseLite[]): boolean {
  if (coveredBy(r, rows)) return true;
  // The same amount, same currency, within a week — whatever the row calls the vendor (cleared, but no file moved).
  return r.amount != null && rows.some((x) => x.category !== "monthly" && x.currency === r.currency && near(x.gross, r.amount!) && daysApart(x.date, r.date) <= 7);
}

/** Why this receipt isn't one to add, or null if it is. Order matters: a known vendor is never a client. */
export function clearedBecause(r: Receipt, rows: ExpenseLite[], known?: Known): Cleared | null {
  if (REPLY.test(r.subject)) return "reply";
  if (PAYMENT_REQUEST.test(r.subject)) return "request";
  if (PLAN_LINE_SITES[r.domain]) return "plan-line";
  if (!r.vendor) {
    if (STUDIO_INVOICE.test(r.subject) || PAYING_US.test(`${displayOf(r.sender)} ${r.subject}`)) return "client";
    if (known?.clients.some((c) => senderIs(c, r))) return "client";
    if (known?.freelancers.some((f) => senderIs(f, r))) return "freelance";
  }
  return covered(r, rows) ? "on-expenses" : null;
}

/** A receipt put on a row, as `rowFill` reads it. */
export interface FillReceipt {
  date: string;
  invoiceNumber: string | null;
  paidWith: string | null;
  item: string | null;
}

/**
 * What a row's receipts fill in where the row is EMPTY (v1.23.0, Nitsan
 * 2026-11-09: "don't just add the invoice file — add how it's paid, the
 * invoice number, complete the data"): the card from the latest receipt; the
 * invoice number too, except on a Monthly row, whose numbers are one per month
 * (its files table shows them); the description = what the receipts most often
 * say was bought (Anthropic's "Team plan", not its one-off credit). Never a
 * locked (`final`) row, never over what the owner typed.
 */
export function rowFill(
  row: { category: string; state?: string | null; invoiceNumber: string | null; paidWith: string | null; description: string },
  receipts: FillReceipt[],
): { invoice_number?: string; paid_with?: string; description?: string } {
  if (row.state === "final" || !receipts.length) return {};
  const newest = [...receipts].sort((a, b) => b.date.localeCompare(a.date));
  const out: { invoice_number?: string; paid_with?: string; description?: string } = {};
  const card = newest.find((r) => r.paidWith?.trim())?.paidWith?.trim();
  if (!row.paidWith?.trim() && card) out.paid_with = card;
  const invoice = newest.find((r) => r.invoiceNumber?.trim())?.invoiceNumber?.trim();
  if (row.category !== "monthly" && !row.invoiceNumber?.trim() && invoice) out.invoice_number = invoice;
  if (!row.description.trim()) {
    const items = newest.map((r) => cleanItem(r.item ?? "")).filter((i) => i && goodItem(i));
    const count = new Map<string, number>();
    for (const i of items) count.set(i, (count.get(i) ?? 0) + 1);
    // Most often, the newest of equals (Map keeps first-seen order: newest first).
    const best = [...count.entries()].reduce<[string, number] | null>((b, e) => (!b || e[1] > b[1] ? e : b), null);
    if (best) out.description = best[0].slice(0, 120);
  }
  return out;
}

/** One receipt per invoice: the same sender, subject and day (or amount) in two mailboxes is one copy. */
function sameReceipt(a: Receipt, b: Receipt): boolean {
  if (a.domain !== b.domain || daysApart(a.date, b.date) > 2) return false;
  const subj = (s: string) => s.replace(REPLY, "").trim().toLowerCase();
  if (subj(a.subject) === subj(b.subject) && daysApart(a.date, b.date) <= 1) return true;
  return a.amount != null && a.amount === b.amount && a.currency === b.currency && senderKey(a) === senderKey(b);
}

/**
 * The receipts still to add, oldest first, each with a guess at its row, and
 * a count of what was cleared away and why. `match` = classify's matchVendor
 * (passed in so this file stays free of the vendor search).
 */
export function suggestions(
  receipts: Receipt[],
  rows: ExpenseLite[],
  known?: Known,
  match: (from: string, vendors: string[]) => string | null = () => null,
  /** today, "YYYY-MM-DD": a Rent bill for months already past is filed without asking (the loader's clock) */
  today?: string,
): SuggestionsOut {
  const out: SuggestionsOut = [];
  const attach: Attach[] = [];
  const cleared: Partial<Record<Cleared, number>> = {};
  const clear = (why: Cleared) => (cleared[why] = (cleared[why] ?? 0) + 1);
  const kept: Receipt[] = [];
  // The Rent tab's cells and lines (v1.24.0) — kept out of every other check.
  const rentRows = rows.filter((x) => x.category === "rent");
  const rentLines = [...new Set(rentRows.map((x) => x.vendor.trim()))];
  rows = rows.filter((x) => x.category !== "rent");
  const sorted = [...receipts].sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account));
  // A new supplier that bills about monthly (3+ receipts, ~a month apart) is a monthly row, not one line a month.
  const dates = new Map<string, string[]>();
  for (const r of sorted) {
    const k = senderKey(r);
    const ds = dates.get(k) ?? [];
    if (!ds.includes(r.date)) ds.push(r.date);
    dates.set(k, ds);
  }
  const billsMonthly = (k: string) => {
    const ds = dates.get(k) ?? [];
    if (ds.length < 3) return false;
    const gaps = ds.slice(1).map((d, i) => daysApart(ds[i], d)).sort((a, b) => a - b);
    const mid = gaps[Math.floor(gaps.length / 2)];
    return mid >= 25 && mid <= 35;
  };
  for (const raw of sorted) {
    const vendor = vendorOf(raw, known, match);
    // The name is worked out again with today's rules: the company, not the person who wrote.
    const r: Receipt = { ...raw, vendor, suggestedVendor: vendor ?? (raw.sender ? vendorFromSender(raw.sender) : raw.suggestedVendor) };
    const twin = kept.find((k) => sameReceipt(k, r));
    if (twin) {
      clear("duplicate");
      const s = out.find((x) => x.id === twin.id);
      if (s && !s.accounts.includes(r.account)) s.accounts.push(r.account);
      continue;
    }
    kept.push(r);
    // A Rent tab bill (v1.24.0): its line's cell(s), not an Expenses row.
    const rent = REPLY.test(r.subject) || PAYMENT_REQUEST.test(r.subject) ? null : rentLineOf({ domain: r.domain, subject: r.subject, key: senderKey(r) }, rentLines, known?.learned, known?.notStudio);
    if (rent) {
      // A payment confirmation for a login-only bill (Milgam's for Mei Avivim) — the bill came on its own.
      if (isPaymentNotice(rent, r)) {
        clear("duplicate");
        continue;
      }
      const lineCells = rentRows.filter((x) => canon(x.vendor) === canon(rent.line));
      const cellsOf = (m: string) => lineCells.filter((x) => x.date.startsWith(m));
      // The grid holds amounts without VAT: a total with VAT is taken off it first.
      const withVat = rent.vat && (r.currency ?? "ILS") === "ILS";
      // The month the bill names ("לחודש מאי - 2026", read into its item) beats the email's day.
      const guessed = rentMonthsFor(rent, r.date, `${r.subject} ${r.itemDescription ?? ""}`, lineCells);
      let parts = r.amount != null ? splitBill(rentNet(r.amount, withVat, guessed[0]), guessed.length) : null;
      // A period the bill names wins ("לחודש מאי - 2026" — every month holds the same ₪199, so matching by
      // amount would pick the wrong one); else the cells already holding it, wherever the grid booked it
      // (electricity); else the months worked out from the bill.
      const named = !!billPeriod(rent, `${r.subject} ${r.itemDescription ?? ""}`);
      let months = named ? guessed : (parts && monthsHolding(lineCells, parts, r.date)) || guessed;
      // Several months paid at once on a one-month line (₪597 = 3 × ₪199, ending at the month it names).
      const several = rent.months === 1 && r.amount != null ? monthsPaid(rentNet(r.amount, withVat, months[0]), lineCells, months[0]) : null;
      if (several) {
        months = several;
        parts = splitBill(rentNet(r.amount!, withVat, months[0]), months.length);
      }
      const cells = months.map((m) => cellsOf(m)[0] ?? null);
      // Already there: every month holds its share, and not as a plan — the files go on the cells. Or no amount
      // in the email for months the grid has already booked: nothing to ask (Nitsan, 2026-11-09: "for past
      // months don't send me to bring files — it's not a must") — the bill's link and files go on the cells.
      // Booked = a cell that isn't a plan, in a month already past — this month and later may still change
      // (Nov–Dec's arnona was typed in as ₪3,500 before its ₪7,062.50 slip came).
      const booked = cells.every((c) => c && c.state !== "predicted");
      const past = !today || months.every((m) => m < today.slice(0, 7));
      // …unless those cells still hold the plan's figure — the amount the line's planned months carry
      // (2026-11-09: water's Aug–Sep were final at the planned ₪80 each; the bill was ₪113.60 for both).
      const plan = lineCells.filter((c) => c.state === "predicted").sort((a, b) => b.date.localeCompare(a.date))[0]?.gross;
      const stillPlan = plan != null && cells.every((c) => c && Math.abs(c.gross - plan) < 0.01);
      if (booked && (parts ? cells.every((c, i) => Math.abs(c!.gross - parts[i]) <= 1) : past && !stillPlan)) {
        clear("on-expenses");
        attach.push({ receiptId: r.id, expenseId: cells[0]!.id, date: r.date, also: cells.slice(1).map((c, i) => ({ expenseId: c!.id, month: months[i + 1] })), rent: true });
        continue;
      }
      const line = cells.find(Boolean)?.vendor.trim() ?? lineCells[0]?.vendor.trim() ?? rent.line;
      const what = months.length > 1 ? `${months.length} months` : "its month";
      out.push({
        ...r,
        category: "rent",
        description: "",
        why: `A ${line} bill — fills ${what} on the Rent tab`,
        repeats: 0,
        accounts: [r.account],
        similar: [],
        afterEnd: null,
        rentLine: line,
        rentMonths: months,
        rentNow: cells.map((c) => (c ? c.gross : null)),
        rentVat: withVat,
        rentFinal: cells.map((c) => c?.state === "final"),
        rentLogin: rent.loginOnly ?? null,
        rentCells: cells.map((c) => c?.id ?? null),
      });
      continue;
    }
    const gone = clearedBecause(r, rows, known);
    if (gone) {
      clear(gone);
      const row = gone === "on-expenses" ? coveredBy(r, rows) : null;
      if (row) attach.push({ receiptId: r.id, expenseId: row.id, date: r.date });
      continue;
    }
    const mine = r.vendor ? rows.filter((x) => canon(x.vendor) === canon(r.vendor!)).sort((a, b) => a.date.localeCompare(b.date)) : [];
    const monthly = mine.filter((x) => x.category === "monthly").pop();
    const yearly = mine.filter((x) => x.category === "yearly").pop();
    // A yearly row whose anniversary is this receipt's month → its renewal — unless the
    // charge is far too small to be one (Figma's seat top-ups beside its yearly plan).
    const small = r.amount != null && yearly != null && (r.currency === yearly.currency ? r.amount < yearly.gross * 0.5 : r.amount < 100);
    // Within 31 days of it either side: a renewal charged a few days early is 362 days on (2026-11-09).
    const offYear = Math.abs((dayMs(r.date) - dayMs(yearly?.date ?? r.date)) / 86_400_000) % 365;
    const anniversary = yearly && !small && Math.min(offYear, 365 - offYear) <= 31;
    let category: SuggestCategory = "misc";
    let why: string | null = null;
    let description = "";
    let afterEnd: Suggestion["afterEnd"] = null;
    if (monthly && (!yearly || !anniversary)) {
      category = "monthly";
      description = monthly.description;
      // Recently ended only: a charge long after (Figma's row ended 2024) is a new product, not a slip.
      if (monthly.endDate && monthly.endDate < r.date && daysApart(monthly.endDate, r.date) <= 92) afterEnd = { expenseId: monthly.id, vendor: monthly.vendor, endDate: monthly.endDate };
    } else if (yearly && anniversary) {
      category = "yearly";
      description = yearly.description;
      why = "On its yearly renewal date";
    } else if (/\bmonthly\b|per month|\/mo\b|חודשי/i.test(r.subject) || (!r.vendor && billsMonthly(senderKey(r)))) category = "monthly";
    else if (/\b(annual|yearly)\b|\/yr\b|שנתי/i.test(r.subject)) category = "yearly";
    // A one-off from a vendor whose last one-off was an Investment (a hardware shop) → Investment again.
    else if (mine.filter((x) => x.category === "misc" || x.category === "investment").pop()?.category === "investment") {
      category = "investment";
      why = "Like this vendor's earlier rows";
    }
    // A monthly receipt already suggested for this vendor: one new row covers them all.
    const first = category === "monthly" ? out.find((s) => s.category === "monthly" && canon(s.suggestedVendor) === canon(r.suggestedVendor)) : null;
    if (first) {
      first.repeats++;
      continue;
    }
    // What the receipt says was bought beats the vendor's usual line (Nitsan, 2026-11-07).
    if (r.itemDescription) description = r.itemDescription;
    const similar = r.vendor || !known ? [] : similarVendors(r.suggestedVendor, known.vendors);
    out.push({ ...r, category, description, why, repeats: 0, accounts: [r.account], similar, afterEnd });
  }
  out.cleared = cleared;
  out.attach = attach;
  return out;
}
