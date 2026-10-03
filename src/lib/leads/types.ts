// Leads — the sales pipeline's shapes.
//
// ⚠️ LIKE CANDIDATES, THIS DOMAIN DOES NOT LIVE IN `src/lib/store/`. Read
// `src/lib/candidates/types.ts` for the full argument; the short of it is that
// the store boots the whole studio on every page load for every designer, and
// this data is admin-only (0042) and read on a handful of admin routes. Egress
// is this project's tightest constraint. Pages fetch what they show.

export type LeadStageKind = "open" | "won" | "lost";
export type LeadSource = "cold" | "linkedin" | "website" | "referral" | "past_client";
export type Currency = "ILS" | "USD";
export type OfferStatus = "draft" | "in_review" | "sent" | "accepted" | "declined";
export type LeadEventKind =
  | "created"
  | "call"
  | "meeting"
  | "note"
  | "stage_change"
  | "offer"
  | "won"
  | "lost"
  | "reopened"
  | "email";

export const SOURCES: { value: LeadSource; label: string }[] = [
  { value: "website", label: "Website form" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "cold", label: "Cold outreach" },
  { value: "referral", label: "Referral" },
  { value: "past_client", label: "Past client" },
];

export const sourceLabel = (s: LeadSource | null): string =>
  SOURCES.find((x) => x.value === s)?.label ?? "—";

export const OFFER_STATUSES: { value: OfferStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
];

/** The activity a person LOGS. The rest of `LeadEventKind` is written by the app. */
export const LOGGABLE: { value: LeadEventKind; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
  { value: "note", label: "Note" },
];

export interface LeadStage {
  id: string;
  name: string;
  position: number;
  /**
   * ⚠️ WON/LOST BEHAVIOUR KEYS OFF THIS, NEVER OFF THE NAME. Renaming "Won" to
   * "Signed" in Settings must not stop the win modal opening.
   */
  kind: LeadStageKind;
  /** Business days of silence before the Stalled flag; null = never. */
  stallDays: number | null;
  /**
   * Which built-in rule stage this is (0044) — how the suggestion rules find
   * "Offer sent" after somebody renames it. Null for stages added later.
   */
  ruleKey: StageRuleKey | null;
  /** 0046 — a hex colour and a STAGE_ICONS key (src/lib/leads/look.tsx); null = neutral dot. */
  color: string | null;
  icon: string | null;
}

export type StageRuleKey = "relevant" | "discovery" | "offer_prep" | "offer_sent" | "negotiation";

export type SuggestionRule = "offer_sent" | "client_replied" | "meeting_booked" | "offer_accepted" | "offer_declined";

export interface LeadSuggestion {
  id: string;
  leadId: string;
  rule: SuggestionRule;
  toStageId: string;
  reason: string;
  createdAt: string;
}

export interface LostReason {
  id: string;
  name: string;
  position: number;
}

export interface Lead {
  id: string;
  company: string;
  website: string | null;
  domain: string | null;
  source: LeadSource | null;
  stageId: string | null;
  ownerId: string | null;
  estValue: number | null;
  currency: Currency;
  askedFor: string | null;
  nextStep: string | null;
  nextStepDue: string | null;
  lostReasonId: string | null;
  lostNote: string | null;
  sheetRef: string | null;
  clientId: string | null;
  sectionId: string | null;
  wonAt: string | null;
  stageChangedAt: string;
  lastActivityAt: string;
  createdAt: string;
  /** The first contact's name, rolled up by the board query for the card. */
  primaryContact: string | null;
  /** When the mailbox was last searched for this lead (0043). */
  gmailBackfilledAt: string | null;
  /**
   * The oldest unanswered inbound email on this lead, if the studio owes a
   * reply on any of its threads — rolled up by `loadBoard` for the Today list.
   */
  replyOwedSince: string | null;
  /** When it was deleted, while it waits out its Undo window (0047); null for a live lead. */
  deletedAt: string | null;
}

export interface LeadContact {
  id: string;
  leadId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  persona: string | null;
  pastConnection: string | null;
  position: number;
}

export interface LeadOffer {
  id: string;
  leadId: string;
  version: number;
  amount: number | null;
  currency: Currency;
  scopeSummary: string | null;
  storagePath: string | null;
  fileName: string | null;
  status: OfferStatus;
  sentAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface LeadThread {
  id: string;
  leadId: string;
  gmailThreadId: string | null;
  url: string;
  subject: string | null;
  note: string | null;
  createdAt: string;
  /** Filled by the Gmail sync (0043); empty on a thread linked by hand before it. */
  participants: string[];
  lastMessageAt: string | null;
  /** "us" = the last message came from outside, so the studio owes the reply. */
  replyOwedBy: "us" | "them" | null;
  messageCount: number;
  digest: string | null;
  matchedBy: "manual" | "thread" | "email" | "domain" | null;
}

export interface LeadMessage {
  id: string;
  threadId: string;
  fromAddr: string | null;
  fromName: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  subject: string | null;
  sentAt: string | null;
  fromUs: boolean;
  bodyText: string | null;
}

export interface LeadEvent {
  id: string;
  leadId: string;
  kind: LeadEventKind;
  body: string | null;
  meta: Record<string, unknown> | null;
  actorId: string | null;
  at: string;
}

export interface LeadDetail {
  lead: Lead;
  /** Pending stage suggestions (0044), newest first. */
  suggestions: LeadSuggestion[];
  contacts: LeadContact[];
  offers: LeadOffer[];
  threads: LeadThread[];
  events: LeadEvent[];
}

export interface ClientContact {
  id: string;
  clientId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  notes: string | null;
  position: number;
}

/** What a new lead is called between "Add lead" and typing the company. */
export const NEW_LEAD_NAME = "New lead";
/** One-shot query flag: the lead page focuses and selects the company name. */
export const NEW_LEAD_PARAM = "new";

/**
 * The bare domain a company is matched on — lower-cased, no scheme, no `www.`,
 * no path. Returns null for anything that does not look like a host.
 *
 * ⚠️ PERSONAL MAIL DOMAINS RETURN NULL. Phase 2 attaches Gmail threads to a
 * lead by domain, and a lead whose "domain" is gmail.com would collect every
 * thread from every person on Gmail. The PRD's rule, enforced at the source.
 */
export function domainOf(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#:]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  if (PERSONAL_DOMAINS.has(s)) return null;
  return s;
}

export const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "walla.co.il",
  "walla.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
]);

/**
 * The Gmail thread id inside a pasted Gmail address, or null.
 *
 * Gmail's web URLs end in the thread's id after the folder — `…#inbox/FMfcg…`
 * or `…#all/18c2…`. The newer `FMfcg` ids are not the API's thread id, so this
 * is a best effort: Phase 2 resolves the real id when it reads the mailbox, and
 * the stored URL is what the page links to either way.
 */
export function gmailThreadIdFromUrl(url: string): string | null {
  const m = url.match(/mail\.google\.com\/mail\/[^#]*#[^/]+\/(?:[^/]+\/)?([A-Za-z0-9]{12,})\s*$/);
  return m ? m[1] : null;
}
