// One-time import of Michal's lead Sheets into Leads (0042).
//
//   node --env-file=.env.local scripts/import-leads.mjs <history.csv> [active.csv]           # dry run
//   node --env-file=.env.local scripts/import-leads.mjs <history.csv> [active.csv] --write   # writes
//
// <history.csv>  leads_full_history_FINAL exported as CSV
//                columns: date,sender,company_name,what_they_asked_for,origin,notes,lead_status,digest
// [active.csv]   Studio&more_Pipeline → "Active pipeline" tab
//                columns: Date,POC,Title,Company,Website,Email,Linkedin,Status,notes
//
// ⚠️ ONE-TIME, BY DECISION (Nitsan, 2026-10-02): the Sheets are imported once
// and the tracker is the source of truth from then on — no live link back, the
// same line July drew for the weekly plan and Everhour.
//
// ⚠️ RE-RUNNABLE ANYWAY. Every lead carries a `sheet_ref` (unique in 0042) and a
// row whose ref already exists is skipped, so running --write twice adds
// nothing the second time.
//
// ⚠️ ALL 619 ROWS COME IN AS HISTORY, and only the recent open ones land on the
// board (Nitsan's choice). An "Open – no reply visible" row from 2021 is not a
// live deal; it arrives in Lost / No response with the Sheet's own status kept
// in the note, so nothing anybody wrote is lost and the board shows only what
// is actually moving. EVERY ROW KEEPS ITS ORIGINAL DATE — created, stage and
// last-activity — or "lost this month" would read 600.
//
// ⚠️ A WON ROW IS LINKED TO AN EXISTING CLIENT BY NAME WHEN ONE MATCHES, and no
// client is ever created here. Those deals are years old and already live in
// the tracker if they live anywhere.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fromCsv } from "./lib/csv.mjs";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const [historyPath, activePath] = args.filter((a) => !a.startsWith("--"));
if (!historyPath) {
  console.error("usage: import-leads.mjs <history.csv> [active.csv] [--write]");
  process.exit(1);
}

/** Open rows on or after this date go on the board; older open rows are history. */
const LIVE_SINCE = "2026-04-01";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── helpers ────────────────────────────────────────────────────────────────

const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com",
  "icloud.com", "me.com", "walla.co.il", "walla.com", "proton.me", "protonmail.com", "aol.com",
]);
/** Same rule as `domainOf` in src/lib/leads/types.ts. */
function domainOf(input) {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) || PERSONAL.has(s)) return null;
  return s;
}

/** dd/mm/yyyy → ISO at midday Israel time, so it never slips a day. */
function isoDate(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const at = (day) => (day ? `${day}T12:00:00+03:00` : new Date().toISOString());

/** "ashley.harrington@x.com" → "Ashley Harrington"; anything else stays the address. */
function nameFromEmail(email) {
  const local = (email ?? "").split("@")[0];
  if (!/[._-]/.test(local) || /\d{3,}/.test(local)) return email || "Unknown";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function sourceOf(origin) {
  return /website form/i.test(origin ?? "") ? "website" : null;
}

/** The Sheet's free-text status → a stage kind/name and, if lost, a reason. */
function classify(status, day) {
  const s = (status ?? "").toLowerCase();
  if (/^won/.test(s)) return { stage: "Won" };
  const lost = (reason) => ({ stage: "Lost", reason });
  if (/^declined|^lost|vendor|not a client|insufficient data|^no reply/.test(s)) {
    if (/budget|priced out/.test(s)) return lost("Budget");
    if (/timing|fully booked|not available|deadline|urgent/.test(s)) return lost("Timing");
    if (/another studio|different studio|went with/.test(s)) return lost("Went with another studio");
    if (/no reply|dropped|stalled/.test(s)) return lost("No response");
    if (
      /fit|focus|scope|rework|vendor|not a client|referred|small|relevant|type of work|marketing agency|ecommerce|development|from-scratch|large-scale|wix|resource|existing language|busy/.test(
        s,
      )
    )
      return lost("Not a fit");
    return lost(null);
  }
  // Open of some kind.
  if (!day || day < LIVE_SINCE) return { ...lost("No response"), aged: true };
  if (/negotiat|rfp/.test(s)) return { stage: "Negotiation" };
  if (/quote sent|offer sent|estimate sent/.test(s)) return { stage: "Offer sent" };
  if (/quote requested|awaiting quote|scoped|awaiting budget/.test(s)) return { stage: "Offer in prep" };
  if (/call held|meeting held|detailed|brief shared|scoping|zoom|meeting|call/.test(s)) return { stage: "Discovery" };
  return { stage: "Relevant" };
}

const norm = (s) => (s ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9֐-׿]+/g, " ").trim();

// ── read ───────────────────────────────────────────────────────────────────

const history = fromCsv(readFileSync(historyPath, "utf8"));
const active = activePath ? fromCsv(readFileSync(activePath, "utf8")) : [];

const [{ data: stages, error: e1 }, { data: reasons, error: e2 }, { data: clients }, { data: existing }] =
  await Promise.all([
    sb.from("lead_stages").select("id,name,kind"),
    sb.from("lead_lost_reasons").select("id,name"),
    sb.from("clients").select("id,name,archived"),
    sb.from("leads").select("sheet_ref"),
  ]);
if (e1 || e2) throw e1 ?? e2;
const stageByName = new Map(stages.map((s) => [s.name, s]));
const reasonByName = new Map(reasons.map((r) => [r.name, r]));
const have = new Set((existing ?? []).map((r) => r.sheet_ref).filter(Boolean));
for (const n of ["Relevant", "Discovery", "Offer in prep", "Offer sent", "Negotiation", "Won", "Lost"]) {
  if (!stageByName.has(n)) throw new Error(`Stage "${n}" not found — was it renamed in Settings?`);
}

function clientFor(company) {
  const c = norm(company);
  if (!c) return null;
  return (
    clients.find((x) => norm(x.name) === c) ??
    clients.find((x) => norm(x.name).length >= 4 && (c.startsWith(norm(x.name)) || norm(x.name).startsWith(c))) ??
    null
  );
}

// ── build ──────────────────────────────────────────────────────────────────

const plans = [];
const refCount = new Map();

for (const r of history) {
  const day = isoDate(r.date);
  const email = (r.sender ?? "").trim().toLowerCase() || null;
  let ref = `history:${day ?? "nodate"}:${email ?? norm(r.company_name)}`;
  const n = (refCount.get(ref) ?? 0) + 1;
  refCount.set(ref, n);
  if (n > 1) ref += `:${n}`;

  const c = classify(r.lead_status, day);
  const company = (r.company_name ?? "").trim() || domainOf(email) || email || "Unknown";
  const client = c.stage === "Won" ? clientFor(company) : null;
  const note = [
    r.digest?.trim(),
    r.notes?.trim() && `Notes: ${r.notes.trim()}`,
    `Origin: ${r.origin || "—"} · Sheet status: ${r.lead_status || "—"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  plans.push({
    ref,
    from: "history",
    day,
    lead: {
      company,
      domain: domainOf(email),
      source: sourceOf(r.origin),
      stage: c.stage,
      reason: c.reason ?? null,
      lost_note: c.aged ? "Imported as open with no recorded outcome" : c.stage === "Lost" ? r.lead_status : null,
      asked_for: r.what_they_asked_for?.trim() || null,
      client,
    },
    contact: email ? { name: nameFromEmail(email), email } : null,
    note,
    sheetStatus: r.lead_status,
  });
}

// Active pipeline: the live deals. These OVERRIDE a history row for the same
// company rather than adding a second lead for it.
const ACTIVE_STAGE = (status) => {
  const s = (status ?? "").toLowerCase();
  if (/started|signed|won/.test(s)) return "Won";
  if (/want to start|closing|negotiat/.test(s)) return "Negotiation";
  return null; // decided per company below
};
for (const r of active) {
  const company = (r.Company ?? "").trim();
  if (!company) continue;
  let stage = ACTIVE_STAGE(r.Status);
  // Unibeam went through three estimate versions (the PRD), so an offer is out.
  if (!stage) stage = /unibeam/i.test(company) ? "Offer sent" : "Relevant";
  const day = isoDate(r.Date);
  const plan = {
    ref: `active:${norm(company)}`,
    from: "active",
    day,
    lead: {
      company,
      domain: domainOf(r.Website) ?? domainOf(r.Email),
      source: null,
      stage,
      reason: null,
      lost_note: null,
      asked_for: null,
      client: stage === "Won" ? clientFor(company) : null,
      website: r.Website?.trim() || null,
    },
    contact: r.POC?.trim()
      ? { name: r.POC.trim(), email: r.Email?.trim() || null, title: r.Title?.trim() || null, linkedin: r.Linkedin?.trim() || null }
      : null,
    note: [r.notes?.trim(), `Active pipeline · Sheet status: ${r.Status || "—"}`].filter(Boolean).join("\n\n"),
    sheetStatus: r.Status,
  };
  // Supersede a history row for the same company (most recent one).
  const dupe = plans
    .filter((p) => p.from === "history" && norm(p.lead.company) === norm(company))
    .sort((a, b) => (b.day ?? "").localeCompare(a.day ?? ""))[0];
  if (dupe) {
    plan.ref = dupe.ref;
    plan.day = dupe.day;
    plan.contact = plan.contact ?? dupe.contact;
    plan.lead.asked_for = dupe.lead.asked_for;
    plan.lead.domain = plan.lead.domain ?? dupe.lead.domain;
    plan.lead.source = dupe.lead.source;
    plan.note = [dupe.note, plan.note].join("\n\n");
    // ⚠️ Created when the Sheet first saw them, but ACTIVE NOW: carrying the
    // history row's 2021 date into the stalled clock would flag a live deal.
    plan.createdDay = dupe.day;
    plan.day = null;
    plans.splice(plans.indexOf(dupe), 1, plan);
  } else plans.push(plan);
}

// ── report ─────────────────────────────────────────────────────────────────

const byStage = {};
for (const p of plans) byStage[p.lead.stage] = (byStage[p.lead.stage] ?? 0) + 1;
const byReason = {};
for (const p of plans.filter((p) => p.lead.stage === "Lost")) {
  const k = p.lead.reason ?? "(none)";
  byReason[k] = (byReason[k] ?? 0) + 1;
}
console.log(`\n${plans.length} leads (${history.length} history rows, ${active.length} active rows)`);
console.log("by stage:", byStage);
console.log("lost by reason:", byReason);
console.log(`\nON THE BOARD (open):`);
for (const p of plans.filter((p) => !["Won", "Lost"].includes(p.lead.stage))) {
  console.log(`  ${p.lead.stage.padEnd(14)} ${p.day ?? "(no date)"}  ${p.lead.company}  ← "${p.sheetStatus ?? ""}"`);
}
console.log(`\nWON:`);
for (const p of plans.filter((p) => p.lead.stage === "Won")) {
  console.log(`  ${p.day ?? "(no date)"}  ${p.lead.company}  → ${p.lead.client ? `client "${p.lead.client.name}"` : "no matching client"}`);
}
const lostNone = plans.filter((p) => p.lead.stage === "Lost" && !p.lead.reason);
if (lostNone.length) {
  console.log(`\nLOST WITH NO REASON MAPPED (${lostNone.length}):`);
  for (const p of lostNone) console.log(`  "${p.sheetStatus}"`);
}
const skip = plans.filter((p) => have.has(p.ref)).length;
console.log(`\nalready imported (skipped): ${skip}`);

if (!WRITE) {
  console.log("\nDRY RUN — nothing written. Re-run with --write to import.\n");
  process.exit(0);
}

// ── write ──────────────────────────────────────────────────────────────────

let made = 0;
for (const p of plans) {
  if (have.has(p.ref)) continue;
  const when = at(p.day);
  const created = p.createdDay ? at(p.createdDay) : when;
  const stage = stageByName.get(p.lead.stage);
  const { data: lead, error } = await sb
    .from("leads")
    .insert({
      company: p.lead.company,
      website: p.lead.website ?? (p.lead.domain ? `https://${p.lead.domain}` : null),
      domain: p.lead.domain,
      source: p.lead.source,
      stage_id: stage.id,
      asked_for: p.lead.asked_for,
      lost_reason_id: p.lead.reason ? (reasonByName.get(p.lead.reason)?.id ?? null) : null,
      lost_note: p.lead.lost_note,
      sheet_ref: p.ref,
      client_id: p.lead.client?.id ?? null,
      won_at: p.lead.stage === "Won" ? when : null,
      stage_changed_at: when,
      last_activity_at: when,
      created_at: created,
    })
    .select("id")
    .single();
  if (error) {
    console.error(`  ✗ ${p.lead.company}: ${error.message}`);
    continue;
  }
  if (p.contact) {
    const { error: ce } = await sb.from("lead_contacts").insert({ lead_id: lead.id, position: 1, ...p.contact });
    if (ce) console.error(`  ✗ contact for ${p.lead.company}: ${ce.message}`);
  }
  const { error: ee } = await sb.from("lead_events").insert([
    { lead_id: lead.id, kind: "created", body: `Imported from the Sheet (${p.from === "active" ? "Active pipeline" : "leads_full_history_FINAL"})`, at: created },
    ...(p.note ? [{ lead_id: lead.id, kind: "note", body: p.note, at: when }] : []),
  ]);
  if (ee) console.error(`  ✗ history for ${p.lead.company}: ${ee.message}`);
  made++;
}
console.log(`\nimported ${made} leads.\n`);
