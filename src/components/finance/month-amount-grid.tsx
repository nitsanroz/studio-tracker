"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, Eye, EyeOff, Link2Off, Lock, LockOpen, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll, mapLock, updatePreservingLock, writeStep, type LockRow } from "@/lib/finance/db";
import { MONTHS, monthLocked } from "@/lib/finance/plan-model";
import { isForecastMonth, paidAtOf, round2, stateOf, type FinanceLock, type FinanceState } from "@/lib/finance/finance";
import { formatHours, formatILS, formatILSShort, formatNum, studioToday } from "@/lib/finance/format";
import { getFreelanceTracked } from "@/lib/finance/actions";
import { usePeople } from "@/lib/finance/people-data";
import { useTableCrosshair } from "@/lib/finance/table-crosshair";
import { POSITION_LABEL, finishedThrough, hoursAreOwnWork, summarize } from "@/lib/finance/people";
import { ConfirmDialog, PageHeader, Loading, ErrorState, MismatchTriangle, StateLegend } from "@/components/finance/ui";
import { LockableCell } from "@/components/finance/lockable-cell";
import { TrackerLines } from "@/components/finance/tracker-lines";
import { CellStateCard, stepOf, type Step } from "@/components/finance/cell-state-card";
import { useCellSelection, selectionSummary, singleCell } from "@/lib/finance/cell-selection";
import { FIRST_YEAR, useYearParam } from "@/lib/finance/use-year-param";
import { SelectionBubble } from "@/components/finance/selection-bubble";
import { TrendsPanel } from "@/components/finance/trends-panel";
import { MONTH_NAMES, MONTH_SHORT, NOUNS, breakdownCard, trend, useExplainHover, type Explanation } from "@/components/finance/explain-card";

/** ₪ tolerance below which a stored-vs-fresh difference isn't worth flagging. */
const MISMATCH_TOLERANCE = 0.02;

// Fixed (non-resizable) column widths, wide enough for a comma-formatted
// 6-figure amount plus the hover lock icon's padding — without an explicit
// width + table-layout:fixed, the browser sizes an <input> cell off its
// unhelpful ~20-character default rather than its actual comma-formatted
// text, which is what was silently clipping numbers like "10,494.86".
const NAME_COL_W = 180;
const MONTH_COL_W = 128;

interface PersonRow {
  name: string;
  role?: string;
  /** The tracker person (profiles.id) these payments belong to, if linked. */
  profileId: string | null;
  /** month → { id, amount, state, notes }. `rows` > 1 when the table holds
   * more than one row for this person and month: `amount` is then their sum
   * (what the P&L counts) and `id`/`state`/`notes` are the first row's. */
  cells: Map<number, { id: string; amount: number; state: FinanceState; notes: string; paidAt: string | null; rows: number }>;
}

/** Sum of every month's amount this year — highest first is what "who costs
 * the most" actually means here, not alphabetical order. */
function yearTotal(p: PersonRow) {
  let sum = 0;
  for (const c of p.cells.values()) sum += c.amount;
  return sum;
}

interface RawRow {
  id: string;
  name: string;
  role?: string;
  profileId: string | null;
  month: number;
  amount: number;
  state: FinanceState;
  notes: string;
  /** when it was marked paid — apart from `final` (reference/0011) */
  paidAt: string | null;
}

/** Click-to-edit name — renaming commits (and merges history) on blur/Enter,
 * Escape reverts. Not gated on `editable`: fixing a name is an identity
 * correction, not a financial edit, so it's allowed on past years too.
 * With `href` (a tracker person) the name opens their page instead, carries
 * the hover card (`cellKey`), and a pencil beside it renames. */
function EditableName({
  name,
  onRename,
  href,
  cellKey,
}: {
  name: string;
  onRename: (next: string) => void;
  href?: string;
  cellKey?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [fieldName] = useState(() => `no-autofill-${Math.random().toString(36).slice(2)}`);

  if (!editing && href) {
    return (
      <span className="inline-flex items-center gap-1">
        <Link href={href} data-cell={cellKey} className="bidi-auto rounded px-0.5 text-left hover:underline">
          {name}
        </Link>
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          title="Rename"
          className="rounded p-0.5 text-faint opacity-0 hover:text-foreground group-hover:opacity-100"
        >
          <Pencil size={11} />
        </button>
      </span>
    );
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        title="Click to rename"
        className="bidi-auto rounded px-0.5 text-left hover:bg-background hover:underline"
      >
        {name}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        setEditing(false);
        onRename(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(name);
          setEditing(false);
        }
      }}
      // These look, to a browser's autofill heuristics, exactly like a
      // "name" field in a contact form — without every one of these off
      // switches, Chrome will happily overwrite it with a saved contact's
      // name the moment the field is focused (confirmed the hard way).
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      name={fieldName}
      data-1p-ignore
      data-lpignore="true"
      className="bidi-auto w-full rounded border border-brand bg-surface px-1 py-0.5 text-[13px] outline-none"
    />
  );
}

/** Click-to-edit expertise tag (e.g. "design", "video") — a small pill when
 * set, a dashed "+ tag" placeholder when empty so there's always a way to
 * add one. Commits on blur/Enter; Escape reverts without saving. */
function EditableTag({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [fieldName] = useState(() => `no-autofill-${Math.random().toString(36).slice(2)}`);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          setEditing(false);
          onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        name={fieldName}
        data-1p-ignore
        data-lpignore="true"
        className="bidi-auto w-24 rounded-full border border-brand bg-surface px-2 py-0.5 text-[11px] outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title="Click to edit expertise"
      className={`bidi-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] transition-colors ${
        value
          ? "bg-brand-soft text-brand-dark hover:bg-brand-soft/70"
          : "border border-dashed border-border-strong text-faint opacity-0 hover:border-brand hover:text-brand group-hover:opacity-100"
      }`}
    >
      {value || placeholder}
    </button>
  );
}

/**
 * Generic monthly amount grid for a per-person-per-month table
 * (finance_salaries, finance_freelance). Rows = people, cols = months.
 */
export function MonthAmountGrid({
  table,
  title,
  subtitle,
  block,
  nameColumn,
  amountColumn,
  roleColumn,
  addLabel,
  pnlLine,
  linkPeople = false,
}: {
  table: string;
  title: string;
  subtitle: string;
  block: FinanceLock["block"];
  nameColumn: string;
  amountColumn: string;
  roleColumn?: string;
  addLabel: string;
  /** finance_pnl_monthly line_item this table rolls up into (e.g. "salaries") — used to flag drift against a locked P&L figure. */
  pnlLine: string;
  /** Rows belong to a tracker person (`profile_id`): one person shared with the
   * tracker's hours and HR, so cost can later be set against their work. */
  linkPeople?: boolean;
}) {
  const [year, setYear] = useYearParam();
  // Read on render, not at module load: a tab left open over New Year kept
  // last year editable and this year read-only.
  const today = studioToday();
  const CUR_YEAR = Number(today.slice(0, 4));
  const CUR_MONTH = Number(today.slice(5, 7));
  const [rows, setRows] = useState<RawRow[]>([]);
  const [locks, setLocks] = useState<FinanceLock[]>([]);
  const [pnlByMonth, setPnlByMonth] = useState<Map<number, { value: number; state: FinanceState }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [newName, setNewName] = useState("");
  const [trackerPeople, setTrackerPeople] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!linkPeople) return;
    createClient()
      .from("profiles")
      .select("id, name")
      .order("name")
      .then(({ data }) => setTrackerPeople((data as { id: string; name: string }[] | null) ?? []));
  }, [linkPeople]);
  // This month so far for freelancers kept in the tracker (AB, Milica, Dima):
  // hours logged and their ₪ cost, shown in brackets beside the planned amount.
  // Live — read on opening and on coming back to the page.
  const [tracked, setTracked] = useState<{ profileId: string; name: string; hours: number; cost: number }[]>([]);
  useEffect(() => {
    if (!linkPeople || year !== CUR_YEAR) return;
    const load = () =>
      getFreelanceTracked(CUR_YEAR, CUR_MONTH)
        .then(setTracked)
        .catch(() => setTracked([]));
    load();
    const onBack = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [linkPeople, year, CUR_YEAR, CUR_MONTH]);
  const trackedFor = (p: PersonRow) =>
    tracked.find((t) => (p.profileId && t.profileId === p.profileId) || t.name.trim().toLowerCase() === p.name.trim().toLowerCase());
  /** The tracker person a typed name refers to (case and spacing don't matter). */
  const trackerPerson = (name: string) => {
    const key = name.trim().toLowerCase();
    return trackerPeople.find((t) => t.name.toLowerCase() === key) ?? null;
  };

  // Hidden rows are a per-table view preference (not shared data), so a
  // departed employee's row can be tucked away without deleting their
  // history — and brought back just as easily.
  const hiddenStorageKey = `hiddenRows.${table}`;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(hiddenStorageKey);
      if (raw) setHidden(new Set(JSON.parse(raw)));
    } catch {
      // ignore — falls back to nothing hidden
    }
  }, [hiddenStorageKey]);
  function persistHidden(next: Set<string>) {
    setHidden(next);
    try {
      localStorage.setItem(hiddenStorageKey, JSON.stringify([...next]));
    } catch {
      // ignore — hide state just won't survive a reload
    }
  }
  function hidePerson(name: string) {
    persistHidden(new Set(hidden).add(name));
  }
  function showPerson(name: string) {
    const next = new Set(hidden);
    next.delete(name);
    persistHidden(next);
  }

  const cols = useMemo(
    () =>
      `id, ${nameColumn}, ${roleColumn ? roleColumn + ", " : ""}${linkPeople ? "profile_id, " : ""}year, month, ${amountColumn}, state, notes`,
    [nameColumn, roleColumn, amountColumn, linkPeople],
  );


  // Only the latest load may land: switching years quickly let an older
  // year's rows arrive last and sit under the newer year — and `commit` then
  // saved such a row into the year on screen, moving it.
  const loadSeq = useRef(0);
  // Empty cells whose insert is still in flight, by `name|month` — see commit.
  const inserting = useRef(new Map<string, Promise<{ id: string; state: FinanceState } | null>>());
  const load = useCallback(
    async (y: number) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(null);
      try {
        const sb = createClient();
        const [raw, lockRows] = await Promise.all([
          fetchAll<Record<string, unknown>>(sb, table, `${cols}, paid_at`, (q) => q.eq("year", y)),
          fetchAll<LockRow>(sb, "finance_locks", "id, scope_year, scope_month, block, locked_at, note", (q) =>
            q.eq("scope_year", y),
          ),
        ]);
        if (seq !== loadSeq.current) return;
        inserting.current.clear();
        setRows(
          raw.map((r) => ({
            id: r.id as string,
            name: r[nameColumn] as string,
            role: roleColumn ? (r[roleColumn] as string) : undefined,
            profileId: (r.profile_id as string | null | undefined) ?? null,
            month: r.month as number,
            amount: Number(r[amountColumn]),
            state: r.state as FinanceState,
            notes: (r.notes as string | null) ?? "",
            paidAt: (r.paid_at as string | null | undefined) ?? null,
          })),
        );
        setLocks(lockRows.map(mapLock));
        setEdits(new Map());
      } catch (e: unknown) {
        if (seq === loadSeq.current) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
      if (seq !== loadSeq.current) return;
      // Best-effort: a missing/renamed P&L line must never break this page.
      try {
        const sb = createClient();
        const pnlRows = await fetchAll<{ month: number; value: number; state: FinanceState }>(
          sb,
          "finance_pnl_monthly",
          "month, value, state",
          (q) => q.eq("year", y).eq("line_item", pnlLine),
        );
        if (seq !== loadSeq.current) return;
        setPnlByMonth(new Map(pnlRows.map((r) => [r.month, { value: Number(r.value), state: r.state }])));
      } catch (e: unknown) {
        // A silent empty map here reads identically to "no mismatch to flag"
        // — log so a broken query doesn't hide behind a genuinely empty one.
        console.error(`Failed to load ${pnlLine} P&L for mismatch check:`, e);
        if (seq === loadSeq.current) setPnlByMonth(new Map());
      }
    },
    [table, cols, nameColumn, roleColumn, amountColumn, pnlLine],
  );

  useEffect(() => {
    void load(year);
  }, [year, load]);

  const people = useMemo(() => {
    const byName = new Map<string, PersonRow>();
    for (const r of rows) {
      let p = byName.get(r.name);
      if (!p) {
        p = { name: r.name, role: r.role, profileId: null, cells: new Map() };
        byName.set(r.name, p);
      }
      p.profileId ??= r.profileId;
      // Two rows for one person and month (a double insert, a rename into a
      // name that had the month): the P&L counts both, so the cell shows their
      // sum and is flagged — it used to show whichever row came last.
      const had = p.cells.get(r.month);
      p.cells.set(
        r.month,
        had
          ? { ...had, amount: had.amount + r.amount, rows: had.rows + 1 }
          : { id: r.id, amount: r.amount, state: r.state, notes: r.notes, paidAt: r.paidAt, rows: 1 },
      );
    }
    return [...byName.values()].sort((a, b) => yearTotal(b) - yearTotal(a) || a.name.localeCompare(b.name));
  }, [rows]);

  // What the side panel reads: the year's rows as they stand, an edit included.
  const trendRows = useMemo(() => rows.map((r) => ({ year, month: r.month, name: r.name, amount: r.amount, predicted: r.state === "predicted" })), [rows, year]);
  const visiblePeople = useMemo(() => people.filter((p) => !hidden.has(p.name)), [people, hidden]);
  const hiddenPeople = useMemo(() => people.filter((p) => hidden.has(p.name)), [people, hidden]);

  const editable = year >= CUR_YEAR;

  const selValueAt = (r: number, c: number) => visiblePeople[r]?.cells.get(c + 1)?.amount ?? null;
  const sel = useCellSelection(`${table}|${year}|${visiblePeople.map((p) => p.name).join(",")}`, selValueAt);
  const selSummary = useMemo(() => selectionSummary(sel.live, selValueAt), [sel.live, visiblePeople]);

  function patchRow(id: string, patch: Partial<RawRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function commit(person: PersonRow, month: number, raw: string) {
    const key = `${person.name}|${month}`;
    // A resting value is shown with thousand separators (see the cell below);
    // strip them back out before parsing.
    const parsed = raw.trim() === "" ? 0 : Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(parsed)) {
      setEdits((m) => {
        const n = new Map(m);
        n.delete(key);
        return n;
      });
      return;
    }
    const clearEdit = () =>
      setEdits((m) => {
        const n = new Map(m);
        n.delete(key);
        return n;
      });
    const sb = createClient();
    const seq = loadSeq.current;
    // `person` is from the render the edit began in. An empty cell edited again
    // before its first insert returned would insert a second row for the same
    // month — wait for that insert and update its row instead.
    const pending = person.cells.get(month) ? undefined : inserting.current.get(key);
    const existing = person.cells.get(month) ?? (pending ? await pending : null);
    if (pending && !existing) return; // the first insert failed, and said so
    if (existing) {
      // Only the amount: the name, role, link and year are the row's own, and
      // sending them back (the year above all, from a render that may be
      // another year's) could move the row. State is never flipped by an
      // edit — see plan-grid.tsx's commitCell.
      if ("amount" in existing && existing.amount === parsed) return clearEdit();
      const { error: e } = await sb.from(table).update({ [amountColumn]: parsed }).eq("id", existing.id);
      if (e) {
        setNote(`Save failed: ${e.message}`);
        return;
      }
      patchRow(existing.id, { amount: parsed });
    } else {
      // Only a brand-new row gets a default state, from isForecastMonth.
      const state: FinanceState = isForecastMonth(year, month) ? "predicted" : "actual";
      const payload: Record<string, unknown> = {
        [nameColumn]: person.name,
        year,
        month,
        [amountColumn]: parsed,
        state,
      };
      if (roleColumn) payload[roleColumn] = person.role ?? "";
      if (linkPeople) payload.profile_id = person.profileId;
      const insert = (async () => {
        const { data, error: e } = await sb.from(table).insert(payload).select("id").single();
        if (e || !data) {
          setNote(`Save failed: ${e?.message ?? "insert failed"}`);
          return null;
        }
        return { id: (data as { id: string }).id, state };
      })();
      inserting.current.set(key, insert);
      const made = await insert;
      // Kept after success until the next load: a render that predates the new
      // row may still commit this cell, and must find it here.
      if (!made) {
        inserting.current.delete(key);
        return;
      }
      // A load since (another year picked) owns the rows now; and never add the
      // row twice, or it would read as a duplicate.
      if (seq === loadSeq.current)
        setRows((rs) =>
          rs.some((r) => r.id === made.id)
            ? rs
            : [...rs, { id: made.id, name: person.name, role: person.role, profileId: person.profileId, month, amount: parsed, state, notes: "", paidAt: null }],
        );
    }
    clearEdit();
  }

  /** The one selected cell, when exactly one cell holding an amount is selected — what the state card beside it acts on. */
  const picked = useMemo(() => {
    const one = singleCell(sel.live);
    if (!one) return null;
    const person = visiblePeople[one.r];
    const cell = person?.cells.get(one.c + 1);
    // A cell of two rows has no one step to set — the card would move only the first.
    if (!person || !cell || !cell.amount || cell.rows > 1) return null;
    return { person, month: one.c + 1, id: cell.id, state: cell.state, paidAt: cell.paidAt };
  }, [sel.live, visiblePeople]);

  /**
   * Move a cell to one of the four steps — Draft → Predicted → Final → Paid
   * (Nitsan, 2026-10-25: paid comes after final; a final cell is one not paid
   * yet), written by db.ts writeStep. In a locked month or a past year only
   * final ↔ paid moves.
   */
  async function setStep(c: NonNullable<typeof picked>, step: Step) {
    if (stepOf(c.state, c.paidAt) === step) return;
    const state = stateOf(step);
    if (state !== c.state && !(editable && !monthLocked(locks, year, c.month, block))) return;
    const paidAt = paidAtOf(step);
    setBusy("step");
    const err = await writeStep(createClient(), table, c.id, c.state, step, paidAt);
    setBusy(null);
    if (err) return setNote(`Update failed: ${err.message}`);
    patchRow(c.id, { state, paidAt });
  }

  /** A month's final amounts not marked paid yet — what "mark the month paid" moves. ₪0 cells are empty, nothing to pay. */
  const unpaidIn = (month: number) => rows.filter((r) => r.month === month && r.state === "final" && !r.paidAt && r.amount !== 0);
  const [confirmPaid, setConfirmPaid] = useState<number | null>(null);

  /**
   * Every final, unpaid amount of a month → Paid in one go (Nitsan,
   * 2026-10-31: salaries go out in one bank run, so marking them one cell at a
   * time was busywork). Final ↔ paid is allowed in a locked month or a past
   * year, as on the card. Asked first, with the count and total.
   */
  async function markMonthPaid(month: number) {
    const open = unpaidIn(month);
    if (!open.length) return;
    const paidAt = paidAtOf("paid");
    const sb = createClient();
    setBusy("step");
    const errors = await Promise.all(open.map((r) => writeStep(sb, table, r.id, r.state, "paid", paidAt)));
    setBusy(null);
    const ok = new Set(open.filter((_, i) => !errors[i]).map((r) => r.id));
    setRows((rs) => rs.map((r) => (ok.has(r.id) ? { ...r, paidAt } : r)));
    const failed = errors.find(Boolean);
    if (failed) setNote(`${open.length - ok.size} of ${open.length} couldn't be marked paid: ${failed.message}`);
  }

  /** Right-click comment — a plain metadata update, allowed even on a
   * "final" row (it doesn't touch the guarded value/state fields). */
  async function saveComment(person: PersonRow, month: number, text: string) {
    const cell = person.cells.get(month);
    if (!cell) return;
    const sb = createClient();
    const err = await updatePreservingLock(sb, table, cell.id, { notes: text }, cell.state);
    if (err) {
      setNote(`Comment save failed: ${err.message}`);
      return;
    }
    patchRow(cell.id, { notes: text });
  }

  /** Rename a person everywhere — every year's rows, not just this one, so
   * their history stays merged under the corrected name instead of
   * splitting into two people. */
  async function renamePerson(oldName: string, nextNameRaw: string) {
    // Renaming to a tracker person's name links the rows to them.
    const match = linkPeople ? trackerPerson(nextNameRaw) : null;
    const nextName = match?.name ?? nextNameRaw.trim();
    if (!nextName || nextName === oldName) return;
    const patch: Record<string, unknown> = { [nameColumn]: nextName };
    if (match) patch.profile_id = match.id;
    const sb = createClient();
    // A bulk single-statement update fails outright the moment ANY matched
    // row is locked ("final") — the guard trigger blocks it regardless of
    // which column changed. Go row by row instead, unlocking/relocking each
    // one exactly like a single-cell edit would.
    const affected = await fetchAll<{ id: string; state: FinanceState; year: number; month: number }>(
      sb,
      table,
      "id, state, year, month",
      (q) => q.eq(nameColumn, oldName),
    );
    // Renaming into a name that already has a row in one of the same months
    // would leave two rows for that person and month — refuse, and say which.
    const taken = await fetchAll<{ year: number; month: number }>(sb, table, "year, month", (q) => q.eq(nameColumn, nextName));
    const takenAt = new Set(taken.map((r) => `${r.year}-${r.month}`));
    const clash = affected.filter((r) => takenAt.has(`${r.year}-${r.month}`));
    if (clash.length) {
      const when = clash
        .sort((a, b) => a.year - b.year || a.month - b.month)
        .slice(0, 3)
        .map((r) => `${MONTH_SHORT[r.month - 1]} ${r.year}`)
        .join(", ");
      setNote(
        `Not renamed: ${nextName} already has ${clash.length === 1 ? "a row" : "rows"} in ${when}${clash.length > 3 ? ` and ${clash.length - 3} more` : ""}` +
          ` — renaming ${oldName} would make two rows for the same month. Move or clear those amounts first.`,
      );
      return;
    }
    for (const r of affected) {
      const err = await updatePreservingLock(sb, table, r.id, patch, r.state);
      if (err) {
        setNote(`Rename failed: ${err.message}`);
        return;
      }
    }
    setRows((rs) =>
      rs.map((r) => (r.name === oldName ? { ...r, name: nextName, profileId: match?.id ?? r.profileId } : r)),
    );
    if (hidden.has(oldName)) {
      const next = new Set(hidden);
      next.delete(oldName);
      next.add(nextName);
      persistHidden(next);
    }
  }

  /** Set a person's expertise tag (freelance's `role` column) — applies to
   * every one of their rows (all years), same lock-safe row-by-row approach
   * as `renamePerson`, so it isn't lost the next time a new month's entry is
   * added for them. */
  async function updateRole(person: PersonRow, nextRoleRaw: string) {
    if (!roleColumn) return;
    const nextRole = nextRoleRaw.trim();
    if (nextRole === (person.role ?? "")) return;
    const sb = createClient();
    const affected = await fetchAll<{ id: string; state: FinanceState }>(sb, table, "id, state", (q) =>
      q.eq(nameColumn, person.name),
    );
    for (const r of affected) {
      const err = await updatePreservingLock(sb, table, r.id, { [roleColumn]: nextRole }, r.state);
      if (err) {
        setNote(`Update failed: ${err.message}`);
        return;
      }
    }
    setRows((rs) => rs.map((r) => (r.name === person.name ? { ...r, role: nextRole } : r)));
  }

  /** Bulk "close the books" for a whole month — every row locked at once,
   * plus a finance_locks row so `monthLocked` disables editing entirely
   * (mirrors Plan's finalizeMonth/unlockMonth). */
  async function finalizeMonth(month: number) {
    setBusy(`lock-${month}`);
    setNote(null);
    try {
      const sb = createClient();
      // Exclude rows already final — the guard trigger blocks a no-op
      // final→final update, which would otherwise abort this whole batch.
      // A row only becomes final here, never paid: a stray paid_at (a
      // final → paid click whose re-lock failed) is cleared.
      const { error: updateErr } = await sb
        .from(table)
        .update({ state: "final", paid_at: null })
        .eq("year", year)
        .eq("month", month)
        .neq("state", "final");
      if (updateErr) throw new Error(updateErr.message);
      const { error: e } = await sb.from("finance_locks").insert({ scope_year: year, scope_month: month, block });
      if (e && !e.message.includes("duplicate")) throw new Error(e.message);
      setRows((rs) => rs.map((r) => (r.month === month ? (r.state === "final" ? r : { ...r, state: "final" as FinanceState, paidAt: null }) : r)));
      setLocks((ls) => [
        ...ls.filter((l) => !(l.scopeYear === year && l.scopeMonth === month && l.block === block)),
        { scopeYear: year, scopeMonth: month, block },
      ]);
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "Finalize failed");
    } finally {
      setBusy(null);
    }
  }

  async function unlockMonth(month: number) {
    setBusy(`lock-${month}`);
    setNote(null);
    try {
      const sb = createClient();
      // Delete the lock FIRST — the guard trigger blocks editing final rows otherwise.
      // Both writes' errors were ignored: the month showed reopened while the
      // database still had it locked and final.
      const { error: delErr } = await sb
        .from("finance_locks")
        .delete()
        .eq("scope_year", year)
        .eq("scope_month", month)
        .eq("block", block);
      if (delErr) throw new Error(`Reopen failed: ${delErr.message}`);
      // Back to draft clears paid too (paid comes after final), so locking the
      // month again doesn't quietly mark its rows paid.
      const { error: updErr } = await sb
        .from(table)
        .update({ state: "actual", paid_at: null })
        .eq("year", year)
        .eq("month", month)
        .eq("state", "final");
      if (updErr) {
        // The rows are still final — put the lock back rather than leave the
        // month half open (no lock, final rows).
        const { error: relockErr } = await sb.from("finance_locks").insert({ scope_year: year, scope_month: month, block });
        if (relockErr) setLocks((ls) => ls.filter((l) => !(l.scopeYear === year && l.scopeMonth === month && l.block === block)));
        throw new Error(
          `Reopen failed: ${updErr.message}${relockErr ? " — the month's lock is off but its rows are still final" : " — the month stays locked"}`,
        );
      }
      setRows((rs) => rs.map((r) => (r.month === month && r.state === "final" ? { ...r, state: "actual" as FinanceState, paidAt: null } : r)));
      setLocks((ls) => ls.filter((l) => !(l.scopeYear === year && l.scopeMonth === month && l.block === block)));
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setBusy(null);
    }
  }

  /** Per-month drift between this table's own sum and a locked P&L figure —
   * e.g. someone unlocked and edited a past salary after that month's P&L
   * line was already finalized. */
  const mismatchByMonth = useMemo(() => {
    const m = new Map<number, { stored: number; fresh: number }>();
    for (const [month, pnl] of pnlByMonth) {
      if (pnl.state !== "final") continue;
      let fresh = 0;
      for (const p of people) fresh += p.cells.get(month)?.amount ?? 0;
      fresh = round2(fresh);
      if (Math.abs(fresh - pnl.value) >= MISMATCH_TOLERANCE) m.set(month, { stored: pnl.value, fresh });
    }
    return m;
  }, [pnlByMonth, people]);

  // ── Hover cards: a month's total (who it's made of, why it moved) and one
  // person's month (their year, their share).
  const personKey = (name: string, m: number) => `m|${name}|${m}`;
  const totalKey = (m: number) => `t|${m}`;
  const monthItems = (m: number) =>
    people.map((p) => ({ label: p.name, n: p.cells.get(m)?.amount ?? 0 })).filter((i) => i.n);
  const monthTotal = (m: number) => monthItems(m).reduce((s, i) => s + i.n, 0);
  const totals = MONTHS.map((_, i) => monthTotal(i + 1));
  const isSalaries = !roleColumn;
  // A person's year at a glance: what they cost against what their hours
  // brought in. Loaded for the year on view, only on grids of tracker people.
  const { data: peopleYear } = usePeople({ year, skip: !linkPeople });
  function personCard(profileId: string): Explanation | null {
    const p = people.find((x) => x.profileId === profileId);
    if (!p) return null;
    const ledger = peopleYear?.ledgers.get(profileId);
    const position = peopleYear?.people.find((x) => x.id === profileId)?.position ?? null;
    const own = hoursAreOwnWork(position);
    const s = summarize(ledger, year, finishedThrough(), own);
    const hours = MONTHS.map((_, i) => ledger?.get(`${year}-${String(i + 1).padStart(2, "0")}`)?.hours ?? 0);
    return {
      title: `${p.name} · ${year}`,
      value: s.cost ? formatILS(Math.round(s.cost)) : "—",
      formula: !peopleYear
        ? "Loading hours…"
        : s.costPerHour != null
          ? `${formatNum(s.hours)}h logged · ₪${formatNum(s.costPerHour)} an hour`
          : s.hours >= 1
            ? own
              ? `${formatNum(s.hours)}h logged — too few for per-hour figures`
              : `${formatNum(s.hours)}h logged · ${POSITION_LABEL[position!]} — not counted as their own work`
            : "No tracked hours this year",
      items: s.clients.slice(0, 5).map((c) => ({ label: c.client, value: `${formatNum(c.hours)}h`, n: c.hours })),
      more: Math.max(0, s.clients.length - 5),
      trends: [],
      notes: [
        s.revenue ? `Their hours brought in ${formatILS(Math.round(s.revenue))}` : "",
        s.returnRatio != null
          ? `${s.returnRatio.toFixed(1)}× the cost of their client work${s.returnRatio < 1 ? " — below it" : ""}${(s.studioShare ?? 0) > 0.01 ? " (studio work left out)" : ""}`
          : "",
        "Click the name for their page",
      ].filter(Boolean),
      series: s.hours >= 1 ? { values: hours, current: null } : undefined,
      sources: [],
    };
  }

  const explainKey = (key: string): Explanation | null => {
    const [kind, a, b] = key.split("|");
    if (kind === "p") return personCard(a);
    if (kind === "t") {
      const m = Number(a);
      const items = monthItems(m);
      const pnl = pnlByMonth.get(m);
      return breakdownCard({
        title: `${title} · ${MONTH_NAMES[m - 1]} ${year}`,
        value: totals[m - 1],
        formula: `Sum of ${items.length} ${isSalaries ? (items.length === 1 ? "employee" : "employees") : items.length === 1 ? "freelancer" : "freelancers"}`,
        items,
        prev: m > 1 ? { items: monthItems(m - 1), label: "last month" } : undefined,
        noun: isSalaries ? NOUNS.person : NOUNS.freelancer,
        upIsGood: false,
        series: { values: totals, current: m },
        notes: [
          pnl && Math.abs(pnl.value - totals[m - 1]) >= MISMATCH_TOLERANCE ? `The Plan shows ${formatILS(pnl.value)} for this month` : null,
        ],
        sources: visiblePeople.filter((p) => p.cells.get(m)?.amount).map((p) => personKey(p.name, m)),
      });
    }
    if (kind === "m") {
      const p = people.find((x) => x.name === a);
      const m = Number(b);
      if (!p) return null;
      const values = MONTHS.map((_, i) => p.cells.get(i + 1)?.amount ?? 0);
      const v = values[m - 1];
      if (!v) return null;
      const paid = values.filter(Boolean);
      const yearSum = paid.reduce((s, x) => s + x, 0);
      const prev = m > 1 ? values[m - 2] : 0;
      return {
        title: `${p.name} · ${MONTH_SHORT[m - 1]} ${year}`,
        value: formatILS(v),
        trends: [trend(v, prev || undefined, formatILS, "last month", null)].filter((t) => t != null),
        // Only when no earlier month has one — an empty month just before isn't "first".
        why: m > 1 && values.slice(0, m - 1).every((x) => !x) ? (isSalaries ? "First salary this year." : "First invoice this year.") : undefined,
        notes: [
          totals[m - 1] ? `${Math.round((v / totals[m - 1]) * 100)}% of ${MONTH_SHORT[m - 1]}'s ${isSalaries ? "salaries" : "freelance"}` : "",
          `${formatILS(yearSum)} in ${year} over ${paid.length} ${paid.length === 1 ? "month" : "months"}`,
          (p.cells.get(m)?.rows ?? 1) > 1 ? `${p.cells.get(m)!.rows} rows for this month, added together — check` : "",
          p.cells.get(m)?.notes ? `Note: ${p.cells.get(m)!.notes}` : "",
        ].filter(Boolean),
        series: { values, current: m },
        sources: [totalKey(m)],
      };
    }
    return null;
  };
  const explain = useExplainHover(explainKey);
  const crosshair = useTableCrosshair();


  /** Persist the new person immediately (a real row, amount 0, month 1) —
   * previously this only touched local state, so a name typed here and never
   * followed by an amount (the person got distracted, or just hasn't been
   * paid yet this year) silently disappeared on the next reload with no save
   * indicator ever shown. */
  async function addPerson() {
    // A tracker person's name links the new row to them, spelled as the tracker has it.
    const match = linkPeople ? trackerPerson(newName) : null;
    const name = match?.name ?? newName.trim();
    if (!name || people.some((p) => p.name === name)) return;
    const state: FinanceState = isForecastMonth(year, 1) ? "predicted" : "actual";
    const sb = createClient();
    const payload: Record<string, unknown> = { [nameColumn]: name, year, month: 1, [amountColumn]: 0, state };
    if (roleColumn) payload[roleColumn] = "";
    if (linkPeople) payload.profile_id = match?.id ?? null;
    const { data, error: e } = await sb.from(table).insert(payload).select("id").single();
    if (e || !data) {
      setNote(`Add failed: ${e?.message ?? "insert failed"}`);
      return;
    }
    const newId = (data as { id: string }).id;
    setRows((rs) => [
      ...rs,
      { id: newId, name, role: roleColumn ? "" : undefined, profileId: match?.id ?? null, month: 1, amount: 0, state, notes: "", paidAt: null },
    ]);
    setNewName("");
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;

  const years: number[] = [];
  for (let y = CUR_YEAR + 1; y >= FIRST_YEAR; y--) years.push(y);

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          </>
        }
      />
      {/* The grid, with its trends beside it from 1536px and above it under that (trends-panel.tsx). */}
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start">
      <div className="min-w-0 flex-1">
      {linkPeople && (table === "finance_salaries" || table === "finance_freelance") && (
        <TrackerLines
          kind={table === "finance_salaries" ? "salaries" : "freelance"}
          table={table}
          nameColumn={nameColumn}
          amountColumn={amountColumn}
          roleColumn={roleColumn}
          block={block}
          onAdded={(y) => {
            if (y === year) void load(year);
          }}
        />
      )}
      <StateLegend
        steps
        hint={
          hiddenPeople.length > 0 && (
            <button
              onClick={() => setShowHiddenPanel((v) => !v)}
              className="flex items-center gap-1 rounded-full border border-border-strong px-2 py-0.5 text-faint hover:bg-background hover:text-foreground"
            >
              <EyeOff size={12} />
              {hiddenPeople.length} hidden
            </button>
          )
        }
      />
      {showHiddenPanel && hiddenPeople.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2/60 px-3 py-2 text-xs">
          <button
            onClick={() => persistHidden(new Set())}
            className="font-medium text-brand hover:text-brand-dark"
          >
            Show all
          </button>
          <span className="text-faint">·</span>
          {hiddenPeople.map((p) => (
            <button
              key={p.name}
              onClick={() => showPerson(p.name)}
              title="Show this row again"
              className="bidi-auto flex items-center gap-1 rounded-full border border-border-strong bg-surface px-2 py-0.5 text-muted hover:bg-background hover:text-foreground"
            >
              <Eye size={11} />
              {p.name}
            </button>
          ))}
        </div>
      )}
      {note && (
        <div className="mb-3 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background">{note}</div>
      )}

      <div
        className="overflow-x-auto rounded-xl border border-border"
        onMouseOver={explain.onMouseOver}
        onMouseLeave={explain.onMouseLeave}
        onScroll={explain.onScroll}
      >
        <table
          className="border-collapse text-[13px]"
          onMouseOver={crosshair.onMouseOver}
          onMouseLeave={crosshair.onMouseLeave}
          style={{ tableLayout: "fixed", width: NAME_COL_W + MONTH_COL_W * MONTHS.length }}
        >
          <colgroup>
            <col style={{ width: NAME_COL_W }} />
            {MONTHS.map((m) => (
              <col key={m} style={{ width: MONTH_COL_W }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-surface-2 text-xs font-medium uppercase tracking-wide text-faint">
              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left">
                {roleColumn ? "Person" : "Employee"}
              </th>
              {MONTHS.map((m, i) => {
                const monthNum = i + 1;
                const locked = monthLocked(locks, year, monthNum, block);
                const mismatch = mismatchByMonth.get(monthNum);
                return (
                  <th
                    key={m}
                    data-advice={`month:${year}-${String(monthNum).padStart(2, "0")}`}
                    className={`group px-2 py-2 text-right ${isForecastMonth(year, monthNum) ? "bg-surface" : ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {mismatch && (
                        <MismatchTriangle align={monthNum >= 7 ? "right" : "left"}>
                          Locked total <span className="tabular-nums">{formatILS(mismatch.stored)}</span>{" "}
                          no longer matches the current entries (
                          <span className="tabular-nums">{formatILS(mismatch.fresh)}</span>, diff{" "}
                          <span className="tabular-nums">
                            {formatILS(Math.abs(mismatch.fresh - mismatch.stored))}
                          </span>
                          ). Someone likely edited a row here after this month&rsquo;s P&amp;L line
                          was finalized.
                        </MismatchTriangle>
                      )}
                      {m}
                      {locked && <span className="text-faint">·</span>}
                      {unpaidIn(monthNum).length > 0 && (
                        <button
                          onClick={() => setConfirmPaid(monthNum)}
                          disabled={busy === "step"}
                          title={`Mark ${MONTH_NAMES[i]}'s ${unpaidIn(monthNum).length} final ${unpaidIn(monthNum).length === 1 ? "amount" : "amounts"} paid`}
                          aria-label={`Mark ${MONTH_NAMES[i]} paid`}
                          className="text-[var(--state-paid-fg)] opacity-60 hover:opacity-100 focus-visible:opacity-100"
                        >
                          <CheckCheck size={12} />
                        </button>
                      )}
                      {editable && (
                        <button
                          onClick={() => (locked ? unlockMonth(monthNum) : finalizeMonth(monthNum))}
                          disabled={busy === `lock-${monthNum}`}
                          title={locked ? "Reopen month" : "Finalize whole month"}
                          className="text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          {locked ? <Lock size={11} /> : <LockOpen size={11} />}
                        </button>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          {/* data-money: every figure in this grid is an amount (no ₪ on them), for Hide numbers. */}
          <tbody data-money>
            {visiblePeople.map((p, rowIdx) => (
              <tr key={p.name} className="group border-t border-border">
                <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                  <span className="inline-flex items-center gap-1">
                    <EditableName
                      name={p.name}
                      onRename={(next) => renamePerson(p.name, next)}
                      href={linkPeople && p.profileId ? `/finance/people/${p.profileId}` : undefined}
                      cellKey={p.profileId ? `p|${p.profileId}` : undefined}
                    />
                    {linkPeople && !p.profileId && (
                      <span title="Not linked to a person in the tracker. Rename to their tracker name to link." className="ml-1 inline-flex text-faint">
                        <Link2Off size={11} />
                      </span>
                    )}
                    {roleColumn && (
                      <EditableTag
                        value={p.role ?? ""}
                        placeholder="+ tag"
                        onCommit={(next) => updateRole(p, next)}
                      />
                    )}
                    <button
                      onClick={() => hidePerson(p.name)}
                      title="Hide this row"
                      className="ml-1 text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    >
                      <EyeOff size={12} />
                    </button>
                  </span>
                </td>
                {MONTHS.map((_, i) => {
                  const m = i + 1;
                  const cell = p.cells.get(m);
                  const amount = cell?.amount ?? 0;
                  const key = `${p.name}|${m}`;
                  const locked = monthLocked(locks, year, m, block);
                  const editVal = edits.get(key);
                  // Nothing planned and nothing logged: no bracket of zeros.
                  const tracker = year === CUR_YEAR && m === CUR_MONTH ? trackedFor(p) : undefined;
                  const live = tracker && (tracker.hours > 0 || amount > 0) ? tracker : undefined;
                  // Two rows for one month: shown as their sum, read-only and
                  // marked — typing one figure here would land on one row only.
                  const dupes = cell && cell.rows > 1 ? cell.rows : 0;
                  const dupeTitle = dupes
                    ? `${dupes} rows for ${p.name} in ${MONTH_SHORT[i]} ${year}, added together (the P&L counts them all) — check`
                    : undefined;
                  return (
                    <LockableCell
                      key={m}
                      editable={editable && !locked && !dupes}
                      title={dupeTitle}
                      state={cell?.state}
                      value={editVal ?? (amount ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "")}
                      committedValue={amount ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) : ""}
                      onChange={(v) =>
                        setEdits((prev) => {
                          const n = new Map(prev);
                          n.set(key, v);
                          return n;
                        })
                      }
                      onCommit={(v) => commit(p, m, v)}
                      comment={cell?.notes}
                      onSaveComment={cell ? (v) => saveComment(p, m, v) : undefined}
                      future={isForecastMonth(year, m)}
                      dataCell={amount ? personKey(p.name, m) : undefined}
                      advice={cell ? `row:${cell.id}` : undefined}
                      paid={!!cell && stepOf(cell.state, cell.paidAt) === "paid"}
                      aside={
                        live
                          ? {
                              text: `${formatHours(live.hours)}h · ${formatILSShort(live.cost)}`,
                              title: `${formatHours(live.hours)}h logged in the tracker so far this month — ${formatILS(live.cost)} at their rate, charges included`,
                            }
                          : dupeTitle
                            ? { text: `${dupes} rows`, title: dupeTitle }
                            : undefined
                      }
                      selected={sel.isSelected(rowIdx, i)}
                      onCellMouseDown={(e) => sel.cellMouseDown(rowIdx, i, e)}
                      onCellMouseEnter={(e) => sel.cellMouseEnter(rowIdx, i, e)}
                    />
                  );
                })}
              </tr>
            ))}
            {visiblePeople.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-4 text-center text-faint">
                  {people.length === 0
                    ? `No entries for ${year} yet.`
                    : "Every row is hidden — show one back from above."}
                </td>
              </tr>
            )}
          </tbody>
          {people.length > 0 && (
            <tfoot data-money>
              <tr className="border-t-2 border-foreground/20 font-semibold">
                <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-xs uppercase tracking-wide">
                  Total
                </td>
                {MONTHS.map((_, i) => {
                  const m = i + 1;
                  const sum = totals[i];
                  return (
                    <td
                      key={m}
                      data-cell={sum ? totalKey(m) : undefined}
                      className={`px-2 py-2 text-right tabular-nums ${isForecastMonth(year, m) ? "bg-surface" : ""}`}
                    >
                      {sum ? formatILS(sum) : ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {explain.card}
      <SelectionBubble
        bubble={sel.bubble}
        copied={sel.copied}
        total={selSummary.total}
        cells={selSummary.cells}
        filled={selSummary.filled}
        formatValue={formatILS}
      />
      {confirmPaid != null && (() => {
        const open = unpaidIn(confirmPaid);
        const total = open.reduce((t, r) => t + r.amount, 0);
        return (
          <ConfirmDialog
            title={`Mark ${MONTH_NAMES[confirmPaid - 1]} ${year} paid?`}
            body={`${open.length} final ${open.length === 1 ? "amount" : "amounts"}, ${formatILS(total)} in all, will be marked Paid. Each can be moved back from its cell's card.`}
            confirmLabel="Mark paid"
            onConfirm={() => {
              setConfirmPaid(null);
              void markMonthPaid(confirmPaid);
            }}
            onCancel={() => setConfirmPaid(null)}
          />
        );
      })()}
      {picked && (
        <CellStateCard
          key={picked.id}
          anchor={`[data-advice~="row:${picked.id}"]`}
          step={stepOf(picked.state, picked.paidAt)}
          canEdit={editable && !monthLocked(locks, year, picked.month, block)}
          why={editable ? "month" : "year"}
          busy={busy === "step"}
          onStep={(v) => void setStep(picked, v)}
        />
      )}

      {editable && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPerson()}
            placeholder={addLabel}
            list={linkPeople ? `${table}-people` : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            name="no-autofill-add-person"
            data-1p-ignore
            data-lpignore="true"
            className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
          {linkPeople && (
            <datalist id={`${table}-people`}>
              {trackerPeople.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          )}
          <button
            onClick={addPerson}
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-background"
          >
            <Plus size={15} />
            Add row
          </button>
        </div>
      )}
      </div>
      <TrendsPanel
        table={table}
        nameColumn={nameColumn}
        amountColumn={amountColumn}
        year={year}
        through={year === CUR_YEAR ? CUR_MONTH : 12}
        current={trendRows}
        what={table === "finance_salaries" ? "salaries" : "freelance payments"}
      />
      </div>
    </div>
  );
}
