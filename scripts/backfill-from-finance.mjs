/**
 * Top up pre-Everhour months so each client's hours per month match the finance
 * plan sheets, which for those years are the studio's actual billing record.
 *
 *   node --env-file=.env.local scripts/backfill-from-finance.mjs           # dry run
 *   node --env-file=.env.local scripts/backfill-from-finance.mjs --apply   # write
 *
 * WHY THIS EXISTS, and why it is not the same as the Asana recovery.
 * Nitsan's brief (2026-07-29): for pre-Everhour years what matters is hours per
 * month, per year and per client — per task and per person are not worth chasing,
 * so the finance figures can be relied on instead of reconstructing task detail.
 * The Asana passes recovered everything the task titles and comments could give;
 * this closes the remainder from the billing record.
 *
 * TOP-UP, NOT REPLACE — the invariant that keeps this safe:
 *
 *     written[client][month] = max(0, finance[client][month] - already[client][month])
 *
 * so every hour already recovered from a real task keeps its task, its date and
 * its author. Only the shortfall is added. Run it twice and the second run writes
 * nothing, because `already` has grown to meet `finance`.
 *
 * `already` deliberately includes the client's UNDATED `tasks.legacy_hours`,
 * apportioned across that client's finance months. Those hours are real and
 * counted in client totals — ignoring them here would push the client above its
 * billed figure, which is the one thing this script exists to prevent.
 *
 * SCOPE: months up to 2022-11 only. Everhour's real entries start 2022-11-20 and
 * the cutover was 2022-12-04; from December on, tracked hours are the better
 * record and legitimately differ from billed hours (worked ≠ billed). Forcing
 * those months to match would destroy a genuine signal.
 *
 * SHAPE OF WHAT IT WRITES. One holder task per client, and one entry per month on
 * it, because a month total cannot honestly be split across tasks:
 *   legacy = true          → excluded from days-worked, tenure, /feed, personal stats
 *   date_estimated = true  → renders with an asterisk; the day is not real, the month is
 *   user_id = null         → nobody's timesheet gains hours
 *   legacy_author_name     → "(from finance plan)", the provenance, and required by
 *                            0017's CHECK for any authorless legacy row
 * Dated to the 15th so a month total cannot land outside its own month.
 *
 * REVERSAL, complete and in one statement:
 *   delete from time_entries where legacy_author_name = '(from finance plan)';
 *   delete from tasks where title = 'Pre-tracker hours (finance record)';
 *   -- and, if you also want the client rows this created:
 *   --   they are the archived clients with everhour_id like 'finance:%'
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { toCsv } from "./lib/csv.mjs";
import { canon, alias, resolve } from "./lib/client-names.mjs";

const APPLY = process.argv.includes("--apply");
const OUT = path.join(import.meta.dirname, "..", "data", "finance-backfill-review.csv");

/** Last month treated as pre-Everhour. See SCOPE above. */
const LAST_MONTH = "2022-11";
const HOLDER_TITLE = "Pre-tracker hours (finance record)";
const AUTHOR = "(from finance plan)";
const PALETTE = [
  "#e11d48", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#6366f1",
  "#a855f7", "#ec4899", "#84cc16", "#06b6d4", "#8b5cf6", "#f43f5e", "#10b981",
];

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


// Guard: without 0019 there is no date_estimated column and these rows would be
// indistinguishable from real dated time.
{
  const { error } = await supabase.from("time_entries").select("date_estimated").limit(1);
  if (error) {
    console.error("time_entries.date_estimated is missing — apply migration 0019 first.");
    process.exit(1);
  }
}

const clients = await fetchAll("clients", "id, name, billable, archived, everhour_id");
const tasks = await fetchAll("tasks", "id, title, client_id, billable, legacy_hours");
const entries = await fetchAll("time_entries", "task_id, date, minutes, legacy_author_name");
const finance = await fetchAll("finance_client_monthly", "year, month, client_canon, hours, state");

// A key can cover SEVERAL tracker client rows — In-reach and Quadream both alias
// to "quadream" and stay separate rows until data/merge-clients-inreach-quadream.sql is run.
// Group them: hours already recovered must be summed across the whole group, or
// the shortfall is measured against one row and wildly overstated. The row that
// receives the top-up is the one whose own name IS the key.
const clientGroup = new Map(); // key → client[]
for (const c of clients) {
  const k = alias(canon(c.name));
  if (!clientGroup.has(k)) clientGroup.set(k, []);
  clientGroup.get(k).push(c);
}
const primary = (k) => {
  const g = clientGroup.get(k) ?? [];
  return g.find((c) => canon(c.name) === k) ?? g[0];
};
const known = new Set(clientGroup.keys());

const taskById = new Map(tasks.map((t) => [t.id, t]));
const ym = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

// ── what the tracker already holds, per client per month ──────────────────
const already = new Map(); // clientId → Map(ym → hours)
const undated = new Map(); // clientId → hours with no date at all
const bump = (map, a, b, h) => {
  if (!map.has(a)) map.set(a, new Map());
  map.get(a).set(b, (map.get(a).get(b) ?? 0) + h);
};
for (const e of entries) {
  const t = taskById.get(e.task_id);
  if (!t?.client_id) continue;
  bump(already, t.client_id, String(e.date).slice(0, 7), e.minutes / 60);
}
for (const t of tasks) {
  const h = Number(t.legacy_hours ?? 0);
  if (h && t.client_id) undated.set(t.client_id, (undated.get(t.client_id) ?? 0) + h);
}

// ── what finance says, per client per month, pre-cutover only ─────────────
const want = new Map(); // canon → Map(ym → hours)
const financeName = new Map();
for (const r of finance) {
  if (r.state === "predicted") continue;
  const key = ym(r.year, r.month);
  if (key > LAST_MONTH) continue;
  const k = resolve(alias(canon(r.client_canon)), known);
  // Where several spellings collapse to one key, name the client after the
  // spelling that IS the key — otherwise a client created for the "ravin" key
  // gets whichever of Raven / Ravוn / Ravin happened to be read first.
  if (!financeName.has(k) || canon(r.client_canon) === k) financeName.set(k, r.client_canon);
  bump(want, k, key, Number(r.hours ?? 0));
}

// ── plan the top-ups ──────────────────────────────────────────────────────
const newClients = [];
const rows = [];
let planned = 0;

for (const [k, months] of want) {
  let client = primary(k);
  const financeTotal = [...months.values()].reduce((a, b) => a + b, 0);
  if (financeTotal <= 0) continue;

  if (!client) {
    // Archived + billable: these are real past client engagements, and archiving
    // keeps them out of every picker while their history still charts.
    client = {
      id: null,
      name: financeName.get(k),
      billable: true,
      archived: true,
      _new: true,
      color: PALETTE[newClients.length % PALETTE.length],
    };
    newClients.push(client);
  }

  // Sum across every tracker row in this alias group, not just the primary.
  const group = clientGroup.get(k) ?? [];
  const have = new Map();
  let spare = 0;
  for (const c of group) {
    for (const [m, h] of already.get(c.id) ?? []) have.set(m, (have.get(m) ?? 0) + h);
    spare += undated.get(c.id) ?? 0;
  }

  // ── reconcile per YEAR, distribute on the finance monthly shape ──────────
  // Not per month. Billing months lag work months, so a client can be ahead in
  // March and behind in April while the year matches exactly. Topping up each
  // month independently banks every shortfall and ignores every surplus — on the
  // first run that invented 1,223h for Mobileye and 1,198h for Autofleet, both
  // of which already exceed their billed hours for the year.
  const years = new Map(); // year → Map(month → finance hours)
  for (const [m, h] of months) {
    const y = m.slice(0, 4);
    if (!years.has(y)) years.set(y, new Map());
    years.get(y).set(m, h);
  }

  for (const [year, monthsOfYear] of [...years].sort()) {
    const financeYear = [...monthsOfYear.values()].reduce((a, b) => a + b, 0);
    if (financeYear <= 0) continue;
    let trackerYear = 0;
    for (const [m, h] of have) if (m.startsWith(year)) trackerYear += h;
    // The client's undated hours have no year either, so apportion them across
    // years the same way — proportional to what finance shows.
    const spareYear = (financeYear / financeTotal) * spare;

    const deficit = financeYear - trackerYear - spareYear;
    if (deficit <= 0.01) continue;

    // Spread the year's deficit over its months in proportion to the finance
    // shape, so the monthly curve follows the billing record.
    for (const [month, target] of [...monthsOfYear].sort()) {
      const topUp = (target / financeYear) * deficit;
      if (topUp <= 0.01) continue;
      planned += topUp;
      rows.push({
        client: client.name,
        new_client: client._new ? "yes" : "",
        month,
        finance_month: target.toFixed(2),
        finance_year: financeYear.toFixed(2),
        tracker_year: trackerYear.toFixed(2),
        undated_apportioned: spareYear.toFixed(2),
        year_deficit: deficit.toFixed(2),
        top_up_hours: topUp.toFixed(2),
      });
    }
  }
}

rows.sort((a, b) => a.client.localeCompare(b.client) || a.month.localeCompare(b.month));
if (rows.length) fs.writeFileSync(OUT, toCsv(rows, Object.keys(rows[0])));

// ── report ────────────────────────────────────────────────────────────────
const byYear = new Map();
for (const r of rows) {
  const y = r.month.slice(0, 4);
  byYear.set(y, (byYear.get(y) ?? 0) + Number(r.top_up_hours));
}
console.log(APPLY ? "── APPLYING ──" : "── DRY RUN (nothing written; pass --apply) ──");
console.log(`scope            months up to ${LAST_MONTH}`);
console.log(`clients to create ${newClients.length}`);
console.log(`month top-ups     ${rows.length} across ${new Set(rows.map((r) => r.client)).size} clients`);
console.log(`hours to add      ${planned.toFixed(2)}h\n`);
console.log("by year:");
for (const y of [...byYear.keys()].sort()) console.log(`  ${y}  ${byYear.get(y).toFixed(2).padStart(9)}h`);
console.log(`\nreview sheet → ${path.relative(process.cwd(), OUT)}`);

if (!APPLY) {
  console.log("\nTop 15 clients by hours added:");
  const byClient = new Map();
  for (const r of rows) byClient.set(r.client, (byClient.get(r.client) ?? 0) + Number(r.top_up_hours));
  for (const [c, h] of [...byClient].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${c.slice(0, 26).padEnd(28)}${h.toFixed(2).padStart(9)}h`);
  }
  process.exit(0);
}

// ── write ─────────────────────────────────────────────────────────────────
// 1. clients
for (const c of newClients) {
  const { data, error } = await supabase
    .from("clients")
    .insert({
      name: c.name,
      color: c.color,
      archived: true,
      billable: true,
      // Marks provenance and makes the created rows findable for reversal.
      everhour_id: `finance:${canon(c.name)}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(`client "${c.name}": ${error.message}`);
  c.id = data.id;
}
const clientIdByName = new Map([
  ...clients.map((c) => [c.name, c.id]),
  ...newClients.map((c) => [c.name, c.id]),
]);
console.log(`clients created   ${newClients.length}`);

// 2. holder tasks — one per client, reused on a re-run
const holderByClient = new Map(
  tasks.filter((t) => t.title === HOLDER_TITLE && t.client_id).map((t) => [t.client_id, t.id]),
);
const needHolder = [...new Set(rows.map((r) => r.client))].filter(
  (n) => !holderByClient.has(clientIdByName.get(n)),
);
for (const name of needHolder) {
  const cid = clientIdByName.get(name);
  const c = clients.find((x) => x.id === cid) ?? newClients.find((x) => x.id === cid);
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: HOLDER_TITLE,
      client_id: cid,
      billable: c?.billable ?? true,
      status: "done",
      brief:
        "Monthly client hours for the years before time tracking, taken from the yearly finance plan " +
        "sheets. One entry per month; the day within the month is not meaningful. Task-level detail " +
        "for these hours was never recorded anywhere.",
    })
    .select("id")
    .single();
  if (error) throw new Error(`holder task for "${name}": ${error.message}`);
  holderByClient.set(cid, data.id);
}
console.log(`holder tasks      ${needHolder.length} created, ${holderByClient.size} total`);

// 3. entries — skip any month already carrying one, so re-runs are safe
const existingKey = new Set(
  entries.filter((e) => e.legacy_author_name === AUTHOR).map((e) => `${e.task_id}|${e.date}`),
);
const payload = [];
for (const r of rows) {
  const taskId = holderByClient.get(clientIdByName.get(r.client));
  const date = `${r.month}-15`;
  if (!taskId || existingKey.has(`${taskId}|${date}`)) continue;
  payload.push({
    task_id: taskId,
    user_id: null,
    legacy_author_name: AUTHOR,
    date,
    minutes: Math.round(Number(r.top_up_hours) * 60),
    description: `${r.month}: ${Number(r.finance_hours).toFixed(2)}h billed per the finance plan; ${Number(r.tracker_hours).toFixed(2)}h already recovered from tasks, so ${Number(r.top_up_hours).toFixed(2)}h added here.`,
    legacy: true,
    date_estimated: true,
  });
}
let written = 0;
for (let i = 0; i < payload.length; i += 500) {
  const slice = payload.slice(i, i + 500);
  const { error } = await supabase.from("time_entries").insert(slice);
  if (error) console.error(`! entries ${i}: ${error.message}`);
  else written += slice.length;
}
console.log(`entries written   ${written}/${payload.length}  = ${(payload.reduce((a, e) => a + e.minutes, 0) / 60).toFixed(2)}h`);
console.log(`\nThen: node --env-file=.env.local scripts/compare-finance-hours.mjs`);
