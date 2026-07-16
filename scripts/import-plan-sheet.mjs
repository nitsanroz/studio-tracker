// One-shot: sync July weekly-plan content from the studio's Google Sheet CSV.
// Idempotent: skips entries that already exist (same column+date+text/absence).
// Run: node --env-file=.env.local scripts/import-plan-sheet.mjs <csv-path>

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// tiny CSV parser that honors quoted newlines
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync(process.argv[2], "utf8"));

const { data: cols } = await sb.from("plan_columns").select("id, name, type");
const { data: clients } = await sb.from("clients").select("id, name");
const { data: profiles } = await sb.from("profiles").select("id, name");
const colByName = new Map(cols.map((c) => [c.name.toLowerCase(), c]));
const waiting = cols.find((c) => c.type === "waiting_list");

// ensure a Daniel column exists
let daniel = colByName.get("daniel");
if (!daniel) {
  const prof = profiles.find((p) => p.name.toLowerCase().startsWith("daniel"));
  const { data, error } = await sb
    .from("plan_columns")
    .insert({ name: "Daniel", type: "member", profile_id: prof?.id ?? null, position: 8 })
    .select()
    .single();
  if (error) console.error("daniel column failed:", error.message);
  else { daniel = data; console.log("created Daniel column"); }
}

// sheet column index → app plan column
const MAP = [
  [1, colByName.get("studio")],
  [3, colByName.get("dmitry")],
  [5, colByName.get("nadav")],
  [6, colByName.get("adaya")],
  [7, colByName.get("aki")],
  [8, colByName.get("shaked")],
  [9, colByName.get("leeyam")],
  [10, daniel],
  [11, colByName.get("sefi")],
  [12, colByName.get("freelancers")],
  [13, waiting],
].filter(([, c]) => c);

const ALIASES = [
  ["no traffic", ["nt", "notraffic", "no traffic", "notrrafic"]],
  ["dualbird", ["db", "dualbird", "dual bird"]],
  ["voyantis", ["vy", "voyantis", "voyatis"]],
  ["visitt", ["visitt", "visit "]],
  ["whitebox", ["wb", "whitebox"]],
  ["tema creative", ["tema"]],
  ["blazepod", ["blazepod"]],
  ["checkmarx", ["cx", "checkmarx"]],
  ["swimm", ["swimm"]],
  ["baseline", ["baseline"]],
  ["justplay", ["jp ", "justplay"]],
  ["studio", ["studio", "&more", "nmore"]],
  ["maccabi", ["maccabi"]],
];
const clientByLower = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));
function matchClient(text) {
  const t = text.toLowerCase().trim();
  for (const [cname, id] of clientByLower) if (t.startsWith(cname)) return id;
  for (const [canonical, keys] of ALIASES) {
    for (const k of keys) if (t.startsWith(k)) return clientByLower.get(canonical) ?? null;
  }
  return null;
}

// existing entries for dedupe (July + waiting list)
const { data: existing } = await sb
  .from("plan_entries")
  .select("column_id, date, text, type, absence_type")
  .or("date.gte.2026-07-01,date.is.null");
const seen = new Set(
  existing.map((e) => `${e.column_id}|${e.date ?? ""}|${e.type}|${(e.text ?? "").toLowerCase().trim()}|${e.absence_type ?? ""}`),
);

const inserts = [];
for (const row of rows) {
  const m = /(\d{1,2})\/(\d{1,2})$/.exec(row[0] ?? "");
  if (!m) continue;
  const date = `2026-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  if (date < "2026-07-01" || date > "2026-07-31") continue;
  for (const [idx, col] of MAP) {
    const cell = (row[idx] ?? "").trim();
    if (!cell) continue;
    const isWaiting = col.type === "waiting_list";
    const entryDate = isWaiting ? null : date;
    let pos = 0;
    for (const rawLine of cell.split("\n")) {
      const line = rawLine.trim();
      if (!line || line === "-" || line === "?") continue;
      let payload;
      if (/חופש/.test(line)) payload = { type: "absence", absence_type: "vacation", text: "" };
      else if (/מחלה/.test(line)) payload = { type: "absence", absence_type: "sick", text: "" };
      else payload = { type: "free_text", text: line, client_id: matchClient(line) };
      const key = `${col.id}|${entryDate ?? ""}|${payload.type}|${(payload.text ?? "").toLowerCase()}|${payload.absence_type ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      inserts.push({ date: entryDate, column_id: col.id, position: pos++, ...payload });
    }
  }
}

console.log(`prepared ${inserts.length} entries`);
if (inserts.length) {
  const { error, count } = await sb.from("plan_entries").insert(inserts, { count: "exact" });
  console.log(error ? `failed: ${error.message}` : `inserted ${count}`);
}
