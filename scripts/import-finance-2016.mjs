/**
 * Load the parsed 2016 plan sheet into the finance tables.
 *
 *   python3 scripts/parse-plan-2016.py                                   # first
 *   node --env-file=.env.local scripts/import-finance-2016.mjs           # dry run
 *   node --env-file=.env.local scripts/import-finance-2016.mjs --apply   # write
 *
 * 2016 was absent from finance_client_monthly and finance_pnl_monthly entirely —
 * both the 0006 seed and the later granular import started at 2017 because no 2016
 * workbook was on disk. That absence is why Quadream 2016 showed as a 345h
 * "overage" in the tracker/finance comparison: there was nothing to compare with.
 *
 * INSERT ONLY. finance_guard_locked() is a BEFORE UPDATE OR DELETE trigger, so
 * inserting rows already marked state='final' is allowed and needs no unlock. This
 * script never updates and never deletes: if a 2016 row already exists it is
 * skipped, so a second run is a no-op rather than a double-count.
 *
 * It also always writes data/0021_finance_2016.sql, because writes to the finance
 * tables have been blocked by the sandbox classifier before — if that happens the
 * SQL file is the same import, runnable in the Supabase SQL editor.
 *
 * REVERSAL:
 *   delete from finance_client_monthly where year = 2016;
 *   delete from finance_pnl_monthly where year = 2016;
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const DATA = path.join(import.meta.dirname, "..", "data");
const SQL_OUT = path.join(DATA, "0021_finance_2016.sql");

const payload = JSON.parse(fs.readFileSync(path.join(DATA, "finance-2016.json"), "utf8"));
const { client_monthly: cm, pnl_monthly: pnl } = payload;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function fetchAll(table, columns, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns);
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const q = (v) =>
  v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

// ── refuse to duplicate ───────────────────────────────────────────────────
const existingCm = await fetchAll("finance_client_monthly", "year, month, client_canon, sub_account", (x) =>
  x.eq("year", 2016),
);
const existingPnl = await fetchAll("finance_pnl_monthly", "year, month, line_item", (x) => x.eq("year", 2016));
const cmKey = new Set(existingCm.map((r) => `${r.month}|${r.client_canon}|${r.sub_account ?? ""}`));
const pnlKey = new Set(existingPnl.map((r) => `${r.month}|${r.line_item}`));

const newCm = cm.filter((r) => !cmKey.has(`${r.month}|${r.client_canon}|${r.sub_account}`));
const newPnl = pnl.filter((r) => !pnlKey.has(`${r.month}|${r.line_item}`));

// ── the SQL fallback, always written ──────────────────────────────────────
const lines = [
  `-- 0021 — the 2016 plan sheet, which was never imported.`,
  `--`,
  `-- INSERT ONLY: no UPDATE, no DELETE, no DDL. Rows go in already state='final',`,
  `-- which the finance_guard_locked trigger permits because it only fires on`,
  `-- UPDATE and DELETE. Safe to run once; re-running would duplicate, so the`,
  `-- guard below aborts if 2016 is already present.`,
  `--`,
  `-- 2016 is a PARTIAL year — the studio began trading in May, so only months`,
  `-- 5-12 exist. There are deliberately no Jan-Apr rows: "no row" means "not`,
  `-- trading yet", which is a different statement from zero hours billed.`,
  `--`,
  `-- To undo:  delete from finance_client_monthly where year = 2016;`,
  `--           delete from finance_pnl_monthly where year = 2016;`,
  ``,
  `begin;`,
  ``,
  `do $$`,
  `begin`,
  `  if exists (select 1 from finance_client_monthly where year = 2016) then`,
  `    raise exception '2016 client rows already present — aborting to avoid duplicates';`,
  `  end if;`,
  `end $$;`,
  ``,
];
for (const r of newCm) {
  lines.push(
    `insert into finance_client_monthly (year, month, client_canon, discipline, sub_account, hours, rate, revenue_gross, state) values ` +
      `(2016, ${r.month}, ${q(r.client_canon)}, ${q(r.discipline)}, ${q(r.sub_account)}, ${r.hours}, ${q(r.rate)}, ${r.revenue_gross}, 'final');`,
  );
}
lines.push("");
for (const r of newPnl) {
  lines.push(
    `insert into finance_pnl_monthly (year, month, line_item, value, state, source) values ` +
      `(2016, ${r.month}, ${q(r.line_item)}, ${r.value}, 'final', 'import');`,
  );
}
lines.push("", "commit;", "");
fs.writeFileSync(SQL_OUT, lines.join("\n"));

// ── report + optional write ───────────────────────────────────────────────
const hours = newCm.reduce((a, r) => a + r.hours, 0);
console.log(APPLY ? "── APPLYING ──" : "── DRY RUN (nothing written; pass --apply) ──");
console.log(`client_monthly  ${newCm.length} new of ${cm.length} parsed   ${hours.toFixed(2)}h`);
console.log(`pnl_monthly     ${newPnl.length} new of ${pnl.length} parsed`);
if (existingCm.length || existingPnl.length) {
  console.log(`already present: ${existingCm.length} client rows, ${existingPnl.length} pnl rows — those are skipped`);
}
console.log(`SQL fallback  → ${path.relative(process.cwd(), SQL_OUT)}`);

if (!APPLY) process.exit(0);

let ok = 0;
for (let i = 0; i < newCm.length; i += 200) {
  const slice = newCm.slice(i, i + 200);
  const { error } = await supabase.from("finance_client_monthly").insert(slice);
  if (error) console.error(`! client_monthly ${i}: ${error.message}`);
  else ok += slice.length;
}
let pOk = 0;
for (let i = 0; i < newPnl.length; i += 200) {
  const slice = newPnl.slice(i, i + 200).map((r) => ({ ...r, state: "final", source: "import" }));
  const { error } = await supabase.from("finance_pnl_monthly").insert(slice);
  if (error) console.error(`! pnl_monthly ${i}: ${error.message}`);
  else pOk += slice.length;
}
console.log(`\nwritten: ${ok}/${newCm.length} client rows, ${pOk}/${newPnl.length} pnl rows`);
if (ok < newCm.length || pOk < newPnl.length) {
  console.log(`Some writes failed — run ${path.relative(process.cwd(), SQL_OUT)} in the SQL editor instead.`);
  process.exitCode = 1;
} else {
  console.log(`\nThen: node --env-file=.env.local scripts/compare-finance-hours.mjs`);
}
