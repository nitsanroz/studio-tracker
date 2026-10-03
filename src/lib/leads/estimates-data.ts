"use client";

// Reads and writes for estimates and the service library (0045).
//
// Kept apart from `data.ts` / `actions.ts` because it is its own sub-domain
// with its own lifecycle (draft → in review → approved → published), and those
// two files are already long. Same conventions: browser client, admin-only by
// RLS, writes throw LeadWriteError.

import { createClient } from "../supabase/client";
import { LeadWriteError, alertOfferReview } from "./actions";
import { fmtHours, fmtNis, groupWinners, totals, type Category, type Estimate, type EstimateLine, type EstimatePhase, type Range, type ServiceItem } from "./estimate";

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const nstr = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const nnum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const fail = (label: string, error: { message: string } | null) => {
  if (error) throw new LeadWriteError(label, error.message);
};

export function mapItem(r: Row): ServiceItem {
  return {
    id: str(r.id),
    name: str(r.name),
    category: (str(r.category) || "other") as Category,
    kind: r.kind === "percent" ? "percent" : "hours",
    minHours: nnum(r.min_hours),
    maxHours: nnum(r.max_hours),
    percent: nnum(r.percent),
    percentOf: nstr(r.percent_of) as Category | null,
    description: nstr(r.description),
    position: nnum(r.position) ?? 0,
    active: r.active !== false,
  };
}

export function mapEstimate(r: Row): Estimate {
  const st = str(r.status);
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    version: nnum(r.version) ?? 1,
    status: (st === "in_review" || st === "approved" ? st : "draft") as Estimate["status"],
    rate: nnum(r.rate) ?? 350,
    vatPercent: nnum(r.vat_percent) ?? 18,
    discountPercent: nnum(r.discount_percent),
    discountNote: nstr(r.discount_note),
    intro: nstr(r.intro),
    timeline: nstr(r.timeline),
    closing: nstr(r.closing),
    changeNote: nstr(r.change_note),
    offerId: nstr(r.offer_id),
    approvedBy: nstr(r.approved_by),
    approvedAt: nstr(r.approved_at),
    shareToken: nstr(r.share_token),
    publishedAt: nstr(r.published_at),
    createdAt: str(r.created_at),
  };
}

export function mapPhase(r: Row): EstimatePhase {
  return {
    id: str(r.id),
    estimateId: str(r.estimate_id),
    name: str(r.name),
    description: nstr(r.description),
    position: nnum(r.position) ?? 0,
  };
}

export function mapLine(r: Row): EstimateLine {
  return {
    id: str(r.id),
    estimateId: str(r.estimate_id),
    phaseId: nstr(r.phase_id),
    serviceItemId: nstr(r.service_item_id),
    name: str(r.name),
    description: nstr(r.description),
    category: (str(r.category) || "other") as Category,
    kind: r.kind === "percent" ? "percent" : "hours",
    minHours: nnum(r.min_hours),
    maxHours: nnum(r.max_hours),
    percent: nnum(r.percent),
    percentOf: nstr(r.percent_of) as Category | null,
    optional: r.optional === true,
    altGroup: nstr(r.alt_group),
    chosen: r.chosen !== false,
    position: nnum(r.position) ?? 0,
    taskId: nstr(r.task_id),
  };
}

const ESTIMATE_COLS =
  "id,lead_id,version,status,rate,vat_percent,discount_percent,discount_note,intro,timeline,closing," +
  "change_note,offer_id,approved_by,approved_at,share_token,published_at,created_at";

// ── reads ───────────────────────────────────────────────────────────────────

export async function loadLibrary(): Promise<ServiceItem[]> {
  const sb = createClient();
  const { data, error } = await sb.from("service_items").select("*").order("position");
  if (error) return [];
  return ((data ?? []) as Row[]).map(mapItem);
}

export async function loadPricing(): Promise<{ rate: number; vatPercent: number }> {
  const sb = createClient();
  const { data } = await sb.from("lead_settings").select("value").eq("key", "pricing").maybeSingle();
  const v = (data as { value?: { rate?: unknown; vat_percent?: unknown } } | null)?.value;
  return { rate: nnum(v?.rate) ?? 350, vatPercent: nnum(v?.vat_percent) ?? 18 };
}

export interface EstimateSummary extends Estimate {
  net: { min: number; max: number };
  hours: { min: number; max: number };
}

/** Every version for one lead, newest first, each with its total. */
export async function loadEstimates(leadId: string): Promise<EstimateSummary[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("lead_estimates")
    .select(ESTIMATE_COLS)
    .eq("lead_id", leadId)
    .order("version", { ascending: false });
  if (error) return [];
  const ests = ((data ?? []) as unknown as Row[]).map(mapEstimate);
  if (ests.length === 0) return [];
  const { data: lineRows } = await sb
    .from("estimate_lines")
    .select("*")
    .in(
      "estimate_id",
      ests.map((e) => e.id),
    );
  const lines = ((lineRows ?? []) as Row[]).map(mapLine);
  return ests.map((e) => {
    const t = totals(
      lines.filter((l) => l.estimateId === e.id),
      e.rate,
      e.vatPercent,
      e.discountPercent,
    );
    return { ...e, net: t.net, hours: t.totalHours };
  });
}

export interface EstimateDetail {
  estimate: Estimate;
  phases: EstimatePhase[];
  lines: EstimateLine[];
  /** Logged hours per task, for lines that became tasks on Won (US21). */
  actual: Map<string, number>;
}

export async function loadEstimate(id: string): Promise<EstimateDetail | null> {
  const sb = createClient();
  const { data, error } = await sb.from("lead_estimates").select(ESTIMATE_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [phases, lines] = await Promise.all([
    sb.from("estimate_phases").select("*").eq("estimate_id", id).order("position"),
    sb.from("estimate_lines").select("*").eq("estimate_id", id).order("position"),
  ]);
  const ls = ((lines.data ?? []) as Row[]).map(mapLine);
  const actual = new Map<string, number>();
  const taskIds = ls.map((l) => l.taskId).filter((t): t is string => Boolean(t));
  if (taskIds.length) {
    const { data: te } = await sb.from("time_entries").select("task_id,minutes").in("task_id", taskIds);
    for (const r of (te ?? []) as Row[]) {
      const t = str(r.task_id);
      actual.set(t, (actual.get(t) ?? 0) + (nnum(r.minutes) ?? 0) / 60);
    }
  }
  return {
    estimate: mapEstimate(data as unknown as Row),
    phases: ((phases.data ?? []) as Row[]).map(mapPhase),
    lines: ls,
    actual,
  };
}

/**
 * Average real hours per library item, from lines that became tasks on won
 * leads (US21) — so next quote's ranges can be checked against what the work
 * actually took.
 */
export async function loadLibraryActuals(): Promise<Map<string, { avg: number; n: number }>> {
  const sb = createClient();
  const { data: rows } = await sb
    .from("estimate_lines")
    .select("service_item_id,task_id")
    .not("service_item_id", "is", null)
    .not("task_id", "is", null);
  const pairs = (rows ?? []) as Row[];
  const out = new Map<string, { avg: number; n: number }>();
  if (pairs.length === 0) return out;
  const { data: te } = await sb
    .from("time_entries")
    .select("task_id,minutes")
    .in(
      "task_id",
      pairs.map((p) => str(p.task_id)),
    );
  const byTask = new Map<string, number>();
  for (const r of (te ?? []) as Row[]) byTask.set(str(r.task_id), (byTask.get(str(r.task_id)) ?? 0) + (nnum(r.minutes) ?? 0) / 60);
  const acc = new Map<string, number[]>();
  for (const p of pairs) {
    const h = byTask.get(str(p.task_id));
    if (h === undefined) continue;
    const k = str(p.service_item_id);
    acc.set(k, [...(acc.get(k) ?? []), h]);
  }
  for (const [k, list] of acc) out.set(k, { avg: list.reduce((a, b) => a + b, 0) / list.length, n: list.length });
  return out;
}

// ── estimate writes ─────────────────────────────────────────────────────────

const LOCKED = "This version is approved and can't be changed — save it as a new version to edit.";

async function assertEditable(estimateId: string) {
  const sb = createClient();
  const { data } = await sb.from("lead_estimates").select("status").eq("id", estimateId).maybeSingle();
  if ((data as { status?: string } | null)?.status === "approved") throw new LeadWriteError("edit the estimate", LOCKED);
}

/** v1 of a lead's estimate: studio rate and VAT, one empty phase. */
export async function createEstimate(leadId: string, company: string, actorId: string | null): Promise<string> {
  const sb = createClient();
  const pricing = await loadPricing();
  const { data: last } = await sb
    .from("lead_estimates")
    .select("version")
    .eq("lead_id", leadId)
    .order("version", { ascending: false })
    .limit(1);
  const version = (((last ?? [])[0] as { version?: number } | undefined)?.version ?? 0) + 1;
  const { data, error } = await sb
    .from("lead_estimates")
    .insert({
      lead_id: leadId,
      version,
      rate: pricing.rate,
      vat_percent: pricing.vatPercent,
      intro: `Hi,\n\nThanks again for the conversation. Below is our estimated scope, pricing and timeline for ${company}.\n\nWe work on an hourly basis (${pricing.rate} NIS + VAT per hour); ranges are refined once content is final.`,
      created_by: actorId,
    })
    .select("id")
    .single();
  fail("create the estimate", error);
  const id = (data as { id: string }).id;
  await sb.from("estimate_phases").insert({ estimate_id: id, name: "Phase 1", position: 1 });
  return id;
}

/**
 * "Save as new version": copies this version — text, phases, lines — into
 * version + 1 as a draft, with the note saying what is about to change.
 *
 * ⚠️ THE SOURCE IS NEVER TOUCHED. Whatever it was (an approved v2 the client
 * has seen) stays exactly as it was; all editing happens on the copy.
 */
export async function newVersion(estimateId: string, changeNote: string, actorId: string | null): Promise<string> {
  const src = await loadEstimate(estimateId);
  if (!src) throw new LeadWriteError("copy the estimate", "it no longer exists");
  return copyInto(src, src.estimate.leadId, changeNote, actorId, null);
}

/**
 * "New estimate from…" — copies ANY estimate (an earlier one for this client,
 * or another project's as a template) into a new draft on `targetLeadId`.
 *
 * ⚠️ THE SOURCE'S COMPANY NAME IS SWAPPED FOR THE TARGET'S in the client-facing
 * text (intro, timeline, closing, phase and line descriptions). A template from
 * the Unibeam quote that still says "Hi Rivi … Unibeam" in another client's
 * intro is the one mistake nobody would forgive; everything else is meant to be
 * edited anyway. The greeting's NAME cannot be known and is left for editing.
 *
 * ⚠️ ONLY THE CONTENT TRAVELS — status, approval, the offer link and the
 * published client page stay with the source. The copy is a draft.
 */
export async function copyEstimate(
  sourceId: string,
  targetLeadId: string,
  targetCompany: string,
  actorId: string | null,
): Promise<string> {
  const src = await loadEstimate(sourceId);
  if (!src) throw new LeadWriteError("copy the estimate", "it no longer exists");
  const sb = createClient();
  const { data: srcLead } = await sb.from("leads").select("company").eq("id", src.estimate.leadId).maybeSingle();
  const fromCompany = (srcLead as { company?: string } | null)?.company ?? "";
  const sameLead = src.estimate.leadId === targetLeadId;
  const note = sameLead
    ? `Started from v${src.estimate.version}`
    : `Started from ${fromCompany || "another estimate"} v${src.estimate.version}`;
  return copyInto(src, targetLeadId, note, actorId, sameLead || !fromCompany ? null : { from: fromCompany, to: targetCompany });
}

function swapName(text: string | null, swap: { from: string; to: string } | null): string | null {
  if (!text || !swap || !swap.from.trim()) return text;
  const esc = swap.from.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(esc, "gi"), swap.to);
}

async function copyInto(
  src: EstimateDetail,
  targetLeadId: string,
  changeNote: string,
  actorId: string | null,
  swap: { from: string; to: string } | null,
): Promise<string> {
  const sb = createClient();
  const { data: last } = await sb
    .from("lead_estimates")
    .select("version")
    .eq("lead_id", targetLeadId)
    .order("version", { ascending: false })
    .limit(1);
  const version = (((last ?? [])[0] as { version?: number } | undefined)?.version ?? 0) + 1;
  const e = src.estimate;
  const { data, error } = await sb
    .from("lead_estimates")
    .insert({
      lead_id: targetLeadId,
      version,
      rate: e.rate,
      vat_percent: e.vatPercent,
      discount_percent: e.discountPercent,
      discount_note: e.discountNote,
      intro: swapName(e.intro, swap),
      timeline: swapName(e.timeline, swap),
      closing: swapName(e.closing, swap),
      change_note: changeNote.trim() || null,
      created_by: actorId,
    })
    .select("id")
    .single();
  fail("save the new version", error);
  const id = (data as { id: string }).id;
  const phaseMap = new Map<string, string>();
  for (const p of src.phases) {
    const { data: np, error: pe } = await sb
      .from("estimate_phases")
      .insert({ estimate_id: id, name: p.name, description: swapName(p.description, swap), position: p.position })
      .select("id")
      .single();
    fail("copy a phase", pe);
    phaseMap.set(p.id, (np as { id: string }).id);
  }
  if (src.lines.length) {
    const { error: le } = await sb.from("estimate_lines").insert(
      src.lines.map((l) => ({
        estimate_id: id,
        phase_id: l.phaseId ? (phaseMap.get(l.phaseId) ?? null) : null,
        service_item_id: l.serviceItemId,
        name: l.name,
        description: swapName(l.description, swap),
        category: l.category,
        kind: l.kind,
        min_hours: l.minHours,
        max_hours: l.maxHours,
        percent: l.percent,
        percent_of: l.percentOf,
        optional: l.optional,
        alt_group: l.altGroup,
        chosen: l.chosen,
        position: l.position,
      })),
    );
    fail("copy the lines", le);
  }
  return id;
}

export interface EstimateSourcePhase {
  name: string;
  hours: Range;
  lines: { name: string; optional: boolean; alternative: boolean; hours: Range }[];
}

export interface EstimateSource {
  id: string;
  leadId: string;
  company: string;
  clientId: string | null;
  version: number;
  status: Estimate["status"];
  createdAt: string;
  changeNote: string | null;
  lineCount: number;
  /** Counted hours and the ₪ after discount, before VAT — the figure quoted "+ VAT". */
  hours: Range;
  net: Range;
  rate: number;
  discountPercent: number | null;
  phases: EstimateSourcePhase[];
}

/**
 * Every estimate in the studio, for the "start from" picker — company,
 * version, status, its total and what it holds (phases and their lines), so
 * a starting point can be chosen by what it contains rather than by name.
 * Three queries for the whole studio (~35 estimates, ~500 lines).
 */
export async function loadEstimateSources(): Promise<EstimateSource[]> {
  const sb = createClient();
  // ⚠️ A binned lead's estimates are not offered as a starting point (0047);
  // `deleted_at` is in the embed, filtered here so 0047-less DBs still list.
  const q = (cols: string) =>
    sb
      .from("lead_estimates")
      .select(`id,lead_id,version,status,created_at,rate,vat_percent,discount_percent,change_note,leads(${cols})`)
      .order("created_at", { ascending: false });
  let { data, error } = await q("company,client_id,deleted_at");
  if (error) ({ data, error } = await q("company,client_id"));
  if (error) return [];
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => !((r.leads ?? {}) as Row).deleted_at);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => str(r.id));
  const [lineRes, phaseRes] = await Promise.all([
    sb.from("estimate_lines").select("*").in("estimate_id", ids).order("position"),
    sb.from("estimate_phases").select("id,estimate_id,name,position").in("estimate_id", ids).order("position"),
  ]);
  const lines = ((lineRes.data ?? []) as Row[]).map(mapLine);
  const phases = ((phaseRes.data ?? []) as Row[]).map((r) => mapPhase(r));
  return rows.map((r) => {
    const lead = (r.leads ?? {}) as Row;
    const st = str(r.status);
    const id = str(r.id);
    const ls = lines.filter((l) => l.estimateId === id);
    const t = totals(ls, nnum(r.rate) ?? 350, nnum(r.vat_percent) ?? 18, nnum(r.discount_percent));
    const ps = phases.filter((p) => p.estimateId === id).sort((a, b) => a.position - b.position);
    const phaseOf = (pid: string | null, name: string): EstimateSourcePhase => ({
      name,
      hours: t.phase.get(pid ?? "") ?? { min: 0, max: 0 },
      lines: ls
        .filter((l) => (l.phaseId ?? null) === pid)
        .map((l) => ({
          name: l.name,
          optional: l.optional,
          alternative: Boolean(l.altGroup),
          hours: t.hours.get(l.id) ?? { min: 0, max: 0 },
        })),
    });
    const out = ps.map((p) => phaseOf(p.id, p.name));
    if (ls.some((l) => !l.phaseId || !ps.some((p) => p.id === l.phaseId))) {
      const orphan = ls.filter((l) => !l.phaseId || !ps.some((p) => p.id === l.phaseId));
      out.push({
        name: "Other",
        hours: t.phase.get("") ?? { min: 0, max: 0 },
        lines: orphan.map((l) => ({
          name: l.name,
          optional: l.optional,
          alternative: Boolean(l.altGroup),
          hours: t.hours.get(l.id) ?? { min: 0, max: 0 },
        })),
      });
    }
    return {
      id,
      leadId: str(r.lead_id),
      company: str(lead.company),
      clientId: nstr(lead.client_id),
      version: nnum(r.version) ?? 1,
      status: (st === "in_review" || st === "approved" ? st : "draft") as Estimate["status"],
      createdAt: str(r.created_at),
      changeNote: nstr(r.change_note),
      lineCount: ls.length,
      hours: t.totalHours,
      net: t.net,
      rate: nnum(r.rate) ?? 350,
      discountPercent: nnum(r.discount_percent),
      phases: out.filter((p) => p.lines.length > 0),
    };
  });
}

export async function updateEstimate(
  id: string,
  patch: Partial<{
    rate: number;
    vatPercent: number;
    discountPercent: number | null;
    discountNote: string | null;
    intro: string | null;
    timeline: string | null;
    closing: string | null;
    changeNote: string | null;
  }>,
) {
  await assertEditable(id);
  const row: Row = {};
  if ("rate" in patch) row.rate = patch.rate;
  if ("vatPercent" in patch) row.vat_percent = patch.vatPercent;
  if ("discountPercent" in patch) row.discount_percent = patch.discountPercent;
  if ("discountNote" in patch) row.discount_note = patch.discountNote;
  if ("intro" in patch) row.intro = patch.intro;
  if ("timeline" in patch) row.timeline = patch.timeline;
  if ("closing" in patch) row.closing = patch.closing;
  if ("changeNote" in patch) row.change_note = patch.changeNote;
  const sb = createClient();
  const { error } = await sb.from("lead_estimates").update(row).eq("id", id);
  fail("save the estimate", error);
}

export async function deleteEstimate(id: string) {
  await assertEditable(id);
  const sb = createClient();
  const { error } = await sb.from("lead_estimates").delete().eq("id", id);
  fail("delete the estimate", error);
}

export async function addPhase(estimateId: string, name: string, position: number) {
  await assertEditable(estimateId);
  const sb = createClient();
  const { error } = await sb.from("estimate_phases").insert({ estimate_id: estimateId, name, position });
  fail("add the phase", error);
}

export async function updatePhase(estimateId: string, id: string, patch: { name?: string; description?: string | null }) {
  await assertEditable(estimateId);
  const sb = createClient();
  const { error } = await sb.from("estimate_phases").update(patch).eq("id", id);
  fail("save the phase", error);
}

export async function removePhase(estimateId: string, id: string) {
  await assertEditable(estimateId);
  const sb = createClient();
  const { error } = await sb.from("estimate_phases").delete().eq("id", id);
  fail("remove the phase", error);
}

/** A line from the library — or a blank one when `item` is null. */
export async function addLine(estimateId: string, phaseId: string, item: ServiceItem | null, position: number) {
  await assertEditable(estimateId);
  const sb = createClient();
  const { error } = await sb.from("estimate_lines").insert({
    estimate_id: estimateId,
    phase_id: phaseId,
    service_item_id: item?.id ?? null,
    name: item?.name ?? "New line",
    description: item?.description ?? null,
    category: item?.category ?? "other",
    kind: item?.kind ?? "hours",
    min_hours: item ? item.minHours : 0,
    max_hours: item ? item.maxHours : 0,
    percent: item?.percent ?? null,
    percent_of: item?.percentOf ?? null,
    position,
  });
  fail("add the line", error);
}

export type LinePatch = Partial<{
  name: string;
  description: string | null;
  category: Category;
  minHours: number | null;
  maxHours: number | null;
  percent: number | null;
  optional: boolean;
  altGroup: string | null;
  chosen: boolean;
  phaseId: string;
}>;

export async function updateLine(estimateId: string, id: string, patch: LinePatch) {
  await assertEditable(estimateId);
  const row: Row = {};
  if ("name" in patch) row.name = patch.name;
  if ("description" in patch) row.description = patch.description;
  if ("category" in patch) row.category = patch.category;
  if ("minHours" in patch) row.min_hours = patch.minHours;
  if ("maxHours" in patch) row.max_hours = patch.maxHours;
  if ("percent" in patch) row.percent = patch.percent;
  if ("optional" in patch) row.optional = patch.optional;
  if ("altGroup" in patch) row.alt_group = patch.altGroup;
  if ("chosen" in patch) row.chosen = patch.chosen;
  if ("phaseId" in patch) row.phase_id = patch.phaseId;
  const sb = createClient();
  const { error } = await sb.from("estimate_lines").update(row).eq("id", id);
  fail("save the line", error);
}

/** Picking one line of a choose-one group un-picks the others. */
export async function chooseAlternative(estimateId: string, group: string, lineId: string) {
  await assertEditable(estimateId);
  const sb = createClient();
  const { error: e1 } = await sb
    .from("estimate_lines")
    .update({ chosen: false })
    .eq("estimate_id", estimateId)
    .eq("alt_group", group);
  fail("choose the option", e1);
  const { error: e2 } = await sb.from("estimate_lines").update({ chosen: true }).eq("id", lineId);
  fail("choose the option", e2);
}

export async function removeLine(estimateId: string, id: string) {
  await assertEditable(estimateId);
  const sb = createClient();
  const { error } = await sb.from("estimate_lines").delete().eq("id", id);
  fail("remove the line", error);
}

// ── review, approval, publishing ────────────────────────────────────────────

/**
 * "Send for review" — the estimate becomes an Offer in review, which is what
 * fires the approver's email (Phase 3) and shows on the Offers tab.
 *
 * ⚠️ THE OFFER CARRIES THE TOP OF THE RANGE, NET OF DISCOUNT, BEFORE VAT —
 * the figure the pipeline should count, since the studio quotes "+ VAT" and a
 * range's upper bound is what the client has been told to budget for. The
 * full range is in its scope summary.
 */
export async function submitForReview(estimateId: string, actorId: string | null) {
  const d = await loadEstimate(estimateId);
  if (!d) throw new LeadWriteError("send the estimate", "it no longer exists");
  const e = d.estimate;
  if (e.status === "approved") throw new LeadWriteError("send the estimate", LOCKED);
  const t = totals(d.lines, e.rate, e.vatPercent, e.discountPercent);
  const summary = `Estimate v${e.version}: ${fmtHours(t.totalHours)} · ${fmtNis(t.net)} + VAT`;
  const sb = createClient();
  let offerId = e.offerId;
  if (offerId) {
    const { error } = await sb
      .from("lead_offers")
      .update({ amount: Math.round(t.net.max), currency: "ILS", scope_summary: summary, status: "in_review" })
      .eq("id", offerId);
    fail("update the offer", error);
  } else {
    const { data: last } = await sb
      .from("lead_offers")
      .select("version")
      .eq("lead_id", e.leadId)
      .order("version", { ascending: false })
      .limit(1);
    const version = (((last ?? [])[0] as { version?: number } | undefined)?.version ?? 0) + 1;
    const { data, error } = await sb
      .from("lead_offers")
      .insert({
        lead_id: e.leadId,
        version,
        amount: Math.round(t.net.max),
        currency: "ILS",
        scope_summary: summary,
        status: "in_review",
        created_by: actorId,
      })
      .select("id")
      .single();
    fail("create the offer", error);
    offerId = (data as { id: string }).id;
  }
  const { error } = await sb.from("lead_estimates").update({ status: "in_review", offer_id: offerId }).eq("id", estimateId);
  fail("send the estimate", error);
  await alertOfferReview(offerId);
}

/** Approve: locks the version and marks its offer approved by whoever pressed it. */
export async function approveEstimate(estimateId: string, actorId: string | null) {
  const sb = createClient();
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("lead_estimates")
    .update({ status: "approved", approved_by: actorId, approved_at: now })
    .eq("id", estimateId)
    .select("offer_id,lead_id")
    .single();
  fail("approve the estimate", error);
  const offerId = (data as { offer_id: string | null }).offer_id;
  if (offerId) await sb.from("lead_offers").update({ approved_by: actorId, approved_at: now }).eq("id", offerId);
}

/** Back to draft from review (not from approved — that needs a new version). */
export async function reopenEstimate(estimateId: string) {
  const sb = createClient();
  const { error } = await sb
    .from("lead_estimates")
    .update({ status: "draft" })
    .eq("id", estimateId)
    .eq("status", "in_review");
  fail("reopen the estimate", error);
}

export interface PublishedEstimate {
  company: string;
  version: number;
  rate: number;
  vatPercent: number;
  discountPercent: number | null;
  discountNote: string | null;
  intro: string | null;
  timeline: string | null;
  closing: string | null;
  phases: {
    name: string;
    description: string | null;
    hours: { min: number; max: number };
    lines: {
      name: string;
      description: string | null;
      hours: { min: number; max: number };
      optional: boolean;
      altGroup: string | null;
      chosen: boolean;
    }[];
  }[];
  totalHours: { min: number; max: number };
  subtotal: { min: number; max: number };
  discount: { min: number; max: number };
  net: { min: number; max: number };
  publishedAt: string;
}

/**
 * Publish to the client: freezes what they will see into `published_snapshot`
 * and returns the link. Approved versions only — no price goes out without
 * review (US17).
 *
 * ⚠️ A SNAPSHOT, LIKE THE CLIENT REPORTS. Editing the estimate afterwards (in a
 * new version) never changes the page a client already has; publishing the new
 * version gives it its own link.
 */
export async function publishEstimate(estimateId: string, company: string): Promise<string> {
  const d = await loadEstimate(estimateId);
  if (!d) throw new LeadWriteError("publish", "the estimate no longer exists");
  const e = d.estimate;
  if (e.status !== "approved") throw new LeadWriteError("publish", "approve the estimate first.");
  const t = totals(d.lines, e.rate, e.vatPercent, e.discountPercent);
  const winners = groupWinners(d.lines);
  const now = new Date().toISOString();
  const snap: PublishedEstimate = {
    company,
    version: e.version,
    rate: e.rate,
    vatPercent: e.vatPercent,
    discountPercent: e.discountPercent,
    discountNote: e.discountNote,
    intro: e.intro,
    timeline: e.timeline,
    closing: e.closing,
    phases: d.phases.map((p) => ({
      name: p.name,
      description: p.description,
      hours: t.phase.get(p.id) ?? { min: 0, max: 0 },
      lines: d.lines
        .filter((l) => l.phaseId === p.id)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          name: l.name,
          description: l.description,
          hours: t.hours.get(l.id) ?? { min: 0, max: 0 },
          optional: l.optional,
          altGroup: l.altGroup,
          chosen: l.altGroup ? winners.get(l.altGroup) === l.id : true,
        })),
    })),
    totalHours: t.totalHours,
    subtotal: t.subtotal,
    discount: t.discount,
    net: t.net,
    publishedAt: now,
  };
  const token = e.shareToken ?? crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const sb = createClient();
  const { error } = await sb
    .from("lead_estimates")
    .update({ share_token: token, published_snapshot: snap, published_at: now })
    .eq("id", estimateId);
  fail("publish the estimate", error);
  return token;
}

// ── the library ─────────────────────────────────────────────────────────────

export async function addLibraryItem(position: number) {
  const sb = createClient();
  const { error } = await sb
    .from("service_items")
    .insert({ name: "New item", category: "other", kind: "hours", min_hours: 0, max_hours: 0, position });
  fail("add the item", error);
}

export async function updateLibraryItem(
  id: string,
  patch: Partial<{
    name: string;
    category: Category;
    minHours: number | null;
    maxHours: number | null;
    percent: number | null;
    percentOf: Category | null;
    description: string | null;
    active: boolean;
  }>,
) {
  const row: Row = {};
  if ("name" in patch) row.name = patch.name;
  if ("category" in patch) row.category = patch.category;
  if ("minHours" in patch) row.min_hours = patch.minHours;
  if ("maxHours" in patch) row.max_hours = patch.maxHours;
  if ("percent" in patch) row.percent = patch.percent;
  if ("percentOf" in patch) row.percent_of = patch.percentOf;
  if ("description" in patch) row.description = patch.description;
  if ("active" in patch) row.active = patch.active;
  const sb = createClient();
  const { error } = await sb.from("service_items").update(row).eq("id", id);
  fail("save the item", error);
}

export async function savePricing(rate: number, vatPercent: number) {
  const sb = createClient();
  const { error } = await sb
    .from("lead_settings")
    .upsert({ key: "pricing", value: { rate, vat_percent: vatPercent }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  fail("save the pricing", error);
}

/** The newest approved version for a lead, if any — what "Mark as won" can turn into work. */
export async function latestApproved(leadId: string): Promise<EstimateSummary | null> {
  const list = await loadEstimates(leadId);
  return list.find((e) => e.status === "approved") ?? null;
}

/**
 * Won → work: each phase becomes a section under the client, each counted line
 * a task with its budget (`estimate_hours`), and the line remembers its task so
 * the hours logged on it flow back to the library (US21).
 *
 * ⚠️ THE BUDGET IS THE TOP OF THE RANGE. That is what the client was told to
 * expect and what the studio priced; the bottom is the hopeful case, and a
 * budget bar that goes red at the hopeful case reads as an overrun that isn't.
 *
 * ⚠️ OPTIONAL EXTRAS AND OPTIONS NOT CHOSEN DO NOT BECOME TASKS — they were not
 * sold. Percentage lines (Mobile, QA…) do, with their resolved hours.
 */
export async function estimateToWork(estimateId: string, clientId: string, billable: boolean): Promise<number> {
  const d = await loadEstimate(estimateId);
  if (!d) throw new LeadWriteError("create the work", "the estimate no longer exists");
  const sb = createClient();
  const t = totals(d.lines, d.estimate.rate, d.estimate.vatPercent, d.estimate.discountPercent);
  const { data: existing } = await sb
    .from("sections")
    .select("position")
    .eq("client_id", clientId)
    .order("position", { ascending: false })
    .limit(1);
  let secPos = (((existing ?? [])[0] as { position?: number } | undefined)?.position ?? 0) + 1;
  let made = 0;
  const winners = groupWinners(d.lines);
  for (const p of d.phases) {
    const lines = d.lines.filter(
      (l) => l.phaseId === p.id && !l.optional && (!l.altGroup || winners.get(l.altGroup) === l.id),
    );
    if (lines.length === 0) continue;
    const { data: sec, error } = await sb
      .from("sections")
      .insert({ client_id: clientId, name: p.name, position: secPos++ })
      .select("id")
      .single();
    fail("add a section", error);
    const sectionId = (sec as { id: string }).id;
    let pos = 1;
    for (const l of lines.sort((a, b) => a.position - b.position)) {
      const h = t.hours.get(l.id);
      const { data: task, error: te } = await sb
        .from("tasks")
        .insert({
          client_id: clientId,
          section_id: sectionId,
          title: l.name,
          estimate_hours: h ? Math.round(h.max * 100) / 100 : null,
          billable,
          position: pos++,
        })
        .select("id")
        .single();
      fail("add a task", te);
      await sb.from("estimate_lines").update({ task_id: (task as { id: string }).id }).eq("id", l.id);
      made++;
    }
  }
  return made;
}
