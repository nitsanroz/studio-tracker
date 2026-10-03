"use client";

// Every write the Leads section makes.
//
// ⚠️ NO UNDO, as with candidates (see `src/lib/candidates/actions.ts`): this
// section keeps no in-memory copy to put back. Stage moves are reversible by
// moving back; the only true delete — a whole lead — sits behind a confirm.
//
// ⚠️ EVERY REAL CHANGE TOUCHES `last_activity_at`. It is the Stalled clock,
// and a write that forgets it leaves a lead flagged as quiet while somebody is
// actively working it.

import { createClient } from "../supabase/client";
import { domainOf } from "./types";
import { afterOfferStatus, type Suggestion } from "./rules";
import type {
  Currency,
  LeadContact,
  LeadEventKind,
  LeadSource,
  LeadStage,
  OfferStatus,
} from "./types";

export class LeadWriteError extends Error {
  constructor(
    public readonly label: string,
    message: string,
  ) {
    super(`Could not ${label}: ${message}`);
    this.name = "LeadWriteError";
  }
}

const fail = (label: string, error: { message: string } | null) => {
  if (error) throw new LeadWriteError(label, error.message);
};

const nowIso = () => new Date().toISOString();

async function touch(leadId: string) {
  const sb = createClient();
  await sb.from("leads").update({ last_activity_at: nowIso() }).eq("id", leadId);
}

/**
 * One line in the activity log.
 *
 * ⚠️ BEST-EFFORT, NEVER FATAL — the candidates rule: a failed history line must
 * not fail the move it describes.
 */
async function logEvent(
  leadId: string,
  kind: LeadEventKind,
  body: string | null,
  actorId: string | null,
  meta: Record<string, unknown> | null = null,
) {
  try {
    const sb = createClient();
    await sb.from("lead_events").insert({ lead_id: leadId, kind, body, meta, actor_id: actorId });
  } catch (e) {
    console.error("[leads] event not recorded", kind, e);
  }
}

// ── the lead ────────────────────────────────────────────────────────────────

export interface NewLead {
  company: string;
  stageId: string | null;
  ownerId?: string | null;
  source?: LeadSource | null;
  website?: string | null;
}

export async function createLead(input: NewLead, actorId: string | null): Promise<string> {
  const sb = createClient();
  const { data, error } = await sb
    .from("leads")
    .insert({
      company: input.company.trim(),
      stage_id: input.stageId,
      owner_id: input.ownerId ?? actorId,
      source: input.source ?? null,
      website: input.website?.trim() || null,
      domain: domainOf(input.website),
      created_by: actorId,
    })
    .select("id")
    .single();
  fail("add the lead", error);
  const id = (data as { id: string }).id;
  await logEvent(id, "created", null, actorId);
  return id;
}

export type LeadPatch = Partial<{
  company: string;
  website: string | null;
  source: LeadSource | null;
  ownerId: string | null;
  estValue: number | null;
  currency: Currency;
  askedFor: string | null;
  nextStep: string | null;
  nextStepDue: string | null;
  lostReasonId: string | null;
  lostNote: string | null;
}>;

export async function updateLead(leadId: string, patch: LeadPatch) {
  const row: Record<string, unknown> = { last_activity_at: nowIso() };
  if ("company" in patch) row.company = patch.company?.trim();
  if ("website" in patch) {
    row.website = patch.website?.trim() || null;
    // ⚠️ The domain FOLLOWS the website and is never typed on its own: two
    // fields that can disagree about which company this is would let Phase 2
    // match threads against a site nobody can see.
    row.domain = domainOf(patch.website);
  }
  if ("source" in patch) row.source = patch.source;
  if ("ownerId" in patch) row.owner_id = patch.ownerId;
  if ("estValue" in patch) row.est_value = patch.estValue;
  if ("currency" in patch) row.currency = patch.currency;
  if ("askedFor" in patch) row.asked_for = patch.askedFor;
  if ("nextStep" in patch) row.next_step = patch.nextStep;
  if ("nextStepDue" in patch) row.next_step_due = patch.nextStepDue;
  if ("lostReasonId" in patch) row.lost_reason_id = patch.lostReasonId;
  if ("lostNote" in patch) row.lost_note = patch.lostNote;
  const sb = createClient();
  const { error } = await sb.from("leads").update(row).eq("id", leadId);
  fail("save the change", error);
}

/**
 * Moving between stages — the drag, and the stage picker on the lead page.
 *
 * ⚠️ NEVER USE THIS FOR A WON STAGE. Winning creates a client and copies the
 * contacts across, so it goes through `markWon`; the board opens the win modal
 * instead of calling this. Losing is allowed here, with its reason.
 *
 * ⚠️ LEAVING A LOST STAGE CLEARS THE REASON. A lead revived after "Timing" is
 * not still lost for timing, and a stale reason would sit in the summary's
 * lost-by-reason count for ever.
 */
export async function moveLead(
  leadId: string,
  from: LeadStage | null,
  to: LeadStage,
  actorId: string | null,
  lost?: { reasonId: string | null; reasonName: string | null; note: string | null },
) {
  const row: Record<string, unknown> = {
    stage_id: to.id,
    stage_changed_at: nowIso(),
    last_activity_at: nowIso(),
  };
  if (to.kind === "lost") {
    row.lost_reason_id = lost?.reasonId ?? null;
    row.lost_note = lost?.note ?? null;
  } else {
    row.lost_reason_id = null;
    row.lost_note = null;
  }
  const sb = createClient();
  const { error } = await sb.from("leads").update(row).eq("id", leadId);
  fail("move the lead", error);
  await supersede(leadId);
  await logEvent(
    leadId,
    to.kind === "lost" ? "lost" : from?.kind === "lost" || from?.kind === "won" ? "reopened" : "stage_change",
    to.kind === "lost" ? [lost?.reasonName, lost?.note].filter(Boolean).join(" — ") || null : null,
    actorId,
    { from: from?.name ?? null, to: to.name },
  );
}

/**
 * Delete a lead, held for Undo (0047). Nothing is removed yet: the lead is
 * stamped `deleted_at` and hidden everywhere, so Undo brings back contacts,
 * offers, threads and estimates as they were. It is erased for good when the
 * board's Undo banner is dismissed, or by the nightly cron
 * (`purgeDeletedLeads` in `purge.ts`, run from /api/gmail/renew).
 * `deleted_by` is written for the record only — nothing in the app reads it.
 */
export async function deleteLead(leadId: string, actorId: string | null) {
  const sb = createClient();
  const { error } = await sb
    .from("leads")
    .update({ deleted_at: nowIso(), deleted_by: actorId })
    .eq("id", leadId);
  fail("delete the lead", error);
}

/**
 * Undo a delete. ⚠️ Checks a row came back: an UPDATE that matches nothing is
 * not an error, so without this an Undo after the lead was erased would close
 * the banner as if it had worked.
 */
export async function restoreLead(leadId: string) {
  const sb = createClient();
  const { data, error } = await sb
    .from("leads")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", leadId)
    .select("id");
  fail("restore the lead", error);
  if (!data || data.length === 0) throw new LeadWriteError("restore the lead", "it has already been erased for good.");
}

/**
 * ⚠️ THE HARD DELETE — dismissing the Undo banner. Cascades to contacts,
 * offers, threads, events and estimates, and cannot be undone. Only ever
 * erases a lead that is already deleted, so a stale banner can't take a lead
 * somebody restored in another tab.
 */
export async function eraseLead(leadId: string) {
  const sb = createClient();
  const { error } = await sb.from("leads").delete().eq("id", leadId).not("deleted_at", "is", null);
  fail("erase the lead", error);
}

// ── activity ────────────────────────────────────────────────────────────────

/**
 * A call, meeting, email or note somebody logged.
 *
 * ⚠️ A BACKDATED ENTRY DOES NOT REWIND THE STALLED CLOCK. Logging last week's
 * call today moves `last_activity_at` to WHEN THE CALL WAS, but only if that is
 * later than what is already there — so writing up an old meeting can never
 * make a lead look quieter than it was a minute ago.
 */
export async function logActivity(
  leadId: string,
  kind: LeadEventKind,
  body: string,
  at: string | null,
  currentLastActivity: string,
  actorId: string | null,
) {
  const when = at ? new Date(`${at}T12:00:00`).toISOString() : nowIso();
  const sb = createClient();
  const { error } = await sb
    .from("lead_events")
    .insert({ lead_id: leadId, kind, body: body.trim() || null, at: when, actor_id: actorId });
  fail("log the activity", error);
  if (when > currentLastActivity) {
    await sb.from("leads").update({ last_activity_at: when }).eq("id", leadId);
  }
}

/** Only LOGGED activity can be removed; the app's own history lines stay. */
export async function removeActivity(id: string) {
  const sb = createClient();
  const { error } = await sb
    .from("lead_events")
    .delete()
    .eq("id", id)
    .in("kind", ["call", "meeting", "note", "email"]);
  fail("remove the entry", error);
}

// ── contacts ────────────────────────────────────────────────────────────────

export type ContactFields = Partial<
  Pick<LeadContact, "name" | "title" | "email" | "phone" | "linkedin" | "persona" | "pastConnection">
>;

const contactRow = (f: ContactFields) => {
  const row: Record<string, unknown> = {};
  if ("name" in f) row.name = f.name?.trim() || "Unnamed";
  if ("title" in f) row.title = f.title?.trim() || null;
  if ("email" in f) row.email = f.email?.trim() || null;
  if ("phone" in f) row.phone = f.phone?.trim() || null;
  if ("linkedin" in f) row.linkedin = f.linkedin?.trim() || null;
  if ("persona" in f) row.persona = f.persona?.trim() || null;
  if ("pastConnection" in f) row.past_connection = f.pastConnection?.trim() || null;
  return row;
};

export async function addContact(leadId: string, fields: ContactFields, position: number) {
  const sb = createClient();
  const { error } = await sb
    .from("lead_contacts")
    .insert({ lead_id: leadId, position, ...contactRow({ name: "", ...fields }) });
  fail("add the contact", error);
  await touch(leadId);
}

export async function updateContact(id: string, leadId: string, fields: ContactFields) {
  const row = contactRow(fields);
  if (Object.keys(row).length === 0) return;
  const sb = createClient();
  const { error } = await sb.from("lead_contacts").update(row).eq("id", id);
  fail("save the contact", error);
  await touch(leadId);
}

export async function removeContact(id: string, leadId: string) {
  const sb = createClient();
  const { error } = await sb.from("lead_contacts").delete().eq("id", id);
  fail("remove the contact", error);
  await touch(leadId);
}

// ── offers ──────────────────────────────────────────────────────────────────

export interface OfferInput {
  amount: number | null;
  currency: Currency;
  scopeSummary: string | null;
  sentAt: string | null;
  status: OfferStatus;
  storagePath: string | null;
  fileName: string | null;
}

export async function addOffer(
  leadId: string,
  version: number,
  input: OfferInput,
  actorId: string | null,
  rules?: RuleContext,
) {
  const sb = createClient();
  const { data: created, error } = await sb.from("lead_offers").insert({
    lead_id: leadId,
    version,
    amount: input.amount,
    currency: input.currency,
    scope_summary: input.scopeSummary?.trim() || null,
    sent_at: input.sentAt || null,
    status: input.status,
    storage_path: input.storagePath,
    file_name: input.fileName,
    created_by: actorId,
  }).select("id").single();
  fail("add the offer", error);
  if (rules) await proposeSuggestion(leadId, afterOfferStatus(input.status, version, rules.current, rules.stages));
  if (input.status === "in_review" && created) await alertOfferReview((created as { id: string }).id);
  await touch(leadId);
  await logEvent(leadId, "offer", `v${version} added`, actorId, {
    version,
    amount: input.amount,
    currency: input.currency,
  });
}

export async function updateOffer(
  id: string,
  leadId: string,
  version: number,
  patch: Partial<OfferInput>,
  actorId: string | null,
  rules?: RuleContext,
) {
  const row: Record<string, unknown> = {};
  if ("amount" in patch) row.amount = patch.amount;
  if ("currency" in patch) row.currency = patch.currency;
  if ("scopeSummary" in patch) row.scope_summary = patch.scopeSummary?.trim() || null;
  if ("sentAt" in patch) row.sent_at = patch.sentAt || null;
  if ("status" in patch) row.status = patch.status;
  if ("storagePath" in patch) row.storage_path = patch.storagePath;
  if ("fileName" in patch) row.file_name = patch.fileName;
  if (Object.keys(row).length === 0) return;
  const sb = createClient();
  const { error } = await sb.from("lead_offers").update(row).eq("id", id);
  fail("save the offer", error);
  await touch(leadId);
  if ("status" in patch) {
    await logEvent(leadId, "offer", `v${version} → ${patch.status}`, actorId);
    if (rules && patch.status) await proposeSuggestion(leadId, afterOfferStatus(patch.status, version, rules.current, rules.stages));
    if (patch.status === "in_review") await alertOfferReview(id);
  }
}

/**
 * The CEO step: no price goes out without Nitsan's review (PRD, US17).
 *
 * ⚠️ RECORDED, NOT ENFORCED. Both owners are admins and the database cannot
 * tell them apart by job, so nothing here stops Michal approving her own offer.
 * The record of WHO approved is what makes that visible — and "only Nitsan may
 * press this" is one `profiles` check away if the studio ever wants it.
 */
export async function approveOffer(id: string, leadId: string, version: number, actorId: string | null) {
  const sb = createClient();
  const { error } = await sb
    .from("lead_offers")
    .update({ approved_by: actorId, approved_at: nowIso() })
    .eq("id", id);
  fail("approve the offer", error);
  await touch(leadId);
  await logEvent(leadId, "offer", `v${version} approved`, actorId);
}

export async function removeOffer(id: string, leadId: string) {
  const sb = createClient();
  const { error } = await sb.from("lead_offers").delete().eq("id", id);
  fail("remove the offer", error);
  await touch(leadId);
}

// ── Gmail threads (by hand until Phase 2) ───────────────────────────────────

export async function linkThread(
  leadId: string,
  url: string,
  gmailThreadId: string | null,
  subject: string | null,
  actorId: string | null,
) {
  const sb = createClient();
  const { error } = await sb.from("lead_threads").insert({
    lead_id: leadId,
    url,
    gmail_thread_id: gmailThreadId,
    subject: subject?.trim() || null,
    created_by: actorId,
  });
  if (error?.code === "23505") {
    throw new LeadWriteError("link the thread", "that thread is already linked to a lead.");
  }
  fail("link the thread", error);
  await touch(leadId);
}

/**
 * ⚠️ UNLINKING IS REMEMBERED. A thread the sync matched wrongly would come
 * straight back on its next message, so its Gmail id goes into
 * `lead_thread_ignores` (0043) for this lead first. Best-effort: before 0043
 * the table does not exist and an unlink is simply a delete, as in Phase 1.
 */
export async function unlinkThread(id: string, leadId: string, gmailThreadId: string | null) {
  const sb = createClient();
  if (gmailThreadId) {
    await sb
      .from("lead_thread_ignores")
      .upsert({ lead_id: leadId, gmail_thread_id: gmailThreadId }, { onConflict: "lead_id,gmail_thread_id" });
  }
  const { error } = await sb.from("lead_threads").delete().eq("id", id);
  fail("unlink the thread", error);
  await touch(leadId);
}

// ── winning ─────────────────────────────────────────────────────────────────

export interface WinTarget {
  /** The client the work lands under — new or existing, already resolved. */
  clientId: string;
  /** A new section under that client, or null to add none. */
  sectionName: string | null;
  /** Whether the client was created just now (only changes the history line). */
  created: boolean;
  clientName: string;
}

/**
 * Everything "Mark as won" does once the client exists.
 *
 * ⚠️ THE CLIENT IS CREATED BY THE CALLER, THROUGH THE STORE'S `addClient` — not
 * here — because that is the one place that also makes the client's Keys task
 * and points `keys_task_id` at it, and the store has to hear about the new
 * client anyway or the Clients page would not show it until the next refresh.
 * This function takes it from there: the section, the contacts, the lead row,
 * the history line.
 *
 * ⚠️ CONTACTS ARE COPIED, NOT MOVED. The lead keeps its own; the client gets
 * rows of its own that the team can read (0042's one `read all`). Editing one
 * afterwards does not edit the other, which is right — the person you sold to
 * and the person you work with are often not the same.
 *
 * ⚠️ A CONTACT ALREADY ON THE CLIENT (same email) IS NOT ADDED TWICE — the
 * returning-client case, where the same marketing lead is on the old and the
 * new deal.
 */
export async function markWon(
  leadId: string,
  wonStage: LeadStage,
  from: LeadStage | null,
  target: WinTarget,
  actorId: string | null,
): Promise<{ sectionId: string | null }> {
  const sb = createClient();

  let sectionId: string | null = null;
  if (target.sectionName?.trim()) {
    const { data: existing } = await sb
      .from("sections")
      .select("position")
      .eq("client_id", target.clientId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (((existing ?? [])[0] as { position?: number } | undefined)?.position ?? 0) + 1;
    const { data, error } = await sb
      .from("sections")
      .insert({ client_id: target.clientId, name: target.sectionName.trim(), position })
      .select("id")
      .single();
    fail("add the section", error);
    sectionId = (data as { id: string }).id;
  }

  const [{ data: leadContacts }, { data: clientContacts }] = await Promise.all([
    sb.from("lead_contacts").select("*").eq("lead_id", leadId).order("position"),
    sb.from("client_contacts").select("email,position").eq("client_id", target.clientId),
  ]);
  const have = new Set(
    ((clientContacts ?? []) as { email: string | null }[])
      .map((c) => c.email?.toLowerCase())
      .filter(Boolean),
  );
  let pos = Math.max(0, ...((clientContacts ?? []) as { position: number }[]).map((c) => c.position));
  const rows = ((leadContacts ?? []) as Record<string, unknown>[])
    .filter((c) => !(typeof c.email === "string" && have.has(c.email.toLowerCase())))
    .map((c) => ({
      client_id: target.clientId,
      name: c.name,
      title: c.title,
      email: c.email,
      phone: c.phone,
      linkedin: c.linkedin,
      notes: [c.persona, c.past_connection].filter(Boolean).join(" · ") || null,
      position: ++pos,
    }));
  if (rows.length > 0) {
    const { error } = await sb.from("client_contacts").insert(rows);
    fail("copy the contacts to the client", error);
  }

  const { error } = await sb
    .from("leads")
    .update({
      stage_id: wonStage.id,
      client_id: target.clientId,
      section_id: sectionId,
      won_at: nowIso(),
      lost_reason_id: null,
      lost_note: null,
      stage_changed_at: nowIso(),
      last_activity_at: nowIso(),
    })
    .eq("id", leadId);
  fail("mark the lead as won", error);
  await supersede(leadId);

  await logEvent(
    leadId,
    "won",
    target.created ? `New client: ${target.clientName}` : `Under ${target.clientName}`,
    actorId,
    { from: from?.name ?? null, to: wonStage.name, clientId: target.clientId, sectionId },
  );
  return { sectionId };
}

// ── client contacts ─────────────────────────────────────────────────────────

export async function addClientContact(clientId: string, name: string, position: number) {
  const sb = createClient();
  const { error } = await sb
    .from("client_contacts")
    .insert({ client_id: clientId, name: name.trim() || "Unnamed", position });
  fail("add the contact", error);
}

export async function updateClientContact(
  id: string,
  patch: Partial<{ name: string; title: string | null; email: string | null; phone: string | null; notes: string | null }>,
) {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) row[k] = typeof v === "string" ? v.trim() || null : v;
  if ("name" in row && !row.name) row.name = "Unnamed";
  if (Object.keys(row).length === 0) return;
  const sb = createClient();
  const { error } = await sb.from("client_contacts").update(row).eq("id", id);
  fail("save the contact", error);
}

export async function removeClientContact(id: string) {
  const sb = createClient();
  const { error } = await sb.from("client_contacts").delete().eq("id", id);
  fail("remove the contact", error);
}

// ── settings vocabulary ─────────────────────────────────────────────────────

export async function addStage(name: string, position: number) {
  const sb = createClient();
  const { error } = await sb.from("lead_stages").insert({ name: name.trim(), position, kind: "open" });
  fail("add the stage", error);
}

export async function updateStage(
  id: string,
  patch: { name?: string; stallDays?: number | null; color?: string | null; icon?: string | null },
) {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.stallDays !== undefined) row.stall_days = patch.stallDays;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.icon !== undefined) row.icon = patch.icon;
  if (Object.keys(row).length === 0) return;
  const sb = createClient();
  const { error } = await sb.from("lead_stages").update(row).eq("id", id);
  fail("save the stage", error);
}

/**
 * ⚠️ REFUSES WHILE A LEAD IS IN IT, and refuses the last Won or Lost stage.
 * `leads.stage_id` is `on delete set null`, so deleting an occupied stage would
 * drop its leads into no column at all; and with no Won stage there is nowhere
 * for "Mark as won" to put a lead.
 */
export async function removeStage(
  stage: LeadStage,
  all: LeadStage[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (stage.kind !== "open" && all.filter((s) => s.kind === stage.kind).length <= 1) {
    return { ok: false, reason: `"${stage.name}" is the only ${stage.kind === "won" ? "Won" : "Lost"} stage, so it has to stay.` };
  }
  const sb = createClient();
  const { count } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stage.id)
    // A deleted lead waiting out its Undo window doesn't hold a stage it can't
    // be seen in; if it is restored it simply comes back without one.
    .is("deleted_at", null);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      reason: `"${stage.name}" still has ${count} lead${count === 1 ? "" : "s"} in it. Move them first.`,
    };
  }
  const { error } = await sb.from("lead_stages").delete().eq("id", stage.id);
  fail("remove the stage", error);
  return { ok: true };
}

export async function reorderStages(ids: string[]) {
  const sb = createClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await sb.from("lead_stages").update({ position: i + 1 }).eq("id", ids[i]);
    fail("reorder the stages", error);
  }
}

export async function addLostReason(name: string, position: number) {
  const sb = createClient();
  const { error } = await sb.from("lead_lost_reasons").insert({ name: name.trim(), position });
  fail("add the reason", error);
}

export async function renameLostReason(id: string, name: string) {
  const sb = createClient();
  const { error } = await sb.from("lead_lost_reasons").update({ name: name.trim() }).eq("id", id);
  fail("rename the reason", error);
}

/** Leads that gave this reason keep their note and lose only the tag (set null). */
export async function removeLostReason(id: string) {
  const sb = createClient();
  const { error } = await sb.from("lead_lost_reasons").delete().eq("id", id);
  fail("remove the reason", error);
}

// ── stage suggestions (0044) ────────────────────────────────────────────────

/**
 * Files a suggestion for the owner to accept or dismiss.
 *
 * ⚠️ BEST-EFFORT AND SILENT ON A DUPLICATE: 0044 allows one pending
 * suggestion per lead and target, and a second identical one is simply not
 * needed — so a unique violation (or a missing table before 0044) is ignored.
 */
export async function proposeSuggestion(leadId: string, s: Suggestion | null) {
  if (!s) return;
  try {
    const sb = createClient();
    await sb
      .from("lead_suggestions")
      .insert({ lead_id: leadId, rule: s.rule, to_stage_id: s.toStageId, reason: s.reason });
  } catch (e) {
    console.error("[leads] suggestion not recorded", e);
  }
}

export async function decideSuggestion(id: string, status: "accepted" | "dismissed", actorId: string | null) {
  const sb = createClient();
  const { error } = await sb
    .from("lead_suggestions")
    .update({ status, decided_at: nowIso(), decided_by: actorId })
    .eq("id", id);
  fail("save the decision", error);
}

/** A move by hand makes every pending suggestion for the lead stale. */
async function supersede(leadId: string) {
  try {
    const sb = createClient();
    await sb
      .from("lead_suggestions")
      .update({ status: "superseded", decided_at: nowIso() })
      .eq("lead_id", leadId)
      .eq("status", "pending");
  } catch {
    // Before 0044 there is nothing to supersede.
  }
}

/** Asks the server to email the approver, once per offer (0044's `review_alerted_at`). */
export async function alertOfferReview(offerId: string) {
  try {
    await fetch("/api/leads/offer-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId }),
    });
  } catch {
    // Best-effort: the offer is saved and shows "In review" either way.
  }
}

/** What the offer rules need to know about where the lead stands. */
export interface RuleContext {
  current: LeadStage | undefined;
  stages: LeadStage[];
}

export async function saveMailSetting(key: "digest_recipients" | "approver_ids", profileIds: string[]) {
  const sb = createClient();
  const { error } = await sb
    .from("lead_settings")
    .upsert({ key, value: profileIds, updated_at: nowIso() }, { onConflict: "key" });
  fail("save the email setting", error);
}
