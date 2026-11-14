// Reads the Michpal payslip PDFs in the studio's Salaries folder (Google Drive,
// synced to this Mac by Insync) and stores their figures in finance_payslips:
// salary, gross, vacation and sick-day balances. Run on the owner's Mac only —
// the PDFs are read here and never uploaded; only the numbers are.
//
//   npm run payslips            import new or changed payslips
//   npm run payslips -- --dry   read and report, write nothing
//   npm run payslips -- --refresh   re-read files already in (after the parser
//                               or the table gains a field, e.g. sick_used)
//
// Layouts it reads:
//   <Salaries>/Employees - <year>/<Person>/<name>_<month>[_<year>].pdf
//   <Salaries>/Past Years/<year>/<Person>/…   (older years, same naming)
// A folder of past employees inside a year ("_Past", "Past Employees 2024",
// "old", a year) holds more person folders. Inside a person folder PDFs are
// read at any depth — a subfolder named for a year sets the year — except
// pension, insurance and certificate folders.
//
// ⚠️ A person folder matches a tracker profile by ALIASES (folder → the
// profile's FULL name), its full name, or a first name only ONE profile has.
// Anything else is reported, never guessed — older years have several Noas,
// Itays and Rons, and a guess credits one person's payslips to another. As a
// second guard a payslip from Past Years is stored only if finance paid that
// profile a salary that month. A file whose SHA-256 is already stored is skipped, so re-runs
// are cheap. Two files for one person-month (an original and a "_corrected"
// copy, or the same slip in two folders) — the corrected one, else the newer
// file, is used and the other reported.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getDocumentProxy } from "unpdf";
import { parsePayslip, payslipPeriod } from "../src/lib/finance/payslip.ts";

const SALARIES_DIR =
  process.env.PAYSLIPS_DIR ?? `${process.env.HOME}/Insync/nitsanroz@gmail.com/Google Drive/Logistical&more/Salaries`;
/** Person folder (lower case) → the profile's full name, where the folder's
 * name doesn't pick out one profile by itself. A key with a path ("past
 * years/2023/noa") holds for that folder only — for names too common to
 * alias everywhere. */
const ALIASES = {
  "past years/2020/noa b": "noa barzilay",
  "past years/2023/noa": "noa brosh",
  "past years/2024/past employees 2024/noa": "noa brosh",
  "past years/2024/itay": "itay chen",
  "past years/2025/_past/itay": "itay chen",
  // ⚠️ Only the past-employees folder: Michal Ner-David works here now and
  // may be filed as just "Michal" too.
  "employees - 2026/_past/michal": "michal dekel",
  "yogev nitsan": "shnitz yogev",
  "michal_ner-david": "michal ner-david",
  gabi: "gabriela dolinko",
  sofi: "sofia haskelsky",
  "daniel.k": "daniel kramash",
  "avishai zalch": "avishai zalach",
  daniella: "daniela lisa dahan",
  "itay. b": "itay biran",
};
/** Folders inside a year that hold more person folders. */
const CONTAINER = /^_|past|^old$|^\d{4}$/i;
/** Folders inside a person folder that hold no payslips. */
const NOT_SLIPS = /פנסיה|pensi|ביטוח|קרן|keren|אישור|מימון|freelance|מילואים/i;
/** Files that aren't one person's payslip: every employee's slips in one PDF
 * ("ALL_July_2020"), contracts, tax forms (101, 106, 161), letters. */
const NOT_A_SLIP = /^all[\s_]|contract|חוזה|(^|[^0-9])1(01|06|61)([^0-9]|$)|טופס|מכתב|אישור/i;

const dry = process.argv.includes("--dry");
const refresh = process.argv.includes("--refresh");
const root = new URL("..", import.meta.url).pathname;

function env() {
  const text = readFileSync(join(root, ".env.local"), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

async function textItems(buf) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const items = [];
  // Pages stacked top to bottom, so rows never mix across pages.
  for (let p = 1; p <= pdf.numPages; p++) {
    const { items: its } = await (await pdf.getPage(p)).getTextContent();
    for (const it of its) if ("str" in it) items.push({ s: it.str, x: it.transform[4], y: it.transform[5] + (pdf.numPages - p) * 10_000 });
  }
  return items;
}

const words = (s) => s.toLowerCase().replace(/[._]+/g, " ").split(/[\s-]+/).filter(Boolean);
const dirs = (dir) => readdirSync(dir).filter((d) => !d.startsWith(".") && statSync(join(dir, d)).isDirectory());

/** Every year folder, both layouts. */
function yearFolders() {
  const out = readdirSync(SALARIES_DIR)
    .filter((d) => /^Employees - \d{4}$/.test(d))
    .map((d) => ({ dir: join(SALARIES_DIR, d), year: Number(d.slice(-4)), label: d, past: false }));
  const past = join(SALARIES_DIR, "Past Years");
  if (existsSync(past))
    for (const d of dirs(past).filter((d) => /^\d{4}$/.test(d))) out.push({ dir: join(past, d), year: Number(d), label: `Past Years/${d}`, past: true });
  return out;
}

/** The person folders in a year folder, past-employee folders opened up.
 * Folders with no Latin letters are documents (קורונה…), not people. */
function personFolders(yearDir) {
  const out = [];
  for (const d of dirs(yearDir)) {
    if (!/[a-z]/i.test(d)) continue;
    if (CONTAINER.test(d))
      for (const p of dirs(join(yearDir, d))) /[a-z]/i.test(p) && !CONTAINER.test(p) && out.push({ dir: join(yearDir, d, p), name: p, rel: `${d}/${p}` });
    else out.push({ dir: join(yearDir, d), name: d, rel: d });
  }
  return out;
}

/** The PDFs under a person folder, each with the year its folders imply. */
function pdfsUnder(dir, year) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (f.startsWith(".")) continue;
    const path = join(dir, f);
    if (statSync(path).isDirectory()) {
      if (!NOT_SLIPS.test(f)) out.push(...pdfsUnder(path, /^\d{4}$/.test(f) ? Number(f) : year));
    } else if (/\.pdf$/i.test(f) && !NOT_A_SLIP.test(f)) out.push({ path, file: f, year });
  }
  return out;
}

async function main() {
  if (!existsSync(SALARIES_DIR)) throw new Error(`No Salaries folder at ${SALARIES_DIR} (set PAYSLIPS_DIR)`);
  const e = env();
  const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const all = async (table, cols) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(cols).range(from, from + 999);
      if (error) return { rows, error };
      rows.push(...data);
      if (data.length < 1000) return { rows };
    }
  };

  const { rows: profiles, error: pErr } = await all("profiles", "id, name");
  if (pErr) throw pErr;
  const { rows: known, error: kErr } = await all("finance_payslips", "source_sha256");
  // A dry run works before the table exists — it only reads the PDFs.
  if (kErr && !dry) throw new Error(`finance_payslips: ${kErr.message} — has reference/0008_finance_payslips.sql been run?`);
  const seen = new Set(refresh ? [] : known.map((r) => r.source_sha256));
  // sick_used came with reference/0009 — written only once that has run.
  const hasSickUsed = !(await sb.from("finance_payslips").select("sick_used").limit(1)).error;
  const { rows: salaries, error: sErr } = await all("finance_salaries", "profile_id, year, month, gross_amount");
  if (sErr) throw sErr;
  const paid = new Set(salaries.filter((r) => r.profile_id && Number(r.gross_amount) > 0).map((r) => `${r.profile_id}|${r.year}-${r.month}`));

  const byFull = new Map(profiles.map((p) => [words(p.name).join(" "), p]));
  /** `path` is the folder from its year's ("Employees - 2026/_Past/michal"). */
  function profileFor(folder, path) {
    const alias = ALIASES[path.toLowerCase()] ?? ALIASES[folder.toLowerCase()];
    if (alias) {
      const p = byFull.get(words(alias).join(" "));
      return p ? { profile: p } : { why: `alias "${alias}" names no profile` };
    }
    const full = byFull.get(words(folder).join(" "));
    if (full) return { profile: full };
    const first = words(folder)[0];
    const hits = profiles.filter((p) => words(p.name)[0] === first);
    if (hits.length === 1) return { profile: hits[0] };
    return { why: hits.length ? `${hits.length} profiles named ${first} (${hits.map((p) => p.name).join(", ")})` : "no tracker profile" };
  }

  const problems = [];
  const unmatched = new Map();
  let noMonth = 0;
  // Every candidate first, so one person-month found in two folders is one slip.
  const byMonth = new Map();
  for (const y of yearFolders())
    for (const person of personFolders(y.dir)) {
      const { profile, why } = profileFor(person.name, `${y.label}/${person.rel}`);
      if (!profile) {
        unmatched.set(`${y.label}/${person.rel}`, why);
        continue;
      }
      for (const pdf of pdfsUnder(person.dir, y.year)) {
        const period = payslipPeriod(pdf.file, pdf.year);
        if (!period) {
          noMonth++;
          continue;
        }
        const key = `${profile.id}|${period.year}-${String(period.month).padStart(2, "0")}`;
        const cand = { ...pdf, profile, period, corrected: /correct/i.test(pdf.file), where: `${y.label}/${person.rel}`, past: y.past };
        const prev = byMonth.get(key);
        if (!prev) byMonth.set(key, cand);
        else {
          // The file times are only read when two files claim one month.
          const better = cand.corrected !== prev.corrected ? cand.corrected : statSync(cand.path).mtimeMs > statSync(prev.path).mtimeMs;
          const [keep, drop] = better ? [cand, prev] : [prev, cand];
          byMonth.set(key, keep);
          problems.push(`${drop.where}/${drop.file}: same person and month as ${keep.where}/${keep.file} — using the latter`);
        }
      }
    }

  let imported = 0;
  let skipped = 0;
  let notPaid = 0;
  let notSlips = 0;
  const done = new Map();
  for (const c of byMonth.values()) {
    const { profile, period } = c;
    // Past years only: this year's newest slip can come before its month is booked.
    if (c.past && !paid.has(`${profile.id}|${period.year}-${period.month}`)) {
      notPaid++;
      continue;
    }
    const buf = readFileSync(c.path);
    const sha = createHash("sha256").update(buf).digest("hex");
    if (seen.has(sha)) {
      skipped++;
      continue;
    }
    const slip = parsePayslip(await textItems(buf));
    // Not a payslip (a 106, a pension statement) or a layout it can't read.
    if (slip.salaryPaid == null && slip.vacation.balance == null) {
      notSlips++;
      continue;
    }
    if (slip.missing.length) problems.push(`${c.where}/${c.file}: couldn't read ${slip.missing.join(", ")}`);
    const row = {
      profile_id: profile.id,
      year: period.year,
      month: period.month,
      salary_rate: slip.salaryRate,
      salary_quantity: slip.salaryQuantity,
      salary_paid: slip.salaryPaid,
      gross_total: slip.grossTotal,
      vacation_previous: slip.vacation.previous,
      vacation_accrued: slip.vacation.accrued,
      vacation_used: slip.vacation.used,
      vacation_balance: slip.vacation.balance,
      sick_balance: slip.sick.balance,
      ...(hasSickUsed && { sick_used: slip.sick.used ?? (slip.sick.balance != null ? 0 : null) }),
      source_file: c.file,
      source_sha256: sha,
      imported_at: new Date().toISOString(),
    };
    if (!dry) {
      const { error } = await sb.from("finance_payslips").upsert(row, { onConflict: "profile_id,year,month" });
      if (error) {
        problems.push(`${c.where}/${c.file}: ${error.message}`);
        continue;
      }
    }
    imported++;
    const d = done.get(profile.name) ?? [];
    d.push(`${period.year}-${String(period.month).padStart(2, "0")}`);
    done.set(profile.name, d);
  }
  // A line a person (their months, not their figures), so the log stays short.
  for (const [name, months] of done) {
    months.sort();
    console.log(`${dry ? "would import" : "imported"} ${name}: ${months.length} months, ${months[0]} … ${months.at(-1)}`);
  }
  console.log(
    `\n${imported} ${dry ? "to import" : "imported"}, ${skipped} already in, ${notPaid} skipped (no salary in finance that month), ${notSlips} not payslips or unreadable, ${noMonth} files without a month in the name.`,
  );
  if (unmatched.size) console.log(`\nFolders not matched to a profile (add to ALIASES if they should be):\n- ${[...unmatched].map(([f, w]) => `${f}: ${w}`).join("\n- ")}`);
  if (problems.length) console.log(`\nNeeds a look:\n- ${problems.join("\n- ")}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
