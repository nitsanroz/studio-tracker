// Weekly-plan sheet bridge: one-way sync from the studio Google Sheet (published
// as CSV) into plan_entries. Port of scripts/import-weekly-plan.mjs, adapted for
// a live rolling sync — it only clears the sheet-style entries (free_text/absence)
// for the dates the sheet actually covers, and never touches task-linked entries.
import type { SupabaseClient } from "@supabase/supabase-js";

// ── CSV parse (handles quoted cells with in-cell newlines) ─────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Sheet header name -> plan_columns name
const COLUMN_ALIASES: Record<string, string> = {
  dimitry: "Dmitry",
  nadav: "Nadav",
  adaya: "Adaya",
  aki: "Aki",
  leeyam: "Leeyam",
  sefi: "Sefi",
  shaked: "Shaked",
  "daniel k": "Daniel",
  freelancers: "Freelancers",
  // Sofia & Liza are deactivated (no plan column) — intentionally unmapped/skipped.
};

// text prefix -> client name (for chip colors)
const CLIENT_ALIASES: [RegExp, string][] = [
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

// Only the values the DB `absence_type` enum accepts. "Half day" / "WFH" aren't
// real absences (and aren't in the enum), so they fall through to free_text and
// keep their original label as a note in the cell.
function detectAbsence(line: string): "vacation" | "sick" | null {
  if (/^חופש/.test(line)) return "vacation";
  if (/^מחלה/.test(line)) return "sick";
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Rolling sync window. The sheet holds year-less day/month rows; we only sync
// near-term days so (a) year resolution is unambiguous (window < 365 days) and
// (b) a sync never rewrites distant history. Days outside are left as-is.
const WINDOW_BACK_DAYS = 30;
const WINDOW_FWD_DAYS = 240;

/** The sheet writes dates as day/month with no year ("Sunday 12/7"). Resolve to
 *  the calendar year that puts the date closest to today (handles Dec→Jan), then
 *  keep it only if it falls inside the rolling window. Returns null to skip. */
function resolveDate(day: number, month: number, today: Date): string | null {
  const y = today.getFullYear();
  let best = new Date(y, month - 1, day);
  for (const yy of [y - 1, y + 1]) {
    const c = new Date(yy, month - 1, day);
    if (Math.abs(c.getTime() - today.getTime()) < Math.abs(best.getTime() - today.getTime())) best = c;
  }
  const diffDays = Math.round((best.getTime() - today.getTime()) / 86400000);
  if (diffDays < -WINDOW_BACK_DAYS || diffDays > WINDOW_FWD_DAYS) return null;
  return `${best.getFullYear()}-${pad(best.getMonth() + 1)}-${pad(best.getDate())}`;
}

const DAY_RE = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*(\d{1,2})\/(\d{1,2})$/;

export interface PlanEntryRow {
  date: string | null;
  column_id: string;
  position: number;
  type: "free_text" | "absence";
  text: string;
  client_id?: string | null;
  absence_type?: string;
}

export interface ParsedPlan {
  entries: PlanEntryRow[];
  dates: string[]; // distinct dated days the sheet covers
  hasWaiting: boolean;
  unmatchedColumns: Record<string, number>;
}

type ColRow = { id: string; name: string; type: string };
type ClientRow = { id: string; name: string };

/** Pure transform: CSV text + current columns/clients -> plan_entries rows.
 *  Throws if the sheet layout can't be recognized. `today` is injectable for tests. */
export function parseWeeklyPlanCsv(
  csvText: string,
  columns: ColRow[],
  clients: ClientRow[],
  today: Date = new Date(),
): ParsedPlan {
  const csv = parseCSV(csvText);

  const colByName = new Map(columns.map((c) => [c.name.toLowerCase(), c.id]));
  const studioColId = columns.find((c) => c.type === "studio")?.id;
  const waitingColId = columns.find((c) => c.type === "waiting_list")?.id;
  const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));
  const matchClient = (line: string): string | null => {
    for (const [re, name] of CLIENT_ALIASES) {
      if (re.test(line)) return clientByName.get(name.toLowerCase()) ?? null;
    }
    return null;
  };

  const headerIdx = csv.findIndex((r) => r.some((c) => c.trim() === "Waiting list"));
  if (headerIdx === -1) {
    throw new Error('Could not find the header row (no "Waiting list" column). Check the sheet tab / layout.');
  }
  const header = csv[headerIdx];
  const waitingColIdx = header.findIndex((c) => c.trim() === "Waiting list");

  const colMap = new Map<number, { columnId: string; label: string }>();
  if (studioColId) colMap.set(1, { columnId: studioColId, label: "Studio" });
  const unmatchedColumns: Record<string, number> = {};
  for (let i = 2; i < waitingColIdx; i++) {
    const raw = (header[i] ?? "").trim().toLowerCase();
    if (!raw) continue;
    const mapped = COLUMN_ALIASES[raw];
    if (mapped && colByName.has(mapped.toLowerCase())) {
      colMap.set(i, { columnId: colByName.get(mapped.toLowerCase())!, label: mapped });
    } else {
      unmatchedColumns[(header[i] ?? "").trim()] = 0;
    }
  }

  const entries: PlanEntryRow[] = [];
  const dates = new Set<string>();
  const waitingSeen = new Set<string>();
  let hasWaiting = false;

  for (let r = headerIdx + 1; r < csv.length; r++) {
    const row = csv[r];
    const m = (row[0] ?? "").trim().match(DAY_RE);
    if (!m) continue;
    const date = resolveDate(Number(m[2]), Number(m[3]), today);
    if (!date) continue; // outside the rolling sync window

    for (let i = 1; i < row.length; i++) {
      const cellRaw = (row[i] ?? "").trim();
      if (!cellRaw) continue;
      const lines = cellRaw
        .split("\n")
        .map((l) => l.replace(/^"+|"+$/g, "").trim())
        .filter((l) => l && l !== "?" && l !== "??" && l !== "-");
      if (!lines.length) continue;

      if (i === waitingColIdx) {
        if (!waitingColId) continue;
        for (const line of lines) {
          const key = line.toLowerCase();
          if (waitingSeen.has(key)) continue;
          waitingSeen.add(key);
          hasWaiting = true;
          entries.push({
            date: null,
            column_id: waitingColId,
            position: waitingSeen.size,
            type: "free_text",
            text: line,
            client_id: matchClient(line),
          });
        }
        continue;
      }
      if (i > waitingColIdx) continue; // Hour Estimation / Designer Pref — skip

      const target = colMap.get(i);
      if (!target) {
        const name = (header[i] ?? "").trim() || `col ${i}`;
        if (name in unmatchedColumns) unmatchedColumns[name] += lines.length;
        continue;
      }
      dates.add(date);
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

  return { entries, dates: [...dates].sort(), hasWaiting, unmatchedColumns };
}

export interface SyncSummary {
  inserted: number;
  cleared: number;
  daysCovered: number;
  dateRange: { from: string; to: string } | null;
  colorMatched: number;
  unmatchedColumns: Record<string, number>;
}

/** Fetches columns/clients, parses the CSV, then replaces the sheet-style entries
 *  (free_text/absence) for exactly the days the sheet covers — plus the waiting
 *  list — and re-inserts. Task-linked entries are never touched. */
export async function runWeeklyPlanSync(admin: SupabaseClient, csvText: string): Promise<SyncSummary> {
  const [{ data: colRows, error: colErr }, { data: clientRows, error: clientErr }] = await Promise.all([
    admin.from("plan_columns").select("id, name, type"),
    admin.from("clients").select("id, name"),
  ]);
  if (colErr) throw new Error(`Failed to load plan columns: ${colErr.message}`);
  if (clientErr) throw new Error(`Failed to load clients: ${clientErr.message}`);

  const parsed = parseWeeklyPlanCsv(csvText, colRows ?? [], clientRows ?? []);

  if (parsed.dates.length === 0 && !parsed.hasWaiting) {
    throw new Error("Parsed 0 entries from the sheet — refusing to clear the plan. Check the sheet layout / published tab.");
  }

  let cleared = 0;
  // Clear dated sheet-style entries only for the days the sheet covers (never task links).
  if (parsed.dates.length > 0) {
    const { count, error } = await admin
      .from("plan_entries")
      .delete({ count: "exact" })
      .in("date", parsed.dates)
      .in("type", ["free_text", "absence"]);
    if (error) throw new Error(`Clear (dated) failed: ${error.message}`);
    cleared += count ?? 0;
  }
  // Refresh the waiting list (date null) only when the sheet provided one.
  if (parsed.hasWaiting) {
    const { count, error } = await admin
      .from("plan_entries")
      .delete({ count: "exact" })
      .is("date", null)
      .eq("type", "free_text");
    if (error) throw new Error(`Clear (waiting list) failed: ${error.message}`);
    cleared += count ?? 0;
  }

  let inserted = 0;
  for (let i = 0; i < parsed.entries.length; i += 500) {
    const batch = parsed.entries.slice(i, i + 500);
    const { error, count } = await admin.from("plan_entries").insert(batch, { count: "exact" });
    if (error) throw new Error(`Insert failed: ${error.message}`);
    inserted += count ?? batch.length;
  }

  return {
    inserted,
    cleared,
    daysCovered: parsed.dates.length,
    dateRange: parsed.dates.length ? { from: parsed.dates[0], to: parsed.dates[parsed.dates.length - 1] } : null,
    colorMatched: parsed.entries.filter((e) => e.client_id).length,
    unmatchedColumns: parsed.unmatchedColumns,
  };
}
