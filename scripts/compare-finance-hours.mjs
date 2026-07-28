/**
 * Cross-check the recovered pre-Everhour hours against the finance-admin numbers.
 *
 *   node --env-file=.env.local scripts/compare-finance-hours.mjs
 *   node --env-file=.env.local scripts/compare-finance-hours.mjs --client   # per-client too
 *
 * READ ONLY. Writes nothing, anywhere.
 *
 * WHY this is a real check and not a circular one: finance_client_monthly was
 * imported from the PLAN_more_YYYY.xlsx workbooks (finance-admin, 2026-07-15) —
 * hours Nitsan billed from, typed by hand into a spreadsheet years ago. The
 * tracker's legacy hours were recovered from Asana task titles and comments.
 * Two independent records of the same work, so a year where they disagree is a
 * year where one of them is missing tasks.
 *
 * COMPARABILITY, which is most of the work here:
 *  - the plan sheet counts only BILLABLE client work, so the tracker side is
 *    filtered to billable tasks on billable clients before comparing;
 *  - the sheet is keyed on a free-text `client_canon`, the tracker on clients.name,
 *    so per-client matching is on a normalised name and unmatched names on either
 *    side are reported rather than silently dropped;
 *  - tasks.legacy_hours (the undated remainder) has no month, so it can only
 *    join a YEAR total via tasks.activity_from/to — and the 195h with no date
 *    signal at all can't be compared and is reported separately.
 */
import { createClient } from "@supabase/supabase-js";

const PER_CLIENT = process.argv.includes("--client");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function fetchAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * Client names were typed independently into the plan sheet and the tracker, so
 * they differ in ways no exact key survives: "Harmon.ie"/"harmoni",
 * "Mobileye Corporate"/"mobileye", "In-reach"/"inreach", "Volta Solar"/"Volta".
 * Squash to letters only, then treat a prefix match as the same client. Without
 * the prefix step this report is 90% false gaps.
 */
const canon = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&more|\bltd\b|\binc\b|\bcloud\b|\btasks?\b|corporate|solar|group/g, " ")
    .replace(/[^a-z0-9֐-׿]+/g, "");

/** Resolve a canon name against a set of known names, prefix-matching either way. */
function resolve(k, known) {
  if (known.has(k)) return k;
  for (const c of known) {
    if (c.length >= 5 && k.length >= 5 && (c.startsWith(k) || k.startsWith(c))) return c;
  }
  return k;
}

const clients = await fetchAll("clients", "id, name, billable, archived");
const clientById = new Map(clients.map((c) => [c.id, c]));

const tasks = await fetchAll(
  "tasks",
  "id, client_id, billable, legacy_hours, activity_from, activity_to",
);
const taskById = new Map(tasks.map((t) => [t.id, t]));

const entries = await fetchAll("time_entries", "task_id, date, minutes, legacy");
const finance = await fetchAll("finance_client_monthly", "year, month, client_canon, hours, state");

// ── tracker hours by year ──────────────────────────────────────────────────
// Kept in four buckets, because the interesting failure is a year where the
// billable subtotal is short even though the grand total looks fine.
const yr = new Map();
const bucket = (y) => {
  if (!yr.has(y)) yr.set(y, { tracked: 0, legacy: 0, billTracked: 0, billLegacy: 0, remainder: 0 });
  return yr.get(y);
};
const isBillable = (t) => {
  const c = t && clientById.get(t.client_id);
  return Boolean(t?.billable && c?.billable);
};

for (const e of entries) {
  const t = taskById.get(e.task_id);
  const y = Number(String(e.date).slice(0, 4));
  if (!y) continue;
  const b = bucket(y);
  const h = e.minutes / 60;
  if (e.legacy) {
    b.legacy += h;
    if (isBillable(t)) b.billLegacy += h;
  } else {
    b.tracked += h;
    if (isBillable(t)) b.billTracked += h;
  }
}

// The undated remainder: spread evenly across the years its activity window
// covers. That's an approximation and is labelled as one below — it exists so a
// task whose hours never became dated entries still lands in the right decade.
let undatable = 0;
for (const t of tasks) {
  const h = Number(t.legacy_hours ?? 0);
  if (!h) continue;
  const from = t.activity_from ? Number(String(t.activity_from).slice(0, 4)) : null;
  const to = t.activity_to ? Number(String(t.activity_to).slice(0, 4)) : from;
  if (!from) {
    undatable += h;
    continue;
  }
  const years = to - from + 1;
  for (let y = from; y <= to; y++) bucket(y).remainder += h / years;
}

// ── finance hours by year ─────────────────────────────────────────────────
const fin = new Map();
for (const r of finance) {
  if (r.state === "predicted") continue; // plan, not actuals
  fin.set(r.year, (fin.get(r.year) ?? 0) + Number(r.hours ?? 0));
}

const years = [...new Set([...yr.keys(), ...fin.keys()])].filter((y) => y >= 2015).sort();
const n = (v) => (v ? v.toFixed(0).padStart(7) : "      –");

console.log("Tracker vs finance-admin — BILLABLE hours per year");
console.log("(tracker billable = tracked + legacy entries + apportioned remainder)\n");
console.log("year    finance   tracker      diff    diff%   |  all-tracker");
for (const y of years) {
  const b = yr.get(y) ?? { billTracked: 0, billLegacy: 0, remainder: 0, tracked: 0, legacy: 0 };
  const f = fin.get(y);
  // The remainder isn't split billable/internal, so it is attributed in the same
  // proportion as this year's dated hours rather than assumed to be all billable.
  const dated = b.tracked + b.legacy;
  const share = dated ? (b.billTracked + b.billLegacy) / dated : 1;
  const trk = b.billTracked + b.billLegacy + b.remainder * share;
  const all = b.tracked + b.legacy + b.remainder;
  const d = f == null ? null : trk - f;
  console.log(
    `${y}  ${n(f)}  ${n(trk)}  ${d == null ? "        –" : n(d)}  ` +
      `${d == null || !f ? "      –" : `${((d / f) * 100).toFixed(0).padStart(5)}%`}   |  ${n(all)}`,
  );
}

const finTotal = [...fin.entries()].filter(([y]) => y >= 2015).reduce((a, [, v]) => a + v, 0);
console.log(`\nfinance billable total  ${finTotal.toFixed(0)}h`);
console.log(`undatable legacy_hours  ${undatable.toFixed(2)}h  (no activity window — excluded above)`);

// ── per-client, for the years where the yearly totals disagree ─────────────
if (PER_CLIENT) {
  // The tracker's client list is the reference vocabulary; finance names resolve
  // into it. Doing it the other way round would merge two tracker clients that
  // share a prefix.
  const known = new Set(clients.filter((c) => c.billable).map((c) => canon(c.name)));
  const trkByClient = new Map();
  const finByClient = new Map();
  const add = (m, k, h) => m.set(k, (m.get(k) ?? 0) + h);

  const trackerKey = (cid) => {
    const c = clientById.get(cid);
    return c?.billable ? canon(c.name) : null;
  };
  for (const e of entries) {
    const t = taskById.get(e.task_id);
    if (!t?.billable) continue;
    const k = trackerKey(t.client_id);
    if (k) add(trkByClient, k, e.minutes / 60);
  }
  for (const t of tasks) {
    if (!t.billable || !t.legacy_hours) continue;
    const k = trackerKey(t.client_id);
    if (k) add(trkByClient, k, Number(t.legacy_hours));
  }
  for (const r of finance) {
    if (r.state === "predicted") continue;
    add(finByClient, resolve(canon(r.client_canon), known), Number(r.hours ?? 0));
  }

  const rows = [...new Set([...finByClient.keys(), ...trkByClient.keys()])]
    .map((k) => ({ k, f: finByClient.get(k) ?? 0, t: trkByClient.get(k) ?? 0 }))
    .map((r) => ({ ...r, d: r.t - r.f }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  console.log("\n\nPer-client, all years, billable only — biggest gaps first");
  console.log("client                        finance   tracker      diff");
  for (const r of rows.slice(0, 30)) {
    console.log(`${r.k.slice(0, 28).padEnd(30)}${n(r.f)}  ${n(r.t)}  ${n(r.d)}`);
  }
  const missing = rows.filter((r) => !r.t && r.f);
  console.log(
    `\nin finance but NOT in the tracker at all: ${missing.length} clients, ` +
      `${missing.reduce((a, r) => a + r.f, 0).toFixed(0)}h`,
  );
  console.log(missing.slice(0, 25).map((r) => `${r.k} ${r.f.toFixed(0)}h`).join(", "));
}
