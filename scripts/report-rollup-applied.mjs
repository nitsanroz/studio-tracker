/**
 * Is the roll-up rule actually APPLIED to the data, or do we merely know the shape?
 *
 *   node --env-file=.env.local scripts/report-rollup-applied.mjs
 *
 * READ ONLY → data/rollup-applied.csv
 *
 * ⚠️⚠️ WHY THIS EXISTS ALONGSIDE `report-rollup-risk.mjs`, WHICH NOW REPORTS 0h.
 * That script answers "do we know each task's subtask shape?" — and since
 * `parents.json` was extended to 2,758 tasks it answers yes for everything. It
 * does NOT answer the question that decides whether the hours are wrong:
 *
 *     was CHILDREN WIN, PARENT ZERO ever applied to these rows?
 *
 * The documented fix had two steps — extend `parents.json`, THEN re-run the
 * reconciler so the rule applies studio-wide. Step one is visibly done. If step
 * two was never run, every roll-up parent still carries its children's hours on
 * top of the children themselves, and the risk report says 0h while the database
 * double-counts. Knowing the shape and having acted on it are different facts, and
 * only this one is about the numbers the studio bills from.
 *
 * WHAT COUNTS AS DOUBLE-COUNTED HERE: a task that (a) has recovered hours, (b) has
 * `subs > 0` in `parents.json`, and (c) has at least one CHILD in the database that
 * also carries recovered hours. Both halves must be present — a parent whose
 * children were never imported is the only surviving record of those hours and must
 * be left alone (that is the `rollup-parent-kept-no-children` case the reconciler
 * already flags).
 *
 * ⚠️ The `sum ≈ parent` column is the corroborating signal, not the test. Nitsan's
 * example — `"Q&A Movies - 128.25h"` over children totalling exactly 128.25h — is
 * what a roll-up looks like; a parent well ABOVE its children's sum may be a
 * partial roll-up or may carry real work of its own, so it is reported separately
 * rather than folded in.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { toCsv } from "./lib/csv.mjs";

const DATA = path.join(import.meta.dirname, "..", "data");
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

const parents = JSON.parse(fs.readFileSync(path.join(DATA, "asana", "parents.json"), "utf8"));

// gid -> [child gid]. Built from the same file the reconciler reads, so this
// cannot disagree with the rule it is auditing.
const childrenOf = new Map();
for (const [gid, info] of Object.entries(parents)) {
  const p = info?.parent;
  if (!p) continue;
  if (!childrenOf.has(p)) childrenOf.set(p, []);
  childrenOf.get(p).push(gid);
}

const clients = await fetchAll("clients", "id, name");
const clientName = new Map(clients.map((c) => [c.id, c.name]));
const tasks = await fetchAll("tasks", "id, title, legacy_title, asana_gid, client_id, legacy_hours");
const entries = await fetchAll("time_entries", "task_id, minutes, legacy, legacy_author_name");

// Same definition of "recovered" as report-rollup-risk.mjs: Asana-derived only.
// Tracked time was logged per entry by a person, and the finance backfill sits on
// its own holder task with no subtasks — neither can be a roll-up.
const asanaHours = new Map();
for (const e of entries) {
  if (!e.legacy || e.legacy_author_name === FINANCE_AUTHOR) continue;
  asanaHours.set(e.task_id, (asanaHours.get(e.task_id) ?? 0) + e.minutes / 60);
}
const recovered = (t) => (asanaHours.get(t.id) ?? 0) + Number(t.legacy_hours ?? 0);

const byGid = new Map();
for (const t of tasks) if (t.asana_gid) byGid.set(t.asana_gid, t);

const rows = [];
for (const t of tasks) {
  const own = recovered(t);
  if (own <= 0 || !t.asana_gid) continue;
  const info = parents[t.asana_gid];
  if (!info || !(info.subs > 0)) continue;

  const kids = (childrenOf.get(t.asana_gid) ?? [])
    .map((g) => byGid.get(g))
    .filter(Boolean);
  const kidsWithHours = kids.filter((k) => recovered(k) > 0);
  if (kidsWithHours.length === 0) continue; // only record of those hours — leave alone

  const kidSum = kidsWithHours.reduce((a, k) => a + recovered(k), 0);
  rows.push({
    client: clientName.get(t.client_id) ?? "(no client)",
    asana_gid: t.asana_gid,
    title: (t.legacy_title ?? t.title ?? "").slice(0, 70),
    subtasks_in_asana: info.subs,
    children_in_db_with_hours: kidsWithHours.length,
    parent_hours: own.toFixed(2),
    children_hours: kidSum.toFixed(2),
    // ≈ within 2% is the roll-up signature; anything else is reported but flagged
    shape: Math.abs(own - kidSum) <= Math.max(0.5, own * 0.02) ? "sum≈parent" : "differs",
  });
}

rows.sort((a, b) => Number(b.parent_hours) - Number(a.parent_hours));
const OUT = path.join(DATA, "rollup-applied.csv");
fs.writeFileSync(OUT, toCsv(rows, Object.keys(rows[0] ?? { client: "" })));

const dup = rows.reduce((a, r) => a + Number(r.parent_hours), 0);
const exact = rows.filter((r) => r.shape === "sum≈parent");
const exactH = exact.reduce((a, r) => a + Number(r.parent_hours), 0);

console.log(`parents.json covers ${Object.keys(parents).length} tasks\n`);
if (rows.length === 0) {
  console.log("No roll-up parent in the database carries hours while its children do.");
  console.log("The rule is APPLIED (or there was nothing to apply it to).");
} else {
  console.log("client                 parent hours  children  shape        title");
  for (const r of rows.slice(0, 20)) {
    console.log(
      `  ${r.client.slice(0, 18).padEnd(20)}${Number(r.parent_hours).toFixed(0).padStart(8)}h` +
        `${Number(r.children_hours).toFixed(0).padStart(10)}h  ${r.shape.padEnd(11)} ${r.title.slice(0, 40)}`,
    );
  }
  const perClient = new Map();
  for (const r of rows) {
    perClient.set(r.client, (perClient.get(r.client) ?? 0) + Number(r.parent_hours));
  }
  console.log("\nper client:");
  for (const [c, h] of [...perClient].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.slice(0, 22).padEnd(24)}${h.toFixed(0).padStart(8)}h`);
  }
  console.log(`\nroll-up parents still carrying hours: ${rows.length}`);
  console.log(`hours double-counted (upper bound):   ${dup.toFixed(0)}h`);
  console.log(`  of which sum≈parent (clear roll-up): ${exactH.toFixed(0)}h across ${exact.length}`);
}
console.log(`\n→ ${path.relative(process.cwd(), OUT)}`);
