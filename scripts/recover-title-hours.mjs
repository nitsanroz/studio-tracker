/**
 * Recover pre-Everhour hours from task TITLES across every client.
 *
 *   node --env-file=.env.local scripts/recover-title-hours.mjs           # dry run
 *   node --env-file=.env.local scripts/recover-title-hours.mjs --apply
 *
 * WHY THIS EXISTS SEPARATELY: the earlier recovery (reconcile-legacy-hours.mjs +
 * spread-legacy-remainder.mjs) only ever ran on the 23 legacy projects that made up
 * "Imported / Unsorted" — 7,948h. Every OTHER client's pre-Everhour Asana board was
 * left untouched, so ~15,300h still sat in task titles: Mobileye 4,837h, Autofleet
 * 1,806h, Blazepod 1,764h, Studio 2,177h and on. That is why the home page showed
 * only 768h for the whole of 2020.
 *
 * Titles only — no Asana access needed. The 1,255 tasks whose titles carry no figure
 * would need their comments fetched (a token) and are out of scope here.
 *
 * SCOPE, deliberately narrow:
 *   - zero time entries (so nothing can double-count real Everhour data)
 *   - no legacy_hours already (not previously recovered)
 *   - outside the 23 legacy projects (already done)
 *   - title parses to an hour figure
 *
 * DATE: spread across the months of created_at → completed_at, which Asana gave us
 * for all of these. Falls back to completed_at's month, then created_at's, then
 * due_date's. Every row is `date_estimated = true` — the HOURS are the studio's own
 * recorded figure, the DAY is inferred.
 *
 * TITLES ARE NOT TOUCHED. Renaming needs the SQL editor (0011's trigger reserves
 * tasks.title) and was not asked for; the figures stay visible in the names.
 *
 * Reversible: every row is date_estimated, so
 *   delete from time_entries where date_estimated and legacy;
 * (that also removes the earlier spread — filter by created_at if you need to split).
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { parseLegacyName } from "./lib/legacy-hours.mjs";
import { toCsv } from "./lib/csv.mjs";

const APPLY = process.argv.includes("--apply");
const DATA = path.join(import.meta.dirname, "..", "data");

/**
 * A figure with NO unit ("h"/"hrs") that is also implausibly large is far more
 * likely to be part of the name than an hour count — "Storemaven - 404" reads as a
 * 404 page, and other tasks confirm 404 is used that way ("404 page - 1.25h").
 * These are reported and SKIPPED, never silently included.
 */
const NO_UNIT_MAX = 100;

/**
 * Task ids that tripped NO_UNIT_MAX but which Nitsan confirmed ARE hour figures
 * (2026-07-28). Recorded as reviewed exceptions rather than by raising the
 * threshold — the guard is what caught "Storemaven - 404", and loosening it would
 * let that back in too.
 *   "אתר -124"              124h on the studio's own website (internal)
 *   "Amnon's CES PPT -104"  104h on a deck for Mobileye
 */
const CONFIRMED_HOURS = new Set([
  "90f0fe06-cb6a-4b0f-9fce-6af1811b2ef4",
  "cf765497-90f2-4ef5-b8d2-1494cde45f4d",
]);

const LEGACY_PROJECTS = new Set([
  "as:1186151771710269", "as:1200243332541932", "as:1200243332541808",
  "as:257680404225328", "as:167561988748343", "as:1203307271028327",
  "as:1202617922925561", "as:1200919564657911", "as:1211839453526602",
  "b3:38366642", "no:40f3f673-5d02-4ecd-8d25-afafee9895b0",
  "li:6b21e0eb-01d1-4b1f-b7e6-69b56fdb2bd4", "as:1203577431022050",
  "as:697705382152475", "as:770593244278334", "as:1200228187222714",
  "as:1201715599799021", "as:455542718969443", "as:1202222067805639",
  "as:1200243332541873", "as:1201110470169466", "as:1155362291910928",
  "as:1202138051052762",
]);

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

{
  const { error } = await supabase.from("time_entries").select("date_estimated").limit(1);
  if (error) {
    console.error("time_entries.date_estimated is missing — apply migration 0019 first.");
    process.exit(1);
  }
}

const clients = await fetchAll("clients", "id, name, billable");
const clientById = new Map(clients.map((c) => [c.id, c]));
const projects = await fetchAll("projects", "id, everhour_id");
const legacyProjectIds = new Set(
  projects.filter((p) => LEGACY_PROJECTS.has(p.everhour_id)).map((p) => p.id),
);
const tasks = await fetchAll(
  "tasks",
  "id, title, client_id, project_id, legacy_hours, estimate_hours, created_at, completed_at, due_date",
);
const tracked = new Set((await fetchAll("time_entries", "task_id")).map((e) => e.task_id));

const monthsBetween = (from, to) => {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  for (let i = 0; i < 240 && (y < ey || (y === ey && m <= em)); i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
};

const rows = [];
const review = [];
const flagged = [];
let budgetUpdates = 0;

for (const t of tasks) {
  if (tracked.has(t.id)) continue;
  if (t.legacy_hours) continue;
  if (legacyProjectIds.has(t.project_id)) continue;

  const p = parseLegacyName(t.title);
  if (p.actual == null) continue;

  // Unit check: /(\d)\s*(h|hr|hrs|hours)/ appearing after the figure.
  const hasUnit =
    /\d\s*(?:h\b|hr\b|hrs\b|hours?\b|שעות|שעה)/i.test(t.title) || CONFIRMED_HOURS.has(t.id);
  if (!hasUnit && p.actual > NO_UNIT_MAX) {
    flagged.push({ title: t.title, hours: p.actual, client: clientById.get(t.client_id)?.name ?? "?" });
    continue;
  }

  const from = (t.created_at ?? t.completed_at ?? t.due_date ?? "").slice(0, 7);
  const to = (t.completed_at ?? t.created_at ?? t.due_date ?? "").slice(0, 7);
  if (!from && !to) continue;
  const months = from && to && from <= to ? monthsBetween(from, to) : [to || from];
  if (!months.length) continue;

  const totalMinutes = Math.round(p.actual * 60);
  // Largest-remainder apportionment so the parts sum to the whole exactly.
  const exact = months.map(() => totalMinutes / months.length);
  const floored = exact.map((v) => Math.floor(v));
  let left = totalMinutes - floored.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [i, v - Math.floor(v)]).sort((a, b) => b[1] - a[1]);
  for (const [i] of order) {
    if (left <= 0) break;
    floored[i] += 1;
    left--;
  }

  months.forEach((key, i) => {
    if (floored[i] <= 0) return;
    rows.push({
      task_id: t.id,
      user_id: null,
      legacy_author_name: "(date estimated)",
      date: `${key}-15`,
      minutes: floored[i],
      description: `Recovered from the task name — hours recorded in the title, date estimated from its Asana created/completed window.`,
      legacy: true,
      date_estimated: true,
    });
  });

  if (p.budgetMax != null && t.estimate_hours == null) budgetUpdates++;

  review.push({
    task_id: t.id,
    client: clientById.get(t.client_id)?.name ?? "",
    title: t.title,
    hours: p.actual,
    budget: p.budgetMax ?? "",
    window: `${from} → ${to}`,
    months: months.length,
    has_unit: hasUnit ? "yes" : "no",
    flag: p.flags.join(" "),
  });
}

fs.writeFileSync(
  path.join(DATA, "title-hours-review.csv"),
  toCsv(review, Object.keys(review[0] ?? { task_id: "" })),
);

const totalH = rows.reduce((a, r) => a + r.minutes, 0) / 60;
console.log(APPLY ? "── APPLIED ──" : "── DRY RUN (nothing written; pass --apply) ──");
console.log(`tasks recovered   ${review.length}`);
console.log(`entries           ${rows.length}   = ${totalH.toFixed(2)}h`);
console.log(`budgets to set    ${budgetUpdates} (needs the SQL editor — estimate_hours is trigger-protected)`);
console.log(`\nSKIPPED — big figure with no h/hrs unit, likely part of the name:`);
flagged
  .sort((a, b) => b.hours - a.hours)
  .forEach((f) => console.log(`  ${String(f.hours + "h").padStart(8)}  ${f.client.padEnd(18)} ${JSON.stringify(f.title.slice(0, 50))}`));

const byYear = new Map();
for (const r of rows) byYear.set(r.date.slice(0, 4), (byYear.get(r.date.slice(0, 4)) ?? 0) + r.minutes);
console.log(`\nhours added per year:`);
[...byYear.entries()].sort().forEach(([y, m]) => console.log(`  ${y}  ${(m / 60).toFixed(2)}h`));

const byClient = new Map();
for (const r of review) byClient.set(r.client, (byClient.get(r.client) ?? 0) + r.hours);
console.log(`\ntop clients:`);
[...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([c, h]) => console.log(`  ${String(h.toFixed(0) + "h").padStart(8)}  ${c}`));
console.log(`\nreview sheet: data/title-hours-review.csv`);

if (!APPLY) {
  console.log(`\nRe-run with --apply.`);
  process.exit(0);
}

for (let i = 0; i < rows.length; i += 500) {
  const { error } = await supabase.from("time_entries").insert(rows.slice(i, i + 500));
  if (error) {
    console.error(`! insert ${i}: ${error.message}`);
    process.exit(1);
  }
}
console.log(`\ninserted ${rows.length} entries (${totalH.toFixed(2)}h)`);
console.log(`Next: node --env-file=.env.local scripts/audit-rehome.mjs`);
