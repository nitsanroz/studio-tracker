/**
 * Generate the one-shot migration that dissolves "Imported / Unsorted".
 *
 *   node --env-file=.env.local scripts/build-rehome-sql.mjs
 *   → data/0017_rehome_unsorted.sql   (paste into the Supabase SQL editor)
 *
 * WHY SQL AND NOT A DIRECT WRITE: migration 0011 installs the BEFORE UPDATE
 * trigger `enforce_task_member_columns`, which rejects any change to client_id,
 * section_id, title or estimate_hours unless is_admin(). is_admin() reads
 * auth.uid(), which a service-key connection does not have — so this script
 * CANNOT perform these updates itself. The generated file disables the trigger
 * inside a transaction, does the work, and re-enables it.
 *
 * Hours and cleaned names come from data/legacy-review-*.csv when those exist,
 * so Nitsan's edits win over the parser. Without them the file still does the
 * re-homing, just without touching any name or hour.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fromCsv, numOrNull } from "./lib/csv.mjs";
import { makeAuthorResolver } from "./lib/asana-users.mjs";

const DATA = path.join(import.meta.dirname, "..", "data");
const OUT = path.join(DATA, "0018_rehome_unsorted.sql");
const CUTOVER_MAX = "2022-12-31";

/**
 * Legacy Everhour project → the client it really belongs to. Keyed on
 * projects.everhour_id, which is stable and unique (names are not).
 * `create: true` mints a new archived client; otherwise the name must already exist.
 *
 * "Website - Leg 2" folds into Volta on section evidence: its sections (Design,
 * Referral pages, 3D & Animation, UX & Wireframes, Development) mirror Volta
 * Solar's own "Leg 2 (181h)" and "Referral pages UX+UI (84h)".
 */
const MAP = [
  ["as:1186151771710269", "Volta", true], // Volta Solar
  ["as:1200243332541932", "Volta", true], // Volta On Going
  ["as:1200243332541808", "Volta", true], // Website - Leg 2
  ["as:257680404225328", "Cognigo (d.day labs)", true],
  ["as:167561988748343", "Quadream", true],
  ["as:1203307271028327", "Collabria", false], // exists, archived
  ["as:1202617922925561", "Harmonie", false], // exists, archived — 2103h
  ["as:1200919564657911", "Anchor", true],
  ["as:1211839453526602", "Voyantis", false], // exists, active
  ["b3:38366642", "Studio", false], // Making a Podcast — internal
  ["no:40f3f673-5d02-4ecd-8d25-afafee9895b0", "Studio", false], // Studio Website
  ["li:6b21e0eb-01d1-4b1f-b7e6-69b56fdb2bd4", "Studio", false], // Studio Website
  ["as:1203577431022050", "Studio", false], // Cross-functional project plan
  ["as:697705382152475", "Siteaware", true],
  ["as:770593244278334", "New Era", true],
  ["as:1200228187222714", "Yoco", true],
  ["as:1201715599799021", "One Zero", true],
  ["as:455542718969443", "In-reach", true],
  ["as:1202222067805639", "Empathy", true],
  ["as:1200243332541873", "CSL", true],
  ["as:1201110470169466", "PDQ", true],
  ["as:1155362291910928", "PlayStudios", true],
  ["as:1202138051052762", "Mesh", true],
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

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const qn = (v) => (v == null || v === "" ? "null" : Number(v));

const clients = await fetchAll("clients", "id, name, billable, archived");
const projects = await fetchAll("projects", "id, name, everhour_id");
const sections = await fetchAll("sections", "id, name, client_id");
const tasks = await fetchAll("tasks", "id, title, client_id, section_id, project_id, asana_gid, billable, estimate_hours");
const profiles = await fetchAll("profiles", "id, name");

const unsorted = clients.find((c) => c.name === "Imported / Unsorted");
if (!unsorted) throw new Error('no "Imported / Unsorted" client — nothing to do.');

const clientByName = new Map(clients.map((c) => [c.name, c]));
const projByEverhour = new Map(projects.map((p) => [p.everhour_id, p]));
const sectionById = new Map(sections.map((s) => [s.id, s]));

// ── resolve every target client, minting ids for the new ones ─────────────
const newClients = [];
const targetIdByName = new Map();
for (const [, name, create] of MAP) {
  if (targetIdByName.has(name)) continue;
  const existing = clientByName.get(name);
  if (existing) {
    targetIdByName.set(name, existing.id);
    continue;
  }
  if (!create) throw new Error(`mapping expects client "${name}" to exist, but it doesn't`);
  const id = crypto.randomUUID();
  targetIdByName.set(name, id);
  newClients.push({ id, name });
}

/** everhour project id → target client uuid */
const targetByProject = new Map(
  MAP.map(([everhourId, name]) => {
    const p = projByEverhour.get(everhourId);
    if (!p) console.warn(`! no project row for ${everhourId} — skipped`);
    return p ? [p.id, targetIdByName.get(name)] : null;
  }).filter(Boolean),
);

const unsortedTasks = tasks.filter((t) => t.client_id === unsorted.id);
const unmapped = unsortedTasks.filter((t) => !targetByProject.has(t.project_id));
if (unmapped.length) {
  // Refuse rather than silently leave rows behind: the final DELETE would then
  // cascade them away, destroying tasks nobody decided about.
  const names = [...new Set(unmapped.map((t) => projects.find((p) => p.id === t.project_id)?.name ?? "(no project)"))];
  throw new Error(
    `${unmapped.length} unsorted task(s) have no mapping — add these projects to MAP:\n  ${names.join("\n  ")}`,
  );
}

// ── reviewed CSVs (optional) ──────────────────────────────────────────────
const readCsv = (f) => {
  const p = path.join(DATA, f);
  if (!fs.existsSync(p)) return null;
  return fromCsv(fs.readFileSync(p, "utf8"));
};
const taskReview = readCsv("legacy-review-tasks.csv");
const sectionReview = readCsv("legacy-review-sections.csv");
if (!taskReview) console.warn("! no data/legacy-review-tasks.csv — names and hours will NOT be touched");

const reviewByTask = new Map((taskReview ?? []).map((r) => [r.task_id, r]));
const reviewBySection = new Map((sectionReview ?? []).map((r) => [r.section_id, r]));

// ── section moves, merging where the target already has that name ─────────
const sectionsByClient = new Map();
for (const s of sections) {
  if (!sectionsByClient.has(s.client_id)) sectionsByClient.set(s.client_id, []);
  sectionsByClient.get(s.client_id).push(s);
}
/** old section id → { targetClientId, mergeIntoSectionId | null, newName } */
const sectionPlan = new Map();
for (const s of sections) {
  if (s.client_id !== unsorted.id) continue;
  // A section's client is decided by the tasks sitting in it.
  const targets = new Set(
    unsortedTasks.filter((t) => t.section_id === s.id).map((t) => targetByProject.get(t.project_id)),
  );
  if (targets.size === 0) continue; // empty section — dropped at the end
  if (targets.size > 1) {
    console.warn(`! section "${s.name}" holds tasks for ${targets.size} different clients — tasks move, section stays put`);
  }
  const targetClientId = [...targets][0];
  const newName = reviewBySection.get(s.id)?.clean_name?.trim() || s.name;
  const collision = (sectionsByClient.get(targetClientId) ?? []).find(
    (o) => o.id !== s.id && o.name.trim().toLowerCase() === newName.trim().toLowerCase(),
  );
  sectionPlan.set(s.id, { targetClientId, mergeInto: collision?.id ?? null, newName });
}

// ── build the file ────────────────────────────────────────────────────────
const L = [];
const counts = new Map();
for (const t of unsortedTasks) {
  const name = [...targetIdByName].find(([, id]) => id === targetByProject.get(t.project_id))?.[0];
  counts.set(name, (counts.get(name) ?? 0) + 1);
}
const studioId = targetIdByName.get("Studio");

L.push(`-- 0018 — dissolve "Imported / Unsorted" (generated by scripts/build-rehome-sql.mjs)`);
L.push(`--`);
L.push(`-- ${unsortedTasks.length} tasks and ${sectionPlan.size} sections move to their real client.`);
L.push(`-- Run in the Supabase SQL editor. Requires migrations 0016 AND 0017 to be applied first.`);
L.push(`--`);
for (const [name, c] of [...counts].sort((a, b) => b[1] - a[1])) {
  L.push(`--   ${String(c).padStart(4)}  ${name}${newClients.some((n) => n.name === name) ? "   (new, archived)" : ""}`);
}
L.push(`--`);
L.push(`-- The trigger from 0011 blocks client_id/section_id/title writes for anything`);
L.push(`-- without an admin auth.uid(), which the SQL editor also lacks — hence the`);
L.push(`-- disable/enable around the body. It is inside the transaction, so a failure`);
L.push(`-- rolls the trigger back on with everything else.`);
L.push(``);
L.push(`begin;`);
L.push(`alter table tasks disable trigger trg_task_member_cols;`);
L.push(``);

if (newClients.length) {
  L.push(`-- ── 1. former clients that never had a row ───────────────────────────`);
  // `where not exists` rather than `on conflict (name)`: clients.name is NOT
  // unique (only clients.everhour_id is), so an ON CONFLICT on it fails the whole
  // transaction with 42P10 "no unique or exclusion constraint matching". This form
  // needs no constraint and is just as re-runnable.
  for (const c of newClients) {
    L.push(
      `insert into clients (id, name, color, archived, billable)\n` +
        `  select ${q(c.id)}, ${q(c.name)}, '#9ca3af', true, true\n` +
        `  where not exists (select 1 from clients where name = ${q(c.name)});`,
    );
  }
  L.push(``);
}

L.push(`-- ── 2. sections ──────────────────────────────────────────────────────`);
let merges = 0;
for (const [oldId, plan] of sectionPlan) {
  const old = sectionById.get(oldId);
  if (plan.mergeInto) {
    merges++;
    L.push(`-- "${old.name}" already exists on the target — merge into it`);
    L.push(`update tasks set section_id = ${q(plan.mergeInto)} where section_id = ${q(oldId)};`);
    L.push(`delete from sections where id = ${q(oldId)};`);
  } else {
    const r = reviewBySection.get(oldId);
    const sets = [`client_id = ${q(plan.targetClientId)}`];
    if (r && plan.newName !== old.name) {
      sets.push(`legacy_name = coalesce(legacy_name, name)`, `name = ${q(plan.newName)}`);
    }
    if (r?.actual) sets.push(`legacy_hours = ${qn(numOrNull(r.actual, `section ${oldId} actual`))}`);
    if (r?.budget) sets.push(`estimate_hours = ${qn(numOrNull(r.budget, `section ${oldId} budget`))}`);
    if (r?.closed_on) sets.push(`closed_on = ${q(r.closed_on)}`);
    L.push(`update sections set ${sets.join(", ")} where id = ${q(oldId)};`);
  }
}
L.push(``);

L.push(`-- ── 3. tasks ─────────────────────────────────────────────────────────`);
for (const t of unsortedTasks) {
  const target = targetByProject.get(t.project_id);
  const r = reviewByTask.get(t.id);
  const sets = [`client_id = ${q(target)}`];
  // Studio is an Internal client. updateClient's cascade only fires when the
  // flag is toggled, not on an inbound move, so set it here.
  if (target === studioId && t.billable) sets.push(`billable = false`);
  if (r) {
    const clean = r.clean_name?.trim();
    if (clean && clean !== t.title) {
      sets.push(`legacy_title = coalesce(legacy_title, title)`, `title = ${q(clean)}`);
    }
    const budget = numOrNull(r.budget, `task ${t.id} budget`);
    if (budget != null && t.estimate_hours == null) sets.push(`estimate_hours = ${budget}`);
    const remainder = numOrNull(r.legacy_remainder, `task ${t.id} remainder`);
    if (remainder != null && remainder > 0) sets.push(`legacy_hours = ${remainder}`);
    if (r.activity_from) sets.push(`activity_from = ${q(r.activity_from)}`);
    if (r.activity_to) sets.push(`activity_to = ${q(r.activity_to)}`);
  }
  L.push(`update tasks set ${sets.join(", ")} where id = ${q(t.id)};`);
}
L.push(``);

// ── 4. attributable comment hours → real dated entries ────────────────────
// Read straight from the reconciler's plan. Re-deriving these here is what let the
// two scripts disagree: the SQL was emitting entries for roll-up parents and for
// tasks the review had deliberately left at zero, so Σ(entries) no longer matched
// the legacy_remainder written on the same task.
const PLAN = path.join(DATA, "legacy-entries.json");
const entryLines = [];
let skippedNoProfile = 0;
if (fs.existsSync(PLAN)) {
  for (const e of JSON.parse(fs.readFileSync(PLAN, "utf8"))) {
    if (!e.userId) skippedNoProfile++;
    entryLines.push(
      `insert into time_entries (task_id, user_id, legacy_author_name, date, minutes, description, legacy, asana_story_gid) ` +
        `values (${q(e.taskId)}, ${e.userId ? q(e.userId) : "null"}, ${q(e.authorName)}, ` +
        `${q(e.date)}, ${e.minutes}, ${q(e.body)}, true, ${q(e.storyGid)}) ` +
        `on conflict (asana_story_gid) do nothing;`,
    );
  }
} else {
  console.warn("! no data/legacy-entries.json — run reconcile-legacy-hours.mjs first");
}

L.push(`-- ── 4. attributable pre-Everhour hours → dated entries ───────────────`);
if (entryLines.length) {
  L.push(`-- ${entryLines.length} comments carried hours + a date + a matchable person.`);
  L.push(`-- Everything else stays in tasks.legacy_hours as the unattributed remainder.`);
  L.push(...entryLines);
} else {
  L.push(`-- none: Asana comments not fetched yet (scripts/fetch-asana-stories.mjs).`);
  L.push(`-- All recovered hours are in tasks.legacy_hours for now.`);
}
L.push(``);

L.push(`-- ── 5. retire the bucket ─────────────────────────────────────────────`);
L.push(`delete from sections where client_id = ${q(unsorted.id)}`);
L.push(`  and not exists (select 1 from tasks where tasks.section_id = sections.id);`);
L.push(`do $$`);
L.push(`declare leftover int;`);
L.push(`begin`);
L.push(`  select count(*) into leftover from tasks where client_id = ${q(unsorted.id)};`);
L.push(`  if leftover > 0 then`);
L.push(`    -- clients.id is ON DELETE CASCADE for tasks: deleting with rows still`);
L.push(`    -- attached would destroy them. Abort instead.`);
L.push(`    raise exception '% task(s) still under Imported / Unsorted — not deleting it', leftover;`);
L.push(`  end if;`);
L.push(`  delete from clients where id = ${q(unsorted.id)};`);
L.push(`end $$;`);
L.push(``);
L.push(`alter table tasks enable trigger trg_task_member_cols;`);
L.push(`commit;`);
L.push(``);

fs.writeFileSync(OUT, L.join("\n"));

console.log(`tasks moved       ${unsortedTasks.length}`);
console.log(`sections moved    ${sectionPlan.size} (${merges} merged into an existing section)`);
console.log(`clients created   ${newClients.length}  ${newClients.map((c) => c.name).join(", ")}`);
const entryMinutes = entryLines.reduce((a, l) => a + Number(l.match(/, (-?\d+), /)?.[1] ?? 0), 0);
console.log(
  `legacy entries    ${entryLines.length} rows, ${(entryMinutes / 60).toFixed(2)}h ` +
    `(${skippedNoProfile} name an author with no profile)`,
);
console.log(`names/hours from  ${taskReview ? `${taskReview.length} reviewed task rows` : "NOTHING (review CSV missing)"}`);
console.log(`\nwrote ${path.relative(process.cwd(), OUT)} — ${L.length} statements. Run it in the Supabase SQL editor.`);
