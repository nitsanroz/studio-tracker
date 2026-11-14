// Books each employee's monthly cost from Michpal's employer-cost reports
// (Salaries/עלות מעביד- תמחיר חודשי/<year>/<Month>_<year>.pdf, on Google Drive
// synced to this Mac) into finance_salaries — so the owner no longer types it.
// Run after the payslip import: an employee is recognised by their payments
// matching that month's payslip gross (finance_payslips), so no name mapping.
//
//   npm run employer-cost            book what's new or changed
//   npm run employer-cost -- --dry   compare and report, write nothing
//
// What it writes (Nitsan's go-ahead, 2026-10-13: "for future months get the
// information from the docs"):
// - a month with no row for the person → a new row, state 'actual';
// - an 'actual' or 'predicted' row (a plan placeholder) that differs → updated
//   to the report's figure, state 'actual'.
// What it never writes: a 'final' row (a difference is only reported), a
// month whose salaries are locked (finance_locks), or anything it couldn't
// check (the total's printed cents disagree, or no payslip matches).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getDocumentProxy } from "unpdf";
import { parseEmployerCost, reportPeriod } from "../src/lib/finance/employer-cost.ts";

const SALARIES_DIR =
  process.env.PAYSLIPS_DIR ?? `${process.env.HOME}/Insync/nitsanroz@gmail.com/Google Drive/Logistical&more/Salaries`;
const REPORTS = "עלות מעביד- תמחיר חודשי";
/** Payslips are imported from 2026 on, and earlier years are closed. */
const FROM_YEAR = 2026;

const dry = process.argv.includes("--dry");
const root = new URL("..", import.meta.url).pathname;
const near = (a, b, by = 1) => Math.abs(Number(a) - Number(b)) <= by;
const SOURCE = /\s*·?\s*From the employer-cost report \S+$/;
const withSource = (notes, note) => {
  const own = (notes ?? "").replace(SOURCE, "").trim();
  return own ? `${own} · ${note}` : note;
};
const ym = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

function env() {
  const text = readFileSync(join(root, ".env.local"), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

/** Every row of a query — Supabase returns at most 1,000 at a time. */
async function all(query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function textItems(buf) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const { items: its } = await (await pdf.getPage(p)).getTextContent();
    for (const it of its) if ("str" in it) items.push({ s: it.str, x: it.transform[4], y: it.transform[5] + (pdf.numPages - p) * 10_000 });
  }
  return items;
}

async function main() {
  const dir = join(SALARIES_DIR, REPORTS);
  if (!existsSync(dir)) throw new Error(`No employer-cost reports at ${dir}`);
  const e = env();
  const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const [slips, booked, locks, profiles] = await Promise.all([
    all(() => sb.from("finance_payslips").select("profile_id, year, month, gross_total").gte("year", FROM_YEAR)),
    all(() => sb.from("finance_salaries").select("id, profile_id, employee_name, year, month, gross_amount, state, notes").gte("year", FROM_YEAR - 1)),
    all(() => sb.from("finance_locks").select("scope_year, scope_month, block")),
    all(() => sb.from("profiles").select("id, name")),
  ]);
  const locked = new Set(locks.filter((l) => l.block === "salaries").map((l) => ym(l.scope_year, l.scope_month)));
  const nameOf = (pid) =>
    booked.filter((r) => r.profile_id === pid).sort((a, b) => a.year - b.year || a.month - b.month).at(-1)?.employee_name ??
    profiles.find((p) => p.id === pid)?.name;

  const notes = [];
  let matched = 0;
  let written = 0;
  const years = readdirSync(dir).filter((d) => /^\d{4}$/.test(d) && Number(d) >= FROM_YEAR && statSync(join(dir, d)).isDirectory());
  for (const year of years) {
    for (const file of readdirSync(join(dir, year)).filter((f) => /\.pdf$/i.test(f))) {
      const period = reportPeriod(file, Number(year));
      if (!period) {
        notes.push(`${year}/${file}: no month in the file name`);
        continue;
      }
      const key = ym(period.year, period.month);
      const rows = parseEmployerCost(await textItems(readFileSync(join(dir, year, file))));
      if (!rows.length) {
        notes.push(`${key}: couldn't read ${file}`);
        continue;
      }
      const monthBooked = booked.filter((r) => r.year === period.year && r.month === period.month);
      const monthSlips = slips.filter((s) => s.year === period.year && s.month === period.month);
      const seenProfiles = new Set();
      for (const r of rows) {
        if (!r.checked) {
          notes.push(`${key} ${r.name}: total ₪${r.total} doesn't match the report's printed cents — skipped`);
          continue;
        }
        // Who: the payslip whose gross is this row's payments; else an
        // already-booked row with this exact total.
        const slip = monthSlips.filter((s) => s.gross_total != null && near(s.gross_total, r.payments));
        const pid = slip.length === 1 ? slip[0].profile_id : monthBooked.filter((b) => near(b.gross_amount, r.total, 0.01)).map((b) => b.profile_id)[0];
        if (!pid) {
          notes.push(`${key} ${r.name} (₪${r.total}): no payslip with payments ₪${r.payments} to tell who this is — import their payslip first`);
          continue;
        }
        seenProfiles.add(pid);
        matched++;
        const mine = monthBooked.filter((b) => b.profile_id === pid);
        if (mine.length > 1) {
          notes.push(`${key} ${nameOf(pid)}: ${mine.length} salary rows — left alone`);
          continue;
        }
        const row = mine[0];
        if (row && near(row.gross_amount, r.total, 0.01)) continue;
        // Agorot of rounding on a closed month aren't worth a word.
        if (row?.state === "final" && near(row.gross_amount, r.total, 1)) continue;
        if (row?.state === "final") {
          notes.push(`${key} ${nameOf(pid)}: booked ₪${row.gross_amount} (final), report says ₪${r.total} — not changed`);
          continue;
        }
        if (locked.has(key)) {
          notes.push(`${key} ${nameOf(pid)}: salaries locked — report says ₪${r.total}, not booked`);
          continue;
        }
        const note = `From the employer-cost report ${file}`;
        if (!dry) {
          const { error } = row
            ? await sb
                .from("finance_salaries")
                // A note already on the row (a plan comment) is kept and the source
                // added after it — replacing an earlier run's source, not stacking it.
                .update({ gross_amount: r.total, state: "actual", notes: withSource(row.notes, note) })
                .eq("id", row.id)
            : await sb.from("finance_salaries").insert({
                profile_id: pid,
                employee_name: nameOf(pid),
                year: period.year,
                month: period.month,
                gross_amount: r.total,
                state: "actual",
                notes: note,
              });
          if (error) {
            notes.push(`${key} ${nameOf(pid)}: ${error.message}`);
            continue;
          }
        }
        written++;
        console.log(
          `${dry ? "would book" : "booked"} ${key} ${nameOf(pid)}: ₪${r.total}${row ? ` (was ₪${row.gross_amount}, ${row.state})` : " (new)"}`,
        );
      }
      for (const b of monthBooked)
        if (b.profile_id && !seenProfiles.has(b.profile_id) && b.state !== "final")
          notes.push(`${key} ${b.employee_name}: booked ₪${b.gross_amount} but not in the report`);
    }
  }
  console.log(`\n${matched} report rows matched, ${written} ${dry ? "to book" : "booked"}.`);
  if (notes.length) console.log(`\nNeeds a look:\n- ${notes.join("\n- ")}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
