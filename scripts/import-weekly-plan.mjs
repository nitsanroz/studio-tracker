// Google-Sheet weekly plan → plan_entries (June 2026 onwards).
// Reads data/weekly-plan-tab.csv (exported per-tab CSV, keeps in-cell newlines).
// Re-runnable: clears previously imported free_text/absence entries in range first.
//
// Run:  node --env-file=.env.local scripts/import-weekly-plan.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";

const YEAR = 2026;
const FROM = "2026-06-01";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// ── CSV parse (handles quoted cells with newlines) ─────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Sheet header name -> plan_columns name
const COLUMN_ALIASES = {
  dimitry: "Dmitry",
  nadav: "Nadav",
  adaya: "Adaya",
  aki: "Aki",
  leeyam: "Leeyam",
  sefi: "Sefi",
  freelancers: "Freelancers",
};

// text prefix -> client name (for chip colors)
const CLIENT_ALIASES = [
  [/^(visitt|visit\b|vt\b)/i, "Visitt"],
  [/^(voyantis|voyatis|vy\b)/i, "Voyantis"],
  [/^(dualbird|db\b)/i, "DualBird"],
  [/^blazepod/i, "Blazepod"],
  [/^(checkmarx|cx\b)/i, "Checkmarx"],
  [/^swimm/i, "Swimm"],
  [/^(baseline|basline|badeline)/i, "Baseline"],
  [/^(notraffic|no traffic|nt\b)/i, "No Traffic"],
  [/^(whitebox|wb\b)/i, "Whitebox"],
  [/^air\b/i, "Air"],
  [/^(justplay|jp\b)/i, "JustPlay"],
  [/^(barbahar|ברבהר)/i, "Barbahar"],
  [/^nextage/i, "Nextage"],
  [/^maccabi/i, "Maccabi"],
  [/^tema/i, "TEMA Creative"],
  [/^(anecdotes|ancdotes|anectodes)/i, "Anectodes"],
  [/^mobileye/i, "Mobileye Corporate"],
  [/^arison/i, "Arison"],
  [/^nominal/i, "Nominal"],
  [/^harmonie/i, "Harmonie"],
  [/^orbb/i, "Orbb"],
  [/^controlmonkey/i, "ControlMonkey"],
  [/^(studio|nmore|&more|&website|8bit|game\b|supermario|super mario|social\b)/i, "Studio"],
];

function detectAbsence(line) {
  if (/^חופש/.test(line)) return "vacation";
  if (/^מחלה/.test(line)) return "sick";
  if (/חצי יום/.test(line)) return "half_day";
  if (/(מהבית|wfh)/i.test(line)) return "wfh";
  return null;
}

const csv = parseCSV(readFileSync(path.join(import.meta.dirname, "..", "data", "weekly-plan-tab.csv"), "utf8"));

// Resolve plan columns + clients
const { data: colRows } = await supabase.from("plan_columns").select("id, name, type");
const colByName = new Map(colRows.map((c) => [c.name.toLowerCase(), c.id]));
const studioColId = colRows.find((c) => c.type === "studio")?.id;
const waitingColId = colRows.find((c) => c.type === "waiting_list")?.id;

const { data: clientRows } = await supabase.from("clients").select("id, name");
const clientByName = new Map(clientRows.map((c) => [c.name.toLowerCase(), c.id]));
function matchClient(line) {
  for (const [re, name] of CLIENT_ALIASES) {
    if (re.test(line)) return clientByName.get(name.toLowerCase()) ?? null;
  }
  return null;
}

// Header row: find row containing "Waiting list"
const headerIdx = csv.findIndex((r) => r.some((c) => c.trim() === "Waiting list"));
const header = csv[headerIdx];
const waitingColIdx = header.findIndex((c) => c.trim() === "Waiting list");

// Column index -> plan_column id (member columns)
const colMap = new Map(); // csv col idx -> {columnId, label}
colMap.set(1, { columnId: studioColId, label: "Studio" });
const unmappedCounts = {};
for (let i = 2; i < waitingColIdx; i++) {
  const raw = header[i].trim().toLowerCase();
  if (!raw) continue;
  const mapped = COLUMN_ALIASES[raw];
  if (mapped && colByName.has(mapped.toLowerCase())) {
    colMap.set(i, { columnId: colByName.get(mapped.toLowerCase()), label: mapped });
  } else {
    unmappedCounts[header[i].trim()] = 0;
  }
}

const DAY_RE = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*(\d{1,2})\/(\d{1,2})$/;

const entries = [];
const waitingSeen = new Set();
for (let r = headerIdx + 1; r < csv.length; r++) {
  const row = csv[r];
  const m = (row[0] ?? "").trim().match(DAY_RE);
  if (!m) continue;
  const [, , d, mo] = m;
  const date = `${YEAR}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (date < FROM) continue;

  for (let i = 1; i < row.length; i++) {
    const cellRaw = (row[i] ?? "").trim();
    if (!cellRaw) continue;
    const lines = cellRaw
      .split("\n")
      .map((l) => l.replace(/^"+|"+$/g, "").trim())
      .filter((l) => l && l !== "?" && l !== "??" && l !== "-");
    if (!lines.length) continue;

    if (i === waitingColIdx) {
      for (const line of lines) {
        const key = line.toLowerCase();
        if (waitingSeen.has(key)) continue;
        waitingSeen.add(key);
        entries.push({
          date: null, column_id: waitingColId, position: waitingSeen.size,
          type: "free_text", text: line, client_id: matchClient(line),
        });
      }
      continue;
    }
    if (i > waitingColIdx) continue; // Hour Estimation / Designer Pref — skip

    const target = colMap.get(i);
    if (!target) {
      const name = header[i]?.trim() || `col ${i}`;
      if (name in unmappedCounts) unmappedCounts[name] += lines.length;
      continue;
    }
    lines.forEach((line, pos) => {
      const absence = detectAbsence(line);
      entries.push(
        absence
          ? { date, column_id: target.columnId, position: pos, type: "absence", text: "", absence_type: absence }
          : { date, column_id: target.columnId, position: pos, type: "free_text", text: line, client_id: matchClient(line) },
      );
    });
  }
}

// Clear previous import in range (only sheet-style entry types; task links untouched)
const del1 = await supabase.from("plan_entries").delete({ count: "exact" })
  .gte("date", FROM).in("type", ["free_text", "absence"]);
const del2 = await supabase.from("plan_entries").delete({ count: "exact" })
  .is("date", null).eq("type", "free_text");
console.log(`cleared: ${(del1.count ?? 0) + (del2.count ?? 0)} previously imported entries`);

let inserted = 0;
for (let i = 0; i < entries.length; i += 500) {
  const batch = entries.slice(i, i + 500);
  const { error, count } = await supabase.from("plan_entries").insert(batch, { count: "exact" });
  if (error) { console.log(`batch ${i}: ${error.message}`); continue; }
  inserted += count ?? batch.length;
}
console.log(`inserted: ${inserted} plan entries (from ${FROM})`);
console.log("skipped columns (past members):", JSON.stringify(unmappedCounts));
const withColor = entries.filter((e) => e.client_id).length;
console.log(`client color matched: ${withColor}/${entries.filter((e) => e.type === "free_text").length} text entries`);