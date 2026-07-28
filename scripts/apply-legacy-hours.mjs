/**
 * Apply the recovered pre-Everhour history.
 *
 *   node --env-file=.env.local scripts/apply-legacy-hours.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-legacy-hours.mjs --apply   # write
 *
 * Inputs (regenerate with reconcile-legacy-hours.mjs first):
 *   data/legacy-entries.json         the authoritative entry list
 *   data/legacy-review-tasks.csv     hours + cleaned titles (your edits win)
 *   data/legacy-review-sections.csv  ditto for sections
 *
 * WHAT IT WRITES HERE, and what it can't:
 * migration 0011's trigger blocks `tasks.title` and `tasks.estimate_hours` for
 * anything without an admin auth.uid() — verified empirically, not assumed.
 * Everything else is writable by the service role:
 *
 *   time_entries       INSERT (upsert on asana_story_gid)   ✓ here
 *   tasks.legacy_hours / activity_from / activity_to / legacy_title  ✓ here
 *   sections.*         (no trigger on sections at all)      ✓ here
 *   tasks.title / tasks.estimate_hours                      → data/0019_task_titles.sql
 *
 * That leftover SQL file deliberately does NOT disable the trigger and contains no
 * DELETE and no DDL. It sets the JWT claim instead, so `is_admin()` returns true
 * and the trigger simply allows the update:
 *
 *   select set_config('request.jwt.claims', '{"sub":"<admin uuid>"}', true);
 *
 * `auth.uid()` reads that setting, and `true` scopes it to the transaction. This is
 * the lesson from 2026-07-28: the previous file relied on `alter table … disable
 * trigger` plus begin/commit semantics in the SQL editor that were never verified,
 * and a cascading DELETE at the end destroyed 620 tasks when the middle of the
 * script didn't take effect. Nothing here can cascade.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fromCsv, numOrNull } from "./lib/csv.mjs";

const APPLY = process.argv.includes("--apply");
const DATA = path.join(import.meta.dirname, "..", "data");
const TITLE_SQL = path.join(DATA, "0019_task_titles.sql");
/** Any admin profile; only used so is_admin() passes inside that one transaction. */
const ADMIN_ID = "7bd6a9e3-7179-4805-ae9a-d89fdc4f005c"; // Nitsan Rozenberg

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const readCsv = (f) => {
  const p = path.join(DATA, f);
  if (!fs.existsSync(p)) throw new Error(`missing ${f} — run reconcile-legacy-hours.mjs first`);
  return fromCsv(fs.readFileSync(p, "utf8"));
};

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

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const taskRows = readCsv("legacy-review-tasks.csv");
const sectionRows = readCsv("legacy-review-sections.csv");
const entryPlan = readJson("legacy-entries.json");

const dbTasks = await fetchAll("tasks", "id, title, estimate_hours, legacy_title");
const taskById = new Map(dbTasks.map((t) => [t.id, t]));
const dbSections = await fetchAll("sections", "id, name");
const sectionById = new Map(dbSections.map((s) => [s.id, s]));

// Stale review files are the one thing that could put an hour figure on the wrong
// task, so refuse rather than write a subset.
const unknown = taskRows.filter((r) => !taskById.has(r.task_id)).length;
if (unknown > taskRows.length * 0.05) {
  throw new Error(
    `${unknown} of ${taskRows.length} review rows reference task ids that no longer exist.\n` +
      `The CSV is stale (task ids changed in the 2026-07-28 restore) — re-run reconcile-legacy-hours.mjs.`,
  );
}

// ── 1. the legacy time entries ────────────────────────────────────────────
const existing = new Set(
  (await fetchAll("time_entries", "asana_story_gid")).filter((e) => e.asana_story_gid).map((e) => e.asana_story_gid),
);
const toInsert = entryPlan
  .filter((e) => taskById.has(e.taskId) && !existing.has(e.storyGid))
  .map((e) => ({
    task_id: e.taskId,
    user_id: e.userId,
    legacy_author_name: e.authorName,
    date: e.date,
    minutes: e.minutes,
    description: e.body,
    legacy: true,
    asana_story_gid: e.storyGid,
  }));

let entriesWritten = 0;
if (APPLY) {
  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await supabase
      .from("time_entries")
      .upsert(toInsert.slice(i, i + 500), { onConflict: "asana_story_gid", ignoreDuplicates: true });
    if (error) console.error(`! time_entries ${i}: ${error.message}`);
    else entriesWritten += toInsert.slice(i, i + 500).length;
  }
}

// ── 2. task-level remainder + activity window ─────────────────────────────
// One UPDATE per task. `legacy_title` is stamped here (allowed) so the SQL file
// only has to set `title`; if you never run that file, the original name simply
// stays and nothing is inconsistent.
const taskUpdates = [];
const titleStatements = [];
for (const r of taskRows) {
  const t = taskById.get(r.task_id);
  if (!t) continue;
  const remainder = numOrNull(r.legacy_remainder, `task ${r.task_id}`);
  const patch = {};
  if (remainder != null && remainder > 0) patch.legacy_hours = remainder;
  if (r.activity_from) patch.activity_from = r.activity_from;
  if (r.activity_to) patch.activity_to = r.activity_to;

  const clean = r.clean_name?.trim();
  const renaming = clean && clean !== t.title;
  if (renaming && !t.legacy_title) patch.legacy_title = t.title;
  if (Object.keys(patch).length) taskUpdates.push({ id: r.task_id, patch });

  // Trigger-protected → SQL file.
  const budget = numOrNull(r.budget, `task ${r.task_id} budget`);
  const sets = [];
  if (renaming) sets.push(`title = ${q(clean)}`);
  if (budget != null && t.estimate_hours == null) sets.push(`estimate_hours = ${budget}`);
  if (sets.length) titleStatements.push(`update tasks set ${sets.join(", ")} where id = ${q(r.task_id)};`);
}

let tasksWritten = 0;
if (APPLY) {
  for (const u of taskUpdates) {
    const { error } = await supabase.from("tasks").update(u.patch).eq("id", u.id);
    if (error) console.error(`! task ${u.id}: ${error.message}`);
    else tasksWritten++;
  }
}

// ── 3. sections — fully writable, no trigger ──────────────────────────────
const sectionUpdates = [];
for (const r of sectionRows) {
  const s = sectionById.get(r.section_id);
  if (!s) continue;
  const patch = {};
  const clean = r.clean_name?.trim();
  // `rename_ok` is set by the reconciler: only the dissolved legacy projects' sections
  // may be renamed. Everything else is a live board the team still uses — the hours
  // and budget below are captured either way, but the name is left alone.
  if (r.rename_ok !== "no" && clean && clean !== s.name) {
    patch.legacy_name = s.name;
    patch.name = clean;
  }
  const actual = numOrNull(r.actual, `section ${r.section_id} actual`);
  const budget = numOrNull(r.budget, `section ${r.section_id} budget`);
  if (actual != null) patch.legacy_hours = actual;
  if (budget != null) patch.estimate_hours = budget;
  if (r.closed_on) patch.closed_on = r.closed_on;
  if (Object.keys(patch).length) sectionUpdates.push({ id: r.section_id, patch });
}

let sectionsWritten = 0;
if (APPLY) {
  for (const u of sectionUpdates) {
    const { error } = await supabase.from("sections").update(u.patch).eq("id", u.id);
    if (error) console.error(`! section ${u.id}: ${error.message}`);
    else sectionsWritten++;
  }
}

// ── 4. the small, delete-free SQL for the two protected columns ───────────
if (titleStatements.length) {
  const L = [
    `-- 0019 — clean the task names and set the budgets recovered from them.`,
    `--`,
    `-- ${titleStatements.length} statements. NO DELETE, NO DDL, nothing that can cascade.`,
    `-- Generated by scripts/apply-legacy-hours.mjs; everything else it recovered is`,
    `-- already applied. Only tasks.title and tasks.estimate_hours need to come`,
    `-- through here, because migration 0011's trigger reserves them for admins.`,
    `--`,
    `-- Rather than disable that trigger, this sets the JWT claim auth.uid() reads,`,
    `-- so is_admin() returns true and the trigger allows the updates. Scoped to this`,
    `-- transaction by the third argument to set_config.`,
    `--`,
    `-- Re-runnable: every statement targets one id and sets absolute values.`,
    `-- Originals are already saved in tasks.legacy_title, so to undo:`,
    `--   update tasks set title = legacy_title where legacy_title is not null;`,
    ``,
    `begin;`,
    `select set_config('request.jwt.claims', ${q(JSON.stringify({ sub: ADMIN_ID, role: "authenticated" }))}, true);`,
    ``,
    ...titleStatements,
    ``,
    `commit;`,
    ``,
  ];
  fs.writeFileSync(TITLE_SQL, L.join("\n"));
}

// ── report ────────────────────────────────────────────────────────────────
const entryHours = toInsert.reduce((a, e) => a + e.minutes, 0) / 60;
const remainderHours = taskUpdates.reduce((a, u) => a + Number(u.patch.legacy_hours ?? 0), 0);
console.log(APPLY ? "── APPLIED ──" : "── DRY RUN (nothing written; pass --apply) ──");
console.log(`legacy time entries  ${APPLY ? entriesWritten : toInsert.length}/${toInsert.length}   = ${entryHours.toFixed(2)}h`);
console.log(`  of which reductions ${toInsert.filter((e) => e.minutes < 0).length} (negative מפתח lines)`);
console.log(`  with no profile     ${toInsert.filter((e) => !e.user_id).length} (carry legacy_author_name)`);
console.log(`task updates         ${APPLY ? tasksWritten : taskUpdates.length}/${taskUpdates.length}   remainder ${remainderHours.toFixed(2)}h`);
console.log(`section updates      ${APPLY ? sectionsWritten : sectionUpdates.length}/${sectionUpdates.length}`);
console.log(`\ntotal recovered      ${(entryHours + remainderHours).toFixed(2)}h`);
console.log(
  `\nstill needs the SQL editor: ${titleStatements.length} title/budget updates` +
    `\n  → ${path.relative(process.cwd(), TITLE_SQL)}  (no DELETE, no DDL)`,
);
if (APPLY) console.log(`\nThen: node --env-file=.env.local scripts/audit-rehome.mjs`);
