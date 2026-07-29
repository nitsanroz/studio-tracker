/**
 * Assert everything the re-home was supposed to do — and nothing it wasn't.
 *
 *   node --env-file=.env.local scripts/audit-rehome.mjs
 *
 * Safe to run before, during and after: it only reads. Before 0017 it reports
 * the "not run yet" state rather than failing.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { key as clientKey, resolve } from "./lib/client-names.mjs";

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

/**
 * 4507, not the original 4506 — one row off, deliberately.
 *
 * `restore-unsorted.mjs` rebuilt from data/everhour-tasks-all.json, which carries 7
 * more Studio tasks than the pre-incident DB held. They were not skipped by the
 * original import (its loop has no such filter) — they were added to the Basecamp /
 * Linear boards AFTERWARDS and only ever existed in the refreshed dump.
 *
 * 6 were removed once identified with evidence:
 *   - 5 in a "Shnitz" section that provably did not exist pre-incident (the other
 *     23 "Making a Podcast" rows match the recorded section counts exactly:
 *     Episode Ideas 2, Scheduled 2, Editing 1, Approved 1, Done 5, Not now 2,
 *     Listener Questions 6, Newsletter updates 4). Titled "1", "2", "3", "123".
 *   - the lowercase "hero", a case-duplicate of "Hero".
 *
 * The 7th is NOT identifiable: the "Studio Website" (li:) board held 1 task before
 * and 3 after, all zero-hour, comment-free and section-less — "Hero", "hero",
 * "Mobile Hero". Which one was original is unknowable from the dump, so one extra
 * zero-hour row is left in rather than deleting real content to make a constant
 * match. This number describes reality; it is not a target to hit.
 */
const EXPECTED_TASKS = 4475;

/**
 * The re-home mapping, keyed on projects.everhour_id → client name. Same table as
 * scripts/build-rehome-sql.mjs and restore-unsorted.mjs.
 *
 * Asserted via project_id rather than by comparing each client's task TOTAL: a total
 * is not an invariant, since unrelated tasks are added and deleted in normal use.
 * project_id is never modified by any of this, so "did it land in the right client"
 * stays answerable forever.
 */
const LEGACY_PROJECT_CLIENT = [
  ["as:1186151771710269", "Volta"],
  ["as:1200243332541932", "Volta"],
  ["as:1200243332541808", "Volta"],
  ["as:257680404225328", "Cognigo (d.day labs)"],
  ["as:167561988748343", "Quadream"],
  ["as:1203307271028327", "Collabria"],
  ["as:1202617922925561", "Harmonie"],
  ["as:1200919564657911", "Anchor"],
  ["as:1211839453526602", "Voyantis"],
  ["b3:38366642", "Studio"],
  ["no:40f3f673-5d02-4ecd-8d25-afafee9895b0", "Studio"],
  ["li:6b21e0eb-01d1-4b1f-b7e6-69b56fdb2bd4", "Studio"],
  ["as:1203577431022050", "Studio"],
  ["as:697705382152475", "Siteaware"],
  ["as:770593244278334", "New Era"],
  ["as:1200228187222714", "Yoco"],
  ["as:1201715599799021", "One Zero"],
  ["as:455542718969443", "In-reach"],
  ["as:1202222067805639", "Empathy"],
  ["as:1200243332541873", "CSL"],
  ["as:1201110470169466", "PDQ"],
  ["as:1155362291910928", "PlayStudios"],
  ["as:1202138051052762", "Mesh"],
];

/** Everhour id of the legacy "Harmon.ie cloud" project — the only re-homed
 *  project carrying real tracked time (2103h across 33 tasks). tasks.project_id
 *  is never modified, so this identifies the same rows before and after. */
const HARMONIE_PROJECT = "as:1202617922925561";

let failures = 0;
const ok = (cond, msg, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}${detail ? `  ${detail}` : ""}`);
  if (!cond) failures++;
};

const clients = await fetchAll("clients", "id, name, archived, billable");
const tasks = await fetchAll("tasks", "id, title, client_id, section_id, project_id, legacy_hours, legacy_title, activity_from, activity_to, created_at, completed_at, due_date, billable").catch(
  () => fetchAll("tasks", "id, title, client_id, section_id, project_id, billable"),
);
const sections = await fetchAll("sections", "id, name, client_id, closed_on");
let entries;
try {
  entries = await fetchAll("time_entries", "id, task_id, user_id, minutes, date, legacy, date_estimated, asana_story_gid, legacy_author_name");
} catch {
  entries = (await fetchAll("time_entries", "id, task_id, user_id, minutes, date")).map((e) => ({ ...e, legacy: false, date_estimated: false, legacy_author_name: null }));
}
// Read-only; used to verify the finance-derived months against their source.
const financeMonthly = await fetchAll(
  "finance_client_monthly",
  "year, month, client_canon, hours, state",
).catch(() => []);

const byId = new Map(clients.map((c) => [c.id, c]));
const unsorted = clients.find((c) => c.name === "Imported / Unsorted");
const countFor = (name) => {
  const c = clients.find((x) => x.name === name);
  return c ? tasks.filter((t) => t.client_id === c.id).length : null;
};

console.log("── the bucket ──────────────────────────────────────────────");
if (unsorted) {
  const left = tasks.filter((t) => t.client_id === unsorted.id).length;
  console.log(`  … "Imported / Unsorted" still exists with ${left} tasks — 0017 not run yet`);
} else {
  ok(true, '"Imported / Unsorted" is gone');
}

console.log("\n── nothing lost ────────────────────────────────────────────");
// A MINIMUM, not an equality. The re-home is verified, and tasks may legitimately
// be deleted afterwards (32 zero-hour Voyantis rows were tidied up with bulk-select
// on 2026-07-28). What must never happen is a SILENT drop, so this fails only if the
// count falls below the recorded baseline — normal tidying is not an error.
ok(tasks.length >= EXPECTED_TASKS, `task count ${tasks.length}`, `(baseline >= ${EXPECTED_TASKS})`);
ok(
  !tasks.some((t) => !t.client_id),
  "every task has a client",
  `${tasks.filter((t) => !t.client_id).length} orphaned`,
);
const sectionClient = new Map(sections.map((s) => [s.id, s.client_id]));
const stranded = tasks.filter((t) => t.section_id && sectionClient.get(t.section_id) !== t.client_id);
ok(stranded.length === 0, "no task sits in another client's section", `${stranded.length} stranded`);

console.log("\n── landed where expected ───────────────────────────────────");
// Keyed on project_id → client, NOT on each client's task TOTAL. A total is not an
// invariant: unrelated tasks get added and deleted (32 zero-hour Voyantis rows were
// tidied up on 2026-07-28), which made the old equality fail on ordinary use. What
// must hold forever is that every surviving task from a legacy project sits under the
// client it was re-homed to — project_id is never modified, so this stays true.
const projectsForMap = await fetchAll("projects", "id, name, everhour_id");
const clientForLegacyProject = new Map(LEGACY_PROJECT_CLIENT);
let wrongClient = 0;
for (const [everhourId, clientName] of LEGACY_PROJECT_CLIENT) {
  const p = projectsForMap.find((x) => x.everhour_id === everhourId);
  if (!p) {
    ok(false, `legacy project ${everhourId}`, "project row missing");
    continue;
  }
  const want = clients.find((c) => c.name === clientName);
  const mine = tasks.filter((t) => t.project_id === p.id);
  const astray = mine.filter((t) => t.client_id !== want?.id);
  wrongClient += astray.length;
  if (astray.length) {
    ok(false, `${p.name} → ${clientName}`, `${astray.length} of ${mine.length} under the wrong client`);
  }
}
ok(wrongClient === 0, "every re-homed task sits under its mapped client", `${wrongClient} astray`);
// Counts are reported, not asserted — they move with normal editing.
const counts = [...new Set(LEGACY_PROJECT_CLIENT.map(([, n]) => n))]
  .map((n) => `${n} ${countFor(n) ?? "—"}`)
  .join(" · ");
console.log(`    client totals now: ${counts}`);

console.log("\n── Harmon.ie hours survived untouched ──────────────────────");
const projects = await fetchAll("projects", "id, everhour_id");
const harmProject = projects.find((p) => p.everhour_id === HARMONIE_PROJECT);
if (harmProject) {
  // Identified by project_id, not by client: it is stable across the move, and
  // the target client has 45 tasks of its own that must not be counted here.
  const ids = new Set(tasks.filter((t) => t.project_id === harmProject.id).map((t) => t.id));
  // Only the genuinely TRACKED hours must be preserved exactly. 7 of these 33 tasks
  // never had tracked time of their own and legitimately received recovered hours on
  // top — one of them an estimated-date entry — so a flat "no backfilled entries
  // here" and a 2103h grand total are both stale expectations.
  const tracked = entries
    .filter((e) => ids.has(e.task_id) && !e.legacy)
    .reduce((a, e) => a + (e.minutes ?? 0), 0);
  const recovered = entries
    .filter((e) => ids.has(e.task_id) && e.legacy)
    .reduce((a, e) => a + (e.minutes ?? 0), 0);
  ok(ids.size === 33, `${ids.size} tasks`, "(expected 33)");
  ok(Math.round(tracked / 60) === 2103, `${Math.round(tracked / 60)}h TRACKED`, "(expected exactly 2103h)");
  console.log(`    + ${(recovered / 60).toFixed(2)}h recovered on the 7 with no tracked time`);
  // NOT "no legacy_hours anywhere in this project" — that was too strict. 7 of the
  // 33 Harmon.ie tasks never had tracked time of their own, so recovering their
  // title hours is correct. The real rule is asserted studio-wide below: no task
  // may hold BOTH recovered hours and genuinely tracked time.
  const withTracked = new Set(entries.filter((e) => !e.legacy).map((e) => e.task_id));
  ok(
    !tasks.some((t) => ids.has(t.id) && t.legacy_hours && withTracked.has(t.id)),
    "none of them mixes recovered hours with tracked time",
  );
  const harmonie = clients.find((c) => c.name === "Harmonie");
  if (harmonie && !unsorted) {
    ok(
      [...ids].every((id) => tasks.find((t) => t.id === id)?.client_id === harmonie.id),
      "all 33 now sit under Harmonie",
    );
  }
}

console.log("\n── the backfill invariant ──────────────────────────────────");
const legacyEntries = entries.filter((e) => e.legacy);
const realByTask = new Map();
for (const e of entries) {
  if (e.legacy) continue;
  realByTask.set(e.task_id, (realByTask.get(e.task_id) ?? 0) + 1);
}
const doubled = [...new Set(legacyEntries.map((e) => e.task_id))].filter((id) => realByTask.has(id));
ok(doubled.length === 0, "no task has BOTH backfilled and real entries", `${doubled.length} would double-count`);
// The same rule for the remainder column. This is THE guard against inflating a
// client's history: a task with genuine tracked time must never also carry a
// figure recovered from its title or comments.
const mixed = tasks.filter((t) => t.legacy_hours && realByTask.has(t.id));
ok(mixed.length === 0, "no task mixes legacy_hours with tracked time", `${mixed.length} would double-count`);
// The cutover rule applies to COMMENT-DERIVED entries only. There, a post-2022
// date means the comment parser misread something, so it is a hard error. An
// ESTIMATED date is different: it comes from the task's own activity window, and a
// handful of recovered tasks were genuinely worked after the cutover without ever
// being logged in Everhour (Harmonie's "Renewal Payment page HTML conversion" has
// comments dated July 2023). Capping those at 2022 would make them LESS accurate.
const late = legacyEntries.filter((e) => !e.date_estimated && e.date > "2022-12-31");
ok(late.length === 0, "no comment-derived entry after the 2022 cutover", `${late.length} late`);

// The real invariant for an estimated date: it must sit inside the window the
// evidence actually supports, so a spread can never invent a month out of nothing.
const taskById2 = new Map(tasks.map((t) => [t.id, t]));
const sectionClosed = new Map(sections.map((s) => [s.id, s.closed_on]));
// An estimated date is legitimate if it falls inside ANY window the evidence
// supports. There are two independent sources, because the two recovery passes used
// different ones: the comment-derived pass used activity_from/to, and the wider
// title pass (recover-title-hours.mjs) used Asana's created_at → completed_at,
// which is all those tasks had.
const inWindow = (m, from, to) => {
  if (!from && !to) return false;
  const a = (from ?? to).slice(0, 7);
  const b = (to ?? from).slice(0, 7);
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  return m >= lo && m <= hi;
};
// A third source, from backfill-from-finance.mjs: the finance plan sheets record
// a client's hours PER MONTH, so for those rows the month is the evidence itself
// and there is no Asana window to sit inside. Checking them against the sheet is
// stronger than a window check, not weaker — the client must actually have billed
// hours in that exact month.
const financeMonths = new Set();
{
  const knownKeys = new Set(clients.map((c) => clientKey(c.name)));
  for (const r of financeMonthly) {
    if (r.state === "predicted" || !Number(r.hours ?? 0)) continue;
    const k = resolve(clientKey(r.client_canon), knownKeys);
    financeMonths.add(`${k}|${r.year}-${String(r.month).padStart(2, "0")}`);
  }
}
const FINANCE_AUTHOR = "(from finance plan)";

const outsideWindow = legacyEntries.filter((e) => {
  if (!e.date_estimated) return false;
  const t = taskById2.get(e.task_id);
  if (!t) return true;
  const m = e.date.slice(0, 7);
  if (e.legacy_author_name === FINANCE_AUTHOR) {
    const c = byId.get(t.client_id);
    // Must name a real client AND a month that client actually billed.
    return !c || !financeMonths.has(`${clientKey(c.name)}|${m}`);
  }
  if (inWindow(m, t.activity_from, t.activity_to)) return false;
  if (inWindow(m, t.created_at, t.completed_at)) return false;
  if (inWindow(m, t.due_date, t.due_date)) return false;
  const closed = sectionClosed.get(t.section_id);
  return closed ? m !== closed.slice(0, 7) : true;
});
ok(
  outsideWindow.length === 0,
  "every estimated date sits inside its task's evidenced window",
  `${outsideWindow.length} outside`,
);
const entryHours = legacyEntries.reduce((a, e) => a + (e.minutes ?? 0), 0) / 60;
const remainder = tasks.reduce((a, t) => a + Number(t.legacy_hours ?? 0), 0);
console.log(`    ${legacyEntries.length} backfilled entries, ${entryHours.toFixed(2)}h`);
console.log(`    ${remainder.toFixed(2)}h unattributed remainder on ${tasks.filter((t) => t.legacy_hours).length} tasks`);
console.log(`    ${(entryHours + remainder).toFixed(2)}h recovered in total`);

// Reductions are real ledger lines ("-11.5h מפתח"), so negative minutes are
// EXPECTED here and must survive the import — dropping them while keeping the
// positives is what made comment totals run 4× over the studio's own figures.
const reductions = legacyEntries.filter((e) => (e.minutes ?? 0) < 0);
console.log(`    ${reductions.length} of them are מפתח reductions (negative)`);
console.log(`    ${legacyEntries.filter((e) => e.date_estimated).length} have an ESTIMATED date (hours real, day inferred)`);

// Cross-check against the plan the reconciler actually wrote, if it is present.
try {
  const plan = JSON.parse(fs.readFileSync(new URL("../data/legacy-entries.json", import.meta.url), "utf8"));
  const planned = plan.reduce((a, e) => a + e.minutes, 0) / 60;
  // Compare against the NON-estimated entries only: legacy-entries.json is the
  // comment-derived plan, and spread-legacy-remainder.mjs adds estimated-date rows
  // on top of it that were never in that file.
  // The right question is "has the plan been fully applied", NOT "does the DB equal
  // the plan". legacy-entries.json is a snapshot of what still NEEDS applying, so
  // after a successful run it correctly goes to zero while the DB keeps everything
  // from every earlier pass — comparing the two totals made a completed import look
  // like a failure.
  const presentGids = new Set(entries.map((e) => e.asana_story_gid).filter(Boolean));
  const missing = plan.filter((e) => !presentGids.has(e.storyGid));
  const fromComments = legacyEntries
    .filter((e) => !e.date_estimated)
    .reduce((a, e) => a + (e.minutes ?? 0), 0) / 60;
  if (legacyEntries.length > 0) {
    ok(
      missing.length === 0,
      `the reconciler's plan is fully applied (${plan.length} planned, ${missing.length} missing; ${fromComments.toFixed(2)}h comment-derived in total)`,
    );
  } else {
    console.log(`    plan holds ${plan.length} entries / ${planned.toFixed(2)}h — not imported yet`);
  }
} catch {
  console.log(`    (no data/legacy-entries.json to cross-check against)`);
}

// A member must never be able to touch the backfill: the RLS policies compare
// auth.uid() = user_id, so a null user_id locks the row to admins.
const memberEditable = legacyEntries.filter((e) => e.user_id).length;
console.log(`    ${memberEditable} backfilled entries name a current profile (admin-editable only)`);

console.log("\n── renames are reversible ──────────────────────────────────");
const renamed = tasks.filter((t) => t.legacy_title);
ok(
  !renamed.some((t) => !t.title || !t.title.trim()),
  `${renamed.length} renamed tasks all still have a title`,
);
// `s.name && !s.name.trim()` short-circuits on null and can never be true for the
// case that matters — a section whose name the parser emptied. Check the value, not
// its truthiness.
const blankSections = sections.filter((s) => String(s.name ?? "").trim() === "");
ok(blankSections.length === 0, "no section left with a blank name", `${blankSections.length} blank`);

console.log(
  `\n${failures === 0 ? "PASS — all assertions hold" : `FAIL — ${failures} assertion(s) failed`}`,
);
process.exit(failures === 0 ? 0 : 1);
