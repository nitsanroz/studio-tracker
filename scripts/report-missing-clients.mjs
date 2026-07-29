/**
 * List the clients the finance plan sheets bill for but the tracker has no hours
 * for, with whatever evidence exists locally so Nitsan can investigate in Asana.
 *
 *   node --env-file=.env.local scripts/report-missing-clients.mjs
 *
 * READ ONLY → data/missing-clients.csv
 *
 * For each such client it reports whether the tracker has: a client row, a
 * `projects` row (the Everhour/Asana board), any task whose title names the
 * client, and any `asana_gid` — because that gid is a working Asana link, which
 * is the only way to check whether a board still exists over there.
 *
 * The distinction that matters: a client with a projects row and gids had a board
 * that WAS imported and came through empty, which is worth investigating. A
 * client with nothing at all predates Asana and there is nothing to find.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { toCsv } from "./lib/csv.mjs";
import { canon, alias, resolve } from "./lib/client-names.mjs";

const OUT = path.join(import.meta.dirname, "..", "data", "missing-clients.csv");

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


const clients = await fetchAll("clients", "id, name, billable, archived");
const projects = await fetchAll("projects", "id, name, everhour_id");
const tasks = await fetchAll("tasks", "id, title, client_id, project_id, asana_gid, legacy_hours");
const entries = await fetchAll("time_entries", "task_id, minutes");
const finance = await fetchAll("finance_client_monthly", "year, client_canon, hours, state");

const hours = new Map();
for (const e of entries) hours.set(e.task_id, (hours.get(e.task_id) ?? 0) + e.minutes / 60);
const taskHours = (t) => (hours.get(t.id) ?? 0) + Number(t.legacy_hours ?? 0);

const clientByCanon = new Map();
for (const c of clients) {
  const k = alias(canon(c.name));
  if (!clientByCanon.has(k)) clientByCanon.set(k, []);
  clientByCanon.get(k).push(c);
}
const known = new Set(clientByCanon.keys());

// Finance side, aggregated per client.
const fin = new Map();
for (const r of finance) {
  if (r.state === "predicted") continue;
  const k = resolve(alias(canon(r.client_canon)), known);
  if (!fin.has(k)) fin.set(k, { name: r.client_canon, hours: 0, years: new Set() });
  const a = fin.get(k);
  a.hours += Number(r.hours ?? 0);
  a.years.add(r.year);
}

const rows = [];
for (const [k, f] of fin) {
  const cs = clientByCanon.get(k) ?? [];
  const own = tasks.filter((t) => cs.some((c) => c.id === t.client_id));
  const ownHours = own.reduce((a, t) => a + taskHours(t), 0);
  // Only report where the tracker is materially short; a matched client is fine.
  if (ownHours >= f.hours * 0.5) continue;

  // Evidence, in increasing order of usefulness.
  const named = tasks.filter((t) => canon(t.title).includes(k) && k.length >= 4);
  const proj = projects.filter((p) => canon(p.name).includes(k) && k.length >= 4);
  const projTasks = tasks.filter((t) => proj.some((p) => p.id === t.project_id));
  const gids = [...own, ...named, ...projTasks].filter((t) => t.asana_gid);
  const years = [...f.years].sort();

  rows.push({
    client: f.name,
    finance_hours: f.hours.toFixed(2),
    years: `${years[0]}–${years.at(-1)}`,
    tracker_hours: ownHours.toFixed(2),
    gap: (f.hours - ownHours).toFixed(2),
    client_row: cs.length ? cs.map((c) => `${c.name}${c.archived ? " (archived)" : ""}`).join(" / ") : "",
    board_in_tracker: proj.map((p) => p.name).join(" / "),
    tasks_on_board: projTasks.length,
    tasks_naming_it: named.length,
    hours_on_named_tasks: named.reduce((a, t) => a + taskHours(t), 0).toFixed(2),
    // A real, clickable link — the fastest way to see whether the board survives.
    example_asana_link: gids.length ? `https://app.asana.com/0/0/${gids[0].asana_gid}` : "",
    verdict: proj.length
      ? "board WAS imported but is empty — investigate"
      : named.length
        ? "no board; only tasks mentioning the name (likely portfolio work)"
        : "no trace at all — board predates Asana",
  });
}

rows.sort((a, b) => Number(b.gap) - Number(a.gap));
fs.writeFileSync(OUT, toCsv(rows, Object.keys(rows[0] ?? {})));

const byVerdict = new Map();
for (const r of rows) {
  if (!byVerdict.has(r.verdict)) byVerdict.set(r.verdict, { n: 0, h: 0 });
  const a = byVerdict.get(r.verdict);
  a.n++;
  a.h += Number(r.gap);
}
console.log(`${rows.length} clients where the tracker is short by >50% of billed hours\n`);
for (const [v, a] of [...byVerdict].sort((x, y) => y[1].h - x[1].h)) {
  console.log(`  ${a.n.toString().padStart(3)} clients  ${a.h.toFixed(0).padStart(6)}h   ${v}`);
}
console.log(`\nTop 20 by gap:`);
console.log(`client                  gap    years     evidence`);
for (const r of rows.slice(0, 20)) {
  console.log(
    `  ${r.client.slice(0, 20).padEnd(21)}${Number(r.gap).toFixed(0).padStart(6)}h  ${r.years.padEnd(10)}` +
      `${r.board_in_tracker ? `board "${r.board_in_tracker}" (${r.tasks_on_board} tasks)` : r.tasks_naming_it ? `${r.tasks_naming_it} tasks name it, ${r.hours_on_named_tasks}h` : "none"}`,
  );
}
console.log(`\n→ ${path.relative(process.cwd(), OUT)}  (${rows.length} rows, with Asana links where one exists)`);
