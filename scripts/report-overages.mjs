/**
 * Where the tracker holds MORE hours than the finance plan sheets billed, per
 * client per year, with each hour attributed to the source it came from.
 *
 *   node --env-file=.env.local scripts/report-overages.mjs
 *   node --env-file=.env.local scripts/report-overages.mjs --all   # under-billed too
 *
 * READ ONLY → data/overages.csv
 *
 * This is the evidence behind one open decision: for a client-year where the
 * Asana recovery found MORE hours than the studio billed, which record wins? The
 * backfill (backfill-from-finance.mjs) only ever tops shortfalls UP, so it never
 * created any of these — every hour below came from a real task.
 *
 * THE THREE SOURCES, kept apart because they carry very different weight:
 *
 *   tracked   time_entries with legacy = false. Everhour, or logged in this app.
 *             Someone recorded it at the time. Strongest evidence there is.
 *   asana     legacy = true, from a task title or a comment thread. The studio's
 *             own running total, hand-maintained on the task at the time.
 *   finance   legacy_author_name = '(from finance plan)'. Shown for completeness;
 *             by construction it cannot contribute to an overage.
 *   undated   tasks.legacy_hours with no date — apportioned across the client's
 *             evidenced years, so it is an estimate of WHEN, not of how much.
 *
 * WHY AN OVERAGE IS USUALLY NOT AN ERROR: worked ≠ billed. Hours written off,
 * fixed-fee work that ran long, and the מפתח reductions all show up here, and in
 * every one of those cases the tracker is right and the invoice is also right.
 * A gap only looks like a parse error when it is large relative to the year AND
 * the hours are asana-derived — which is why the two are separated below.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { toCsv } from "./lib/csv.mjs";
import { canon, alias, resolve } from "./lib/client-names.mjs";

const ALL = process.argv.includes("--all");
const OUT = path.join(import.meta.dirname, "..", "data", "overages.csv");
/** The judgment call only applies before tracking existed. */
const LAST_YEAR = 2022;
const FINANCE_AUTHOR = "(from finance plan)";

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

const clients = await fetchAll("clients", "id, name, billable");
const tasks = await fetchAll(
  "tasks",
  "id, title, legacy_title, client_id, billable, legacy_hours, activity_from, activity_to",
);
const entries = await fetchAll(
  "time_entries",
  "task_id, date, minutes, legacy, legacy_author_name",
);
const finance = await fetchAll("finance_client_monthly", "year, client_canon, hours, state");

// Group tracker clients by alias key, same as everywhere else.
const group = new Map();
for (const c of clients) {
  const k = alias(canon(c.name));
  if (!group.has(k)) group.set(k, []);
  group.get(k).push(c);
}
const known = new Set(group.keys());
const keyOfClient = new Map(clients.map((c) => [c.id, alias(canon(c.name))]));
const label = (k) => (group.get(k) ?? []).map((c) => c.name).join(" / ") || k;

const taskById = new Map(tasks.map((t) => [t.id, t]));

// ── tracker hours by key/year, split by source ────────────────────────────
const trk = new Map(); // `${key}|${year}` → {tracked, asana, finance, undated}
const cell = (k, y) => {
  const id = `${k}|${y}`;
  if (!trk.has(id)) trk.set(id, { tracked: 0, asana: 0, finance: 0, undated: 0 });
  return trk.get(id);
};
for (const e of entries) {
  const t = taskById.get(e.task_id);
  const k = t && keyOfClient.get(t.client_id);
  if (!k) continue;
  const y = Number(String(e.date).slice(0, 4));
  if (!y || y > LAST_YEAR) continue;
  const c = cell(k, y);
  const h = e.minutes / 60;
  if (e.legacy_author_name === FINANCE_AUTHOR) c.finance += h;
  else if (e.legacy) c.asana += h;
  else c.tracked += h;
}
// Undated remainder, spread over the task's evidenced years.
for (const t of tasks) {
  const h = Number(t.legacy_hours ?? 0);
  const k = keyOfClient.get(t.client_id);
  if (!h || !k) continue;
  const from = t.activity_from ? Number(String(t.activity_from).slice(0, 4)) : null;
  const to = t.activity_to ? Number(String(t.activity_to).slice(0, 4)) : from;
  if (!from) continue; // no date signal at all — deliberately never guessed
  const n = to - from + 1;
  for (let y = from; y <= to; y++) if (y <= LAST_YEAR) cell(k, y).undated += h / n;
}

// ── finance hours by key/year ─────────────────────────────────────────────
const fin = new Map();
for (const r of finance) {
  if (r.state === "predicted" || r.year > LAST_YEAR) continue;
  const k = resolve(alias(canon(r.client_canon)), known);
  const id = `${k}|${r.year}`;
  fin.set(id, (fin.get(id) ?? 0) + Number(r.hours ?? 0));
}

// ── build ─────────────────────────────────────────────────────────────────
const rows = [];
for (const id of new Set([...trk.keys(), ...fin.keys()])) {
  const [k, ys] = id.split("|");
  const year = Number(ys);
  const s = trk.get(id) ?? { tracked: 0, asana: 0, finance: 0, undated: 0 };
  const trackerTotal = s.tracked + s.asana + s.finance + s.undated;
  const financeTotal = fin.get(id) ?? 0;
  const diff = trackerTotal - financeTotal;
  if (!ALL && diff <= 1) continue;
  if (trackerTotal < 0.5 && financeTotal < 0.5) continue;
  // Internal clients (Studio, OFFF tlv) are never billed, so a finance row of
  // zero against real hours is correct, not a discrepancy. Excluding them is what
  // separates "we worked more than we charged" from "this was never chargeable".
  if (!(group.get(k) ?? []).some((c) => c.billable)) continue;
  rows.push({
    client: label(k),
    year,
    finance_billed: financeTotal.toFixed(2),
    tracker_total: trackerTotal.toFixed(2),
    difference: diff.toFixed(2),
    pct_over: financeTotal ? `${((diff / financeTotal) * 100).toFixed(0)}%` : "no billing row",
    from_tracked: s.tracked.toFixed(2),
    from_asana: s.asana.toFixed(2),
    from_finance_backfill: s.finance.toFixed(2),
    from_undated_estimate: s.undated.toFixed(2),
  });
}
rows.sort((a, b) => Number(b.difference) - Number(a.difference));
if (rows.length) fs.writeFileSync(OUT, toCsv(rows, Object.keys(rows[0])));

const over = rows.filter((r) => Number(r.difference) > 1);
const sum = (a, f) => a.reduce((s, r) => s + Number(r[f]), 0);
console.log(`Tracker ABOVE finance, billable clients, ${LAST_YEAR} and earlier — ${over.length} client-years\n`);
console.log(`total difference   ${sum(over, "difference").toFixed(0)}h  ← this is what the decision is about\n`);
// The per-source figures describe the composition of the TRACKER TOTAL on these
// rows, which is larger than the difference. Saying "of which" would imply they
// add up to the gap, and they don't — an overage of 429h can sit on top of 1,496h
// of hours that agree perfectly.
console.log(`Composition of the tracker total on those same rows (NOT a split of the gap):`);
console.log(`  tracked   ${sum(over, "from_tracked").toFixed(0).padStart(6)}h  logged at the time — strongest evidence`);
console.log(`  asana     ${sum(over, "from_asana").toFixed(0).padStart(6)}h  recovered from task titles / comments`);
console.log(`  undated   ${sum(over, "from_undated_estimate").toFixed(0).padStart(6)}h  year is an estimate`);
console.log(`  backfill  ${sum(over, "from_finance_backfill").toFixed(0).padStart(6)}h  tops shortfalls only, cannot overshoot\n`);
// The one figure that IS a clean split: how much of the gap sits on client-years
// whose hours are purely asana-derived, i.e. where a parse error is even possible.
const pureAsana = over.filter((r) => Number(r.from_tracked) === 0);
console.log(
  `${pureAsana.length} of the ${over.length} rows have NO tracked hours at all — ` +
    `${sum(pureAsana, "difference").toFixed(0)}h. Only these could be a parse error.\n`,
);

console.log("client                     year   finance   tracker    diff    tracked   asana  undated");
for (const r of over.slice(0, 30)) {
  console.log(
    `${r.client.slice(0, 24).padEnd(26)}${r.year}  ${Number(r.finance_billed).toFixed(0).padStart(7)}  ` +
      `${Number(r.tracker_total).toFixed(0).padStart(7)}  ${Number(r.difference).toFixed(0).padStart(6)}  ` +
      `${Number(r.from_tracked).toFixed(0).padStart(9)}  ${Number(r.from_asana).toFixed(0).padStart(6)}  ` +
      `${Number(r.from_undated_estimate).toFixed(0).padStart(7)}`,
  );
}
console.log(`\n→ ${path.relative(process.cwd(), OUT)}  (${rows.length} rows)`);
