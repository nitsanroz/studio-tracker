// Reading Gmail's JSON into the shapes Leads stores — pure, so it is tested.
//
// Nothing here talks to Google or the database. `sync.ts` does that and hands
// the raw API objects to these functions.

import { PERSONAL_DOMAINS } from "../leads/types";

/** The studio's own mail domains. Mail FROM these is "us". */
export const STUDIO_DOMAINS = new Set(["studionmore.com", "nmore.co"]);

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface Address {
  email: string;
  name: string | null;
}

export function header(msg: GmailMessage, name: string): string | null {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

/**
 * `"Dana Cohen" <dana@x.com>, bob@y.com` → two addresses.
 *
 * ⚠️ SPLIT ON COMMAS OUTSIDE QUOTES ONLY. A display name like "Cohen, Dana" is
 * one person, and a naive split makes "Cohen" an address-less recipient and
 * "Dana" <dana@x.com> a second one.
 */
export function parseAddresses(value: string | null): Address[] {
  if (!value) return [];
  const out: Address[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  const flush = () => {
    const s = cur.trim();
    cur = "";
    if (!s) return;
    const m = /^(.*?)<([^>]+)>\s*$/.exec(s);
    const email = (m ? m[2] : s).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const name = m ? m[1].trim().replace(/^"|"$/g, "").trim() || null : null;
    out.push({ email, name });
  };
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angle = true;
    else if (ch === ">") angle = false;
    if (ch === "," && !quoted && !angle) flush();
    else cur += ch;
  }
  flush();
  return out;
}

export const domainOfEmail = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

export function isStudio(email: string, ownAddresses: Set<string>): boolean {
  return ownAddresses.has(email.toLowerCase()) || STUDIO_DOMAINS.has(domainOfEmail(email));
}

/** base64url → UTF-8 text. */
export function decodeBody(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The readable text of a message: its text/plain part, else its HTML stripped.
 *
 * ⚠️ ATTACHMENTS ARE NEVER READ — a part with a filename or an attachmentId is
 * skipped outright (the PRD's privacy rule), even when it is a .txt.
 */
export function extractText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.filename || p.body?.attachmentId) return;
    if (p.body?.data) {
      if (p.mimeType === "text/plain") plain.push(decodeBody(p.body.data));
      else if (p.mimeType === "text/html") html.push(decodeBody(p.body.data));
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  if (plain.length) return plain.join("\n").trim();
  return htmlToText(html.join("\n")).trim();
}

/**
 * Cut the quoted history off a reply, so a ten-message thread doesn't store
 * the first message ten times.
 *
 * ⚠️ CONSERVATIVE: it cuts only at a line that is unmistakably a quote header
 * (Gmail's English and Hebrew "On … wrote:", Outlook's "-----Original
 * Message-----" / "From: … Sent:"), and never when that would leave nothing —
 * a reply that is only a forward keeps its forwarded text.
 */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex(
    (l, i) =>
      i > 0 &&
      (/^\s*On .{4,200} wrote:\s*$/.test(l) ||
        /^\s*בתאריך .{4,200} (נכתב|כתב|כתבה)\s*:?\s*$/.test(l) ||
        /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(l) ||
        (/^\s*From:\s/.test(l) && /^\s*(Sent|Date):\s/.test(lines[i + 1] ?? ""))),
  );
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).join("\n").trim();
  return kept || text.trim();
}

export const MAX_BODY = 20_000;

export interface ParsedMessage {
  gmailId: string;
  rfcId: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  subject: string | null;
  sentAt: string;
  fromUs: boolean;
  body: string;
  snippet: string | null;
  /** A calendar invite or an accept/decline notice — never decides who owes a reply. */
  isCalendar: boolean;
}

/** Gmail's `snippet` is HTML-escaped ("Studio &amp;more"). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * ⚠️ A CALENDAR INVITE IS NOT A MESSAGE ANYBODY ANSWERS. Found on the first
 * real sync: a Zoom invitation from the client put "We owe a reply" on a thread
 * whose last real exchange was the studio's. Detected by a text/calendar part
 * (what every calendar sends) or Google's subject prefixes as a fallback.
 */
export function isCalendarMessage(msg: GmailMessage): boolean {
  let cal = false;
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (/^(text\/calendar|application\/ics)/i.test(p.mimeType ?? "")) cal = true;
    for (const c of p.parts ?? []) walk(c);
  };
  walk(msg.payload);
  const subject = header(msg, "Subject") ?? "";
  return cal || /^(updated invitation|invitation|accepted|declined|tentatively accepted|canceled event|cancelled event)( \(.*?\))?:/i.test(subject);
}

/** Drafts, spam, trash and chats are not conversation. */
export function isRealMail(msg: GmailMessage): boolean {
  const l = new Set(msg.labelIds ?? []);
  return !l.has("DRAFT") && !l.has("SPAM") && !l.has("TRASH") && !l.has("CHAT");
}

export function parseMessage(msg: GmailMessage, ownAddresses: Set<string>): ParsedMessage {
  const from = parseAddresses(header(msg, "From"))[0] ?? null;
  const date = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(header(msg, "Date") ?? Date.now());
  const rfc = (header(msg, "Message-ID") ?? header(msg, "Message-Id") ?? "").trim();
  return {
    gmailId: msg.id,
    // ⚠️ A message with no Message-ID (rare, but some tools send them) is keyed
    // on its Gmail id — it cannot be deduped across mailboxes, but it can still
    // be stored once per mailbox rather than refused.
    rfcId: rfc || `gmail:${msg.id}`,
    from,
    to: parseAddresses(header(msg, "To")),
    cc: parseAddresses(header(msg, "Cc")),
    subject: header(msg, "Subject"),
    sentAt: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
    fromUs: from ? isStudio(from.email, ownAddresses) : false,
    body: stripQuoted(extractText(msg.payload)).slice(0, MAX_BODY),
    snippet: msg.snippet ? decodeEntities(msg.snippet).slice(0, 300) : null,
    isCalendar: isCalendarMessage(msg),
  };
}

/** Everybody on the thread who is NOT the studio — the people a lead is matched on. */
export function externalParticipants(messages: ParsedMessage[], ownAddresses: Set<string>): string[] {
  const set = new Set<string>();
  for (const m of messages) {
    for (const a of [m.from, ...m.to, ...m.cc]) {
      if (a && !isStudio(a.email, ownAddresses)) set.add(a.email);
    }
  }
  return [...set];
}

/**
 * Who owes the next reply: whoever did NOT send the last real message.
 * Calendar traffic is skipped; a thread of nothing but invites owes nobody.
 */
export function replyOwedBy(messages: ParsedMessage[]): "us" | "them" | null {
  const last = messages.filter((m) => !m.isCalendar).sort((a, b) => a.sentAt.localeCompare(b.sentAt)).at(-1);
  if (!last) return null;
  return last.fromUs ? "them" : "us";
}

// ── matching a thread to a lead ─────────────────────────────────────────────

export interface MatchCandidate {
  leadId: string;
  /** Lower-cased contact emails on the lead. */
  emails: string[];
  domain: string | null;
  open: boolean;
  lastActivityAt: string;
}

/**
 * Which lead a thread belongs to, from its external participants — the PRD's
 * order after "thread id already stored", which the caller checks first:
 *
 *   1. a participant's email is a contact on the lead;
 *   2. a participant's domain is the lead's company domain — NEVER for a
 *      personal domain (gmail.com …), or one lead would collect every Gmail
 *      user's mail;
 *   3. otherwise nothing.
 *
 * ⚠️ Several leads can match (a returning client has an old lost lead and a
 * new open one). OPEN WINS, then the most recently active — a new message
 * belongs to the deal being worked, not to the archive.
 *
 * `ignored` holds the lead ids this thread was unlinked from by hand.
 */
export function matchLead(
  participants: string[],
  candidates: MatchCandidate[],
  ignored: Set<string> = new Set(),
): { leadId: string; by: "email" | "domain" } | null {
  const pick = (list: MatchCandidate[]) =>
    [...list].sort(
      (a, b) => Number(b.open) - Number(a.open) || b.lastActivityAt.localeCompare(a.lastActivityAt),
    )[0];
  const usable = candidates.filter((c) => !ignored.has(c.leadId));
  const emails = new Set(participants.map((p) => p.toLowerCase()));
  const byEmail = usable.filter((c) => c.emails.some((e) => emails.has(e)));
  if (byEmail.length) return { leadId: pick(byEmail).leadId, by: "email" };
  const domains = new Set(
    [...emails].map(domainOfEmail).filter((d) => !PERSONAL_DOMAINS.has(d) && !STUDIO_DOMAINS.has(d)),
  );
  const byDomain = usable.filter((c) => c.domain && domains.has(c.domain));
  if (byDomain.length) return { leadId: pick(byDomain).leadId, by: "domain" };
  return null;
}

/** A Gmail web link that opens the thread in the right account. */
export function threadUrl(accountEmail: string, threadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${threadId}`;
}
