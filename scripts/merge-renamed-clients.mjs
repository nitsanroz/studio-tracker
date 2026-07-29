/**
 * Merge the two client identities Nitsan confirmed are one client each
 * (2026-07-29), found by comparing the tracker against the finance-admin plan
 * sheets — see scripts/compare-finance-hours.mjs.
 *
 *   node --env-file=.env.local scripts/merge-renamed-clients.mjs           # dry run
 *   node --env-file=.env.local scripts/merge-renamed-clients.mjs --apply   # write
 *
 *   Double  → Donsplus   the client renamed itself; a plain clients.name change.
 *   In-reach → Quadream  one client. Some months were billed against the In-reach
 *                        budget, which 11 Quadream titles state outright
 *                        ("UI/UX March 20 (Inreach Budget) - 51.75h").
 *
 * NO REVENUE IMPACT, checked before writing rather than assumed. finance-admin
 * matches client_rates by NAME (every row has client_id null), so a rename moves
 * which rate applies:
 *   - Donsplus 250 (2020-06→2021-12) then 300 (2022→); Double 300 (2023→). The
 *     overlap is the same 300, so 2023+ is unchanged and 2020-21 gains the 250
 *     it should always have had.
 *   - In-reach 225 (2019→) vs Quadream 225 (→2021-02) then 250 (2021-03→). The
 *     In-reach-budget tasks all fall in 2019-07…2020-05, where BOTH tracks read
 *     225 — so no month changes value. (In-reach's own 6 tasks are 2017-2019.)
 *
 * WHAT THIS SCRIPT WILL NOT DO, deliberately:
 *   - tasks.client_id / section_id are blocked by 0011's trigger for anything
 *     without an admin auth.uid(), so the 6 task moves go to a SQL file.
 *   - it NEVER deletes a client. `clients → tasks` is ON DELETE CASCADE and that
 *     is exactly what destroyed 620 tasks on 2026-07-28. In-reach is ARCHIVED
 *     and left in place; delete it by hand later if you want, after confirming
 *     `select count(*) from tasks where client_id = '<In-reach>'` returns 0.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const OUT = path.join(import.meta.dirname, "..", "data", "0020_merge_clients.sql");
const ADMIN_ID = "7bd6a9e3-7179-4805-ae9a-d89fdc4f005c"; // Nitsan; only so is_admin() passes

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

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

const clients = await fetchAll("clients", "id, name, archived, billable");
const byName = (n) => clients.find((c) => c.name === n);

// ── 1. Double → Donsplus ──────────────────────────────────────────────────
// Refuse rather than create a second Donsplus if one already exists.
const dbl = byName("Double");
const existingDons = byName("Donsplus");
if (existingDons && dbl) {
  throw new Error(
    `Both "Double" (${dbl.id}) and "Donsplus" (${existingDons.id}) exist. ` +
      `This script only renames; merging two populated client rows needs the task moves reviewed first.`,
  );
}
if (dbl) {
  console.log(`rename  "Double" → "Donsplus"  (${dbl.id})`);
  if (APPLY) {
    const { error } = await supabase.from("clients").update({ name: "Donsplus" }).eq("id", dbl.id);
    if (error) throw new Error(`rename failed: ${error.message}`);
    console.log("        ✓ applied");
  }
} else {
  console.log(`rename  skipped — no client named "Double" (already renamed?)`);
}

// ── 2. In-reach → Quadream: emit SQL for the task moves ───────────────────
const ir = byName("In-reach");
const quad = byName("Quadream");
if (!ir || !quad) {
  console.log("merge   skipped — In-reach or Quadream missing");
} else {
  const tasks = (await fetchAll("tasks", "id, title, client_id, section_id")).filter(
    (t) => t.client_id === ir.id,
  );
  const sections = await fetchAll("sections", "id, name, client_id");
  const irSections = sections.filter((s) => s.client_id === ir.id);
  // A section belongs to exactly one client, so a moved task must land in one of
  // Quadream's — keeping the old id would strand it under the wrong client. Match
  // on name where Quadream already has an equivalent, else move the section over.
  const qByName = new Map(sections.filter((s) => s.client_id === quad.id).map((s) => [s.name, s]));

  const lines = [];
  for (const s of irSections) {
    if (qByName.has(s.name)) continue;
    lines.push(`update sections set client_id = ${q(quad.id)} where id = ${q(s.id)};`);
  }
  for (const t of tasks) {
    const src = irSections.find((s) => s.id === t.section_id);
    const dest = src && qByName.get(src.name);
    const sets = [`client_id = ${q(quad.id)}`];
    if (dest) sets.push(`section_id = ${q(dest.id)}`);
    lines.push(`update tasks set ${sets.join(", ")} where id = ${q(t.id)};  -- ${t.title}`);
  }
  lines.push(`update clients set archived = true where id = ${q(ir.id)};`);

  const sql = [
    `-- 0020 — In-reach and Quadream are ONE client (confirmed 2026-07-29).`,
    `--`,
    `-- Moves In-reach's ${tasks.length} tasks to Quadream and archives the empty client row.`,
    `-- NO DELETE and NO DDL: clients → tasks is ON DELETE CASCADE, and a cascading`,
    `-- delete in a file like this is what destroyed 620 tasks on 2026-07-28.`,
    `-- In-reach is left in place, archived. To remove it later, FIRST confirm:`,
    `--   select count(*) from tasks where client_id = ${q(ir.id)};   -- must be 0`,
    `--`,
    `-- tasks.client_id and section_id are reserved for admins by migration 0011's`,
    `-- trigger, so instead of disabling it this sets the JWT claim auth.uid() reads`,
    `-- and lets is_admin() pass. Scoped to the transaction by set_config's 3rd arg.`,
    `--`,
    `-- To undo: update tasks set client_id = ${q(ir.id)} where id in (…);`,
    `--          update clients set archived = false where id = ${q(ir.id)};`,
    ``,
    `begin;`,
    `select set_config('request.jwt.claims', ${q(JSON.stringify({ sub: ADMIN_ID, role: "authenticated" }))}, true);`,
    ``,
    ...lines,
    ``,
    `commit;`,
    ``,
  ].join("\n");

  fs.writeFileSync(OUT, sql);
  console.log(
    `merge   In-reach → Quadream: ${tasks.length} tasks, ${irSections.length} section(s)\n` +
      `        → ${path.relative(process.cwd(), OUT)}  (${lines.length} statements, no DELETE, no DDL)`,
  );
}

console.log(
  APPLY
    ? `\n── APPLIED (the rename). Run the SQL file in the Supabase SQL editor for the merge. ──`
    : `\n── DRY RUN: nothing written. Pass --apply to do the rename. ──`,
);
