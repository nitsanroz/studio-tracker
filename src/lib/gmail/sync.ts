// The Gmail → Leads sync. Server-side only, service role only.
//
// Three ways in, one way to store:
//   · `syncAccount`  — a push said this mailbox changed: read its history
//                      since the last cursor and attach whatever matches.
//   · `backfillLead` — a lead is new or has new contacts: search the last 12
//                      months of every connected mailbox for its threads.
//   · `renewAll`     — the daily cron: renew each watch, then catch up.
// All three end in `storeThread`, so a thread is written one way however it
// was found.
//
// ⚠️⚠️ ONLY MATCHED THREADS ARE STORED. The history feed shows every message
// in the mailbox; a message is fetched as HEADERS ONLY to decide whether it
// belongs to a lead, and its body is read only once it does. Everything else is
// dropped without a trace — the PRD's privacy rule and the reason this file
// exists rather than a "sync the inbox" job.
//
// ⚠️ WHICH LEADS CAN CATCH A NEW THREAD: open ones, plus anything touched in
// the last 90 days. 593 of the 622 imported leads are years-old history; letting
// them catch mail would file a returning client's new enquiry under a 2021
// "Lost" card nobody looks at. Phase 3's "possible new leads" inbox is where
// those belong.

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptToken } from "./crypto";
import { afterMail } from "../leads/rules";
import { mapStage } from "../leads/stage-map";
import {
  accessTokenFor,
  getMessageMeta,
  getProfile,
  getThread,
  GmailError,
  listHistory,
  searchThreads,
  watch,
} from "./google";
import {
  externalParticipants,
  isRealMail,
  matchLead,
  parseAddresses,
  parseMessage,
  replyOwedBy,
  threadUrl,
  type MatchCandidate,
  type ParsedMessage,
} from "./parse";

export function service(): SupabaseClient {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface Account {
  id: string;
  profile_id: string;
  email: string;
  refresh_token_enc: string;
  history_id: string | null;
  status: string;
}

const ACCOUNT_COLS = "id,profile_id,email,refresh_token_enc,history_id,status";
const MATCH_WINDOW_DAYS = 90;
const BACKFILL_MONTHS = 12;
const BACKFILL_MAX_THREADS = 50;

export async function accounts(sb: SupabaseClient): Promise<Account[]> {
  const { data } = await sb.from("gmail_accounts").select(ACCOUNT_COLS).eq("status", "ok");
  return (data ?? []) as Account[];
}

export async function accountByEmail(sb: SupabaseClient, email: string): Promise<Account | null> {
  const { data } = await sb.from("gmail_accounts").select(ACCOUNT_COLS).ilike("email", email).maybeSingle();
  return (data as Account | null) ?? null;
}

/**
 * An access token, or null when the mailbox can no longer be read.
 *
 * ⚠️ A REVOKED GRANT IS RECORDED, NOT RETRIED. `invalid_grant` means the
 * person removed the app from their Google account (or Google expired it); the
 * row flips to `revoked` and Settings asks them to reconnect, instead of every
 * push for the rest of time failing the same way in a log nobody reads.
 */
export async function accessFor(sb: SupabaseClient, a: Account): Promise<string | null> {
  try {
    return await accessTokenFor(decryptToken(a.refresh_token_enc));
  } catch (e) {
    const revoked = e instanceof GmailError && /invalid_grant/i.test(e.message);
    await sb
      .from("gmail_accounts")
      .update({ status: revoked ? "revoked" : "error", last_error: e instanceof Error ? e.message : String(e) })
      .eq("id", a.id);
    return null;
  }
}

/** Every connected mailbox address — mail from any of them is "us". */
async function ownAddresses(sb: SupabaseClient): Promise<Set<string>> {
  const { data } = await sb.from("gmail_accounts").select("email");
  return new Set(((data ?? []) as { email: string }[]).map((r) => r.email.toLowerCase()));
}

/** The leads a new thread may attach to — see the header. */
export async function matchCandidates(sb: SupabaseClient, onlyLeadId?: string): Promise<MatchCandidate[]> {
  const since = new Date(Date.now() - MATCH_WINDOW_DAYS * 86_400_000).toISOString();
  const [{ data: stages }, leadsRes] = await Promise.all([
    sb.from("lead_stages").select("id,kind"),
    onlyLeadId
      ? sb.from("leads").select("id,stage_id,domain,last_activity_at").eq("id", onlyLeadId)
      : sb.from("leads").select("id,stage_id,domain,last_activity_at").is("deleted_at", null),
  ]);
  const kind = new Map(((stages ?? []) as { id: string; kind: string }[]).map((s) => [s.id, s.kind]));
  const leads = ((leadsRes.data ?? []) as { id: string; stage_id: string | null; domain: string | null; last_activity_at: string }[])
    .map((l) => ({ ...l, open: !l.stage_id || kind.get(l.stage_id) === "open" }))
    .filter((l) => onlyLeadId || l.open || l.last_activity_at >= since);
  if (leads.length === 0) return [];

  const emails = new Map<string, string[]>();
  for (let i = 0; i < leads.length; i += 200) {
    const { data } = await sb
      .from("lead_contacts")
      .select("lead_id,email")
      .in("lead_id", leads.slice(i, i + 200).map((l) => l.id))
      .not("email", "is", null);
    for (const c of (data ?? []) as { lead_id: string; email: string }[]) {
      const list = emails.get(c.lead_id) ?? [];
      list.push(c.email.toLowerCase());
      emails.set(c.lead_id, list);
    }
  }
  return leads.map((l) => ({
    leadId: l.id,
    emails: emails.get(l.id) ?? [],
    domain: l.domain,
    open: l.open,
    lastActivityAt: l.last_activity_at,
  }));
}

async function ignoredLeads(sb: SupabaseClient, gmailThreadId: string): Promise<Set<string>> {
  const { data } = await sb.from("lead_thread_ignores").select("lead_id").eq("gmail_thread_id", gmailThreadId);
  return new Set(((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id));
}

/** The lead_threads row this conversation already has, if any — by id, then by any shared Message-ID. */
async function existingThread(
  sb: SupabaseClient,
  gmailThreadId: string,
  rfcIds: string[],
): Promise<{ id: string; lead_id: string } | null> {
  const { data: byId } = await sb
    .from("lead_threads")
    .select("id,lead_id")
    .eq("gmail_thread_id", gmailThreadId)
    .maybeSingle();
  if (byId) return byId as { id: string; lead_id: string };
  if (rfcIds.length === 0) return null;
  const { data: byMsg } = await sb.from("lead_messages").select("thread_id").in("rfc_message_id", rfcIds).limit(1);
  const tid = ((byMsg ?? [])[0] as { thread_id?: string } | undefined)?.thread_id;
  if (!tid) return null;
  const { data: t } = await sb.from("lead_threads").select("id,lead_id").eq("id", tid).maybeSingle();
  return (t as { id: string; lead_id: string } | null) ?? null;
}

/**
 * Reads one Gmail thread and files it under a lead.
 *
 * `force` is the backfill's lead — the search already decided which lead it is
 * for, so matching is skipped (an unlink by hand still wins). Without it the
 * thread is matched from its participants.
 *
 * Returns the lead it landed on, or null when it belongs to none.
 */
export async function storeThread(
  sb: SupabaseClient,
  account: Account,
  accessToken: string,
  gmailThreadId: string,
  own: Set<string>,
  opts: { force?: { leadId: string; by: "email" | "domain" }; candidates?: MatchCandidate[] } = {},
): Promise<string | null> {
  const thread = await getThread(accessToken, gmailThreadId);
  const raw = (thread.messages ?? []).filter(isRealMail);
  if (raw.length === 0) return null;
  const msgs: ParsedMessage[] = raw.map((m) => parseMessage(m, own));
  msgs.sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  let row = await existingThread(sb, gmailThreadId, msgs.map((m) => m.rfcId));
  let leadId = row?.lead_id ?? null;
  let matchedBy: string | null = null;

  if (!row) {
    const ignored = await ignoredLeads(sb, gmailThreadId);
    if (opts.force) {
      if (ignored.has(opts.force.leadId)) return null;
      leadId = opts.force.leadId;
      matchedBy = opts.force.by;
    } else {
      const m = matchLead(externalParticipants(msgs, own), opts.candidates ?? (await matchCandidates(sb)), ignored);
      if (!m) return null;
      leadId = m.leadId;
      matchedBy = m.by;
    }
  }
  if (!leadId) return null;

  const last = msgs[msgs.length - 1];
  const participants = [...new Set(msgs.flatMap((m) => [m.from, ...m.to, ...m.cc]).filter(Boolean).map((a) => a!.email))];
  const fields = {
    subject: msgs[0].subject,
    participants,
    last_message_at: last.sentAt,
    reply_owed_by: replyOwedBy(msgs),
    message_count: msgs.length,
    digest: last.snippet,
  };

  if (row) {
    const { error } = await sb.from("lead_threads").update(fields).eq("id", row.id);
    if (error) throw new Error(`thread update: ${error.message}`);
  } else {
    const { data, error } = await sb
      .from("lead_threads")
      .insert({
        lead_id: leadId,
        gmail_thread_id: gmailThreadId,
        url: threadUrl(account.email, gmailThreadId),
        matched_by: matchedBy,
        account_id: account.id,
        ...fields,
      })
      .select("id,lead_id")
      .single();
    if (error) throw new Error(`thread insert: ${error.message}`);
    row = data as { id: string; lead_id: string };
  }

  // Which of these are NEW to us — the suggestion rules only look at those.
  const { data: knownRows } = await sb
    .from("lead_messages")
    .select("rfc_message_id")
    .in("rfc_message_id", msgs.map((m) => m.rfcId));
  const known = new Set(((knownRows ?? []) as { rfc_message_id: string }[]).map((r) => r.rfc_message_id));
  const fresh = msgs.filter((m) => !known.has(m.rfcId));

  const { error: me } = await sb.from("lead_messages").upsert(
    msgs.map((m) => ({
      thread_id: row!.id,
      rfc_message_id: m.rfcId,
      gmail_message_id: m.gmailId,
      from_addr: m.from?.email ?? null,
      from_name: m.from?.name ?? null,
      to_addrs: m.to.map((a) => a.email),
      cc_addrs: m.cc.map((a) => a.email),
      subject: m.subject,
      sent_at: m.sentAt,
      from_us: m.fromUs,
      body_text: m.body,
      snippet: m.snippet,
    })),
    { onConflict: "rfc_message_id", ignoreDuplicates: true },
  );
  if (me) throw new Error(`messages: ${me.message}`);

  // ⚠️ AN EMAIL IS ACTIVITY — it moves the Stalled clock — but only forward.
  const { data: lead } = await sb
    .from("leads")
    .select("last_activity_at,stage_id,stage_changed_at")
    .eq("id", leadId)
    .maybeSingle();
  const l = lead as { last_activity_at?: string; stage_id?: string | null; stage_changed_at?: string } | null;
  const current = l?.last_activity_at ?? "";
  if (last.sentAt > current) {
    await sb.from("leads").update({ last_activity_at: last.sentAt }).eq("id", leadId);
  }
  if (fresh.length && l) await suggestFromMail(sb, leadId, l.stage_id ?? null, l.stage_changed_at ?? "", fresh);
  return leadId;
}

/**
 * The mail rules (0044, Phase 3 lite): the client answered an offer, or a
 * meeting got booked. Best-effort — a failed suggestion never fails the sync.
 *
 * ⚠️ ONLY MAIL THAT IS NEW AND AFTER THE LEAD'S LAST STAGE MOVE COUNTS. A
 * backfill re-reads a year of mail; without the date check, the client's
 * reply to last spring's offer would suggest Negotiation today.
 */
async function suggestFromMail(
  sb: SupabaseClient,
  leadId: string,
  stageId: string | null,
  stageChangedAt: string,
  fresh: ParsedMessage[],
) {
  try {
    const { data: rows, error } = await sb.from("lead_stages").select("id,name,position,kind,stall_days,rule_key");
    if (error) return; // before 0044
    const stages = ((rows ?? []) as Record<string, unknown>[]).map(mapStage);
    const currentStage = stages.find((s) => s.id === stageId);
    const after = fresh.filter((m) => m.sentAt > stageChangedAt);
    const reply = after.filter((m) => !m.fromUs && !m.isCalendar).at(-1) ?? null;
    const meeting = after.find((m) => m.isCalendar) ?? null;
    const s = afterMail(currentStage, stages, {
      replyFrom: reply ? (reply.from?.name ?? reply.from?.email ?? "The client") : null,
      replyAt: reply?.sentAt ?? null,
      meeting: meeting?.subject ?? null,
    });
    if (!s) return;
    // A duplicate pending suggestion is refused by 0044's partial unique index — fine.
    await sb.from("lead_suggestions").insert({ lead_id: leadId, rule: s.rule, to_stage_id: s.toStageId, reason: s.reason });
  } catch (e) {
    console.error("[gmail] suggestion failed", e);
  }
}

/**
 * Everything new in one mailbox since its cursor.
 *
 * ⚠️ HEADERS FIRST. For a thread already linked, the whole thread is re-read;
 * for an unknown one, only the new message's From/To/Cc are fetched, and the
 * thread is opened only if those match a lead.
 *
 * ⚠️ A CURSOR GMAIL HAS FORGOTTEN (404 — it keeps about a week) is not an
 * error to stop on: the cursor resets to now and the last three days are
 * searched instead, so a week-long outage loses nothing that is still recent.
 */
export async function syncAccount(sb: SupabaseClient, account: Account): Promise<{ threads: number }> {
  const at = await accessFor(sb, account);
  if (!at) return { threads: 0 };
  const own = await ownAddresses(sb);

  let cursor = account.history_id;
  const threadIds = new Map<string, string>(); // threadId → one new message id
  let newest = cursor;

  if (!cursor) {
    cursor = (await getProfile(at)).historyId;
    newest = cursor;
  } else {
    try {
      let page: string | undefined;
      do {
        const h = await listHistory(at, cursor, page);
        for (const rec of h.history ?? []) {
          for (const added of rec.messagesAdded ?? []) {
            const l = new Set(added.message.labelIds ?? []);
            if (l.has("DRAFT") || l.has("SPAM") || l.has("TRASH") || l.has("CHAT")) continue;
            threadIds.set(added.message.threadId, added.message.id);
          }
        }
        newest = h.historyId;
        page = h.nextPageToken;
      } while (page);
    } catch (e) {
      if (!(e instanceof GmailError && e.status === 404)) throw e;
      newest = (await getProfile(at)).historyId;
      const recent = await searchThreads(at, "newer_than:3d", 100);
      for (const t of recent.threads ?? []) threadIds.set(t.id, "");
    }
  }

  let stored = 0;
  const candidates = threadIds.size ? await matchCandidates(sb) : [];
  for (const [threadId, messageId] of threadIds) {
    try {
      const { data: linked } = await sb.from("lead_threads").select("id").eq("gmail_thread_id", threadId).maybeSingle();
      if (!linked && messageId) {
        // Cheap pre-check on the new message's headers before opening the thread.
        const meta = await getMessageMeta(at, messageId);
        const people = ["From", "To", "Cc"]
          .flatMap((h) => parseAddresses(meta.payload?.headers?.find((x) => x.name === h)?.value ?? null))
          .map((a) => a.email)
          .filter((e) => !own.has(e));
        // ⚠️ A reply in a conversation we already hold from the OTHER mailbox
        // has different Gmail ids but names our stored Message-IDs in its
        // In-Reply-To / References headers — a DB lookup, no extra Gmail call.
        if (!matchLead(people, candidates) && !(await repliesToKnown(sb, meta))) continue;
      }
      if (await storeThread(sb, account, at, threadId, own, { candidates })) stored++;
    } catch (e) {
      console.error(`[gmail] thread ${threadId} for ${account.email}:`, e);
    }
  }

  await sb
    .from("gmail_accounts")
    .update({ history_id: newest, last_sync_at: new Date().toISOString(), status: "ok", last_error: null })
    .eq("id", account.id);
  return { threads: stored };
}

/** Does this message reply to one we already hold (In-Reply-To / References)? */
async function repliesToKnown(sb: SupabaseClient, meta: import("./parse").GmailMessage): Promise<boolean> {
  const h = (name: string) => meta.payload?.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
  const ids = `${h("in-reply-to")} ${h("references")}`.match(/<[^>]+>/g) ?? [];
  if (ids.length === 0) return false;
  const { data } = await sb.from("lead_messages").select("id").in("rfc_message_id", ids.slice(-20)).limit(1);
  return (data ?? []).length > 0;
}

/** Gmail search terms for one lead: its contacts' addresses and its domain. */
export function backfillQuery(emails: string[], domain: string | null): string | null {
  const terms: string[] = [];
  for (const e of emails) terms.push(`from:${e}`, `to:${e}`, `cc:${e}`);
  if (domain) terms.push(`from:@${domain}`, `to:@${domain}`);
  if (terms.length === 0) return null;
  return `{${terms.join(" ")}} newer_than:${BACKFILL_MONTHS}m`;
}

/**
 * The last 12 months of one lead's mail, from every connected mailbox.
 *
 * ⚠️ A THREAD ALREADY FILED UNDER ANOTHER LEAD STAYS WHERE IT IS. The search
 * finds everything with the lead's domain in it, and two leads at one company
 * (a lost one from last year and this one) would otherwise fight over threads.
 */
export async function backfillLead(sb: SupabaseClient, leadId: string): Promise<{ threads: number; accounts: number }> {
  const [cand] = await matchCandidates(sb, leadId);
  const all = await accounts(sb);
  if (!cand || all.length === 0) return { threads: 0, accounts: all.length };
  const q = backfillQuery(cand.emails, cand.domain);
  let stored = 0;
  if (q) {
    const own = await ownAddresses(sb);
    for (const a of all) {
      const at = await accessFor(sb, a);
      if (!at) continue;
      const found = await searchThreads(at, q, BACKFILL_MAX_THREADS);
      for (const t of found.threads ?? []) {
        try {
          const { data: other } = await sb
            .from("lead_threads")
            .select("lead_id")
            .eq("gmail_thread_id", t.id)
            .maybeSingle();
          if (other && (other as { lead_id: string }).lead_id !== leadId) continue;
          const by = cand.emails.length ? "email" : "domain";
          if (await storeThread(sb, a, at, t.id, own, { force: { leadId, by } })) stored++;
        } catch (e) {
          console.error(`[gmail] backfill ${t.id}:`, e);
        }
      }
    }
  }
  await sb.from("leads").update({ gmail_backfilled_at: new Date().toISOString() }).eq("id", leadId);
  return { threads: stored, accounts: all.length };
}

/** Backfills every open lead — run once when somebody connects their mailbox. */
export async function backfillOpenLeads(sb: SupabaseClient): Promise<number> {
  const cands = (await matchCandidates(sb)).filter((c) => c.open);
  let n = 0;
  for (const c of cands) n += (await backfillLead(sb, c.leadId)).threads;
  return n;
}

/** The daily job: renew every watch (they lapse after 7 days), then catch up. */
export async function renewAll(sb: SupabaseClient): Promise<{ renewed: number; threads: number }> {
  let renewed = 0;
  let threads = 0;
  for (const a of await accounts(sb)) {
    const at = await accessFor(sb, a);
    if (!at) continue;
    try {
      const w = await watch(at);
      await sb
        .from("gmail_accounts")
        .update({ watch_expires_at: new Date(Number(w.expiration)).toISOString() })
        .eq("id", a.id);
      renewed++;
      threads += (await syncAccount(sb, a)).threads;
    } catch (e) {
      console.error(`[gmail] renew ${a.email}:`, e);
      await sb.from("gmail_accounts").update({ last_error: e instanceof Error ? e.message : String(e) }).eq("id", a.id);
    }
  }
  return { renewed, threads };
}
