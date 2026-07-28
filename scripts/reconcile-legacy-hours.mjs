/**
 * Build the review sheets for the pre-Everhour hour recovery.
 *
 *   node --env-file=.env.local scripts/reconcile-legacy-hours.mjs [--all]
 *
 * Reads task titles, section names and (when present) the Asana comment threads
 * cached by fetch-asana-stories.mjs, and writes two CSVs for Nitsan to check:
 *
 *   data/legacy-review-tasks.csv
 *   data/legacy-review-sections.csv
 *
 * THIS SCRIPT WRITES NOTHING TO THE DATABASE. The reviewed CSVs are the input to
 * build-rehome-sql.mjs, which is the only thing that produces SQL. Edit the
 * `budget`, `actual` and `clean_name` columns and the edit wins over the parse.
 *
 * Scope: by default the 23 legacy projects that made up "Imported / Unsorted"
 * (keyed on project_id — the client itself no longer exists). `--all` widens to
 * every billable task on a billable client that has an asana_gid and no tracked
 * time (the 1,404 the plan settled on).
 *
 * THE INVARIANT, per task:  total = Σ(legacy time entries) + legacy_hours
 * `legacy_hours` is the REMAINDER — hours we know were worked but cannot pin to a
 * person and a date. It is never a duplicate of the entries.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { parseLegacyName, parseCommentHours } from "./lib/legacy-hours.mjs";
import { makeAuthorResolver } from "./lib/asana-users.mjs";
import { toCsv } from "./lib/csv.mjs";

const WIDE = process.argv.includes("--all");
const DATA = path.join(import.meta.dirname, "..", "data");
const STORIES = path.join(DATA, "asana", "stories");
/** The Everhour cutover. A "pre-Everhour" entry dated after this is a parse error. */
const CUTOVER_MAX = "2022-12-31";

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

const profiles = await fetchAll("profiles", "id, name");
const resolveAuthor = makeAuthorResolver(profiles);
const clients = await fetchAll("clients", "id, name, billable, archived");
const sections = await fetchAll("sections", "id, name, client_id");
const tasks = await fetchAll("tasks", "id, title, client_id, section_id, project_id, asana_gid, billable, estimate_hours");
const entries = await fetchAll("time_entries", "task_id");

const clientById = new Map(clients.map((c) => [c.id, c]));
const sectionById = new Map(sections.map((s) => [s.id, s]));
/**
 * The 23 legacy Everhour projects that made up "Imported / Unsorted".
 *
 * Scope is keyed on these and NOT on the client, because the client is gone: the
 * tasks now sit under their real clients (Volta, Quadream, Harmonie…). `project_id`
 * is the one identifier that survived both the re-home and the 2026-07-28 restore,
 * which is exactly why the restore script preserved it.
 */
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
const projects = await fetchAll("projects", "id, everhour_id");
const legacyProjectIds = new Set(
  projects.filter((p) => LEGACY_PROJECTS.has(p.everhour_id)).map((p) => p.id),
);
if (legacyProjectIds.size === 0) throw new Error("no legacy project rows found — was the restore run?");

/** Sections belonging to those projects — the ones whose names carry hour figures. */
const legacySectionIds = new Set(
  tasks.filter((t) => legacyProjectIds.has(t.project_id) && t.section_id).map((t) => t.section_id),
);

const hasTracked = new Set(entries.map((e) => e.task_id));

// Never touch a task that already has real tracked time: on the 51 studio-wide
// tasks where both exist, the tracked hours are either the same figure re-logged
// at the 2022-12-04 cutover or a later, more complete total. Tracked always wins.
// --all covers INTERNAL clients too (Studio, OFFF tlv), matching the scope Nitsan
// chose on 2026-07-28. `hasTracked` already excludes anything with an existing entry
// — including the title-recovered ones — so a re-run naturally narrows to the tasks
// whose hours are still missing, i.e. the ones whose titles carried no figure.
const inScope = tasks.filter((t) => {
  if (hasTracked.has(t.id)) return false;
  if (legacyProjectIds.has(t.project_id)) return true;
  if (!WIDE) return false;
  return !!t.asana_gid;
});

// ── Asana comments, if fetch-asana-stories.mjs has run ────────────────────
let storyFiles = [];
try {
  storyFiles = fs.readdirSync(STORIES).filter((f) => f.endsWith(".json"));
} catch {
  /* not fetched yet — title-only pass */
}
/** asana_gid → [{gid, date, authorGid, authorName, hours, text}] */
const commentsByGid = new Map();
for (const f of storyFiles) {
  const gid = f.replace(/\.json$/, "");
  let stories;
  try {
    stories = JSON.parse(fs.readFileSync(path.join(STORIES, f), "utf8"));
  } catch {
    console.warn(`! ${f} is not readable JSON — skipped`);
    continue;
  }
  const list = (Array.isArray(stories) ? stories : (stories.data ?? []))
    .filter((s) => s.resource_subtype === "comment_added")
    .map((s) => ({
      gid: s.gid,
      date: String(s.created_at ?? "").slice(0, 10),
      authorName: s.created_by?.name ?? "",
      // Same resolver the SQL generator uses, so "attributable" here means
      // exactly "will become a time entry there".
      profileId: resolveAuthor(s),
      text: s.text ?? "",
      hours: parseCommentHours(s.text),
    }))
    .filter((s) => s.date);
  if (list.length) commentsByGid.set(gid, list);
}

// ── parent / subtask shape ────────────────────────────────────────────────
// A parent's title figure is the ROLL-UP of its subtasks: "Q&A Movies - 128.25h"
// has 7 children summing to the same 128.25h, and the tracker imported parents
// and children as flat siblings — so counting both doubles every rolled-up
// figure. Per Nitsan the CHILDREN win and the parent contributes 0.
//
// Guarded, though: the parent is only zeroed when at least one of its children is
// actually present in our data AND carries hours. A parent whose subtasks were
// never imported keeps its own figure, because nothing else would carry it.
const PARENTS = path.join(DATA, "asana", "parents.json");
const shapes = fs.existsSync(PARENTS) ? JSON.parse(fs.readFileSync(PARENTS, "utf8")) : {};
const taskByGid = new Map(inScope.filter((t) => t.asana_gid).map((t) => [t.asana_gid, t]));

/** parent gid → total hours its in-scope children can account for */
const childHoursByParent = new Map();
for (const t of inScope) {
  const parentGid = shapes[t.asana_gid]?.parent;
  if (!parentGid) continue;
  const own = parseLegacyName(t.title).actual;
  if (own == null) continue;
  childHoursByParent.set(parentGid, (childHoursByParent.get(parentGid) ?? 0) + own);
}

// ── rows ──────────────────────────────────────────────────────────────────
const taskRows = [];
/** The exact time entries to create — consumed verbatim by build-rehome-sql.mjs. */
const entryPlan = [];
let withComments = 0;
let zeroedParents = 0;

for (const t of inScope) {
  const p = parseLegacyName(t.title);
  const comments = (t.asana_gid && commentsByGid.get(t.asana_gid)) || [];
  const withHours = comments.filter((c) => c.hours != null);
  if (comments.length) withComments++;

  const commentTotal = withHours.reduce((a, c) => a + c.hours, 0);
  const dates = comments.map((c) => c.date).sort();

  // The title figure was maintained by hand and is the studio's own total, so it
  // wins when both exist; comments are the fallback for the tasks whose title
  // carries no number at all.
  let total = p.actual ?? (commentTotal > 0 ? commentTotal : null);

  const flags = [...p.flags];

  // Roll-up parent → children carry the hours instead.
  const shape = shapes[t.asana_gid];
  const childHours = childHoursByParent.get(t.asana_gid) ?? 0;
  if (shape?.subs > 0 && childHours > 0) {
    if (total != null) {
      flags.push("rollup-parent-zeroed");
      zeroedParents++;
    }
    total = null;
  } else if (shape?.subs > 0 && total != null) {
    // Has subtasks in Asana but none of them reached us with hours, so this
    // figure is the only record of the work. Keep it, but say so.
    flags.push("rollup-parent-kept-no-children");
  }
  if (p.actual != null && commentTotal > 0) {
    const diff = Math.abs(p.actual - commentTotal) / Math.max(p.actual, commentTotal);
    if (diff > 0.2) flags.push("title-vs-comments-differ");
  }
  const lateEntries = withHours.filter((c) => c.date > CUTOVER_MAX);
  if (lateEntries.length) flags.push("comment-after-cutover");

  // An entry needs hours and a date at or before the cutover. It does NOT need a
  // matching profile: migration 0017 lets a recovered entry name a bare author
  // instead, because most pre-Everhour authors left long before the current
  // roster and minting login accounts for them would be worse than the gap.
  //
  // Reductions are included with their sign — a "-11.5h מפתח" comment is a real
  // ledger line, and dropping it while keeping the positives is what made comment
  // totals run 4× over the hand-maintained title figures.
  const usable = withHours.filter((c) => c.date <= CUTOVER_MAX);

  // A task with no trustworthy total gets NO entries. Emitting them anyway would
  // put hours on a task the review deliberately left at zero — including every
  // roll-up parent, whose children already carry the same hours.
  const entries = total == null ? [] : usable;
  const attributable = +entries.reduce((a, c) => a + c.hours, 0).toFixed(2);

  // The dated entries are hard evidence: if they already exceed the title figure,
  // the title was stale, so the total rises to match rather than the surplus being
  // discarded. Done this way `total = attributable + remainder` holds exactly, with
  // no clamping — the invariant the whole import rests on.
  if (attributable > (total ?? 0) + 0.01) {
    flags.push("entries-exceed-title-total");
    total = attributable;
  }
  const remainder = total == null ? null : +(total - attributable).toFixed(2);

  // The authoritative entry list. build-rehome-sql.mjs emits exactly these rather
  // than re-deriving them, so the two can never disagree about what gets written.
  for (const c of entries) {
    entryPlan.push({
      taskId: t.id,
      storyGid: c.gid,
      date: c.date,
      minutes: Math.round(c.hours * 60),
      userId: c.profileId,
      authorName: c.authorName || "(unknown)",
      body: String(c.text ?? "").slice(0, 500),
    });
  }

  taskRows.push({
    task_id: t.id,
    client: clientById.get(t.client_id)?.name ?? "",
    section: sectionById.get(t.section_id)?.name ?? "",
    original_title: t.title,
    clean_name: p.clean,
    // High end of a range, per Nitsan: that is the ceiling that was quoted to the
    // client. The full range survives in the original title either way.
    budget: p.budgetMax ?? "",
    budget_low: p.budget !== p.budgetMax ? (p.budget ?? "") : "",
    existing_estimate: t.estimate_hours ?? "",
    title_hours: p.actual ?? "",
    comment_hours: commentTotal || "",
    comment_count: comments.length || "",
    // Hours from comments whose author has no profile — recoverable as a figure
    // but not as a dated entry. See the "former staff" note in asana-users.mjs.
    unattributable_comment_hours:
      +withHours.filter((c) => !c.profileId).reduce((a, c) => a + c.hours, 0).toFixed(2) || "",
    actual: total ?? "",
    attributable_hours: attributable || "",
    legacy_remainder: remainder ?? "",
    activity_from: dates[0] ?? "",
    activity_to: dates[dates.length - 1] ?? "",
    flag: flags.join(" "),
  });
}

const sectionRows = [];
for (const s of sections) {
  // Only sections belonging to in-scope tasks' clients are worth renaming.
  if (!WIDE && !legacySectionIds.has(s.id)) continue;
  const p = parseLegacyName(s.name);
  if (p.budget == null && p.actual == null && p.closedOn == null && p.clean === s.name) continue;
  sectionRows.push({
    section_id: s.id,
    client: clientById.get(s.client_id)?.name ?? "",
    original_name: s.name,
    clean_name: p.clean,
    budget: p.budgetMax ?? "",
    budget_low: p.budget !== p.budgetMax ? (p.budget ?? "") : "",
    actual: p.actual ?? "",
    closed_on: p.closedOn ?? "",
    flag: p.flags.join(" "),
  });
}

// Flagged rows first — those are the ones that need a human.
const byFlag = (a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0);
taskRows.sort(byFlag);
sectionRows.sort(byFlag);

const TASK_COLS = Object.keys(taskRows[0] ?? { task_id: "" });
const SECTION_COLS = Object.keys(sectionRows[0] ?? { section_id: "" });
fs.writeFileSync(path.join(DATA, "legacy-review-tasks.csv"), toCsv(taskRows, TASK_COLS));
fs.writeFileSync(path.join(DATA, "legacy-review-sections.csv"), toCsv(sectionRows, SECTION_COLS));
fs.writeFileSync(path.join(DATA, "legacy-entries.json"), JSON.stringify(entryPlan, null, 1));

// ── summary ───────────────────────────────────────────────────────────────
const n = (f) => taskRows.filter(f).length;
const sum = (f) => taskRows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
console.log(`scope: ${WIDE ? "all billable zero-hour tasks" : "the 23 legacy projects only"}`);
console.log(`tasks in scope       ${inScope.length}`);
console.log(`  with a title hour  ${n((r) => r.title_hours !== "")}`);
console.log(`  with comments      ${withComments}${storyFiles.length ? "" : "   (no comments fetched yet — run fetch-asana-stories.mjs)"}`);
console.log(`  with ANY total     ${n((r) => r.actual !== "")}`);
console.log(`  still at zero      ${n((r) => r.actual === "")}`);
console.log(`  flagged for review ${n((r) => r.flag !== "")}`);
if (Object.keys(shapes).length === 0) {
  console.log(`  ! no data/asana/parents.json — ROLL-UP PARENTS ARE NOT BEING ZEROED,`);
  console.log(`    so any parent whose title repeats its subtasks' hours double-counts.`);
  console.log(`    Run fetch-asana-stories.mjs first.`);
} else {
  console.log(`  roll-up parents zeroed ${zeroedParents} (their subtasks carry the hours)`);
}
console.log(`  key/מפתח reduction notes not counted ${n((r) => r.flag.includes("key-reduction"))}`);
const total = sum("actual");
const attrib = sum("attributable_hours");
const rem = sum("legacy_remainder");
console.log(`hours recoverable    ${total.toFixed(2)}h`);
console.log(`  → dated entries    ${attrib.toFixed(2)}h  (author has a profile)`);
console.log(`  → remainder        ${rem.toFixed(2)}h  (no person and/or no date)`);
// Fail loudly rather than emit a sheet whose numbers cannot both be true.
const drift = Math.abs(total - (attrib + rem));
if (drift > 0.5) {
  console.error(`\nINVARIANT BROKEN: total ≠ attributable + remainder (off by ${drift.toFixed(2)}h)`);
  process.exit(1);
}
console.log(`  invariant holds    total = attributable + remainder (±${drift.toFixed(2)}h)`);
console.log(`hours in comments by people with no profile: ${sum("unattributable_comment_hours").toFixed(2)}h`);
console.log(`sections to rewrite  ${sectionRows.length}`);
console.log(`\nwrote data/legacy-review-tasks.csv and data/legacy-review-sections.csv`);
console.log(`Review the flagged rows, then run: node --env-file=.env.local scripts/build-rehome-sql.mjs`);
