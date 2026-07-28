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
const EXPECTED_TASKS = 4507;

/**
 * Expected task count per client AFTER 0017. The four that already existed carry
 * their own pre-existing tasks, so these are baseline + inbound, measured on
 * 2026-07-28: Collabria 34+53, Harmonie 45+33, Voyantis 117+25, Studio 1037+29.
 */
const EXPECTED = {
  Volta: 154,
  "Cognigo (d.day labs)": 118,
  Quadream: 107,
  Collabria: 87,
  Harmonie: 78,
  Anchor: 26,
  Voyantis: 142,
  Studio: 1067, // 1066 + the one unidentifiable zero-hour row described above
  Siteaware: 20,
  "New Era": 16,
  Yoco: 13,
  "One Zero": 7,
  "In-reach": 6,
  Empathy: 5,
  CSL: 4,
  PDQ: 2,
  PlayStudios: 1,
  Mesh: 1,
};

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
const tasks = await fetchAll("tasks", "id, title, client_id, section_id, project_id, legacy_hours, legacy_title, billable").catch(
  () => fetchAll("tasks", "id, title, client_id, section_id, project_id, billable"),
);
const sections = await fetchAll("sections", "id, name, client_id");
let entries;
try {
  entries = await fetchAll("time_entries", "id, task_id, user_id, minutes, date, legacy");
} catch {
  entries = (await fetchAll("time_entries", "id, task_id, user_id, minutes, date")).map((e) => ({ ...e, legacy: false }));
}

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
ok(tasks.length === EXPECTED_TASKS, `task count ${tasks.length}`, `(expected ${EXPECTED_TASKS})`);
ok(
  !tasks.some((t) => !t.client_id),
  "every task has a client",
  `${tasks.filter((t) => !t.client_id).length} orphaned`,
);
const sectionClient = new Map(sections.map((s) => [s.id, s.client_id]));
const stranded = tasks.filter((t) => t.section_id && sectionClient.get(t.section_id) !== t.client_id);
ok(stranded.length === 0, "no task sits in another client's section", `${stranded.length} stranded`);

console.log("\n── landed where expected ───────────────────────────────────");
for (const [name, want] of Object.entries(EXPECTED)) {
  const got = countFor(name);
  if (got == null) {
    ok(false, `${name}`, "client does not exist");
    continue;
  }
  ok(got === want, `${name}: ${got} tasks`, `(expected ${want})`);
}

console.log("\n── Harmon.ie hours survived untouched ──────────────────────");
const projects = await fetchAll("projects", "id, everhour_id");
const harmProject = projects.find((p) => p.everhour_id === HARMONIE_PROJECT);
if (harmProject) {
  // Identified by project_id, not by client: it is stable across the move, and
  // the target client has 45 tasks of its own that must not be counted here.
  const ids = new Set(tasks.filter((t) => t.project_id === harmProject.id).map((t) => t.id));
  const mins = entries.filter((e) => ids.has(e.task_id)).reduce((a, e) => a + (e.minutes ?? 0), 0);
  ok(ids.size === 33, `${ids.size} tasks`, "(expected 33)");
  ok(Math.round(mins / 60) === 2103, `${Math.round(mins / 60)}h tracked`, "(expected 2103h)");
  ok(
    !entries.some((e) => ids.has(e.task_id) && e.legacy),
    "no backfilled entries on them",
  );
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
const late = legacyEntries.filter((e) => e.date > "2022-12-31");
ok(late.length === 0, "no backfilled entry after the 2022 cutover", `${late.length} late`);
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

// Cross-check against the plan the reconciler actually wrote, if it is present.
try {
  const plan = JSON.parse(fs.readFileSync(new URL("../data/legacy-entries.json", import.meta.url), "utf8"));
  const planned = plan.reduce((a, e) => a + e.minutes, 0) / 60;
  if (legacyEntries.length > 0) {
    ok(
      Math.abs(planned - entryHours) < 0.02,
      `entries match the reconciler's plan (${planned.toFixed(2)}h planned)`,
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
