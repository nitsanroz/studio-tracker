/**
 * Collapse duplicate spellings of one client in the finance tables.
 *
 *   node --env-file=.env.local scripts/merge-finance-client-names.mjs           # dry run
 *   node --env-file=.env.local scripts/merge-finance-client-names.mjs --apply   # write
 *
 * Found by comparing the tracker against the plan sheets: "Ravin" was typed three
 * ways across the yearly workbooks — "Raven" (2018), "Ravוn" (2019, with a Hebrew
 * vav mid-word from a keyboard-layout slip) and "Ravin" (2019-12, 2021). All three
 * are Ravin, confirmed by Nitsan 2026-07-29. Until now the Overview split one
 * client's 487h across three cards.
 *
 * finance_client_monthly is UNIQUE (year, month, client_canon, sub_account), so a
 * rename can collide. This script refuses to merge when two spellings share a
 * month rather than silently dropping or doubling one — for Ravin they don't
 * overlap, but the next merge might.
 *
 * client_rates is renamed too, because finance-admin resolves a rate by NAME.
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

/** canonical name → the spellings that should become it */
const MERGES = [{ into: "Ravin", from: ["Raven", "Ravוn", "Ravin"] }];

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

const monthly = await fetchAll(
  "finance_client_monthly",
  "id, year, month, client_canon, sub_account, hours, state",
);
const rates = await fetchAll("client_rates", "id, client_canon, rate, effective_from, effective_to");

for (const { into, from } of MERGES) {
  const rows = monthly.filter((r) => from.includes(r.client_canon));
  const rateRows = rates.filter((r) => from.includes(r.client_canon));

  // Collision check: same (year, month, sub_account) under two spellings.
  const seen = new Map();
  const clashes = [];
  for (const r of rows) {
    const k = `${r.year}-${r.month}-${r.sub_account ?? ""}`;
    if (seen.has(k) && seen.get(k) !== r.client_canon) clashes.push(`${k}: "${seen.get(k)}" vs "${r.client_canon}"`);
    seen.set(k, r.client_canon);
  }
  if (clashes.length) {
    console.error(`REFUSING to merge into "${into}" — ${clashes.length} month collision(s):`);
    clashes.forEach((c) => console.error(`  ${c}`));
    console.error(`Merging would violate the unique constraint or need the hours summed by hand.`);
    process.exitCode = 1;
    continue;
  }

  const toRename = rows.filter((r) => r.client_canon !== into);
  const ratesToRename = rateRows.filter((r) => r.client_canon !== into);
  const spellings = [...new Set(rows.map((r) => r.client_canon))];
  console.log(
    `"${into}"  ←  ${spellings.map((s) => `"${s}"`).join(", ")}\n` +
      `  ${rows.length} monthly rows (${rows.reduce((a, r) => a + Number(r.hours ?? 0), 0)}h), ` +
      `${toRename.length} need renaming; ${ratesToRename.length} of ${rateRows.length} rate rows too`,
  );

  if (!APPLY) continue;

  // These rows are state='final', and finance_guard_locked() rejects any UPDATE
  // where the row is final both before and after. The documented unlock path is
  // to leave the final state first, so each row is renamed in two steps:
  // final → actual (carrying the new name) → final. Both steps are allowed by the
  // guard as written; nothing is disabled and no DDL is involved.
  //
  // If the second step ever failed, a row would be left unlocked, so the count is
  // asserted at the end and anything stranded is named.
  let ok = 0;
  const stranded = [];
  for (const r of toRename) {
    const label = `${r.year}-${String(r.month).padStart(2, "0")} "${r.client_canon}"`;
    const unlock = await supabase
      .from("finance_client_monthly")
      .update({ client_canon: into, state: "actual" })
      .eq("id", r.id);
    if (unlock.error) {
      console.error(`  ! ${label}: ${unlock.error.message}`);
      continue;
    }
    const relock = await supabase
      .from("finance_client_monthly")
      .update({ state: r.state })
      .eq("id", r.id);
    if (relock.error) {
      stranded.push(`${label} (id ${r.id})`);
      console.error(`  ! ${label} renamed but NOT re-locked: ${relock.error.message}`);
      continue;
    }
    ok++;
  }
  if (stranded.length) {
    console.error(
      `\n  !! ${stranded.length} row(s) left unlocked — re-lock by hand:\n` +
        stranded.map((s) => `     ${s}`).join("\n"),
    );
    process.exitCode = 1;
  }
  let rOk = 0;
  for (const r of ratesToRename) {
    const { error } = await supabase.from("client_rates").update({ client_canon: into }).eq("id", r.id);
    if (error) console.error(`  ! rate ${r.effective_from} ${r.client_canon}: ${error.message}`);
    else rOk++;
  }
  console.log(`  ✓ ${ok}/${toRename.length} monthly, ${rOk}/${ratesToRename.length} rates`);
}

console.log(APPLY ? "\n── APPLIED ──" : "\n── DRY RUN: nothing written. Pass --apply. ──");
