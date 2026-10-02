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
import type {
  ClientContact,
  Currency,
  Lead,
  LeadContact,
  LeadDetail,
  LeadEvent,
  LeadEventKind,
  LeadOffer,
  LeadSource,
  LeadStage,
  LeadStageKind,
  LeadThread,
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

export function mapStage(r: Row): LeadStage {
  const kind = str(r.kind);
  return {
    id: str(r.id),
    name: str(r.name),
    position: num(r.position),
    kind: (kind === "won" || kind === "lost" ? kind : "open") as LeadStageKind,
    stallDays: nnum(r.stall_days),
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
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    gmailThreadId: nstr(r.gmail_thread_id),
    url: str(r.url),
    subject: nstr(r.subject),
    note: nstr(r.note),
    createdAt: str(r.created_at),
  };
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

export interface Vocabulary {
  stages: LeadStage[];
  lostReasons: LostReason[];
}

export async function loadVocabulary(): Promise<Vocabulary> {
  const sb = createClient();
  const [stages, reasons] = await Promise.all([
    sb.from("lead_stages").select("id,name,position,kind,stall_days").order("position"),
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
export async function loadBoard(): Promise<Lead[]> {
  const sb = createClient();
  const { data, error } = await sb.from("leads").select(LEAD_COLS).order("last_activity_at", {
    ascending: false,
  });
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
  return leads;
}

export async function loadLead(id: string): Promise<LeadDetail | null> {
  const sb = createClient();
  const { data, error } = await sb.from("leads").select(LEAD_COLS).eq("id", id).maybeSingle();
  check(error);
  if (!data) return null;
  const lead = mapLead(data as unknown as Row);

  const [contacts, offers, threads, events] = await Promise.all([
    sb.from("lead_contacts").select("*").eq("lead_id", id).order("position"),
    sb.from("lead_offers").select("*").eq("lead_id", id).order("version", { ascending: false }),
    sb.from("lead_threads").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    sb.from("lead_events").select("*").eq("lead_id", id).order("at", { ascending: false }).limit(100),
  ]);
  check(contacts.error);
  check(offers.error);
  check(threads.error);
  check(events.error);

  const c = ((contacts.data ?? []) as Row[]).map(mapContact);
  lead.primaryContact = c[0]?.name ?? null;
  return {
    lead,
    contacts: c,
    offers: ((offers.data ?? []) as Row[]).map(mapOffer),
    threads: ((threads.data ?? []) as Row[]).map(mapThread),
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
  const { data, error } = await sb.from("leads").select("id,company,domain").order("last_activity_at", {
    ascending: false,
  });
  if (error) return [];
  return ((data ?? []) as Row[]).map((r) => ({ id: str(r.id), company: str(r.company), domain: nstr(r.domain) }));
}
