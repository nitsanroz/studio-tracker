/**
 * Give the pre-Everhour authors a profile, so their history is browsable on Team.
 *
 *   node --env-file=.env.local scripts/create-former-staff.mjs            # dry run
 *   node --env-file=.env.local scripts/create-former-staff.mjs --apply
 *
 * Requires migration 0018 (drops the profiles.id → auth.users FK and adds
 * `has_account`). These people get NO auth user and therefore cannot sign in.
 *
 * For each distinct `time_entries.legacy_author_name` with no profile:
 *   1. insert a profile — active = false, has_account = false, no avatar/photo
 *   2. point their legacy time entries and comments at it
 *
 * `legacy_author_name` is KEPT on every row afterwards. It is the provenance of
 * the match and the only way to undo this cleanly:
 *   update time_entries set user_id = null
 *    where legacy and user_id in (select id from profiles where not has_account);
 *   delete from profiles where not has_account;
 *
 * Names are used verbatim as they appear in Asana ("dikla", "adi", "yam sasson")
 * — they are not normalised or title-cased, because guessing at someone's
 * preferred capitalisation is worse than showing what the record actually says.
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
/** Below this many hours a name is more likely a one-off collaborator than staff. */
const MIN_HOURS = Number(process.argv[process.argv.indexOf("--min-hours") + 1]) || 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function fetchAll(table, columns, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ── preflight: 0018 must be applied, or this cannot work ──────────────────
{
  const { error } = await supabase.from("profiles").select("has_account").limit(1);
  if (error) {
    console.error("profiles.has_account is missing — apply migration 0018 first.");
    process.exit(1);
  }
}

const profiles = await fetchAll("profiles", "id, name, active, has_account");
const byName = new Map(profiles.map((p) => [p.name.trim().toLowerCase(), p]));

const entries = await fetchAll("time_entries", "id, user_id, legacy, legacy_author_name, minutes, date", (q) =>
  q.eq("legacy", true),
);
const comments = await fetchAll("task_comments", "id, user_id, author_name");

/** name → { entries, minutes, first, last } for the ones with no profile yet */
const people = new Map();
for (const e of entries) {
  if (e.user_id) continue; // already attributed
  const name = (e.legacy_author_name ?? "").trim();
  if (!name || name === "(unknown)") continue;
  const o = people.get(name) ?? { entries: 0, minutes: 0, first: "9999", last: "" };
  o.entries++;
  o.minutes += e.minutes ?? 0;
  if (e.date < o.first) o.first = e.date;
  if (e.date > o.last) o.last = e.date;
  people.set(name, o);
}

const rows = [];
const skipped = [];
for (const [name, s] of people) {
  const existing = byName.get(name.toLowerCase());
  if (existing) {
    // A current member who also has pre-Everhour hours — attribute to them, don't
    // create a duplicate person.
    skipped.push({ name, why: `matches existing profile "${existing.name}"`, id: existing.id, ...s });
    continue;
  }
  if (Math.abs(s.minutes) / 60 < MIN_HOURS) {
    skipped.push({ name, why: `under --min-hours ${MIN_HOURS}`, id: null, ...s });
    continue;
  }
  rows.push({
    id: crypto.randomUUID(),
    name,
    role: "designer",
    active: false, // archived: out of pickers, plan and active lists
    has_account: false, // no auth user exists; never can sign in
    avatar_url: null,
    photo_url: null,
    // Their first logged day is the closest thing to a start date we have, and it
    // makes the member page's tenure/first-activity read sensibly.
    start_date: s.first,
    ...s,
  });
}

// ── report ────────────────────────────────────────────────────────────────
console.log(APPLY ? "── APPLIED ──" : "── DRY RUN (nothing written; pass --apply) ──");
console.log(`\nprofiles to create (${rows.length}):`);
rows
  .sort((a, b) => b.minutes - a.minutes)
  .forEach((r) =>
    console.log(
      `  ${String((r.minutes / 60).toFixed(1) + "h").padStart(9)}  ${String(r.entries).padStart(4)} entries  ${r.first}→${r.last}   ${r.name}`,
    ),
  );
if (skipped.length) {
  console.log(`\nnot created (${skipped.length}):`);
  skipped.forEach((s) => console.log(`  ${String((s.minutes / 60).toFixed(1) + "h").padStart(9)}  ${s.name} — ${s.why}`));
}

if (!APPLY) {
  console.log(`\nRe-run with --apply to create them and re-attribute their hours.`);
  process.exit(0);
}

// ── write ─────────────────────────────────────────────────────────────────
const insert = rows.map(({ entries: _e, minutes: _m, first: _f, last: _l, ...p }) => p);
for (let i = 0; i < insert.length; i += 200) {
  const { error } = await supabase.from("profiles").insert(insert.slice(i, i + 200));
  if (error) {
    console.error(`! profiles: ${error.message}`);
    process.exit(1);
  }
}
console.log(`\ncreated ${insert.length} profiles`);

// name → id, now including the ones just made and any pre-existing match
const idFor = new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
for (const s of skipped) if (s.id) idFor.set(s.name.toLowerCase(), s.id);

let entriesLinked = 0;
for (const [name, id] of idFor) {
  const ids = entries
    .filter((e) => !e.user_id && (e.legacy_author_name ?? "").trim().toLowerCase() === name)
    .map((e) => e.id);
  for (let i = 0; i < ids.length; i += 300) {
    const { error } = await supabase
      .from("time_entries")
      .update({ user_id: id })
      .in("id", ids.slice(i, i + 300));
    if (error) console.error(`! time_entries for ${name}: ${error.message}`);
    else entriesLinked += ids.slice(i, i + 300).length;
  }
}
console.log(`linked ${entriesLinked} time entries`);

let commentsLinked = 0;
for (const [name, id] of idFor) {
  const ids = comments
    .filter((c) => !c.user_id && (c.author_name ?? "").trim().toLowerCase() === name)
    .map((c) => c.id);
  for (let i = 0; i < ids.length; i += 300) {
    const { error } = await supabase
      .from("task_comments")
      .update({ user_id: id })
      .in("id", ids.slice(i, i + 300));
    if (error) console.error(`! task_comments for ${name}: ${error.message}`);
    else commentsLinked += ids.slice(i, i + 300).length;
  }
}
console.log(`linked ${commentsLinked} comments`);
console.log(`\nNext: node --env-file=.env.local scripts/audit-rehome.mjs`);
