// Reading an applicant's email — a saved `.eml` — into the facts a candidate
// card holds: who they are, how to reach them, what they wrote, and which of
// the attachments is the CV.
//
// ⚠️ PURE AND RULE-BASED, ON PURPOSE. Nitsan chose this over sending the mail
// to Claude (2026-10-25: no API credits for it). So every guess below is a
// pattern, and each one is shaped to leave a field EMPTY rather than fill it
// wrongly — an empty phone is one click to fill in, a stranger's phone number
// on the card is a call to the wrong person.
//
// No IO here: the browser side (`import-email.ts`) parses the MIME and does the
// writes, and this file only decides. That is what lets it be tested.

import type { CandidateLinkKind } from "./types";

/** The parts of a parsed message this file reads — postal-mime's shape. */
export interface ParsedMailbox {
  name: string;
  address: string;
}

export interface ParsedEmail {
  from?: ParsedMailbox | null;
  replyTo?: ParsedMailbox[] | null;
  subject?: string | null;
  date?: string | null;
  text?: string | null;
  html?: string | null;
}

/**
 * The studio's own mailboxes. Mail FROM one of these is somebody here
 * forwarding an application, so the applicant is inside the body instead.
 */
const STUDIO_DOMAINS = ["studionmore.com", "nmore.co"];

const isStudio = (address: string) =>
  STUDIO_DOMAINS.some((d) => address.toLowerCase().endsWith(`@${d}`));

/** Robots that send mail on somebody's behalf — the person is in Reply-To. */
const NO_REPLY = /^(no-?reply|do-?not-?reply|notifications?|jobs-noreply|mailer)/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** "Dana Levi <dana@x.com>", "dana@x.com", "Dana Levi" + a bare address. */
function mailboxOf(raw: string): ParsedMailbox | null {
  const address = raw.match(EMAIL_RE)?.[0];
  if (!address) return null;
  const name = raw
    .replace(/<[^>]*>/g, "")
    .replace(address, "")
    .replace(/["'[\]]/g, "")
    .trim();
  return { name, address };
}

/**
 * Gmail's and Outlook's forward headers, in English and Hebrew. Only the FIRST
 * one counts — a forward of a forward still names the applicant in the
 * innermost block, but by then it is the studio talking to itself and the
 * outermost non-studio sender is the right answer anyway.
 */
function forwardedSender(body: string): ParsedMailbox | null {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^[\s>*]*(?:From|מאת)\s*:\s*\**\s*(.+)$/i);
    if (!m) continue;
    const box = mailboxOf(m[1]);
    if (box && !isStudio(box.address)) return box;
  }
  return null;
}

/** "dana.levi87" → "Dana Levi". Only used when the mail carries no name at all. */
function nameFromAddress(address: string): string {
  const local = address.split("@")[0].replace(/\d+/g, "");
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Who applied.
 *
 * ⚠️ `null` WHEN IT CAN'T TELL — a studio forward with no forward header in
 * it. The caller then uses the "New candidate" placeholder the Add button
 * already uses, rather than putting Nitsan's own name on an applicant.
 */
export function pickApplicant(
  mail: ParsedEmail,
  body: string,
): { name: string; email: string } | null {
  let box = mail.from ?? null;
  if (box && NO_REPLY.test(box.address)) {
    box = (mail.replyTo ?? []).find((r) => !isStudio(r.address)) ?? null;
  }
  if (!box || isStudio(box.address)) box = forwardedSender(body);
  if (!box) return null;
  const name = box.name.trim() || nameFromAddress(box.address);
  return { name: name || box.address, email: box.address.toLowerCase() };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Enough HTML → text for an email body; it is shown verbatim, not rendered. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) =>
      label.includes(href) || !/^https?:/i.test(href) ? label : `${label} (${href})`,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The application as written. Plain text when the mail has it. */
export function bodyOf(mail: ParsedEmail): string {
  const text = mail.text?.trim();
  if (text) return text.replace(/\r\n/g, "\n");
  return mail.html ? htmlToText(mail.html) : "";
}

/** The longest application text kept; a CV pasted inline can run long. */
export const MAX_APPLICATION_CHARS = 20_000;

/**
 * A phone number, Israeli or international.
 *
 * ⚠️ ONLY NUMBERS THAT START WITH `+` OR `0`, and 9–13 digits. That one rule is
 * what keeps "2019 – 2023", a postcode or an ID out of the phone field — a CV
 * is full of digit runs, and every phone a person writes down starts one of
 * those two ways.
 */
export function extractPhone(text: string): string | null {
  const re = /(?:^|[^\d+])((?:\+|\(?0)[\d\s().-]{7,20}\d)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 13) continue;
    if (/\d{4}\s*[-–]\s*\d{4}/.test(raw) && !raw.startsWith("+")) continue;
    return raw.replace(/\s{2,}/g, " ");
  }
  return null;
}

export function extractEmail(text: string): string | null {
  for (const m of text.matchAll(new RegExp(EMAIL_RE.source, "g"))) {
    if (!isStudio(m[0])) return m[0].toLowerCase();
  }
  return null;
}

/**
 * Hosts that are never the applicant's own work: mail plumbing, trackers, the
 * studio itself, and the job boards' own pages (a LinkedIn notification is
 * mostly links back into LinkedIn).
 */
const JUNK_HOST =
  /(^|\.)(studionmore\.com|nmore\.co|google\.com|gstatic\.com|googleusercontent\.com|outlook\.com|office\.com|microsoft\.com|aka\.ms|apple\.com|w3\.org|list-manage\.com|mailchimp\.com|sendgrid\.net|mandrillapp\.com|hubspot\.com|facebook\.com|twitter\.com|x\.com|wix\.com|calendly\.com)$/i;

const PORTFOLIO_HOSTS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/i, "LinkedIn"],
  [/(^|\.)behance\.net$/i, "Behance"],
  [/(^|\.)dribbble\.com$/i, "Dribbble"],
  [/(^|\.)instagram\.com$/i, "Instagram"],
  [/(^|\.)vimeo\.com$/i, "Vimeo"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i, "YouTube"],
  [/(^|\.)github\.com$/i, "GitHub"],
  [/(^|\.)figma\.com$/i, "Figma"],
];

export interface FoundLink {
  url: string;
  title: string;
  kind: CandidateLinkKind;
}

/**
 * One link, judged: kept with a title and a kind, or `null` for noise.
 *
 * ⚠️ LinkedIn is kept ONLY as a profile (`/in/…`). Everything else on that
 * domain in an application mail is the platform talking about itself.
 */
export function judgeLink(raw: string): FoundLink | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (!host.includes(".") || JUNK_HOST.test(host)) return null;
  if (/\.(png|jpe?g|gif|svg|webp|ico|css|js)$/i.test(url.pathname)) return null;
  if (/unsubscribe|track|click|utm_|redirect/i.test(url.pathname + url.search) && !/(^|\.)(behance|dribbble)/.test(host)) {
    return null;
  }
  const known = PORTFOLIO_HOSTS.find(([re]) => re.test(host));
  if (known?.[1] === "LinkedIn" && !/^\/in\/[^/]+/.test(url.pathname)) return null;
  // Tidy, so the same link written two ways dedupes to one.
  url.hash = "";
  const clean = url.toString().replace(/\/$/, "");
  return {
    url: clean,
    title: known?.[1] ?? host,
    kind: "portfolio",
  };
}

/**
 * Every link worth keeping, in the order first seen, once each.
 *
 * Bare `www.x.com` and `behance.net/x` count too: a CV's text layer usually
 * carries the address as written, not as a hyperlink.
 */
export function extractLinks(texts: string[]): FoundLink[] {
  const re =
    /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+|\b(?:linkedin\.com\/in|behance\.net|dribbble\.com|instagram\.com)\/[^\s<>"')\]]+/gi;
  const seen = new Set<string>();
  const out: FoundLink[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(re)) {
      const link = judgeLink(m[0].replace(/[.,;:!?]+$/, ""));
      if (!link) continue;
      const key = link.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}

export interface DocumentLink {
  /** As written in the mail — kept on the card so the original stays reachable. */
  url: string;
  /** Where the bytes actually come from (a share page is not the file). */
  fetchUrl: string;
  title: string;
}

/**
 * A link that is probably a CV sent as a link instead of an attachment:
 * Google Drive / Docs, Dropbox, OneDrive, or anything ending `.pdf`.
 *
 * ⚠️ RUN ON THE RAW TEXT, BEFORE `judgeLink`, which drops google.com as
 * plumbing — and a Drive link is the commonest way a CV arrives as a link.
 *
 * Only works for files shared "anyone with the link": the server fetching it
 * is signed in to nobody's Google account. A private file comes back as a
 * sign-in page, which the fetch rejects for not being a PDF.
 */
export function documentLink(raw: string): DocumentLink | null {
  let u: URL;
  try {
    u = new URL(raw.replace(/[.,;:!?)\]]+$/, ""));
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const url = u.toString();

  if (host === "drive.google.com") {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get("id");
    if (!id) return null;
    return { url, fetchUrl: `https://drive.google.com/uc?export=download&id=${id}`, title: "Google Drive" };
  }
  if (host === "docs.google.com") {
    const m = u.pathname.match(/\/(document|presentation)\/d\/([\w-]+)/);
    if (!m) return null;
    return {
      url,
      fetchUrl: `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=pdf`,
      title: "Google Docs",
    };
  }
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    if (!/\/(s|scl\/fi)\//.test(u.pathname)) return null;
    const f = new URL(url);
    f.searchParams.set("dl", "1");
    return { url, fetchUrl: f.toString(), title: "Dropbox" };
  }
  if (host === "1drv.ms" || host.endsWith("onedrive.live.com") || host.endsWith("sharepoint.com")) {
    const f = new URL(url);
    f.searchParams.set("download", "1");
    return { url, fetchUrl: f.toString(), title: "OneDrive" };
  }
  if (/\.pdf$/i.test(u.pathname)) {
    const name = decodeURIComponent(u.pathname.split("/").pop() ?? "");
    return { url, fetchUrl: url, title: name || host };
  }
  return null;
}

/** Every document link in the texts, once each, at most `max` of them. */
export function documentLinks(texts: string[], max = 3): DocumentLink[] {
  const seen = new Set<string>();
  const out: DocumentLink[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(/\bhttps:\/\/[^\s<>"')\]]+/gi)) {
      const d = documentLink(m[0]);
      if (!d || seen.has(d.fetchUrl)) continue;
      seen.add(d.fetchUrl);
      out.push(d);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Where they came from, in the dossier's own vocabulary (`SOURCES`). */
export function sourceOf(mail: ParsedEmail, body: string): "LinkedIn" | "Email" {
  const from = mail.from?.address ?? "";
  if (/linkedin\.com$/i.test(from) || /via LinkedIn|LinkedIn Job/i.test(`${mail.subject ?? ""}\n${body.slice(0, 500)}`)) {
    return "LinkedIn";
  }
  return "Email";
}

/** The day they sent it, as the browser's own date — the studio is in Israel. */
export function appliedOnOf(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  inline: boolean;
}

const CV_NAME = /\b(cv|resume|résumé)\b|קורות|curriculum/i;
const PORTFOLIO_NAME = /portfolio|תיק\s*עבודות|showreel|reel/i;
const DOC_EXT = /\.(pdf|docx?|pages|rtf)$/i;

/**
 * Which attachments to keep, and as what.
 *
 * ⚠️ INLINE IMAGES ARE DROPPED — they are signature logos and social icons,
 * and a new candidate opening with four copies of the Gmail logo under Files
 * is the kind of noise that teaches people to stop importing.
 *
 * ⚠️ EXACTLY ONE CV: a file named like one wins; otherwise the first document
 * that isn't named like a portfolio. Everything else is "other".
 */
export function planAttachments(atts: AttachmentInfo[]): { index: number; kind: CandidateLinkKind }[] {
  const kept = atts
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => !(a.inline && a.mimeType.startsWith("image/")));
  const kinds = new Map<number, CandidateLinkKind>();
  for (const { a, index } of kept) {
    if (PORTFOLIO_NAME.test(a.filename)) kinds.set(index, "portfolio");
  }
  const named = kept.find(({ a, index }) => !kinds.has(index) && CV_NAME.test(a.filename));
  const fallback = kept.find(({ a, index }) => !kinds.has(index) && DOC_EXT.test(a.filename));
  const cv = named ?? fallback;
  if (cv) kinds.set(cv.index, "cv");
  return kept.map(({ index }) => ({ index, kind: kinds.get(index) ?? "other" }));
}

/** A filename for an attachment that came without one. */
export function attachmentName(filename: string | null, mimeType: string, i: number): string {
  if (filename?.trim()) return filename.trim();
  const ext =
    mimeType === "application/pdf"
      ? "pdf"
      : mimeType.startsWith("image/")
        ? mimeType.slice(6).replace("jpeg", "jpg")
        : "bin";
  return `attachment-${i + 1}.${ext}`;
}
