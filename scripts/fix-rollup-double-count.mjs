/**
 * Remove the duplicated half of a roll-up, per Nitsan's ruling of 2026-08-26.
 *
 *   node --env-file=.env.local scripts/fix-rollup-double-count.mjs            # dry run
 *   node --env-file=.env.local scripts/fix-rollup-double-count.mjs --apply
 *
 * ⚠️⚠️ THIS DELETES `time_entries` ROWS. Read the whole header before running it.
 *
 * THE RULING. Measured (see `report-rollup-applied.mjs`), six tasks carried
 * recovered hours while their children carried hours too. Nitsan: *"donsplus
 * include children too in addition to parent, other take parent title only… if
 * its twice its no good so if you need to erase according to my desicion please
 * do."* So the PARENT side is authoritative for the roll-ups below, and the
 * children's recovered hours — which are the same work counted a second time —
 * come out.
 *
 * ⚠️ WHAT IS DELETED IS NARROW, AND THE NARROWNESS IS THE POINT: only
 * `time_entries` rows that are `legacy = true` AND NOT the finance backfill,
 * belonging to the named CHILD tasks. Tracked time logged by a real person is
 * never touched, the finance-derived rows are never touched, and no task, title,
 * budget, section or client is modified. Nitsan's other instruction was "dont
 * erase number from title and stuff", so titles and `legacy_hours` are untouched —
 * every one of these tasks happens to hold its hours entirely in entries anyway
 * (verified before writing: `legacy_hours` is 0.00 on all of them).
 *
 * ⚠️ THREE GROUPS, NOT SIX, AND THE THREE EXCLUSIONS ARE DELIBERATE:
 *   · `3 small tasks (18-20) - 14.25h` (Donsplus) — his explicit exception:
 *     parent AND children both count. Untouched.
 *   · `Q&A Movies - 128.25h` (Volta) — already correct. Parent holds 18.3h as the
 *     unattributed remainder against 107h on its children, totalling 125.3h
 *     against a title of 128.25h: UNDER, not double-counted. Applying the rule
 *     here would delete 107h of real detail to "fix" a figure that is already
 *     right.
 *   · `לעדכן אתר קיים - 6HRS` (Studio) — its children are `DDAY גיף / ג'ייפג`,
 *     `HELPO`, `combotag`, `nextnine`: four different clients' jobs, not
 *     components of one parent. The roll-up premise does not hold, so deleting
 *     them would destroy 9.5h of unrelated work. RAISED WITH NITSAN, not applied.
 *
 * ⚠️ THE PARENTS ARE LEFT EXACTLY AS THEY ARE, INCLUDING WHERE THEY EXCEED THEIR
 * OWN TITLE. Volta's parent holds 221.75h against a title of 200.5h, and Fiverr's
 * 101.75h against 71.5h. Closing THAT gap would mean choosing which dated entries
 * to destroy, which no rule decides and which is a second, separate question. It
 * is reported at the end rather than silently resolved.
 *
 * REVERSAL. Every deleted row is written to `data/rollup-deleted-<stamp>.json`
 * AND as ready-to-run INSERTs in `data/rollup-restore-<stamp>.sql`, with the
 * original ids, so this is undoable in full. ⚠️ `/data` is gitignored, so those
 * files are local to the machine that ran it — keep them.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const DATA = path.join(import.meta.dirname, "..", "data");
const FINANCE_AUTHOR = "(from finance plan)";
const apply = process.argv.includes("--apply");

/**
 * The roll-up parents whose CHILDREN lose their duplicated hours. Matched on a
 * distinctive fragment of the title plus the client, so a re-run cannot wander
 * onto a different task, and asserted to match exactly one parent each.
 */
const GROUPS = [
  { client: "Volta", titleHas: "Full Website Design" },
  { client: "Fiverr", titleHas: "Illustration animation" },
  { client: "Volta", titleHas: "Website Wireframes" },
];

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function all(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const parents = JSON.parse(fs.readFileSync(path.join(DATA, "asana", "parents.json"), "utf8"));
const childrenOf = new Map();
for (const [gid, info] of Object.entries(parents)) {
  if (!info?.parent) continue;
  if (!childrenOf.has(info.parent)) childrenOf.set(info.parent, []);
  childrenOf.get(info.parent).push(gid);
}

const clients = await all("clients", "id, name");
const cname = new Map(clients.map((c) => [c.id, c.name]));
const tasks = await all("tasks", "id, title, legacy_title, asana_gid, client_id, legacy_hours");
const entries = await all("time_entries", "*");

const byGid = new Map(tasks.filter((t) => t.asana_gid).map((t) => [t.asana_gid, t]));
const recoveredOf = new Map();
for (const e of entries) {
  if (!e.legacy || e.legacy_author_name === FINANCE_AUTHOR) continue;
  if (!recoveredOf.has(e.task_id)) recoveredOf.set(e.task_id, []);
  recoveredOf.get(e.task_id).push(e);
}
const hours = (rows) => (rows ?? []).reduce((a, e) => a + e.minutes, 0) / 60;

const doomed = [];
const report = [];

for (const g of GROUPS) {
  const matches = tasks.filter(
    (t) =>
      cname.get(t.client_id) === g.client &&
      String(t.legacy_title ?? t.title ?? "").includes(g.titleHas) &&
      t.asana_gid &&
      parents[t.asana_gid]?.subs > 0,
  );
  // ⚠️ Refuse ambiguity outright rather than pick one: this deletes billed hours.
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 parent for ${g.client} / "${g.titleHas}", found ${matches.length}`,
    );
  }
  const parent = matches[0];
  const parentHours = hours(recoveredOf.get(parent.id));
  const kids = (childrenOf.get(parent.asana_gid) ?? [])
    .map((gid) => byGid.get(gid))
    .filter(Boolean)
    .map((k) => ({ task: k, rows: recoveredOf.get(k.id) ?? [] }))
    .filter((k) => k.rows.length > 0);

  let removed = 0;
  for (const k of kids) {
    // ⚠️ `legacy_hours` must be 0 or the child keeps a remainder this cannot see.
    if (Number(k.task.legacy_hours ?? 0) !== 0) {
      throw new Error(`child ${k.task.id} carries legacy_hours — not handled, aborting`);
    }
    doomed.push(...k.rows);
    removed += hours(k.rows);
  }
  report.push({
    client: g.client,
    title: String(parent.legacy_title ?? parent.title ?? "").slice(0, 60),
    parentHours,
    childrenHours: removed,
    childTasks: kids.length,
    rows: kids.reduce((a, k) => a + k.rows.length, 0),
  });
}

console.log(apply ? "APPLYING\n" : "DRY RUN — nothing will be written\n");
for (const r of report) {
  console.log(`${r.client} — ${r.title}`);
  console.log(
    `  parent keeps ${r.parentHours.toFixed(2)}h | removing ${r.childrenHours.toFixed(2)}h ` +
      `across ${r.rows} entries on ${r.childTasks} child task(s)`,
  );
}
const total = report.reduce((a, r) => a + r.childrenHours, 0);
console.log(`\nentries to delete: ${doomed.length}  |  hours removed: ${total.toFixed(2)}h`);
console.log("untouched: Donsplus (his exception), Q&A Movies (already correct), Studio (children are other clients' work)");

if (!apply) {
  console.log("\nRe-run with --apply to write. A JSON backup and restore SQL are written first.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const jsonPath = path.join(DATA, `rollup-deleted-${stamp}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(doomed, null, 2));

const cols = Object.keys(doomed[0]);
const lit = (v) =>
  v === null || v === undefined
    ? "null"
    : typeof v === "number"
      ? String(v)
      : typeof v === "boolean"
        ? String(v)
        : `'${String(v).replace(/'/g, "''")}'`;
const sql =
  `-- Restores the ${doomed.length} time_entries rows deleted by ` +
  `fix-rollup-double-count.mjs on ${stamp}.\n-- Original ids preserved.\n` +
  doomed
    .map(
      (r) =>
        `insert into time_entries (${cols.join(", ")}) values (${cols.map((c) => lit(r[c])).join(", ")});`,
    )
    .join("\n") +
  "\n";
const sqlPath = path.join(DATA, `rollup-restore-${stamp}.sql`);
fs.writeFileSync(sqlPath, sql);
console.log(`\nbackup → ${path.relative(process.cwd(), jsonPath)}`);
console.log(`restore → ${path.relative(process.cwd(), sqlPath)}`);

// Delete in chunks, by id, so nothing can match more than it was shown.
const ids = doomed.map((r) => r.id);
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const { error } = await db.from("time_entries").delete().in("id", chunk);
  if (error) throw error;
}

const { count } = await db
  .from("time_entries")
  .select("id", { count: "exact", head: true })
  .in("id", ids.slice(0, 100));
console.log(`\ndeleted ${ids.length} rows. spot-check of first 100 ids still present: ${count}`);
