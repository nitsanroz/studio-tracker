"use client";

// Every read the Leads section makes. See ./types.ts for why none of this is in
// the global store.
//
// ⚠️ TWO SHAPES, AS WITH CANDIDATES: `loadBoard` reads the columns of the list
// plus each lead's first contact name, and `loadLead` reads everything about
// one lead. The board never drags offers, threads or the activity log along.

import { createClient } from "../supabase/client";
import { MISSING_SCHEMA_CODES } from "../db";
import type { StoredRate } from "./fx";
import { mapStage } from "./stage-map";
import type {
  ClientContact,
  Currency,
  Lead,
  LeadContact,
  LeadDetail,
  LeadEvent,
  LeadEventKind,
  LeadMessage,
  LeadOffer,
  LeadSource,
  LeadStage,
  LeadSuggestion,
  LeadThread,
  SuggestionRule,
  LostReason,
  OfferStatus,
} from "./types";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nstr = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
/** numeric(12,2) arrives from PostgREST as a NUMBER or a STRING depending on size. */
const nnum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const currency = (v: unknown): Currency => (v === "USD" ? "USD" : "ILS");

/**
 * ⚠️ A FRIENDLIER ERROR FOR THE ONE FAILURE EVERYBODY HITS FIRST. Until 0042 is
 * run in the SQL editor every read here fails with "relation does not exist",
 * which reads like the app is broken rather than waiting on a migration.
 */
export class LeadsNotInstalled extends Error {
  constructor() {
    super("The Leads tables aren't in the database yet — run migration 0042 in the Supabase SQL editor.");
    this.name = "LeadsNotInstalled";
  }
}

function check(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (MISSING_SCHEMA_CODES.has(error.code ?? "") || /schema cache/i.test(error.message)) {
    throw new LeadsNotInstalled();
  }
  throw new Error(error.message);
}

export { mapStage };

export function mapSuggestion(r: Row): LeadSuggestion {
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    rule: str(r.rule) as SuggestionRule,
    toStageId: str(r.to_stage_id),
    reason: str(r.reason),
    createdAt: str(r.created_at),
  };
}

export function mapLead(r: Row): Lead {
  return {
    id: str(r.id),
    company: str(r.company),
    website: nstr(r.website),
    domain: nstr(r.domain),
    source: nstr(r.source) as LeadSource | null,
    stageId: nstr(r.stage_id),
    ownerId: nstr(r.owner_id),
    estValue: nnum(r.est_value),
    currency: currency(r.currency),
    askedFor: nstr(r.asked_for),
    nextStep: nstr(r.next_step),
    nextStepDue: nstr(r.next_step_due),
    lostReasonId: nstr(r.lost_reason_id),
    lostNote: nstr(r.lost_note),
    sheetRef: nstr(r.sheet_ref),
    clientId: nstr(r.client_id),
    sectionId: nstr(r.section_id),
    wonAt: nstr(r.won_at),
    stageChangedAt: str(r.stage_changed_at),
    lastActivityAt: str(r.last_activity_at),
    createdAt: str(r.created_at),
    primaryContact: null,
    gmailBackfilledAt: nstr(r.gmail_backfilled_at),
    replyOwedSince: null,
    deletedAt: nstr(r.deleted_at),
  };
}

export function mapContact(r: Row): LeadContact {
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    name: str(r.name),
    title: nstr(r.title),
    email: nstr(r.email),
    phone: nstr(r.phone),
    linkedin: nstr(r.linkedin),
    persona: nstr(r.persona),
    pastConnection: nstr(r.past_connection),
    position: num(r.position),
  };
}

export function mapOffer(r: Row): LeadOffer {
  const status = str(r.status);
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    version: num(r.version),
    amount: nnum(r.amount),
    currency: currency(r.currency),
    scopeSummary: nstr(r.scope_summary),
    storagePath: nstr(r.storage_path),
    fileName: nstr(r.file_name),
    status: (["draft", "in_review", "sent", "accepted", "declined"].includes(status)
      ? status
      : "draft") as OfferStatus,
    sentAt: nstr(r.sent_at),
    approvedBy: nstr(r.approved_by),
    approvedAt: nstr(r.approved_at),
    createdAt: str(r.created_at),
  };
}

export function mapThread(r: Row): LeadThread {
  const owed = str(r.reply_owed_by);
  const by = str(r.matched_by);
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    gmailThreadId: nstr(r.gmail_thread_id),
    url: str(r.url),
    subject: nstr(r.subject),
    note: nstr(r.note),
    createdAt: str(r.created_at),
    participants: Array.isArray(r.participants) ? (r.participants as string[]) : [],
    lastMessageAt: nstr(r.last_message_at),
    replyOwedBy: owed === "us" || owed === "them" ? owed : null,
    messageCount: num(r.message_count),
    digest: nstr(r.digest),
    matchedBy: (["manual", "thread", "email", "domain"].includes(by) ? by : null) as LeadThread["matchedBy"],
  };
}

export function mapMessage(r: Row): LeadMessage {
  return {
    id: str(r.id),
    threadId: str(r.thread_id),
    fromAddr: nstr(r.from_addr),
    fromName: nstr(r.from_name),
    toAddrs: Array.isArray(r.to_addrs) ? (r.to_addrs as string[]) : [],
    ccAddrs: Array.isArray(r.cc_addrs) ? (r.cc_addrs as string[]) : [],
    subject: nstr(r.subject),
    sentAt: nstr(r.sent_at),
    fromUs: r.from_us === true,
    bodyText: nstr(r.body_text),
  };
}

/** One thread's messages, oldest first — fetched when a thread is opened, never with the board. */
export async function loadThreadMessages(threadId: string): Promise<LeadMessage[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("lead_messages")
    .select("id,thread_id,from_addr,from_name,to_addrs,cc_addrs,subject,sent_at,from_us,body_text")
    .eq("thread_id", threadId)
    .order("sent_at");
  check(error);
  return ((data ?? []) as Row[]).map(mapMessage);
}

export function mapEvent(r: Row): LeadEvent {
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    kind: str(r.kind) as LeadEventKind,
    body: nstr(r.body),
    meta: r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : null,
    actorId: nstr(r.actor_id),
    at: str(r.at),
  };
}

export function mapClientContact(r: Row): ClientContact {
  return {
    id: str(r.id),
    clientId: str(r.client_id),
    name: str(r.name),
    title: nstr(r.title),
    email: nstr(r.email),
    phone: nstr(r.phone),
    linkedin: nstr(r.linkedin),
    notes: nstr(r.notes),
    position: num(r.position),
  };
}

/** The columns the board reads. Deliberately not `*`. */
const LEAD_COLS =
  "id,company,website,domain,source,stage_id,owner_id,est_value,currency,asked_for," +
  "next_step,next_step_due,lost_reason_id,lost_note,sheet_ref,client_id,section_id,won_at," +
  "stage_changed_at,last_activity_at,created_at";
/** 0043's column, asked for separately so the board still loads before 0043 is run. */
const LEAD_COLS_0043 = LEAD_COLS + ",gmail_backfilled_at";

export interface Vocabulary {
  stages: LeadStage[];
  lostReasons: LostReason[];
}

export async function loadVocabulary(): Promise<Vocabulary> {
  const sb = createClient();
  // A ladder: each rung drops the newest migration's columns, so the board
  // keeps loading whichever of 0044 / 0046 has not been run yet.
  const stageRows = async () => {
    for (const cols of [
      "id,name,position,kind,stall_days,rule_key,color,icon",
      "id,name,position,kind,stall_days,rule_key",
      "id,name,position,kind,stall_days",
    ]) {
      const r = await sb.from("lead_stages").select(cols).order("position");
      if (!r.error || !MISSING_SCHEMA_CODES.has(r.error.code ?? "")) return r;
    }
    return sb.from("lead_stages").select("id,name,position,kind,stall_days").order("position");
  };
  const [stages, reasons] = await Promise.all([
    stageRows(),
    sb.from("lead_lost_reasons").select("id,name,position").order("position"),
  ]);
  check(stages.error);
  check(reasons.error);
  return {
    stages: ((stages.data ?? []) as Row[]).map(mapStage),
    lostReasons: ((reasons.data ?? []) as Row[]).map((r) => ({
      id: str(r.id),
      name: str(r.name),
      position: num(r.position),
    })),
  };
}

/**
 * Every lead, with its first contact's name.
 *
 * ⚠️ ALL OF THEM, INCLUDING WON AND LOST. A studio this size opens dozens of
 * leads a year, not thousands, and the board's Won/Lost columns and the summary
 * strip both need them. If that ever stops being true, filter closed leads to
 * the last N months here — not on the page.
 */
/**
 * ⚠️ STEPS DOWN A RUNG WHEN 0043 IS NOT APPLIED — the same ladder the store
 * uses: naming a missing column fails the whole select, and Phase 1 must keep
 * working while Phase 2's migration waits to be run.
 */
async function leadRows(filter?: { id: string }) {
  const sb = createClient();
  // ⚠️ The board skips deleted leads (0047); a single lead is fetched either
  // way, so its page can say it was deleted and offer Undo.
  const q = (cols: string, live: boolean) => {
    const base = sb.from("leads").select(cols);
    if (filter) return base.eq("id", filter.id);
    const ordered = base.order("last_activity_at", { ascending: false });
    return live ? ordered.is("deleted_at", null) : ordered;
  };
  const top = await q(LEAD_COLS_0043 + ",deleted_at", true);
  if (!top.error || !MISSING_SCHEMA_CODES.has(top.error.code ?? "")) return top;
  const full = await q(LEAD_COLS_0043, false);
  if (!full.error || !MISSING_SCHEMA_CODES.has(full.error.code ?? "")) return full;
  return q(LEAD_COLS, false);
}

/** A deleted lead's name, for the board's "X was deleted · Undo" banner. */
export async function deletedLeadName(id: string): Promise<string | null> {
  const sb = createClient();
  const { data } = await sb
    .from("leads")
    .select("company")
    .eq("id", id)
    .not("deleted_at", "is", null)
    .maybeSingle();
  return data ? str((data as Row).company) : null;
}

export async function loadBoard(): Promise<Lead[]> {
  const sb = createClient();
  const { data, error } = await leadRows();
  check(error);
  const leads = ((data ?? []) as unknown as Row[]).map(mapLead);
  if (leads.length === 0) return leads;

  const { data: contacts } = await sb
    .from("lead_contacts")
    .select("lead_id,name,position")
    .in(
      "lead_id",
      leads.map((l) => l.id),
    )
    .order("position");
  const first = new Map<string, string>();
  for (const c of (contacts ?? []) as Row[]) {
    const id = str(c.lead_id);
    if (!first.has(id)) first.set(id, str(c.name));
  }
  for (const l of leads) l.primaryContact = first.get(l.id) ?? null;

  // Replies the studio owes, for the Today list. Only threads where the ball is
  // in our court, and only their timestamps — never a subject or a body.
  const { data: owed, error: owedErr } = await sb
    .from("lead_threads")
    .select("lead_id,last_message_at")
    .eq("reply_owed_by", "us");
  if (!owedErr) {
    const since = new Map<string, string>();
    for (const t of (owed ?? []) as Row[]) {
      const id = str(t.lead_id);
      const at = str(t.last_message_at);
      if (at && (!since.has(id) || at < since.get(id)!)) since.set(id, at);
    }
    for (const l of leads) l.replyOwedSince = since.get(l.id) ?? null;
  }
  return leads;
}

/** Every pending suggestion, for the Today list. Best-effort before 0044. */
export async function loadPendingSuggestions(): Promise<LeadSuggestion[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("lead_suggestions")
    .select("id,lead_id,rule,to_stage_id,reason,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as Row[]).map(mapSuggestion);
}

export async function loadLead(id: string): Promise<LeadDetail | null> {
  const sb = createClient();
  const { data: rows, error } = await leadRows({ id });
  check(error);
  const data = ((rows ?? []) as unknown as Row[])[0];
  if (!data) return null;
  const lead = mapLead(data);

  const [contacts, offers, threads, events] = await Promise.all([
    sb.from("lead_contacts").select("*").eq("lead_id", id).order("position"),
    sb.from("lead_offers").select("*").eq("lead_id", id).order("version", { ascending: false }),
    // Sorted below rather than by `last_message_at` here: that column is 0043's,
    // and ordering by a missing column fails the whole lead page.
    sb.from("lead_threads").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    sb.from("lead_events").select("*").eq("lead_id", id).order("at", { ascending: false }).limit(100),
  ]);
  check(contacts.error);
  check(offers.error);
  check(threads.error);
  check(events.error);

  const c = ((contacts.data ?? []) as Row[]).map(mapContact);
  lead.primaryContact = c[0]?.name ?? null;
  const { data: sugg } = await sb
    .from("lead_suggestions")
    .select("id,lead_id,rule,to_stage_id,reason,created_at")
    .eq("lead_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return {
    lead,
    suggestions: ((sugg ?? []) as Row[]).map(mapSuggestion),
    contacts: c,
    offers: ((offers.data ?? []) as Row[]).map(mapOffer),
    threads: ((threads.data ?? []) as Row[])
      .map(mapThread)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)),
    events: ((events.data ?? []) as Row[]).map(mapEvent),
  };
}

/** The lead a client was won from, if any — for the "From lead" link. */
export async function leadForClient(clientId: string): Promise<{ id: string; company: string } | null> {
  const sb = createClient();
  const { data } = await sb
    .from("leads")
    .select("id,company")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("won_at", { ascending: false })
    .limit(1);
  const r = (data ?? [])[0] as Row | undefined;
  return r ? { id: str(r.id), company: str(r.company) } : null;
}

/**
 * A client's contacts.
 *
 * ⚠️ Returns [] rather than throwing when 0042 has not been applied, because
 * this runs on the CLIENT PAGE, which every member opens: an unapplied Leads
 * migration must not put an error on a page that has nothing to do with sales.
 */
export async function loadClientContacts(clientId: string): Promise<ClientContact[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("client_contacts")
    .select("*")
    .eq("client_id", clientId)
    .order("position");
  if (error) return [];
  return ((data ?? []) as Row[]).map(mapClientContact);
}

/** The stored USD→ILS rate, or null if none has been fetched yet. */
export async function loadStoredRate(): Promise<StoredRate | null> {
  const sb = createClient();
  const { data } = await sb.from("lead_settings").select("value").eq("key", "fx_usd_ils").maybeSingle();
  const v = (data as { value?: unknown } | null)?.value as
    | { official?: unknown; date?: unknown; checkedAt?: unknown }
    | undefined;
  const official = nnum(v?.official);
  const date = typeof v?.date === "string" ? v.date : null;
  const checkedAt = typeof v?.checkedAt === "string" ? v.checkedAt : undefined;
  return official && date ? { official, date, checkedAt } : null;
}

/**
 * Asks the server to refresh the rate from the Bank of Israel.
 *
 * ⚠️ SERVER-SIDE BECAUSE THE BROWSER CANNOT: the CSP allows connections only to
 * the app and Supabase (`src/lib/csp.ts`), so a fetch to boi.gov.il from here
 * would be refused. Best-effort — the stored rate (or the fallback) stands if
 * the bank is unreachable.
 */
export async function refreshRate(): Promise<StoredRate | null> {
  try {
    const res = await fetch("/api/leads/fx", { method: "POST" });
    if (!res.ok) return null;
    const json = (await res.json()) as { rate?: StoredRate | null };
    return json.rate ?? null;
  } catch {
    return null;
  }
}

export async function loadInboundToken(): Promise<string | null> {
  const sb = createClient();
  const { data } = await sb.from("lead_settings").select("value").eq("key", "inbound_token").maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return typeof v === "string" ? v : null;
}

/**
 * The few columns global search needs — company and domain, nothing else.
 * Fetched once, lazily, the first time an ADMIN focuses the search box, so it
 * costs a designer nothing and an admin one tiny read per session.
 */
export async function loadLeadIndex(): Promise<{ id: string; company: string; domain: string | null }[]> {
  const sb = createClient();
  const list = (live: boolean) => {
    const q = sb.from("leads").select("id,company,domain").order("last_activity_at", { ascending: false });
    return live ? q.is("deleted_at", null) : q;
  };
  let { data, error } = await list(true);
  if (error && MISSING_SCHEMA_CODES.has(error.code ?? "")) ({ data, error } = await list(false));
  if (error) return [];
  return ((data ?? []) as Row[]).map((r) => ({ id: str(r.id), company: str(r.company), domain: nstr(r.domain) }));
}

export interface GmailStatus {
  configured: boolean;
  installed: boolean;
  me: string;
  connections: {
    profile_id: string;
    email: string;
    status: "ok" | "error" | "revoked";
    last_error: string | null;
    last_sync_at: string | null;
    watch_expires_at: string | null;
    connected_at: string;
  }[];
}

export async function loadGmailStatus(): Promise<GmailStatus | null> {
  try {
    const res = await fetch("/api/gmail/status", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as GmailStatus;
  } catch {
    return null;
  }
}

/** Runs the 12-month mailbox search for one lead. */
export async function searchGmailForLead(leadId: string): Promise<{ threads: number; accounts: number }> {
  const res = await fetch("/api/gmail/backfill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId }),
  });
  const j = (await res.json().catch(() => ({}))) as { threads?: number; accounts?: number; error?: string };
  if (!res.ok) throw new Error(j.error ?? "Gmail search failed.");
  return { threads: j.threads ?? 0, accounts: j.accounts ?? 0 };
}

/** Saved recipient lists (profile ids) — null when nothing is saved, meaning "every admin". */
export async function loadMailSettings(): Promise<{ digest: string[] | null; approvers: string[] | null }> {
  const sb = createClient();
  const { data } = await sb.from("lead_settings").select("key,value").in("key", ["digest_recipients", "approver_ids"]);
  const get = (k: string) => {
    const v = ((data ?? []) as Row[]).find((r) => r.key === k)?.value;
    return Array.isArray(v) ? (v as string[]) : null;
  };
  return { digest: get("digest_recipients"), approvers: get("approver_ids") };
}
