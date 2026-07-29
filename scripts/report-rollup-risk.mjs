/**
 * How much of the Asana-recovered history could be double-counted, because we
 * never fetched the task's subtask shape.
 *
 *   node --env-file=.env.local scripts/report-rollup-risk.mjs
 *
 * READ ONLY → data/rollup-risk.csv
 *
 * THE PROBLEM. A parent task's title figure is the SUM of its subtasks —
 * `"Q&A Movies - 128.25h"` over children `Storyboards - 34h`, `Design (70)- 50h`,
 * `Animation - 18h`… — and the Everhour import flattened parents and children into
 * sibling tasks. Counting both doubles the figure. The rule (Nitsan, 2026-07-28)
 * is CHILDREN WIN, PARENT ZERO, and `reconcile-legacy-hours.mjs` applies it from
 * `data/asana/parents.json`, refusing to zero anything when that file is missing.
 *
 * THE GAP THIS REPORTS. `parents.json` was only ever populated for the tasks
 * `fetch-asana-stories.mjs` ran over — the 23 dissolved legacy projects. The later,
 * much wider pass (`recover-title-hours.mjs`, +14,668h across every other client)
 * read titles only and had NO parent data, so the roll-up rule was never applied
 * there. Volta shows 50 of 50 tasks covered and 0h at risk; Mobileye shows 7 of
 * 300 and 4,837h at risk.
 *
 * UNKNOWN SHAPE IS NOT THE SAME AS DOUBLE-COUNTED. Most tasks have no subtasks at
 * all, so the figure below is an UPPER BOUND on exposure, not an estimate of error.
 * The observed overage against the finance sheets is ~2,700h, which is what a
 * modest amount of roll-up would look like — but it cannot be separated from
 * genuine write-offs without the real parent data.
 *
 * THE FIX, which needs an Asana token: re-run `fetch-asana-stories.mjs` over the
 * gids listed in the CSV to extend `parents.json`, then re-run the reconciler so
 * the roll-up rule applies studio-wide.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { toCsv } from "./lib/csv.mjs";

const DATA = path.join(import.meta.dirname, "..", "data");
const OUT = path.join(DATA, "rollup-risk.csv");
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

const parentsPath = path.join(DATA, "asana", "parents.json");
const parents = fs.existsSync(parentsPath) ? JSON.parse(fs.readFileSync(parentsPath, "utf8")) : {};
const covered = new Set(Object.keys(parents));

const clients = await fetchAll("clients", "id, name");
const clientName = new Map(clients.map((c) => [c.id, c.name]));
const tasks = await fetchAll("tasks", "id, title, legacy_title, asana_gid, client_id, legacy_hours");
const entries = await fetchAll("time_entries", "task_id, minutes, legacy, legacy_author_name");

// Only ASANA-derived hours are exposed: tracked time was logged per-entry by a
// person and the finance backfill sits on its own holder task with no subtasks.
const asanaHours = new Map();
for (const e of entries) {
  if (!e.legacy || e.legacy_author_name === FINANCE_AUTHOR) continue;
  asanaHours.set(e.task_id, (asanaHours.get(e.task_id) ?? 0) + e.minutes / 60);
}

const agg = new Map();
const gidsToFetch = [];
for (const t of tasks) {
  const rec = (asanaHours.get(t.id) ?? 0) + Number(t.legacy_hours ?? 0);
  if (rec <= 0) continue;
  const name = clientName.get(t.client_id) ?? "(no client)";
  if (!agg.has(name)) agg.set(name, { tasks: 0, known: 0, hours: 0, atRisk: 0 });
  const a = agg.get(name);
  a.tasks++;
  a.hours += rec;
  if (t.asana_gid && covered.has(t.asana_gid)) a.known++;
  else {
    a.atRisk += rec;
    if (t.asana_gid) gidsToFetch.push({ client: name, asana_gid: t.asana_gid, hours: rec.toFixed(2), title: t.legacy_title ?? t.title });
  }
}

const rows = [...agg]
  .map(([client, a]) => ({
    client,
    tasks_with_recovered_hours: a.tasks,
    shape_known: a.known,
    recovered_hours: a.hours.toFixed(2),
    hours_at_risk: a.atRisk.toFixed(2),
    pct_at_risk: a.hours ? `${((a.atRisk / a.hours) * 100).toFixed(0)}%` : "0%",
  }))
  .sort((x, y) => Number(y.hours_at_risk) - Number(x.hours_at_risk));

fs.writeFileSync(OUT, toCsv(rows, Object.keys(rows[0] ?? {})));
fs.writeFileSync(path.join(DATA, "rollup-refetch-gids.csv"), toCsv(gidsToFetch, ["client", "asana_gid", "hours", "title"]));

const tot = rows.reduce((a, r) => a + Number(r.recovered_hours), 0);
const risk = rows.reduce((a, r) => a + Number(r.hours_at_risk), 0);
console.log(`parents.json covers ${covered.size} Asana tasks\n`);
console.log("client                    tasks  shape known   recovered   AT RISK");
for (const r of rows.slice(0, 15)) {
  console.log(
    `  ${r.client.slice(0, 22).padEnd(24)}${String(r.tasks_with_recovered_hours).padStart(5)}` +
      `${String(r.shape_known).padStart(13)}   ${Number(r.recovered_hours).toFixed(0).padStart(9)}h ${Number(r.hours_at_risk).toFixed(0).padStart(9)}h`,
  );
}
console.log(`\nasana-recovered total   ${tot.toFixed(0)}h`);
console.log(`shape never fetched     ${risk.toFixed(0)}h  (${((risk / tot) * 100).toFixed(0)}%) — UPPER BOUND on exposure, not an error estimate`);
console.log(`\n→ ${path.relative(process.cwd(), OUT)}`);
console.log(`→ data/rollup-refetch-gids.csv  (${gidsToFetch.length} gids to re-fetch; needs ASANA_ACCESS_TOKEN)`);
