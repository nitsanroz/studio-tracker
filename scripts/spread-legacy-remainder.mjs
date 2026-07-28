/**
 * Put the undated half of the recovered history onto the timeline.
 *
 *   node --env-file=.env.local scripts/spread-legacy-remainder.mjs           # dry run
 *   node --env-file=.env.local scripts/spread-legacy-remainder.mjs --apply
 *
 * Requires migration 0019 (adds time_entries.date_estimated).
 *
 * THE PROBLEM: 3,953.75h of the 7,948.65h recovered sat in `tasks.legacy_hours`
 * with no date, so no chart could plot it — the home page's early years showed
 * ~3,995h when the studio had really logged twice that. Those hours are undated
 * because a task's TITLE recorded a larger total than its comments accounted for
 * ("Ui system - 165hrs", comments totalling 8h → 157h with no day attached).
 *
 * THE SHAPE, in order of preference:
 *   1. The task's own real dated legacy entries — distribute proportionally, so
 *      the remainder follows the month-by-month shape the evidence shows.
 *   2. Otherwise, evenly across the months of activity_from → activity_to.
 *   3. Otherwise, the month of the section's closed_on.
 *   4. No date signal at all → LEFT ALONE in legacy_hours. Never guessed.
 *
 * Every row written is `legacy = true, date_estimated = true, user_id = null`.
 * Null author is deliberate: the hours belong to the client and the task, and
 * pinning an estimated date on a named person would put invented specifics into
 * that person's record.
 *
 * The invariant is preserved exactly — for each task, hours moved out of
 * legacy_hours equal hours inserted as entries, so
 *     task total = Σ(legacy entries) + legacy_hours
 * still holds and audit-rehome.mjs still passes.
 *
 * Reversible:
 *   -- restore the remainder, then delete the estimates
 *   update tasks t set legacy_hours = coalesce(t.legacy_hours,0) + x.h
 *     from (select task_id, sum(minutes)/60.0 h from time_entries
 *           where date_estimated group by task_id) x where t.id = x.task_id;
 *   delete from time_entries where date_estimated;
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

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

const tasks = await fetchAll("tasks", "id, title, legacy_hours, activity_from, activity_to, section_id");
const sections = await fetchAll("sections", "id, closed_on");
const closedOn = new Map(sections.map((s) => [s.id, s.closed_on]));
const entries = await fetchAll("time_entries", "task_id, date, minutes, legacy, date_estimated");

/** taskId → month key → minutes, from the task's REAL dated entries only. */
const shapeByTask = new Map();
for (const e of entries) {
  if (!e.legacy || e.date_estimated) continue;
  if ((e.minutes ?? 0) <= 0) continue; // reductions must not shape a distribution
  let m = shapeByTask.get(e.task_id);
  if (!m) shapeByTask.set(e.task_id, (m = new Map()));
  const k = e.date.slice(0, 7);
  m.set(k, (m.get(k) ?? 0) + e.minutes);
}

/** Months from `from` to `to` inclusive, as YYYY-MM. */
function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let mo = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  // Guard against a reversed or absurd window rather than looping forever.
  for (let i = 0; i < 240 && (y < ey || (y === ey && mo <= em)); i++) {
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
    if (++mo > 12) {
      mo = 1;
      y++;
    }
  }
  return out;
}

/** The 15th: a mid-month day, so a month's hours can't slide into a neighbour. */
const midMonth = (key) => `${key}-15`;

const rows = [];
const zeroed = [];
const skipped = [];

for (const t of tasks) {
  const remainder = Number(t.legacy_hours ?? 0);
  if (remainder <= 0) continue;
  const totalMinutes = Math.round(remainder * 60);

  const shape = shapeByTask.get(t.id);
  let weights = null; // [[monthKey, weight], …]

  if (shape && shape.size > 0) {
    weights = [...shape.entries()];
  } else if (t.activity_from && t.activity_to) {
    const months = monthsBetween(t.activity_from.slice(0, 7), t.activity_to.slice(0, 7));
    if (months.length) weights = months.map((k) => [k, 1]);
  } else if (t.activity_from) {
    weights = [[t.activity_from.slice(0, 7), 1]];
  } else if (closedOn.get(t.section_id)) {
    weights = [[closedOn.get(t.section_id).slice(0, 7), 1]];
  }

  if (!weights) {
    skipped.push({ title: t.title, hours: remainder });
    continue;
  }

  // Largest-remainder apportionment, so the parts sum to the whole exactly — a
  // per-row round() would drift and break the invariant.
  const totalWeight = weights.reduce((a, [, w]) => a + w, 0);
  const exact = weights.map(([k, w]) => [k, (totalMinutes * w) / totalWeight]);
  const floored = exact.map(([k, v]) => [k, Math.floor(v)]);
  let left = totalMinutes - floored.reduce((a, [, v]) => a + v, 0);
  const order = exact
    .map(([k, v], i) => [i, v - Math.floor(v)])
    .sort((a, b) => b[1] - a[1]);
  for (const [i] of order) {
    if (left <= 0) break;
    floored[i][1] += 1;
    left--;
  }

  for (const [key, minutes] of floored) {
    if (minutes <= 0) continue;
    rows.push({
      task_id: t.id,
      user_id: null,
      legacy_author_name: "(date estimated)",
      date: midMonth(key),
      minutes,
      description: `Recovered from "${(t.legacy_title ?? t.title ?? "").slice(0, 120)}" — hours recorded on the task, date estimated from its activity window.`,
      legacy: true,
      date_estimated: true,
    });
  }
  zeroed.push(t.id);
}

const movedH = rows.reduce((a, r) => a + r.minutes, 0) / 60;
console.log(APPLY ? "── APPLIED ──" : "── DRY RUN (nothing written; pass --apply) ──");
console.log(`tasks to spread     ${zeroed.length}`);
console.log(`entries to create   ${rows.length}   = ${movedH.toFixed(2)}h moved onto the timeline`);
console.log(`left undated        ${skipped.length} tasks, ${skipped.reduce((a, s) => a + s.hours, 0).toFixed(2)}h (no date signal — never guessed)`);
skipped.forEach((s) => console.log(`   ${s.hours}h  ${JSON.stringify(s.title.slice(0, 56))}`));

const byYear = new Map();
for (const r of rows) byYear.set(r.date.slice(0, 4), (byYear.get(r.date.slice(0, 4)) ?? 0) + r.minutes);
console.log(`\nhours added per year:`);
[...byYear.entries()].sort().forEach(([y, m]) => console.log(`  ${y}  ${(m / 60).toFixed(2)}h`));

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
// Only now clear the remainder, so a failure above leaves the invariant intact
// rather than losing the hours entirely.
for (let i = 0; i < zeroed.length; i += 200) {
  const { error } = await supabase
    .from("tasks")
    .update({ legacy_hours: null })
    .in("id", zeroed.slice(i, i + 200));
  if (error) console.error(`! clearing legacy_hours ${i}: ${error.message}`);
}
console.log(`\ninserted ${rows.length} estimated-date entries and cleared legacy_hours on ${zeroed.length} tasks`);
console.log(`Next: node --env-file=.env.local scripts/audit-rehome.mjs`);
