"use client";

import { PanelFold } from "@/components/panel-fold";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  LockOpen,
  RefreshCw,
  ExternalLink,
  Clipboard,
  Download,
  Undo2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/finance/supabase-client";
import {
  fetchAll,
  fetchAllOptional,
  mapClientMonthly,
  mapClientRate,
  mapLock,
  mapPnl,
  updatePreservingLock,
  writeStep,
  type ClientMonthlyRow,
  type ClientRateRow,
  type ExpenseRowDb,
  type FreelanceRowDb,
  type IncomeRowDb,
  type LockRow,
  type PnlRow,
  type SalaryRowDb,
} from "@/lib/finance/db";
import { buildFxTable, type FxRow, type FxTable } from "@/lib/finance/fx";
import { TOTAL_COL, cellKey, usePlanExplain, type ExplainData } from "@/components/finance/plan-explain";
import { useTableCrosshair } from "@/lib/finance/table-crosshair";
import { LINE, NON_BILLABLE_CLIENT_CANON, cellStateClass, isForecastMonth, invoicedAtOf, paidAtOf, round2, stateOf, summarizeYear, type ClientMonthly, type ClientRate, type FinanceLock, type FinanceState, type PnlMonthly } from "@/lib/finance/finance";
import { applyLockedGapFix, getTrackerHoursForMonth, getTrackerHoursForYear, type LockedGap } from "@/lib/finance/actions";
import { PNL_UPDATED, refreshPnl, type RollupResult } from "@/lib/finance/auto-rollup";
import {
  MONTHS,
  buildClientRows,
  rateFor,
  rateLabel,
  rateSummary,
  pnlLineByMonth,
  expenseLinesFor,
  monthLocked,
  computeMonthRollup,
  clientMonthRows,
  mainRowOnly,
  isSyncBatchFor,
  SYNC_LABEL,
  type ClientRow,
  type UndoBatch,
} from "@/lib/finance/plan-model";
import { buildMonthlyTrend, buildMonthlyExpenses, buildMonthlyRate, projectMonths } from "@/lib/finance/overview";
import { MonthlyLineChart, DualLineChart, type MonthPoint, type DualPoint } from "@/components/finance/finance-charts";
import { formatILS, formatHours, formatNum, formatPct, isoDate, studioYear } from "@/lib/finance/format";
import { PageHeader, Loading, ErrorState, MismatchTriangle, StateLegend, InfoDot, PaidMark, InvoicedMark, NeedsInvoiceMark } from "@/components/finance/ui";
import { useCellComment } from "@/components/finance/cell-comment";
import { CELL_FOCUS, SEL_CLS, cellKeyProps, type CellSelectionProps } from "@/components/finance/lockable-cell";
import { useCellSelection, selectionSummary, singleCell } from "@/lib/finance/cell-selection";
import { useYearParam } from "@/lib/finance/use-year-param";
import { SelectionBubble } from "@/components/finance/selection-bubble";
import { CellStateCard, PLAN_STEPS, stepOf, type Step } from "@/components/finance/cell-state-card";
import { ReceivablesCard } from "@/components/finance/receivables-card";
import { useClientTerms } from "@/lib/finance/use-client-terms";

/** Most P&L lines are money; a few are a percent or a raw hours count. */
function formatGapValue(lineItem: string, value: number): string {
  if (lineItem === "profit_pct") return formatPct(value);
  if (lineItem === "total_hours") return formatHours(value);
  return formatILS(value);
}

interface ProjectCell {
  id: string;
  /** every income row summed into the cell — what an &advice card can point at */
  ids: string[];
  amount: number;
  state: "predicted" | "actual" | "final";
  comment: string;
  /** the client paid it (reference/0012); paid only when every row of the month is */
  paidAt: string | null;
  /** the invoice went out (reference/0013); likewise every row */
  invoicedAt: string | null;
}
interface ProjectRow {
  description: string;
  cells: Map<number, ProjectCell>;
}

/** Group non-hourly income by project name × month (mirrors the sheet's "Projects" section). */
function buildProjectRows(income: IncomeRowDb[], year: number): ProjectRow[] {
  const byName = new Map<string, ProjectRow>();
  for (const r of income) {
    if (r.date.slice(0, 4) !== String(year)) continue;
    const name = r.description || "Untitled project";
    let row = byName.get(name);
    if (!row) {
      row = { description: name, cells: new Map() };
      byName.set(name, row);
    }
    const month = Number(r.date.slice(5, 7));
    const cur = row.cells.get(month);
    row.cells.set(month, {
      id: cur?.id ?? r.id,
      ids: [...(cur?.ids ?? []), r.id],
      amount: (cur?.amount ?? 0) + Number(r.amount),
      state: r.state,
      comment: r.comment || cur?.comment || "",
      paidAt: cur && !cur.paidAt ? null : (r.paid_at ?? null),
      invoicedAt: cur && !(cur.invoicedAt || cur.paidAt) ? null : (r.invoiced_at ?? r.paid_at ?? null),
    });
  }
  return [...byName.values()].sort((a, b) => a.description.localeCompare(b.description));
}

interface Loaded {
  clientMonthly: ClientMonthly[];
  rates: ClientRate[];
  pnl: PnlMonthly[];
  locks: FinanceLock[];
  income: IncomeRowDb[];
  /** Prior year's pnl + client hours — for the Insights pane's "vs same
   * elapsed months last year" comparisons, not the editable grid itself. */
  priorPnl: PnlMonthly[];
  priorClientMonthly: ClientMonthly[];
  /** The entries behind the expense lines — only for the hover breakdowns. */
  expenses: ExpenseRowDb[];
  salaries: SalaryRowDb[];
  freelance: FreelanceRowDb[];
  fx: FxTable;
  /** reference/0013 is run: the income cells offer Invoiced */
  hasInvoiced: boolean;
}

/** A tracker-hours difference not yet written anywhere — shown inline in the
 * grid as an accept/dismiss chip instead of being written automatically.
 * `existing` is the current finance_client_monthly row (sub_account ""), if
 * one exists — carried so approving/undoing can restore it exactly. */
interface SyncSuggestion {
  clientId: string | null;
  clientCanon: string;
  discipline: string | null;
  month: number;
  newHours: number;
  newRate: number;
  existing: { hours: number; rate: number | null; revenueGross: number; state: FinanceState } | null;
}

const syncKey = (clientCanon: string, month: number) => `${clientCanon}|${month}`;

/** The one definition of "is this the (year, month, client) hours row" —
 * shared by every local-state patch below, so a future field added to the
 * natural key can't be updated in one place and missed in another. */
function matchesClientMonthly(
  r: ClientMonthly,
  year: number,
  month: number,
  clientCanon: string,
): boolean {
  return r.year === year && r.month === month && r.clientCanon === clientCanon && r.subAccount === "";
}

/** Patch one (year, month, client) hours row in local state after a write
 * that already succeeded on the server — avoids the full-page `load()` that
 * flips `loading` and blinks the whole grid for a single-cell edit. `build`
 * gets the existing entry (if any) so a caller can carry forward fields it
 * doesn't itself touch, e.g. `comment` on a lock/predicted toggle. */
function withClientMonthly(
  list: ClientMonthly[],
  year: number,
  month: number,
  clientCanon: string,
  build: (existing: ClientMonthly | undefined) => ClientMonthly,
): ClientMonthly[] {
  const i = list.findIndex((r) => matchesClientMonthly(r, year, month, clientCanon));
  if (i === -1) return [...list, build(undefined)];
  const next = list.slice();
  next[i] = build(next[i]);
  return next;
}

/**
 * The newest not-yet-undone tracker-sync batch of the year on screen. The
 * undo log also holds Rates repricings (client-rate.ts) and other years'
 * syncs, and "Undo last sync" used to take the newest of ANY of them — a
 * Rates change, or last year's sync while looking at this one. Sync batches
 * are told apart by their label (SYNC_LABEL) and each change's `match.year`.
 */
async function lastSyncBatch(y: number): Promise<(UndoBatch & { id: string }) | null> {
  const sb = createClient();
  const { data: rows, error } = await sb
    .from("finance_undo_log")
    .select("id, action_label, changes")
    .eq("table_name", "finance_client_monthly")
    .like("action_label", `${SYNC_LABEL}%`)
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((rows ?? []) as (UndoBatch & { id: string })[]).find((b) => isSyncBatchFor(b, y)) ?? null;
}

export function PlanGrid() {
  const [year, setYear] = useYearParam();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gaps, setGaps] = useState<LockedGap[]>([]);
  const [fixingGap, setFixingGap] = useState<string | null>(null);
  const [showInsights, setShowInsights] = useState(true);
  const [pendingSync, setPendingSync] = useState<SyncSuggestion[]>([]);
  // This month's hours logged in the tracker so far, per client — shown as
  // "(13)" beside the current month's plan hours.
  const [trackedNow, setTrackedNow] = useState<Record<string, number>>({});
  // Read every render, never fixed at module load: a tab left open over New
  // Year kept last year editable and "current" (studioYear's note).
  const CUR_YEAR = studioYear();
  const CUR_MONTH = new Date().getMonth() + 1;
  const loadTrackedNow = useCallback(() => {
    getTrackerHoursForMonth(CUR_YEAR, CUR_MONTH)
      .then(setTrackedNow)
      .catch(() => setTrackedNow({}));
  }, [CUR_YEAR, CUR_MONTH]);
  // Live: refreshed every minute while the page is in view, and on coming back to it.
  useEffect(() => {
    if (year !== CUR_YEAR) return;
    loadTrackedNow();
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") loadTrackedNow();
    }, 60_000);
    const onBack = () => document.visibilityState === "visible" && loadTrackedNow();
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [year, CUR_YEAR, loadTrackedNow]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("plan.showInsights");
      if (raw != null) setShowInsights(raw === "1");
    } catch {
      // ignore — falls back to open
    }
  }, []);
  // Stable, so the memoised insights pane skips the grid's every keystroke and drag.
  const toggleInsights = useCallback(() => {
    setShowInsights((v) => {
      const next = !v;
      try {
        localStorage.setItem("plan.showInsights", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // In-flight cell edits: `${clientCanon}|${month}` → hours string
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  // Same, for project-income cells: `${description}|${month}` → amount string
  const [incomeEdits, setIncomeEdits] = useState<Map<string, string>>(new Map());
  const [newProject, setNewProject] = useState("");
  // Pending project names typed via "Add project" with no amount yet — shown as
  // an empty row so there's somewhere to type the first month's figure into.
  const [localProjects, setLocalProjects] = useState<string[]>([]);

  /**
   * `quiet` = re-read after a write WITHOUT the loading screen. The full one
   * unmounts the grid, so accepting one tracker value threw away the scroll
   * and the place you were working (Nitsan, 2026-11-01). Only a year change,
   * which is different data altogether, should blank the page.
   */
  // Only the newest load may land: switching 2025 → 2026 quickly let the
  // slower 2025 read arrive last and show its rows under "2026".
  const loadSeq = useRef(0);
  const load = useCallback(async (y: number, { quiet = false }: { quiet?: boolean } = {}) => {
    const seq = ++loadSeq.current;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const sb = createClient();
      const [cm, rates, pnl, locks, income, priorPnl, priorCm, expenses, salaries, freelance, fxRows] = await Promise.all([
        // invoiced_at only once reference/0013 is run — until then the Plan loads without Invoiced.
        fetchAllOptional<ClientMonthlyRow>(
          sb,
          "finance_client_monthly",
          "id, year, month, client_id, client_canon, discipline, sub_account, hours, rate, revenue_gross, state, comment, paid_at",
          "invoiced_at",
          (q) => q.eq("year", y),
        ),
        fetchAll<ClientRateRow>(sb, "client_rates", "id, client_id, client_canon, rate, effective_from, effective_to, note"),
        fetchAll<PnlRow>(sb, "finance_pnl_monthly", "*", (q) => q.eq("year", y)),
        fetchAll<LockRow>(sb, "finance_locks", "id, scope_year, scope_month, block, locked_at, note", (q) => q.eq("scope_year", y)),
        fetchAllOptional<IncomeRowDb>(sb, "finance_income", "id, date, client_id, source, amount, description, state, comment, paid_at", "invoiced_at", (q) =>
          q.gte("date", `${y}-01-01`).lte("date", `${y}-12-31`),
        ),
        fetchAll<PnlRow>(sb, "finance_pnl_monthly", "*", (q) => q.eq("year", y - 1)),
        fetchAll<ClientMonthlyRow>(
          sb,
          "finance_client_monthly",
          "id, year, month, client_id, client_canon, discipline, sub_account, hours, rate, revenue_gross, state, comment",
          (q) => q.eq("year", y - 1),
        ),
        // For the hover breakdowns: entries behind each expense line (yearly
        // renewals from up to 3 years back still spread into this year).
        fetchAll<ExpenseRowDb>(
          sb,
          "finance_expenses",
          "id, date, end_date, category, vendor, description, amount_gross, amount_no_vat, currency, vat_included, renew_months, recurrence, link, notes, state",
          (q) => q.gte("date", `${y - 3}-01-01`).lte("date", `${y}-12-31`),
        ),
        fetchAll<SalaryRowDb>(sb, "finance_salaries", "id, profile_id, employee_name, year, month, gross_amount, state, notes", (q) => q.eq("year", y)),
        fetchAll<FreelanceRowDb>(sb, "finance_freelance", "id, person_name, role, year, month, amount, rate_note, state, notes", (q) => q.eq("year", y)),
        fetchAll<FxRow>(sb, "fx_rates", "*").catch(() => [] as FxRow[]),
      ]);
      if (seq !== loadSeq.current) return;
      setData({
        clientMonthly: cm.rows.map(mapClientMonthly),
        rates: rates.map(mapClientRate),
        pnl: pnl.map(mapPnl),
        locks: locks.map(mapLock),
        income: income.rows,
        priorPnl: priorPnl.map(mapPnl),
        priorClientMonthly: priorCm.map(mapClientMonthly),
        expenses,
        salaries,
        freelance,
        fx: buildFxTable(fxRows),
        hasInvoiced: cm.has && income.has,
      });
      setEdits(new Map());
    } catch (e: unknown) {
      if (seq === loadSeq.current) setError(e instanceof Error ? e.message : "Failed to load plan");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year);
  }, [year, load]);

  // The P&L recomputes itself (see auto-rollup): on opening this year, and
  // after edits anywhere. When one lands, take its figures in place — only the
  // P&L rows, so cells being edited aren't disturbed — and show any locked
  // figure that no longer matches its entries.
  useEffect(() => {
    if (year !== CUR_YEAR) return;
    // A recompute that lands after switching to another year must not drop
    // this year's P&L into that year's view (seen with &advice's ?year= link).
    let live = true;
    const take = async (r: RollupResult | null) => {
      if (!r || !live) return;
      setGaps(r.gaps);
      if (!r.monthsWritten) return;
      const pnl = await fetchAll<PnlRow>(createClient(), "finance_pnl_monthly", "*", (q) => q.eq("year", year));
      if (live) setData((d) => d && { ...d, pnl: pnl.map(mapPnl) });
    };
    void refreshPnl().then(take);
    const onUpdated = (e: Event) => void take((e as CustomEvent<RollupResult | null>).detail);
    window.addEventListener(PNL_UPDATED, onUpdated);
    return () => {
      live = false;
      window.removeEventListener(PNL_UPDATED, onUpdated);
    };
  }, [year, CUR_YEAR]);

  const clientRows = useMemo(
    () => (data ? buildClientRows(data.clientMonthly, year) : []),
    [data, year],
  );
  const priorClientRows = useMemo(
    () => (data ? buildClientRows(data.priorClientMonthly, year - 1) : []),
    [data, year],
  );
  // A pending sync suggestion for a client with NO existing row yet needs
  // somewhere to render its chip — append a placeholder row (no committed
  // cells) for exactly those clients, purely for display. It disappears once
  // load() refetches after the suggestion is approved or dismissed.
  const displayRows = useMemo(() => {
    if (pendingSync.length === 0) return clientRows;
    const known = new Set(clientRows.map((r) => r.clientCanon));
    const extra: ClientRow[] = [];
    for (const s of pendingSync) {
      if (known.has(s.clientCanon) || extra.some((r) => r.clientCanon === s.clientCanon)) continue;
      extra.push({ clientCanon: s.clientCanon, clientId: s.clientId, discipline: s.discipline, cells: new Map() });
    }
    return extra.length > 0 ? [...clientRows, ...extra] : clientRows;
  }, [clientRows, pendingSync]);

  const projectRows = useMemo(() => {
    const rows = data ? buildProjectRows(data.income, year) : [];
    const present = new Set(rows.map((r) => r.description));
    for (const name of localProjects) {
      if (!present.has(name)) rows.push({ description: name, cells: new Map() });
    }
    return rows;
  }, [data, year, localProjects]);

  // Whether each month's revenue is locked depends only on the month, not on
  // which client/project row is rendering — computed once here rather than
  // rescanned by every HoursCell/IncomeCell in every row.
  const revenueLockedByMonth = useMemo(
    () => (data ? MONTHS.map((_, i) => monthLocked(data.locks, year, i + 1, "revenue")) : []),
    [data, year],
  );

  // Current/future months get a lighter background so they read as "still
  // open" against the settled, past-month columns.
  const futureColClass = (month: number) => (isForecastMonth(year, month) ? "bg-surface" : "");

  // Height for the grid's own scroll box: the rest of the window below it, so
  // with the page at the top the grid fills the screen and its header sticks.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [gridMaxH, setGridMaxH] = useState<number | undefined>(undefined);
  useEffect(() => {
    const measure = () => {
      const el = gridScrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setGridMaxH(Math.max(400, window.innerHeight - top - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [gaps.length, note, loading]);

  // This year opens scrolled to the current month (once per visit), its
  // column just right of the pinned client names.
  const scrolledTo = useRef<number | null>(null);
  useEffect(() => {
    if (loading || year !== CUR_YEAR || scrolledTo.current === year) return;
    const box = gridScrollRef.current;
    const th = box?.querySelector<HTMLElement>(`th[data-month="${new Date().getMonth() + 1}"]`);
    const pinned = box?.querySelector<HTMLElement>("thead th");
    if (!box || !th) return;
    // Measured against the scroll box itself (not offsetLeft, which a sticky
    // header cell takes from the page), leaving the month just right of the names.
    box.scrollLeft += th.getBoundingClientRect().left - box.getBoundingClientRect().left - (pinned?.offsetWidth ?? 0);
    scrolledTo.current = year;
  }, [loading, year, CUR_YEAR]);

  // Column MONTHS.length (12) is the row-total column, sitting right after
  // the 12 month columns — selectable and summable like any other cell.
  const hoursValueAt = (r: number, c: number) => {
    const row = clientRows[r];
    if (!row) return null;
    if (c === MONTHS.length) {
      let sum = 0;
      for (let m = 1; m <= MONTHS.length; m++) sum += row.cells.get(m)?.hours ?? 0;
      return sum;
    }
    return row.cells.get(c + 1)?.hours ?? null;
  };
  const hoursSel = useCellSelection(
    `hours|${year}|${clientRows.map((r) => r.clientCanon).join(",")}`,
    hoursValueAt,
  );
  const hoursSummary = useMemo(
    () => selectionSummary(hoursSel.live, hoursValueAt),
    [hoursSel.live, clientRows],
  );

  const incomeValueAt = (r: number, c: number) => {
    const row = projectRows[r];
    if (!row) return null;
    if (c === MONTHS.length) {
      let sum = 0;
      for (let m = 1; m <= MONTHS.length; m++) sum += row.cells.get(m)?.amount ?? 0;
      return sum;
    }
    return row.cells.get(c + 1)?.amount ?? null;
  };
  const incomeSel = useCellSelection(
    `income|${year}|${projectRows.map((r) => r.description).join(",")}`,
    incomeValueAt,
  );
  const incomeSummary = useMemo(
    () => selectionSummary(incomeSel.live, incomeValueAt),
    [incomeSel.live, projectRows],
  );

  const incomeByMonth = useMemo(() => {
    const m = new Map<number, number>();
    if (data) {
      for (const r of data.income) {
        const month = Number(r.date.slice(5, 7));
        m.set(month, (m.get(month) ?? 0) + Number(r.amount));
      }
    }
    return m;
  }, [data]);

  // Read-only sections (Expenses, Rollup) get their own selection scope so a
  // drag there sums those rows' own values, same as the editable grids above.
  const expenseLines = useMemo(() => (data ? expenseLinesFor(data.pnl, year) : []), [data, year]);
  const expenseGrid = useMemo(() => {
    if (!data) return [];
    return expenseLines.map((line) => {
      const byMonth = pnlLineByMonth(data.pnl, year, line.key);
      const monthVals = MONTHS.map((_, i) => byMonth.get(i + 1) ?? 0);
      return [...monthVals, monthVals.reduce((s, v) => s + v, 0)];
    });
  }, [data, year, expenseLines]);
  const expensesValueAt = (r: number, c: number) => expenseGrid[r]?.[c] ?? null;
  const expensesSel = useCellSelection(`expenses|${year}`, expensesValueAt);
  const expensesSummary = useMemo(
    () => selectionSummary(expensesSel.live, expensesValueAt),
    [expensesSel.live, expenseGrid],
  );

  const rollupAll = useMemo(
    () => (data ? buildRollupRows(clientRows, data.rates, incomeByMonth, data.pnl, year) : []),
    [data, clientRows, incomeByMonth, year],
  );
  // The rollup's "Total hours" (billable-only, Studio already excluded) closes
  // out the Hours rows — one computation, never two numbers that could drift
  // apart. It no longer repeats at the bottom (Nitsan, 2026-11-02).
  const totalHoursRow = rollupAll.find((r) => r.label === "Total hours");
  // Total income · Total expenses · Profit · Profit % — in that order, which
  // the multi-select indexes by (ROLLUP).
  const rollupRows = useMemo(() => rollupAll.filter((r) => r.label !== "Total hours"), [rollupAll]);

  // Income and Expenses fold to their summary line (Nitsan, 2026-11-02) — a
  // per-viewer preference, so it lives in this browser only.
  const [fold, setFold] = useState<{ income: boolean; expenses: boolean }>({ income: false, expenses: false });
  useEffect(() => {
    try {
      const raw = localStorage.getItem("plan.fold");
      if (raw) setFold({ income: false, expenses: false, ...JSON.parse(raw) });
    } catch {
      // ignore — both parts open
    }
  }, []);
  const toggleFold = (part: "income" | "expenses") =>
    setFold((f) => {
      const next = { ...f, [part]: !f[part] };
      try {
        localStorage.setItem("plan.fold", JSON.stringify(next));
      } catch {
        // ignore — the fold just won't survive a reload
      }
      return next;
    });

  // payment terms + invoice day per client: the receivables card and the hover cards
  const clientTerms = useClientTerms();
  const explainData = useMemo<ExplainData | null>(
    () =>
      data
        ? {
            year,
            clientRows,
            priorClientRows,
            rates: data.rates,
            projectRows,
            incomeByMonth,
            pnl: data.pnl,
            priorPnl: data.priorPnl,
            expenses: data.expenses,
            salaries: data.salaries,
            freelance: data.freelance,
            fx: data.fx,
            tracked: year === CUR_YEAR ? { month: CUR_MONTH, byClient: trackedNow } : undefined,
            terms: clientTerms,
            today: isoDate(new Date()),
          }
        : null,
    [data, year, clientRows, priorClientRows, projectRows, incomeByMonth, trackedNow, CUR_YEAR, CUR_MONTH, clientTerms],
  );
  const explain = usePlanExplain(explainData);
  const crosshair = useTableCrosshair();
  const rollupValueAt = (r: number, c: number) => rollupRows[r]?.raw[c] ?? null;
  const rollupSel = useCellSelection(`rollup|${year}`, rollupValueAt);
  // Profit % (row 3) holds ratios: summed into shekels and shown as a whole
  // number, a selection of them read "0". A selection of Profit % cells alone
  // reads as percentages (sum and average, as a spreadsheet would); mixed in
  // with money rows, the ratios are left out of the sum. Its Total cell is empty.
  const PROFIT_PCT_ROW = 3;
  const rollupPctOnly = rollupSel.live.length > 0 && rollupSel.live.every((b) => b.r0 === PROFIT_PCT_ROW && b.r1 === PROFIT_PCT_ROW);
  const rollupSummary = useMemo(
    () =>
      selectionSummary(rollupSel.live, (r, c) =>
        r === PROFIT_PCT_ROW && (!rollupPctOnly || c === MONTHS.length) ? null : rollupValueAt(r, c),
      ),
    [rollupSel.live, rollupRows, rollupPctOnly],
  );

  const editable = year >= CUR_YEAR;

  async function commitCell(row: ClientRow, month: number, raw: string) {
    if (!data) return;
    const key = `${row.clientCanon}|${month}`;
    const parsed = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isFinite(parsed)) {
      setEdits((m) => {
        const n = new Map(m);
        n.delete(key);
        return n;
      });
      return;
    }
    // A month held in sub-account rows (Mobileye Corporate + HR) isn't typed
    // into: this upsert writes the main ("") row, which would land BESIDE them
    // and count the month's hours twice. The cell is read-only; paste lands here too.
    if (!mainRowOnly(clientMonthRows(data.clientMonthly, year, month, row.clientCanon))) {
      setEdits((m) => {
        const n = new Map(m);
        n.delete(key);
        return n;
      });
      setNote(`${row.clientCanon} · ${MONTHS[month - 1]} is held in sub-account rows, each at its own rate — it isn't typed into here.`);
      return;
    }
    const rate = rateFor(data.rates, row.clientCanon, year, month) ?? 0;
    // Editing the hours must never silently flip the state — predicted/final
    // can carry meaning beyond "has this happened yet" (e.g. "is this
    // invoice paid"), set deliberately via the lock/predicted toggle. Only a
    // brand-new row gets a default from isForecastMonth.
    const existingState = row.cells.get(month)?.state;
    const state = existingState ?? (isForecastMonth(year, month) ? "predicted" : "actual");
    const sb = createClient();
    const { error: e } = await sb.from("finance_client_monthly").upsert(
      {
        year,
        month,
        client_id: row.clientId,
        client_canon: row.clientCanon,
        discipline: row.discipline,
        sub_account: "",
        hours: parsed,
        rate,
        revenue_gross: parsed * rate,
        state,
      },
      { onConflict: "year,month,client_canon,sub_account" },
    );
    if (e) {
      setNote(`Save failed: ${e.message}`);
      return;
    }
    setEdits((m) => {
      const n = new Map(m);
      n.delete(key);
      return n;
    });
    setData((d) =>
      d && {
        ...d,
        clientMonthly: withClientMonthly(d.clientMonthly, year, month, row.clientCanon, (ex) => ({
          year,
          month,
          clientId: row.clientId,
          clientCanon: row.clientCanon,
          discipline: row.discipline,
          subAccount: "",
          hours: parsed,
          rate,
          revenueGross: parsed * rate,
          state,
          comment: ex?.comment ?? "",
        })),
      },
    );
  }

  async function commitIncomeCell(row: ProjectRow, month: number, raw: string) {
    if (!data) return;
    const key = `${row.description}|${month}`;
    const parsed = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isFinite(parsed)) {
      setIncomeEdits((m) => {
        const n = new Map(m);
        n.delete(key);
        return n;
      });
      return;
    }
    // Defense in depth: the UI already renders this cell read-only once the
    // month is locked, but a brand-new row (no existing 'final' cell) has
    // nothing for the guard trigger to refuse on an INSERT — so a locked
    // month must also be checked here.
    if (monthLocked(data.locks, year, month, "revenue")) {
      setNote(`${MONTHS[month - 1]} ${year} revenue is locked — unlock it first.`);
      return;
    }
    const sb = createClient();
    const existing = row.cells.get(month);
    // A month made of several income rows (3,000 + 5,000) can't take one typed
    // figure: it went onto the first row only, so typing 5,000 booked 10,000.
    // The cell is read-only (IncomeCell `readOnlyWhy`); this is the backstop.
    if (existing && existing.ids.length > 1) {
      setIncomeEdits((m) => {
        const n = new Map(m);
        n.delete(key);
        return n;
      });
      setNote(`${row.description} · ${MONTHS[month - 1]} is made of ${existing.ids.length} income rows — it isn't typed into here.`);
      return;
    }
    // Editing the amount must never silently flip the state — a cell's
    // predicted/final flag can mean things beyond "has this happened yet"
    // (e.g. "is this invoice paid"), set deliberately via the lock/predicted
    // toggle. Only a brand-new row gets a default from isForecastMonth.
    const state = existing ? existing.state : isForecastMonth(year, month) ? "predicted" : "actual";
    if (existing) {
      const { error: e } = await sb.from("finance_income").update({ amount: parsed, state }).eq("id", existing.id);
      if (e) {
        setNote(`Save failed: ${e.message}`);
        return;
      }
      setData(
        (d) =>
          d && {
            ...d,
            income: d.income.map((r) => (r.id === existing.id ? { ...r, amount: parsed, state } : r)),
          },
      );
    } else {
      const { data: inserted, error: e } = await sb
        .from("finance_income")
        .insert({
          date: `${year}-${String(month).padStart(2, "0")}-15`,
          description: row.description,
          source: "fixed_project",
          amount: parsed,
          state,
        })
        .select()
        .single();
      if (e) {
        setNote(`Save failed: ${e.message}`);
        return;
      }
      setData((d) => d && { ...d, income: [...d.income, inserted as IncomeRowDb] });
    }
    setIncomeEdits((m) => {
      const n = new Map(m);
      n.delete(key);
      return n;
    });
  }

  /** Write one step to every row of a cell at once (rows are distinct, so in
   * parallel); the first error, if any, goes to the note. True when all landed.
   * On a failure the others may have landed — the screen re-reads, or it would
   * keep showing every row on its old step. */
  async function writeRows(writes: Promise<{ message: string } | null>[]): Promise<boolean> {
    setBusy("step");
    const err = (await Promise.all(writes)).find(Boolean);
    if (err) {
      setNote(`Update failed: ${err.message}`);
      await load(year, { quiet: true });
    }
    setBusy(null);
    return !err;
  }

  /** An hours cell's step, from the card above it — every sub-account row of the
   * client's month moves together. Locking the main row books its revenue at
   * today's rate, as the old lock icon did — so hours with no rate aren't
   * locked: they'd be booked at ₪0, and a rate added later leaves final rows alone. */
  async function setHoursStep(row: ClientRow, month: number, step: Step) {
    if (!data) return;
    const rows = data.clientMonthly.filter((r) => r.year === year && r.month === month && r.clientCanon === row.clientCanon);
    const state = stateOf(step);
    const paidAt = paidAtOf(step);
    // One invoiced date for the cell: the one it had, else now (finance.ts invoicedAtOf).
    const invoicedAt = invoicedAtOf(step, rows.find((r) => r.invoicedAt)?.invoicedAt ?? null);
    const inv = data.hasInvoiced ? { invoiced_at: invoicedAt } : {};
    const known = rateFor(data.rates, row.clientCanon, year, month);
    const rate = known ?? 0;
    const locks = (r: ClientMonthly) => state === "final" && r.state !== "final" && r.subAccount === "";
    if (known == null && rows.some((r) => locks(r) && r.hours > 0)) {
      setNote(`${row.clientCanon} has no rate for ${MONTHS[month - 1]} ${year} — add it on Rates first, or these hours would be locked at ₪0.`);
      return;
    }
    const sb = createClient();
    const ok = await writeRows(
      rows.map((r) =>
        writeStep(sb, "finance_client_monthly", { year, month, client_canon: row.clientCanon, sub_account: r.subAccount }, r.state, step, paidAt, { ...inv, ...(locks(r) ? { rate, revenue_gross: round2(r.hours * rate) } : {}) }),
      ),
    );
    if (!ok) return;
    const moved = new Set(rows);
    setData(
      (d) =>
        d && {
          ...d,
          clientMonthly: d.clientMonthly.map((r) =>
            moved.has(r) ? { ...r, state, paidAt, ...(data.hasInvoiced ? { invoicedAt } : {}), ...(locks(r) ? { rate, revenueGross: round2(r.hours * rate) } : {}) } : r,
          ),
        },
    );
  }

  /** A project-income cell's step — every income row of that project's month moves together. */
  async function setIncomeStep(row: ProjectRow, month: number, step: Step) {
    if (!data) return;
    const ids = new Set(row.cells.get(month)?.ids ?? []);
    const rows = data.income.filter((r) => ids.has(r.id));
    const state = stateOf(step);
    const paidAt = paidAtOf(step);
    const invoicedAt = invoicedAtOf(step, rows.find((r) => r.invoiced_at)?.invoiced_at ?? null);
    const inv = data.hasInvoiced ? { invoiced_at: invoicedAt } : {};
    const sb = createClient();
    if (!(await writeRows(rows.map((r) => writeStep(sb, "finance_income", r.id, r.state, step, paidAt, inv))))) return;
    setData((d) => d && { ...d, income: d.income.map((r) => (ids.has(r.id) ? { ...r, state, paid_at: paidAt, ...inv } : r)) });
  }

  /** The one selected hours or income cell (a month, not the total) — what the step card acts on. */
  const pickedHours = useMemo(() => {
    const one = singleCell(hoursSel.live);
    if (!one || one.c >= MONTHS.length || !data) return null;
    const row = clientRows[one.r];
    const cell = row?.cells.get(one.c + 1);
    if (!row || !cell) return null;
    // Sub-accounts of one month can differ (Mobileye Corporate final, HR
    // draft): the card shows the earliest step among them, so choosing a
    // later one moves every row — never a no-op on the merged cell's state.
    const order: FinanceState[] = ["actual", "predicted", "final"];
    const subs = data.clientMonthly.filter((r) => r.year === year && r.month === one.c + 1 && r.clientCanon === row.clientCanon);
    const state = subs.reduce<FinanceState>((lo, r) => (order.indexOf(r.state) < order.indexOf(lo) ? r.state : lo), "final");
    return {
      row,
      month: one.c + 1,
      state,
      paidAt: subs.every((r) => r.paidAt) ? (cell.paidAt ?? null) : null,
      invoicedAt: subs.every((r) => r.invoicedAt || r.paidAt) ? (cell.invoicedAt ?? null) : null,
    };
  }, [hoursSel.live, clientRows, data, year]);
  const pickedIncome = useMemo(() => {
    const one = singleCell(incomeSel.live);
    if (!one || one.c >= MONTHS.length || !data) return null;
    const row = projectRows[one.r];
    const cell = row?.cells.get(one.c + 1);
    if (!row || !cell) return null;
    // A project's month can hold several income rows: the earliest step among
    // them, as for an hours cell's sub-accounts above.
    const order: FinanceState[] = ["actual", "predicted", "final"];
    const ids = new Set(cell.ids);
    const state = data.income.filter((r) => ids.has(r.id)).reduce<FinanceState>((lo, r) => (order.indexOf(r.state) < order.indexOf(lo) ? r.state : lo), "final");
    return { row, month: one.c + 1, state, paidAt: state === "final" ? cell.paidAt : null, invoicedAt: state === "final" ? cell.invoicedAt : null };
  }, [incomeSel.live, projectRows, data]);

  /** Right-click comment — writes the comment and nothing else, onto every row
   * the cell is made of (its main row and any sub-account rows). It used to
   * upsert the main row with the cell's summed hours and TODAY's rate, which
   * re-booked a closed final month (₪0 with no rate) and, on a sub-account
   * month, inserted a main row holding the total — the hours counted twice.
   * updatePreservingLock gets a comment past the final→final guard. */
  async function saveHoursComment(row: ClientRow, month: number, text: string) {
    if (!data) return;
    const rows = clientMonthRows(data.clientMonthly, year, month, row.clientCanon);
    if (!rows.length) return; // a comment never creates a row
    const sb = createClient();
    const err = (
      await Promise.all(
        rows.map((r) =>
          updatePreservingLock(sb, "finance_client_monthly", { year, month, client_canon: row.clientCanon, sub_account: r.subAccount }, { comment: text }, r.state),
        ),
      )
    ).find(Boolean);
    if (err) {
      setNote(`Comment save failed: ${err.message}`);
      // Some rows may have taken it (or a re-lock failed): show what the DB holds.
      await load(year, { quiet: true });
      return;
    }
    const written = new Set(rows);
    setData((d) => d && { ...d, clientMonthly: d.clientMonthly.map((r) => (written.has(r) ? { ...r, comment: text } : r)) });
  }

  async function saveIncomeComment(row: ProjectRow, month: number, text: string) {
    const cell = row.cells.get(month);
    if (!cell) return;
    const sb = createClient();
    const err = await updatePreservingLock(sb, "finance_income", cell.id, { comment: text }, cell.state);
    if (err) {
      setNote(`Comment save failed: ${err.message}`);
      return;
    }
    setData(
      (d) => d && { ...d, income: d.income.map((r) => (r.id === cell.id ? { ...r, comment: text } : r)) },
    );
  }

  function addProject() {
    const name = newProject.trim();
    if (!name || projectRows.some((r) => r.description === name)) return;
    setLocalProjects((p) => [...p, name]);
    setNewProject("");
  }

  async function finalizeMonth(month: number) {
    if (!data) return;
    setBusy(`lock-${month}`);
    setNote(null);
    try {
      const sb = createClient();
      const lastDay = new Date(year, month, 0).getDate();
      const from = `${year}-${String(month).padStart(2, "0")}-01`;
      const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const stepCols = data?.hasInvoiced ? "id, state, paid_at, invoiced_at" : "id, state, paid_at";
      type Prior = { id: string; state: FinanceState; paid_at: string | null; invoiced_at?: string | null };
      // ⚠️ What each row was, read FIRST (2026-11-10): the rows are flipped to
      // final before the lock is written, and when the lock insert failed they
      // stayed final in an unlocked month while the screen still showed drafts.
      // Now a failure puts every flipped row back as it was.
      const [cmBefore, incBefore] = await Promise.all([
        fetchAll<Prior>(sb, "finance_client_monthly", stepCols, (q) => q.eq("year", year).eq("month", month).neq("state", "final")),
        fetchAll<Prior>(sb, "finance_income", stepCols, (q) => q.gte("date", from).lte("date", to).neq("state", "final")),
      ]);
      const flipped: { table: string; rows: Prior[] }[] = [];
      const putBack = async () => {
        const errs: string[] = [];
        for (const { table, rows } of flipped) {
          for (const r of rows) {
            const { error } = await sb
              .from(table)
              .update({ state: r.state, paid_at: r.paid_at, ...(data?.hasInvoiced ? { invoiced_at: r.invoiced_at ?? null } : {}) })
              .eq("id", r.id);
            if (error) errs.push(error.message);
          }
        }
        return errs;
      };
      try {
        // Flip revenue-block rows to final, then write the lock. Rows already
        // final are excluded — the guard trigger blocks a no-op final→final
        // update, which would otherwise abort the whole batch. They become
        // final, never paid: a stray paid_at (a final → paid click whose
        // re-lock failed) is cleared.
        const finalize = { state: "final", paid_at: null, ...(data?.hasInvoiced ? { invoiced_at: null } : {}) };
        if (cmBefore.length) {
          const { error: e1 } = await sb.from("finance_client_monthly").update(finalize).in("id", cmBefore.map((r) => r.id));
          if (e1) throw new Error(e1.message);
          flipped.push({ table: "finance_client_monthly", rows: cmBefore });
        }
        if (incBefore.length) {
          const { error: e2 } = await sb.from("finance_income").update(finalize).in("id", incBefore.map((r) => r.id));
          if (e2) throw new Error(e2.message);
          flipped.push({ table: "finance_income", rows: incBefore });
        }
        const { error: e } = await sb.from("finance_locks").insert({
          scope_year: year,
          scope_month: month,
          block: "revenue",
        });
        if (e && !e.message.includes("duplicate")) throw new Error(e.message);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Finalize failed";
        const errs = await putBack();
        throw new Error(
          errs.length
            ? `${msg} — and ${errs.length} row(s) couldn't be put back, so some of ${MONTHS[month - 1]} is final without a lock.`
            : `${msg} Nothing was changed.`,
        );
      }
      setNote(`${MONTHS[month - 1]} ${year} revenue finalized.`);
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "Finalize failed");
    } finally {
      // Whatever happened, show what the database now holds.
      await load(year, { quiet: true });
      setBusy(null);
    }
  }

  async function unlockMonth(month: number) {
    if (!data) return;
    setBusy(`lock-${month}`);
    setNote(null);
    try {
      const sb = createClient();
      const lastDay = new Date(year, month, 0).getDate();
      // Delete the lock FIRST (the DB trigger blocks editing final rows otherwise).
      // Its error was ignored: a refused delete still reopened the rows and
      // said "reopened" while the month stayed locked.
      const { error: e0 } = await sb
        .from("finance_locks")
        .delete()
        .eq("scope_year", year)
        .eq("scope_month", month)
        .eq("block", "revenue");
      if (e0) throw new Error(e0.message);
      const { error: e1 } = await sb
        .from("finance_client_monthly")
        // Back to draft clears paid (paid comes after final), so re-locking doesn't quietly mark rows paid.
        .update({ state: "actual", paid_at: null, ...(data?.hasInvoiced ? { invoiced_at: null } : {}) })
        .eq("year", year)
        .eq("month", month)
        .eq("state", "final");
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await sb
        .from("finance_income")
        .update({ state: "actual", paid_at: null, ...(data?.hasInvoiced ? { invoiced_at: null } : {}) })
        .gte("date", `${year}-${String(month).padStart(2, "0")}-01`)
        .lte("date", `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`)
        .eq("state", "final");
      if (e2) throw new Error(e2.message);
      setNote(`${MONTHS[month - 1]} ${year} reopened.`);
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      // Also after a failure: the lock may be gone with the rows still final,
      // and the screen should show that, not the month as it was.
      await load(year, { quiet: true });
      setBusy(null);
    }
  }

  async function refreshUndoAvailable(y: number) {
    try {
      setCanUndo(!!(await lastSyncBatch(y)));
    } catch {
      // best-effort — an undo button that fails to appear isn't worth surfacing an error for
    }
  }

  useEffect(() => {
    void refreshUndoAvailable(year);
  }, [year]);

  /** Compute suggestions only — nothing is written. Diffs live tracker hours
   * against the current finance_client_monthly row (sub_account "") for each
   * client/month, skipping anything already matching and anything locked. */
  async function previewSync() {
    setBusy("sync");
    setNote(null);
    setPendingSync([]);
    try {
      const hours = await getTrackerHoursForYear(year);
      if (year === CUR_YEAR) loadTrackedNow();
      const suggestions: SyncSuggestion[] = [];
      // Months held in sub-account rows whose total differs from the tracker.
      let held = 0;
      for (const h of hours) {
        // A locked month is still worth flagging — nothing here writes
        // anything on its own, so there's no reason to hide a mismatch just
        // because the month (or the cell) is locked. You decide per cell.
        const newHours = round2(h.hours);
        const newRate = rateFor(data?.rates ?? [], h.clientCanon, year, h.month) ?? 0;
        const rows = clientMonthRows(data?.clientMonthly ?? [], year, h.month, h.clientCanon);
        // A month held in sub-account rows (Mobileye Corporate + HR) was
        // compared with its main row only — none — so it showed "—→N", and
        // approving it added a main row beside them: the hours counted twice.
        // Not offered; those rows are kept by hand, at their own rates.
        if (!mainRowOnly(rows)) {
          if (Math.abs(rows.reduce((s, r) => s + r.hours, 0) - newHours) >= 0.005) held++;
          continue;
        }
        const existingRow = rows[0];
        if (existingRow && Math.abs(existingRow.hours - newHours) < 0.005) continue; // already matches
        suggestions.push({
          clientId: h.clientId,
          clientCanon: h.clientCanon,
          discipline: existingRow?.discipline ?? null,
          month: h.month,
          newHours,
          newRate,
          existing: existingRow
            ? { hours: existingRow.hours, rate: existingRow.rate, revenueGross: existingRow.revenueGross, state: existingRow.state }
            : null,
        });
      }
      const heldNote = held
        ? ` ${held} month${held === 1 ? " is" : "s are"} held in sub-account rows and differ${held === 1 ? "s" : ""} from the tracker — not offered, as each sub-account bills at its own rate.`
        : "";
      if (suggestions.length === 0) {
        setNote(`Tracker hours already match — nothing to sync.${heldNote}`);
      } else {
        setPendingSync(suggestions.sort((a, b) => a.month - b.month || a.clientCanon.localeCompare(b.clientCanon)));
        if (heldNote) setNote(heldNote.trim());
      }
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "Sync preview failed");
    } finally {
      setBusy(null);
    }
  }

  /** Write the given (already-approved) suggestions and log an undoable
   * batch capturing the exact before/after row for each. */
  async function approveSync(items: SyncSuggestion[]) {
    if (items.length === 0 || !data) return;
    setBusy("sync");
    setNote(null);
    // It was one upsert for everything: a single suggestion on a final cell
    // (its state kept → a final→final write the guard refuses) failed the
    // whole batch, and a month with no row went in as a new row inside a
    // LOCKED month. Those now stay pending — move the cell back from final or
    // reopen the month, then approve; or dismiss — and the rest are written
    // row by row. A month that has gained sub-account rows since the preview
    // is held back too (see previewSync).
    const blocked = new Set(
      items.filter(
        (s) =>
          s.existing?.state === "final" ||
          monthLocked(data.locks, year, s.month, "revenue") ||
          !mainRowOnly(clientMonthRows(data.clientMonthly, year, s.month, s.clientCanon)),
      ),
    );
    const ready = items.filter((s) => !blocked.has(s));
    try {
      const sb = createClient();
      const results = await Promise.all(
        ready.map(async (s) => {
          // Accepting a tracker-suggested hours number must not silently
          // change what the cell's own state means (e.g. final/"paid",
          // predicted/"not yet paid") — preserve it. Only a brand-new row
          // (nothing existing to preserve) gets a default from isForecastMonth.
          const state = s.existing?.state ?? (isForecastMonth(year, s.month) ? "predicted" : "actual");
          const match = { year, month: s.month, client_canon: s.clientCanon, sub_account: "" };
          const values = { hours: s.newHours, rate: s.newRate, revenue_gross: round2(s.newHours * s.newRate) };
          const after = { ...match, client_id: s.clientId, discipline: s.discipline, ...values, state };
          const before = s.existing && {
            ...match,
            client_id: s.clientId,
            discipline: s.discipline,
            hours: s.existing.hours,
            rate: s.existing.rate,
            revenue_gross: s.existing.revenueGross,
            state: s.existing.state,
          };
          // An existing row takes the new figures only; a missing one is
          // inserted (never upserted over a row that appeared since the preview).
          const err = s.existing
            ? await updatePreservingLock(sb, "finance_client_monthly", match, values, s.existing.state)
            : await sb
                .from("finance_client_monthly")
                .insert(after)
                .then(({ error }) => (error ? { message: error.message } : null));
          return { s, err, change: { match, before: before ?? null, after } };
        }),
      );
      const done = results.filter((r) => !r.err);
      const failed = results.filter((r) => r.err);
      const doneKeys = new Set(done.map((r) => syncKey(r.s.clientCanon, r.s.month)));
      setPendingSync((prev) => prev.filter((s) => !doneKeys.has(syncKey(s.clientCanon, s.month))));
      if (done.length) {
        const { error: e2 } = await sb.from("finance_undo_log").insert({
          action_label: `${SYNC_LABEL}${done.length} client-month${done.length === 1 ? "" : "s"} from the tracker`,
          table_name: "finance_client_monthly",
          changes: done.map((r) => r.change),
        });
        if (e2) throw new Error(`Applied ${done.length} tracker update${done.length === 1 ? "" : "s"}, but they can't be undone: ${e2.message}`);
      }
      setNote(
        [
          `Applied ${done.length} tracker update${done.length === 1 ? "" : "s"}.`,
          blocked.size
            ? `${blocked.size} skipped and left pending — on a final cell or in a locked month (or now held in sub-account rows); reopen it to apply, or dismiss.`
            : "",
          failed.length ? `${failed.length} failed: ${failed[0].err!.message}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "Sync apply failed");
    } finally {
      // Always re-read: whatever landed (all, some or none) is what the grid shows.
      await load(year, { quiet: true });
      await refreshUndoAvailable(year);
      setBusy(null);
    }
  }

  function dismissSync(items: SyncSuggestion[]) {
    const dismissedKeys = new Set(items.map((s) => syncKey(s.clientCanon, s.month)));
    setPendingSync((prev) => prev.filter((s) => !dismissedKeys.has(syncKey(s.clientCanon, s.month))));
  }

  /** Revert the most recent not-yet-undone tracker-sync batch OF THIS YEAR —
   * scoped to writes made through the sync-approval flow above (never a Rates
   * repricing, never another year's sync), not a general-purpose undo. */
  async function undoLastSync() {
    setBusy("undo");
    setNote(null);
    try {
      const sb = createClient();
      const batch = await lastSyncBatch(year);
      if (!batch) {
        setNote("Nothing to undo.");
        return;
      }
      const changes = batch.changes as Array<{
        match: { year: number; month: number; client_canon: string; sub_account: string };
        before: Record<string, unknown> | null;
        after: { hours: number; rate: number | null; revenue_gross: number; state: FinanceState };
      }>;
      // Revert only rows still as the sync left them. Now that a Rates
      // repricing can sit newer than the sync, putting `before` back blindly
      // would undo the repricing too — and a row finalized since would be
      // quietly reopened. Those rows (and locked months) are left as they are.
      const names = [...new Set(changes.map((c) => c.match.client_canon))];
      const current = await fetchAll<ClientMonthlyRow>(
        sb,
        "finance_client_monthly",
        "id, year, month, client_id, client_canon, discipline, sub_account, hours, rate, revenue_gross, state, comment",
        (q) => q.eq("year", year).in("client_canon", names),
      );
      const asSynced = (c: (typeof changes)[number]) => {
        if (monthLocked(data?.locks ?? [], year, c.match.month, "revenue")) return false;
        const r = current.find((x) => x.month === c.match.month && x.client_canon === c.match.client_canon && (x.sub_account ?? "") === c.match.sub_account);
        if (!r) return false;
        const rate = r.rate == null ? null : Number(r.rate);
        return (
          r.state === c.after.state &&
          Math.abs(Number(r.hours) - c.after.hours) < 0.005 &&
          Math.abs(Number(r.revenue_gross) - c.after.revenue_gross) < 0.005 &&
          (rate == null || c.after.rate == null ? rate === c.after.rate : Math.abs(rate - c.after.rate) < 0.005)
        );
      };
      const revert = changes.filter(asSynced);
      const left = changes.length - revert.length;
      for (const c of revert) {
        if (c.before) {
          const { error } = await sb
            .from("finance_client_monthly")
            .upsert(c.before, { onConflict: "year,month,client_canon,sub_account" });
          if (error) throw new Error(error.message);
        } else {
          const { error } = await sb
            .from("finance_client_monthly")
            .delete()
            .match(c.match);
          if (error) throw new Error(error.message);
        }
      }
      const { error: e2 } = await sb
        .from("finance_undo_log")
        .update({ undone_at: new Date().toISOString() })
        .eq("id", batch.id);
      if (e2) throw new Error(e2.message);
      const who = [...new Set(revert.map((c) => c.match.client_canon))];
      setNote(
        `Reverted: ${batch.action_label}${who.length ? ` — ${who.slice(0, 4).join(", ")}${who.length > 4 ? ` +${who.length - 4} more` : ""}` : ""}.${
          left ? ` ${left} row${left === 1 ? " was" : "s were"} changed since (repriced, retyped, finalized or locked) and left as ${left === 1 ? "it is" : "they are"}.` : ""
        }`,
      );
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "Undo failed");
    } finally {
      await load(year, { quiet: true });
      await refreshUndoAvailable(year);
      setBusy(null);
    }
  }


  async function applyGap(gap: LockedGap) {
    const key = `${gap.month}|${gap.lineItem}`;
    setFixingGap(key);
    try {
      await applyLockedGapFix(year, gap.month, gap.lineItem, gap.freshValue);
      setGaps((gs) => gs.filter((g) => `${g.month}|${g.lineItem}` !== key));
      await load(year, { quiet: true });
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "Couldn't update that figure");
    } finally {
      setFixingGap(null);
    }
  }

  function exportCsv() {
    if (!data) return;
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Row", "Rate", ...MONTHS, "Total"];
    const lines: string[] = [header.join(",")];

    lines.push("Revenue · hours × rate");
    for (const row of clientRows) {
      const rate = rateLabel(data.rates, row, year);
      let total = 0;
      const cells = MONTHS.map((_, i) => {
        const h = row.cells.get(i + 1)?.hours ?? 0;
        total += h;
        return h || "";
      });
      lines.push([esc(row.clientCanon), rate, ...cells, total || ""].map(esc).join(","));
    }

    lines.push("Project income (₪)");
    for (const row of projectRows) {
      let total = 0;
      const cells = MONTHS.map((_, i) => {
        const v = row.cells.get(i + 1)?.amount ?? 0;
        total += v;
        return v ? round2(v) : "";
      });
      lines.push([esc(row.description), "", ...cells, total ? round2(total) : ""].map(esc).join(","));
    }

    lines.push("Expenses (₪)");
    for (const line of expenseLinesFor(data.pnl, year)) {
      const byMonth = pnlLineByMonth(data.pnl, year, line.key);
      let total = 0;
      const cells = MONTHS.map((_, i) => {
        const v = byMonth.get(i + 1) ?? 0;
        total += v;
        return v ? round2(v) : "";
      });
      lines.push([esc(line.label), "", ...cells, total ? round2(total) : ""].map(esc).join(","));
    }

    lines.push("Rollup (₪)");
    const months = MONTHS.map((_, i) => i + 1);
    const rollups = months.map((m) =>
      computeMonthRollup(clientRows, data.rates, incomeByMonth, data.pnl, year, m),
    );
    const rollupRows: [string, number[]][] = [
      ["Total revenues", rollups.map((r) => r.totalRevenue)],
      ["Total expenses", rollups.map((r) => r.totalExpense)],
      ["Profit", rollups.map((r) => r.profit)],
      ["Total hours", rollups.map((r) => r.totalHours)],
    ];
    for (const [label, vals] of rollupRows) {
      const total = vals.reduce((s, v) => s + v, 0);
      lines.push(
        [esc(label), "", ...vals.map((v) => (v ? round2(v) : "")), round2(total)]
          .map(esc)
          .join(","),
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-plan-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Paste from Excel: fill rows×months starting at (rowIdx, month). */
  function handlePaste(e: React.ClipboardEvent, rowIdx: number, month: number) {
    if (!editable) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return; // single value: let default happen
    e.preventDefault();
    const matrix = text
      .replace(/\r/g, "")
      .split("\n")
      .filter((line, i, arr) => !(i === arr.length - 1 && line === ""))
      .map((line) => line.split("\t"));
    for (let r = 0; r < matrix.length; r++) {
      const row = clientRows[rowIdx + r];
      if (!row) break;
      for (let c = 0; c < matrix[r].length; c++) {
        const m = month + c;
        if (m > 12) break;
        if (monthLocked(data?.locks ?? [], year, m, "revenue")) continue;
        if (row.cells.get(m)?.state === "final") continue; // locked-final row
        // held in sub-account rows: read-only, see commitCell
        if (!mainRowOnly(clientMonthRows(data?.clientMonthly ?? [], year, m, row.clientCanon))) continue;
        void commitCell(row, m, matrix[r][c]);
      }
    }
  }

  if (loading) return <Loading label="Loading plan…" />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="No plan data." />;

  const years = yearRange();

  return (
    <div>
      <PageHeader
        title="Plan"
        subtitle="The year as a live grid — actuals locked in, future months as your plan."
        actions={
          <>
            {year === CUR_YEAR && (
              <button
                onClick={previewSync}
                disabled={!!busy || pendingSync.length > 0}
                title={
                  pendingSync.length > 0
                    ? "Resolve the pending suggestions below first"
                    : "Compare this year's hours with the tracker and suggest updates — nothing is written until you approve"
                }
                className={DESKTOP_TOOL}
              >
                <RefreshCw size={15} className={busy === "sync" ? "animate-spin" : ""} />
                Sync tracker hours
              </button>
            )}
            {year === CUR_YEAR && canUndo && (
              <button
                onClick={undoLastSync}
                disabled={!!busy}
                title="Undo the last tracker sync you approved"
                className={DESKTOP_TOOL}
              >
                <Undo2 size={15} className={busy === "undo" ? "animate-pulse" : ""} />
                Undo last sync
              </button>
            )}
            <button
              onClick={exportCsv}
              title="Download this year's grid as a CSV file (opens in Excel / Sheets)"
              className={DESKTOP_TOOL}
            >
              <Download size={15} />
              CSV
            </button>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              title="Year shown in the grid"
              className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <PanelFold open={showInsights} onClick={toggleInsights} label="insights" />
          </>
        }
      />

      {data && (
        <ReceivablesCard
          clientMonthly={data.clientMonthly}
          income={data.income}
          terms={clientTerms}
          invoiced={data.hasInvoiced}
          busy={busy === "step"}
          onStep={(r, step) => {
            if (r.kind === "hours") {
              const row = clientRows.find((x) => x.clientCanon === r.name);
              if (row) void setHoursStep(row, r.month, step);
            } else {
              const row = projectRows.find((x) => x.description === r.name);
              if (row) void setIncomeStep(row, r.month, step);
            }
          }}
        />
      )}

      <StateLegend
        steps
        invoiced={!!data?.hasInvoiced}
        hint={
          editable && (
            <>
              <Clipboard size={13} />
              Paste a range from Excel into the hours grid
            </>
          )
        }
      />
      {note && (
        <div className="mb-3 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background">
          {note}
        </div>
      )}
      {pendingSync.length > 0 && (
        <div className="mb-3 rounded-lg border border-border-strong bg-surface-2 px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              <span className="font-medium">{pendingSync.length}</span> tracker update
              {pendingSync.length === 1 ? "" : "s"} ready to review — the changed cells are highlighted below.
              Nothing has been written yet.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => approveSync(pendingSync)}
                disabled={!!busy}
                title="Write every highlighted tracker update into the grid (can be undone with “Undo last sync”)"
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium hover:bg-background disabled:opacity-50"
              >
                Approve all
              </button>
              <button
                onClick={() => dismissSync(pendingSync)}
                disabled={!!busy}
                title="Ignore these tracker updates — the grid stays as it is"
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium hover:bg-background disabled:opacity-50"
              >
                Dismiss all
              </button>
            </div>
          </div>
        </div>
      )}
      {gaps.length > 0 && (
        <div className="mb-3 rounded-lg border border-[var(--state-predicted-border)] bg-[var(--state-predicted-bg)] px-3 py-2.5 text-sm text-[var(--state-predicted-fg)]">
          <p className="mb-2 font-medium">
            {gaps.length} locked figure{gaps.length === 1 ? "" : "s"} no longer match the current data —
            probably something changed after the month was finalized.
          </p>
          <ul className="space-y-1.5">
            {gaps.map((g) => {
              const key = `${g.month}|${g.lineItem}`;
              return (
                <li key={key} className="flex flex-wrap items-center gap-2">
                  <span>
                    <span className="font-medium">{g.lineLabel}</span> for {MONTHS[g.month - 1]}: locked at{" "}
                    {formatGapValue(g.lineItem, g.storedValue)}, current data says{" "}
                    {formatGapValue(g.lineItem, g.freshValue)} (
                    {g.delta > 0 ? "+" : ""}
                    {formatGapValue(g.lineItem, g.delta)}).
                  </span>
                  <button
                    onClick={() => applyGap(g)}
                    title="Replace the locked figure with what the data now adds up to, then lock it again"
                    disabled={fixingGap === key}
                    className="rounded-md border border-[var(--state-predicted-border)] bg-surface px-2 py-0.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
                  >
                    {fixingGap === key ? "Updating…" : `Update to ${formatGapValue(g.lineItem, g.freshValue)}`}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
      {/* The table scrolls inside its own box, sized to fill the window, so the
          month header can stick at its top — a box that only scrolls sideways
          is what stops a header sticking when the page scrolls down. */}
      <div
        ref={gridScrollRef}
        style={{ maxHeight: gridMaxH }}
        onMouseOver={explain.onMouseOver}
        onMouseLeave={explain.onMouseLeave}
        onScroll={explain.onScroll}
        className="min-w-0 flex-1 overflow-auto"
      >
        <table
          className="plan-panes text-[13px] md:min-w-[900px]"
          onMouseOver={crosshair.onMouseOver}
          onMouseLeave={crosshair.onMouseLeave}
        >
          <thead>
            <tr className="pane-top text-xs font-medium uppercase tracking-wide text-faint">
              <th className="sticky left-0 top-0 z-30 bg-surface-2 px-3 py-2 text-left md:min-w-[150px]">
                Row
              </th>
              <th className={`sticky top-0 z-20 bg-surface-2 px-2 py-2 text-right ${RATE_COL}`}>Rate</th>
              {MONTHS.map((mLabel, i) => {
                const m = i + 1;
                const locked = revenueLockedByMonth[i];
                const monthGaps = gaps.filter((g) => g.month === m);
                return (
                  <th key={mLabel} data-month={m} data-advice={`month:${year}-${String(m).padStart(2, "0")}`} className={`group sticky top-0 z-20 px-2 py-2 text-right ${futureColClass(m) || "bg-surface-2"}`}>
                    <div className="flex items-center justify-end gap-1">
                      {monthGaps.length > 0 && (
                        <MismatchTriangle>
                          <div className="space-y-1">
                            {monthGaps.map((g) => (
                              <div key={g.lineItem}>
                                {g.lineLabel}: locked at{" "}
                                <span className="tabular-nums">
                                  {formatGapValue(g.lineItem, g.storedValue)}
                                </span>
                                , now computes{" "}
                                <span className="tabular-nums">
                                  {formatGapValue(g.lineItem, g.freshValue)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </MismatchTriangle>
                      )}
                      {mLabel}
                      {locked && <span className="text-faint">·</span>}
                      {editable && (
                        <button
                          onClick={() => (locked ? unlockMonth(m) : finalizeMonth(m))}
                          disabled={busy === `lock-${m}`}
                          title={locked ? "Reopen month" : "Finalize month revenue"}
                          className="text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
                        </button>
                      )}
                    </div>
                  </th>
                );
              })}
              <th className="sticky top-0 z-20 bg-surface-2 px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <SectionHeader label="Income · hours and projects" folded={fold.income} onToggle={() => toggleFold("income")} />
            {!fold.income && displayRows.map((row, rowIdx) => {
              const isSynthetic = rowIdx >= clientRows.length;
              let total = 0;
              return (
                <tr key={row.clientCanon} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                    <span className="bidi-auto">{row.clientCanon}</span>
                    {isSynthetic && <span className="ml-1 text-[10px] text-faint">new</span>}
                  </td>
                  <td data-cell={cellKey.rate(row.clientCanon)} className={`relative whitespace-nowrap px-2 py-1.5 text-right text-faint ${RATE_COL}`}>
                    {(() => {
                      const r = rateSummary(data.rates, row, year);
                      return (
                        <>
                          {r.latest ?? "—"}
                          {r.changed && (
                            <span
                              aria-label="Rate changed during the year"
                              className="absolute right-1 top-1.5 h-[3px] w-[3px] rounded-full bg-brand/45"
                            />
                          )}
                        </>
                      );
                    })()}
                  </td>
                  {MONTHS.map((_, i) => {
                    const m = i + 1;
                    const suggestion = pendingSync.find((s) => s.clientCanon === row.clientCanon && s.month === m);
                    const cell = row.cells.get(m);
                    const hours = cell?.hours ?? 0;
                    // Counted before the suggestion's early return: the row's
                    // Total dropped the month while its sync chip was showing.
                    total += hours;
                    if (suggestion) {
                      return (
                        <SyncSuggestionCell
                          key={m}
                          suggestion={suggestion}
                          busy={!!busy}
                          onApprove={() => approveSync([suggestion])}
                          onDismiss={() => dismissSync([suggestion])}
                        />
                      );
                    }
                    if (isSynthetic) return <td key={m} className="px-2 py-1.5" />;
                    const key = `${row.clientCanon}|${m}`;
                    const locked = revenueLockedByMonth[i];
                    const editVal = edits.get(key);
                    const parts = clientMonthRows(data.clientMonthly, year, m, row.clientCanon);
                    const held = !mainRowOnly(parts);
                    return (
                      <HoursCell
                        key={m}
                        dataCell={cellKey.hours(row.clientCanon, m)}
                        paid={!!cell && stepOf(cell.state, cell.paidAt) === "paid"}
                        invoiced={!!cell && stepOf(cell.state, cell.paidAt, cell.invoicedAt) === "invoiced"}
                        needsInvoice={!!cell && data.hasInvoiced && hours > 0 && stepOf(cell.state, cell.paidAt, cell.invoicedAt) === "final"}
                        editable={editable && !locked && !held}
                        readOnlyWhy={
                          held
                            ? `Made of ${parts.length} sub-account row${parts.length === 1 ? "" : "s"} (${parts.map((p) => p.subAccount || "main").join(", ")}), each at its own rate — not typed into here`
                            : undefined
                        }
                        state={cell?.state}
                        locked={locked}
                        future={isForecastMonth(year, m)}
                        value={editVal ?? (hours ? formatHours(hours) : "")}
                        committedValue={hours ? formatHours(hours) : ""}
                        tracked={year === CUR_YEAR && m === CUR_MONTH ? (trackedNow[row.clientCanon] ?? 0) : undefined}
                        onChange={(v) =>
                          setEdits((prev) => {
                            const n = new Map(prev);
                            n.set(key, v);
                            return n;
                          })
                        }
                        onCommit={(v) => commitCell(row, m, v)}
                        onPaste={(e) => handlePaste(e, rowIdx, m)}
                        comment={cell?.comment}
                        onSaveComment={cell ? (v) => saveHoursComment(row, m, v) : undefined}
                        selected={hoursSel.isSelected(rowIdx, i)}
                        onCellMouseDown={(e) => hoursSel.cellMouseDown(rowIdx, i, e)}
                        onCellMouseEnter={(e) => hoursSel.cellMouseEnter(rowIdx, i, e)}
                      />
                    );
                  })}
                  <td
                    data-cell={isSynthetic ? undefined : cellKey.hours(row.clientCanon, TOTAL_COL)}
                    className={`px-2 py-1.5 text-right font-medium tabular-nums ${!isSynthetic && hoursSel.isSelected(rowIdx, MONTHS.length) ? SEL_CLS : ""}`}
                    onMouseDown={(e) => !isSynthetic && hoursSel.cellMouseDown(rowIdx, MONTHS.length, e)}
                    onMouseEnter={(e) => !isSynthetic && hoursSel.cellMouseEnter(rowIdx, MONTHS.length, e)}
                  >
                    {total ? formatHours(total) : ""}
                  </td>
                </tr>
              );
            })}
            {!fold.income && displayRows.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-4 text-center text-faint">
                  No client hours for {year}.{" "}
                  {year === CUR_YEAR && "Use “Sync tracker hours” to pull them in."}
                </td>
              </tr>
            )}
            {!fold.income && clientRows.length > 0 && totalHoursRow && (
              <tr className="border-t border-border bg-surface-2/40 font-medium">
                <td className="sticky left-0 z-10 bg-surface-2 px-3 py-1.5">Total hours</td>
                <td className={`bg-surface-2/40 ${RATE_COL}`} />
                {totalHoursRow.raw.slice(0, MONTHS.length).map((v, i) => (
                  <td
                    key={i}
                    data-cell={cellKey.totalHours(i + 1)}
                    className={`px-2 py-1.5 text-right tabular-nums ${isForecastMonth(year, i + 1) ? "bg-surface" : ""}`}
                  >
                    {v ? formatHours(v) : ""}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {totalHoursRow.raw[MONTHS.length] ? formatHours(totalHoursRow.raw[MONTHS.length]) : ""}
                </td>
              </tr>
            )}

            {!fold.income && <SectionHeader label="Project income · one-off / non-hourly" sub />}
            {!fold.income && projectRows.map((row, rowIdx) => {
              let total = 0;
              return (
                <tr key={row.description} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                    <span className="bidi-auto">{row.description}</span>
                  </td>
                  <td className={RATE_COL} />
                  {MONTHS.map((_, i) => {
                    const m = i + 1;
                    const cell = row.cells.get(m);
                    const amount = cell?.amount ?? 0;
                    total += amount;
                    const key = `${row.description}|${m}`;
                    const locked = revenueLockedByMonth[i];
                    const editVal = incomeEdits.get(key);
                    return (
                      <IncomeCell
                        key={m}
                        dataCell={cellKey.project(row.description, m)}
                        paid={!!cell && stepOf(cell.state, cell.paidAt) === "paid"}
                        invoiced={!!cell && stepOf(cell.state, cell.paidAt, cell.invoicedAt) === "invoiced"}
                        needsInvoice={!!cell && data.hasInvoiced && amount > 0 && stepOf(cell.state, cell.paidAt, cell.invoicedAt) === "final"}
                        advice={cell ? cell.ids.map((id) => `row:${id}`).join(" ") : undefined}
                        editable={editable && !locked && !(cell && cell.ids.length > 1)}
                        readOnlyWhy={
                          cell && cell.ids.length > 1
                            ? `Made of ${cell.ids.length} income rows — a typed figure can't say which one changes, so it isn't typed into here`
                            : undefined
                        }
                        locked={locked}
                        state={cell?.state}
                        future={isForecastMonth(year, m)}
                        value={editVal ?? (amount ? String(round2(amount)) : "")}
                        committedValue={amount ? String(round2(amount)) : ""}
                        onChange={(v) =>
                          setIncomeEdits((prev) => {
                            const n = new Map(prev);
                            n.set(key, v);
                            return n;
                          })
                        }
                        onCommit={(v) => commitIncomeCell(row, m, v)}
                        comment={cell?.comment}
                        onSaveComment={cell ? (v) => saveIncomeComment(row, m, v) : undefined}
                        selected={incomeSel.isSelected(rowIdx, i)}
                        onCellMouseDown={(e) => incomeSel.cellMouseDown(rowIdx, i, e)}
                        onCellMouseEnter={(e) => incomeSel.cellMouseEnter(rowIdx, i, e)}
                      />
                    );
                  })}
                  <td
                    data-cell={cellKey.project(row.description, TOTAL_COL)}
                    className={`px-2 py-1.5 text-right font-medium tabular-nums ${incomeSel.isSelected(rowIdx, MONTHS.length) ? SEL_CLS : ""}`}
                    onMouseDown={(e) => incomeSel.cellMouseDown(rowIdx, MONTHS.length, e)}
                    onMouseEnter={(e) => incomeSel.cellMouseEnter(rowIdx, MONTHS.length, e)}
                  >
                    {total ? formatILS(total) : ""}
                  </td>
                </tr>
              );
            })}
            {!fold.income && projectRows.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-4 text-center text-faint">
                  No project income for {year}.
                </td>
              </tr>
            )}
            {!fold.income && editable && (
              <tr>
                <td colSpan={15} className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={newProject}
                      onChange={(e) => setNewProject(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addProject()}
                      placeholder="New project name"
                      className="rounded-lg border border-border-strong bg-surface px-2.5 py-1 text-xs outline-none focus:border-brand"
                    />
                    <button
                      onClick={addProject}
                      title="Add a one-off / fixed-fee income row, then type its amount into the month it was billed"
                      className="rounded-lg border border-border-strong px-2.5 py-1 text-xs hover:bg-background"
                    >
                      Add project
                    </button>
                  </div>
                </td>
              </tr>
            )}

            <RollupRow r={rollupRows[0]} rowIdx={0} sel={rollupSel} year={year} look="summary" label="Total income" edge="bottom" />

            <PaneGap />
            <SectionHeader label="Expenses · edited in the feeder sheets" folded={fold.expenses} onToggle={() => toggleFold("expenses")} top />
            {!fold.expenses && expenseLines.map((line, lineIdx) => {
              const row = expenseGrid[lineIdx] ?? [];
              return (
                <tr key={line.key} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                    <Link href={line.href} className="flex items-center gap-1 text-foreground hover:text-brand">
                      {line.label}
                      <ExternalLink size={11} className="text-faint" />
                    </Link>
                  </td>
                  <td className={RATE_COL} />
                  {MONTHS.map((_, i) => {
                    const v = row[i] ?? 0;
                    return (
                      <td
                        key={i}
                        data-cell={cellKey.expense(line.key, i + 1)}
                        className={`px-2 py-1.5 text-right tabular-nums text-muted ${futureColClass(i + 1)} ${expensesSel.isSelected(lineIdx, i) ? SEL_CLS : ""}`}
                        onMouseDown={(e) => expensesSel.cellMouseDown(lineIdx, i, e)}
                        onMouseEnter={(e) => expensesSel.cellMouseEnter(lineIdx, i, e)}
                      >
                        {v ? formatILS(v) : ""}
                      </td>
                    );
                  })}
                  <td
                    data-cell={cellKey.expense(line.key, TOTAL_COL)}
                    className={`px-2 py-1.5 text-right font-medium tabular-nums ${expensesSel.isSelected(lineIdx, MONTHS.length) ? SEL_CLS : ""}`}
                    onMouseDown={(e) => expensesSel.cellMouseDown(lineIdx, MONTHS.length, e)}
                    onMouseEnter={(e) => expensesSel.cellMouseEnter(lineIdx, MONTHS.length, e)}
                  >
                    {row[MONTHS.length] ? formatILS(row[MONTHS.length]) : ""}
                  </td>
                </tr>
              );
            })}

            <RollupRow r={rollupRows[1]} rowIdx={1} sel={rollupSel} year={year} look="summary" edge="bottom" />

            {/* The bottom line, a pane of its own: profit, green or red at a glance. */}
            <PaneGap />
            <RollupRow r={rollupRows[2]} rowIdx={2} sel={rollupSel} year={year} look="profit" edge="top" />
            <RollupRow r={rollupRows[3]} rowIdx={3} sel={rollupSel} year={year} look="profitPct" edge="bottom" />
          </tbody>
        </table>
      </div>
      {showInsights && (
        <PlanInsightsPane
          pnl={data.pnl}
          clientRows={clientRows}
          priorPnl={data.priorPnl}
          priorClientRows={priorClientRows}
          year={year}
          onClose={toggleInsights}
        />
      )}
      </div>
      {explain.card}
      {pickedHours && (
        <CellStateCard
          key={`h|${pickedHours.row.clientCanon}|${pickedHours.month}`}
          anchor={`[data-cell="${CSS.escape(cellKey.hours(pickedHours.row.clientCanon, pickedHours.month))}"]`}
          step={stepOf(pickedHours.state, pickedHours.paidAt, pickedHours.invoicedAt)}
          canEdit={editable && !revenueLockedByMonth[pickedHours.month - 1]}
          why={editable ? "month" : "year"}
          steps={data?.hasInvoiced ? PLAN_STEPS : undefined}
          busy={busy === "step"}
          onStep={(v) => void setHoursStep(pickedHours.row, pickedHours.month, v)}
        />
      )}
      {pickedIncome && (
        <CellStateCard
          key={`i|${pickedIncome.row.description}|${pickedIncome.month}`}
          anchor={`[data-cell="${CSS.escape(cellKey.project(pickedIncome.row.description, pickedIncome.month))}"]`}
          step={stepOf(pickedIncome.state, pickedIncome.paidAt, pickedIncome.invoicedAt)}
          canEdit={editable && !revenueLockedByMonth[pickedIncome.month - 1]}
          why={editable ? "month" : "year"}
          steps={data?.hasInvoiced ? PLAN_STEPS : undefined}
          busy={busy === "step"}
          onStep={(v) => void setIncomeStep(pickedIncome.row, pickedIncome.month, v)}
        />
      )}
      <SelectionBubble
        bubble={hoursSel.bubble}
        copied={hoursSel.copied}
        total={hoursSummary.total}
        cells={hoursSummary.cells}
        filled={hoursSummary.filled}
        formatValue={formatHours}
      />
      <SelectionBubble
        bubble={incomeSel.bubble}
        copied={incomeSel.copied}
        total={incomeSummary.total}
        cells={incomeSummary.cells}
        filled={incomeSummary.filled}
        formatValue={formatILS}
      />
      <SelectionBubble
        bubble={expensesSel.bubble}
        copied={expensesSel.copied}
        total={expensesSummary.total}
        cells={expensesSummary.cells}
        filled={expensesSummary.filled}
        formatValue={formatILS}
      />
      <SelectionBubble
        bubble={rollupSel.bubble}
        copied={rollupSel.copied}
        total={rollupSummary.total}
        cells={rollupSummary.cells}
        filled={rollupSummary.filled}
        formatValue={(n) => (rollupPctOnly ? formatPct(n) : formatNum(n, 0))}
        money={!rollupPctOnly}
      />
    </div>
  );
}

/** % change from `prior` to `current`, or null if there's nothing to compare
 * against (prior is 0/absent) — matches the "vs prior year" comparison used
 * everywhere else in the app (see finance.ts's `yoy`). */
function yoyPct(current: number, prior: number): number | null {
  return prior ? Math.round(((current - prior) / prior) * 100) : null;
}

/** Foldable right-hand pane: quick stats + charts for the year currently
 * shown in the grid, so you don't have to jump to Overview to see how the
 * plan is shaping up. Reads the same `pnl`/`clientRows` the grid already
 * loaded. Every chart shares the same compact "headline number + line"
 * look (MonthlyLineChart) so the pane stays legible at sidebar width.
 * Memoised: its props only change with the loaded data, the year or the
 * toggle, so editing and selecting in the grid don't redraw every chart. */
const PlanInsightsPane = memo(function PlanInsightsPane({
  pnl,
  clientRows,
  priorPnl,
  priorClientRows,
  year,
  onClose,
}: {
  pnl: PnlMonthly[];
  clientRows: ClientRow[];
  priorPnl: PnlMonthly[];
  priorClientRows: ClientRow[];
  year: number;
  onClose: () => void;
}) {
  const summary = summarizeYear(pnl, year);
  // This year's unfinished months are drawn (dashed) as estimated full months
  // and never counted in a headline — see projectMonths.
  const projections = projectMonths(pnl, year);

  const trend = buildMonthlyTrend(pnl, year, projections);
  const revenuePoints: MonthPoint[] = trend.map((t) => ({
    label: t.label ?? "",
    value: t.revenue,
    future: t.partial,
  }));
  const expensesPoints = buildMonthlyExpenses(pnl, year, projections);
  const revenueExpensePoints: DualPoint[] = revenuePoints.map((r, i) => ({
    label: r.label,
    a: r.value,
    b: expensesPoints[i]?.value ?? 0,
    future: r.future,
  }));
  const rateByMonth = buildMonthlyRate(pnl, year, projections);
  const ratePoints: MonthPoint[] = rateByMonth.map((r) => ({
    label: String(r.year),
    value: r.rate,
    future: r.partial,
  }));
  const hoursPoints: MonthPoint[] = MONTHS.map((label, i) => {
    const m = i + 1;
    const p = projections.get(m);
    const row = pnl.find((r) => r.year === year && r.month === m && r.lineItem === LINE.totalHours);
    return { label, value: p ? p.hours : (row?.value ?? 0), future: isForecastMonth(year, m) };
  });
  const activeCount = (m: number) =>
    clientRows.filter((r) => r.clientCanon !== NON_BILLABLE_CLIENT_CANON && (r.cells.get(m)?.hours ?? 0) > 0).length;
  // An unfinished month's client rows are the plan's; estimate it at the last
  // three booked months' average instead.
  const firstOpen = projections.size ? Math.min(...projections.keys()) : 13;
  const recentBooked = [firstOpen - 3, firstOpen - 2, firstOpen - 1].filter((m) => m >= 1);
  const clientsEstimate = recentBooked.length
    ? Math.round(recentBooked.reduce((t, m) => t + activeCount(m), 0) / recentBooked.length)
    : 0;
  const activeClientsPoints: MonthPoint[] = MONTHS.map((label, i) => {
    const m = i + 1;
    return { label, value: projections.has(m) ? clientsEstimate : activeCount(m), future: isForecastMonth(year, m) };
  });

  // "Elapsed months" sums, computed independently from `summarizeYear`
  // because the two want different things for a selected FUTURE planning
  // year: summarizeYear sums the whole year (real predicted totals, for
  // forward planning), while these "so far" figures deliberately count only
  // elapsed months — zero for a future year. For the current year the two
  // now agree (summarizeYear already excludes not-yet-elapsed months there
  // too), but this pane still needs its own per-month "elapsed" filter to
  // drive `actualMonthsCount` and the point-level charts below.
  const actualMonthsCount = revenuePoints.filter((p) => !p.future).length || 12;
  const actualRevenue = revenuePoints.filter((p) => !p.future).reduce((s, p) => s + p.value, 0);
  const actualExpenses = expensesPoints.filter((p) => !p.future).reduce((s, p) => s + p.value, 0);
  const actualHours = hoursPoints.filter((p) => !p.future).reduce((s, p) => s + p.value, 0);
  const avgRateSoFar = actualHours ? actualRevenue / actualHours : 0;

  // "Apples to apples": every trend badge compares this year's elapsed
  // months (Jan..N) against the SAME Jan..N months last year — never the
  // latest month against the one before it, which is a noisy, arbitrary
  // comparison for a still-partial year.
  const sumPriorLine = (lineItem: string) => {
    let s = 0;
    for (const r of priorPnl) if (r.year === year - 1 && r.month <= actualMonthsCount && r.lineItem === lineItem) s += r.value;
    return s;
  };
  const priorRevenue = sumPriorLine(LINE.totalRevenues);
  const priorExpenses = sumPriorLine(LINE.totalExpenses);
  const priorHours = sumPriorLine(LINE.totalHours);
  const priorRate = priorHours ? priorRevenue / priorHours : 0;
  const priorActiveClients = (() => {
    const months = Array.from({ length: actualMonthsCount }, (_, i) => i + 1);
    let total = 0;
    for (const m of months)
      total += priorClientRows.filter(
        (r) => r.clientCanon !== NON_BILLABLE_CLIENT_CANON && (r.cells.get(m)?.hours ?? 0) > 0,
      ).length;
    return total;
  })();
  const activeClientsSoFar = activeClientsPoints.filter((p) => !p.future).reduce((s, p) => s + p.value, 0);
  const spanLabel = actualMonthsCount > 1 ? `Jan-${MONTHS[actualMonthsCount - 1]}` : MONTHS[0];
  const priorLabel = `${spanLabel} ${year} vs ${spanLabel} ${year - 1}`;

  const trends = {
    revenue: yoyPct(actualRevenue, priorRevenue),
    expenses: yoyPct(actualExpenses, priorExpenses),
    rate: yoyPct(avgRateSoFar, priorRate),
    hours: yoyPct(actualHours, priorHours),
    activeClients: yoyPct(activeClientsSoFar, priorActiveClients),
  };

  const stats: { label: string; value: string; info: string }[] = [
    {
      label: "Avg. monthly revenue",
      value: formatILS(Math.round(actualRevenue / actualMonthsCount)),
      info: "Revenue for the year so far, divided by how many months have elapsed.",
    },
    {
      label: "Avg. monthly expense",
      value: formatILS(Math.round(actualExpenses / actualMonthsCount)),
      info: "Expenses for the year so far, divided by how many months have elapsed.",
    },
    { label: "Profit", value: formatILS(Math.round(summary.profit)), info: "Revenue minus expenses, year to date." },
    { label: "Margin", value: formatPct(summary.margin, 0), info: "Profit ÷ revenue." },
  ];

  return (
    // Phone: above the grid, its cards one swipeable row. Wider: a column beside it.
    <aside className="order-first w-full md:order-none md:w-80 md:shrink-0">
      <div className="mb-2 flex items-center justify-between md:mb-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-faint">
          Insights · {year}
        </h2>
        <PanelFold open onClick={onClose} label="insights" />
      </div>

      <div className="flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:thin] md:block md:space-y-4 md:overflow-visible md:pb-0 [&>*]:w-[280px] [&>*]:shrink-0 [&>*]:snap-start md:[&>*]:w-auto">
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-surface p-2.5">
            <div className="flex items-center gap-1 text-[11px] text-muted">
              {s.label}
              <InfoDot>{s.info}</InfoDot>
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-surface p-3">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Revenue vs expenses</h3>
        <DualLineChart
          points={revenueExpensePoints}
          aTrend={trends.revenue}
          bTrend={trends.expenses}
          trendTitle={priorLabel}
        />
      </div>

      <div className="rounded-xl border border-border bg-surface p-3">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Average rate</h3>
        <MonthlyLineChart
          points={ratePoints}
          headline={avgRateSoFar}
          higherIsBetter
          trendOverride={trends.rate}
          trendTitle={priorLabel}
        />
      </div>

      <div className="rounded-xl border border-border bg-surface p-3">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Work hours</h3>
        <MonthlyLineChart
          points={hoursPoints}
          seriesLabel="Hours"
          totalLabel="total hours, year to date"
          formatValue={formatHours}
          formatDetail={formatHours}
          higherIsBetter
          trendOverride={trends.hours}
          trendTitle={priorLabel}
        />
      </div>

      <div className="rounded-xl border border-border bg-surface p-3">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Active clients</h3>
        <MonthlyLineChart
          points={activeClientsPoints}
          seriesLabel="Clients"
          totalLabel="client-months, year to date"
          formatValue={(v) => formatNum(v, 0)}
          formatDetail={(v) => formatNum(v, 0)}
          higherIsBetter
          trendOverride={trends.activeClients}
          trendTitle={priorLabel}
        />
      </div>
      </div>
    </aside>
  );
});

/** A toolbar button for desktop only — sync, recompute and CSV are no phone jobs. */
const DESKTOP_TOOL =
  "hidden items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50 md:flex";

/** The RATE column's cells — a phone has no room for it. */
const RATE_COL = "hidden md:table-cell";

function yearRange(): number[] {
  const out: number[] = [];
  for (let y = studioYear() + 1; y >= 2016; y--) out.push(y);
  return out;
}

/** A part's heading. With `onToggle` it folds the part down to its summary
 * line; `sub` is a heading inside a part (Project income). */
function SectionHeader({
  label,
  folded,
  onToggle,
  sub,
  top,
}: {
  label: string;
  folded?: boolean;
  onToggle?: () => void;
  sub?: boolean;
  /** opens a pane (see `.plan-panes` in globals.css) */
  top?: boolean;
}) {
  return (
    <tr className={top ? "pane-top" : undefined}>
      <td
        colSpan={15}
        className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wide ${sub ? "bg-surface-2/50 text-faint" : "bg-surface-2 text-muted"}`}
      >
        {/* The label sticks, not the cell: a cell spanning every month can't
            stay in view when the grid is scrolled sideways. */}
        <span className="sticky left-3 inline-flex">
        {onToggle ? (
          <button
            onClick={onToggle}
            aria-expanded={!folded}
            className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
            title={folded ? "Show the rows" : "Fold to the total"}
          >
            {folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            {label}
          </button>
        ) : (
          label
        )}
        </span>
      </td>
    </tr>
  );
}

/** The space between two panes of the grid — one spanning cell, so the
 * crosshair passes over it. */
function PaneGap() {
  return (
    <tr className="pane-gap" aria-hidden>
      <td colSpan={15} className="h-6 bg-transparent p-0" />
    </tr>
  );
}

/** A tracker-hours suggestion not yet applied — shows old → new inline with
 * accept/dismiss, replacing the normal cell for exactly this (client, month)
 * until it's resolved. Nothing is written by rendering this. */
function SyncSuggestionCell({
  suggestion,
  busy,
  onApprove,
  onDismiss,
}: {
  suggestion: SyncSuggestion;
  busy: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const old = suggestion.existing ? formatHours(suggestion.existing.hours) : "—";
  return (
    <td
      className="relative bg-[var(--brand-soft)] p-0.5 text-right tabular-nums outline outline-2 -outline-offset-1 outline-[var(--brand)]"
      title={`Tracker says ${formatHours(suggestion.newHours)}h (was ${old}h)`}
    >
      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap rounded-[5px] bg-surface px-1.5 py-1 shadow-sm">
        <span className="text-[11px] font-semibold tabular-nums text-foreground">
          {old}→{formatHours(suggestion.newHours)}
        </span>
        <button
          onClick={onApprove}
          disabled={busy}
          title="Accept this tracker value"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white transition-transform hover:scale-110 disabled:opacity-50"
        >
          <Check size={12} strokeWidth={3} />
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          title="Keep the current value"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-white transition-transform hover:scale-110 disabled:opacity-50"
        >
          <X size={12} strokeWidth={3} />
        </button>
      </div>
    </td>
  );
}

/**
 * An income cell's look on the Plan, past its basic state (Nitsan, 2026-11-02):
 * paid = full green + ✓ (done); invoiced = orange + a bold ↗ (waiting for the
 * money — it should nag, not rest in final's green); final with no invoice =
 * a red dashed outline + an alert (unfinished: go send the invoice).
 */
function incomeLook(
  state: FinanceState | undefined,
  paid?: boolean,
  invoiced?: boolean,
  needsInvoice?: boolean,
): { cls: string; mark: ReactNode; title?: string } {
  if (paid) return { cls: `${cellStateClass(state)} text-[var(--state-paid-fg)]! bg-[var(--state-paid-bg)]!`, mark: <PaidMark /> };
  if (invoiced)
    return {
      cls: `${cellStateClass(state)} text-[var(--state-invoiced-fg)]! bg-[var(--state-invoiced-bg)]!`,
      mark: <InvoicedMark />,
      title: "Invoiced — waiting for the money",
    };
  if (needsInvoice)
    return {
      cls: `${cellStateClass(state)} outline-dashed outline-[1.5px] -outline-offset-[3px] outline-[var(--state-uninvoiced)]`,
      mark: <NeedsInvoiceMark />,
      title: "Final — no invoice sent yet",
    };
  return { cls: cellStateClass(state), mark: null };
}

function HoursCell({
  editable,
  state,
  locked,
  value,
  committedValue,
  onChange,
  onCommit,
  onPaste,
  comment,
  onSaveComment,
  selected,
  onCellMouseDown,
  onCellMouseEnter,
  future,
  dataCell,
  paid,
  invoiced,
  needsInvoice,
  tracked,
  readOnlyWhy,
}: {
  editable: boolean;
  /** why a cell of an editable month is read-only (it holds several rows) — its title */
  readOnlyWhy?: string;
  state: "predicted" | "actual" | "final" | undefined;
  locked: boolean;
  value: string;
  /** Current month only: hours logged in the tracker so far, shown as "(13)". */
  tracked?: number;
  /** The last-saved value, independent of `value` (which tracks live typing)
   * — onBlur compares against this, never against `value` itself, since by
   * blur time `value` already reflects whatever was just typed. */
  committedValue: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  comment?: string;
  onSaveComment?: (v: string) => void;
  /** Current/future month — draws a lighter background behind the value. */
  future?: boolean;
  /** Key for the hover explanation (plan-explain.tsx). */
  dataCell?: string;
  /** the client paid it (reference/0012): the amount in dark green with a tick, as on Freelance */
  paid?: boolean;
  /** the invoice went out (reference/0013): a ↗ before the amount */
  invoiced?: boolean;
  /** final, and the Plan tracks invoices, but none went out yet */
  needsInvoice?: boolean;
} & CellSelectionProps) {
  const ref = useRef<HTMLInputElement>(null);
  const look = incomeLook(state, paid, invoiced, needsInvoice);
  const stateCls = look.cls;
  const futureCls = future && state !== "predicted" && state !== "final" ? "bg-surface" : "";
  const { contextMenu, commentUi } = useCellComment(comment, onSaveComment);
  const selCls = selected ? SEL_CLS : "";
  const showTracked = tracked !== undefined && (tracked > 0 || committedValue !== "");
  const trackedUi = showTracked && (
    <span
      title={`${formatHours(tracked!)}h logged in the tracker so far this month`}
      className="ml-1 text-[11px] font-normal text-faint"
    >
      ({formatHours(tracked!)})
    </span>
  );
  if (!editable) {
    return (
      <td
        data-cell={dataCell}
        className={`relative px-2 py-1.5 text-right tabular-nums ${stateCls} ${futureCls} ${selCls} ${CELL_FOCUS}`}
        title={readOnlyWhy ?? look.title ?? (locked ? "Locked" : undefined)}
        onContextMenu={contextMenu}
        onMouseDown={onCellMouseDown}
        {...cellKeyProps(onCellMouseDown)}
        onMouseEnter={onCellMouseEnter}
      >
        {look.mark}
        {value}
        {trackedUi}
        {commentUi}
      </td>
    );
  }
  if (state === "final") {
    return (
      <td
        data-cell={dataCell}
        className={`relative cursor-cell p-0 select-none ${futureCls} ${selCls} ${CELL_FOCUS}`}
        onContextMenu={contextMenu}
        onMouseDown={onCellMouseDown}
        {...cellKeyProps(onCellMouseDown)}
        onMouseEnter={onCellMouseEnter}
      >
        <div className={`px-2 py-1.5 text-right tabular-nums ${stateCls}`} title={look.title}>
          {look.mark}
          {value}
          {trackedUi}
        </div>
        {commentUi}
      </td>
    );
  }
  return (
    <td
      data-cell={dataCell}
      className={`relative p-0 ${stateCls} ${futureCls} ${selCls}`}
      onContextMenu={contextMenu}
      onMouseDown={onCellMouseDown}
      onMouseEnter={onCellMouseEnter}
    >
      {/* The tracker's hours sit just after the typed number, in the same
          row — laid out beside the field, never over it, however wide
          either gets ("170 (154.25)"). */}
      <div className="flex items-center">
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            // Just clicking into a cell and back out must not touch it — only a
            // real edit should re-commit. Compare against the last-SAVED value,
            // not `value` (which already reflects whatever was just typed by
            // the time blur fires, making a same-as-`value` check always pass).
            if (e.target.value !== committedValue) onCommit(e.target.value);
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter") ref.current?.blur();
          }}
          inputMode="decimal"
          className={`min-w-0 flex-1 rounded-md bg-transparent py-1.5 text-right tabular-nums outline-none transition-shadow hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--border-strong)] focus:bg-brand-soft/40 focus:shadow-[inset_0_0_0_1.5px_var(--brand)] ${
            showTracked ? "pl-2 pr-0.5" : "px-2"
          }`}
        />
        {showTracked && <span className="pointer-events-none shrink-0 whitespace-nowrap pr-2">{trackedUi}</span>}
      </div>
      {commentUi}
    </td>
  );
}

function IncomeCell({
  editable,
  state,
  locked,
  value,
  committedValue,
  onChange,
  onCommit,
  comment,
  onSaveComment,
  selected,
  onCellMouseDown,
  onCellMouseEnter,
  future,
  dataCell,
  paid,
  invoiced,
  needsInvoice,
  advice,
  readOnlyWhy,
}: {
  editable: boolean;
  /** why a cell of an editable month is read-only (it holds several rows) — its title */
  readOnlyWhy?: string;
  state: "predicted" | "actual" | "final" | undefined;
  locked?: boolean;
  value: string;
  committedValue: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  comment?: string;
  onSaveComment?: (v: string) => void;
  /** Current/future month — draws a lighter background behind the value. */
  future?: boolean;
  /** Key for the hover explanation (plan-explain.tsx). */
  dataCell?: string;
  /** the client paid it (reference/0012): the amount in dark green with a tick, as on Freelance */
  paid?: boolean;
  /** the invoice went out (reference/0013): a ↗ before the amount */
  invoiced?: boolean;
  /** final, and the Plan tracks invoices, but none went out yet */
  needsInvoice?: boolean;
  /** `data-advice` tokens (advice.tsx `Spotlight`). */
  advice?: string;
} & CellSelectionProps) {
  const ref = useRef<HTMLInputElement>(null);
  const look = incomeLook(state, paid, invoiced, needsInvoice);
  const stateCls = look.cls;
  const futureCls = future && state !== "predicted" && state !== "final" ? "bg-surface" : "";
  const { contextMenu, commentUi } = useCellComment(comment, onSaveComment);
  const selCls = selected ? SEL_CLS : "";
  if (!editable) {
    return (
      <td
        data-cell={dataCell}
        data-advice={advice}
        className={`relative px-2 py-1.5 text-right tabular-nums ${stateCls} ${futureCls} ${selCls} ${CELL_FOCUS}`}
        title={readOnlyWhy ?? look.title ?? (locked ? "Locked" : undefined)}
        onContextMenu={contextMenu}
        onMouseDown={onCellMouseDown}
        {...cellKeyProps(onCellMouseDown)}
        onMouseEnter={onCellMouseEnter}
      >
        {look.mark}
        {value ? formatILS(Number(value)) : ""}
        {commentUi}
      </td>
    );
  }
  if (state === "final") {
    return (
      <td
        data-cell={dataCell}
        data-advice={advice}
        className={`relative cursor-cell p-0 select-none ${futureCls} ${selCls} ${CELL_FOCUS}`}
        onContextMenu={contextMenu}
        onMouseDown={onCellMouseDown}
        {...cellKeyProps(onCellMouseDown)}
        onMouseEnter={onCellMouseEnter}
      >
        <div className={`px-2 py-1.5 text-right tabular-nums ${stateCls}`} title={look.title}>
          {look.mark}
          {value ? formatILS(Number(value)) : ""}
        </div>
        {commentUi}
      </td>
    );
  }
  return (
    <td
        data-cell={dataCell}
        data-advice={advice}
      className={`relative p-0 ${stateCls} ${futureCls} ${selCls}`}
      onContextMenu={contextMenu}
      onMouseDown={onCellMouseDown}
      onMouseEnter={onCellMouseEnter}
    >
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          if (e.target.value !== committedValue) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") ref.current?.blur();
        }}
        inputMode="decimal"
        className={`w-full rounded-md bg-transparent px-2 py-1.5 text-right tabular-nums outline-none transition-shadow hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--border-strong)] focus:bg-brand-soft/40 focus:shadow-[inset_0_0_0_1.5px_var(--brand)]`}
      />
      {commentUi}
    </td>
  );
}

interface RollupRowData {
  label: string;
  cells: string[];
  total: string;
  strong?: boolean;
  /** 12 months + the row total (13 entries) — raw numbers for the
   * multi-select summary and the negative-value styling, alongside the
   * formatted `cells`/`total` used for display. */
  raw: number[];
}

function buildRollupRows(
  clientRows: ClientRow[],
  rates: ClientRate[],
  incomeByMonth: Map<number, number>,
  pnl: PnlMonthly[],
  year: number,
): RollupRowData[] {
  const months = MONTHS.map((_, i) => i + 1);
  const rollups = months.map((m) =>
    computeMonthRollup(clientRows, rates, incomeByMonth, pnl, year, m),
  );

  const sumOf = (pick: (r: (typeof rollups)[number]) => number) =>
    rollups.reduce((s, r) => s + pick(r), 0);

  return [
    {
      label: "Total revenues",
      cells: rollups.map((r) => (r.totalRevenue ? formatILS(r.totalRevenue) : "")),
      total: formatILS(sumOf((r) => r.totalRevenue)),
      strong: true,
      raw: [...rollups.map((r) => r.totalRevenue), sumOf((r) => r.totalRevenue)],
    },
    {
      label: "Total expenses",
      cells: rollups.map((r) => (r.totalExpense ? formatILS(r.totalExpense) : "")),
      total: formatILS(sumOf((r) => r.totalExpense)),
      raw: [...rollups.map((r) => r.totalExpense), sumOf((r) => r.totalExpense)],
    },
    {
      label: "Profit",
      cells: rollups.map((r) => (r.totalRevenue || r.totalExpense ? formatILS(r.profit) : "")),
      total: formatILS(sumOf((r) => r.profit)),
      strong: true,
      raw: [...rollups.map((r) => r.profit), sumOf((r) => r.profit)],
    },
    {
      label: "Profit %",
      cells: rollups.map((r) => (r.totalRevenue ? formatPct(r.profitPct) : "")),
      total: "",
      raw: [...rollups.map((r) => r.profitPct), 0],
    },
    {
      label: "Total hours",
      cells: rollups.map((r) => (r.totalHours ? formatHours(r.totalHours) : "")),
      total: formatHours(sumOf((r) => r.totalHours)),
      raw: [...rollups.map((r) => r.totalHours), sumOf((r) => r.totalHours)],
    },
  ];
}

/**
 * One line of the rollup. `summary` closes a part (Total income, Total
 * expenses): bold, on a rule. `profit` is the bottom line — bigger, every
 * month green when it made money and red when it lost (Nitsan, 2026-11-02);
 * `profitPct` the same colours, quieter.
 */
function RollupRow({
  r,
  rowIdx,
  sel,
  year,
  look,
  label,
  edge,
}: {
  r: RollupRowData | undefined;
  rowIdx: number;
  sel: ReturnType<typeof useCellSelection>;
  year: number;
  look: "summary" | "profit" | "profitPct";
  /** shown instead of `r.label` (which stays the hover key) */
  label?: string;
  /** opens or closes a pane (see `.plan-panes` in globals.css) */
  edge?: "top" | "bottom";
}) {
  if (!r) return null;
  const profit = look === "profit";
  const signed = look !== "summary";
  const tone = (v: number, filled: boolean) =>
    !signed || !filled ? "" : v < 0 ? "text-danger" : v > 0 ? "text-[var(--success)]" : "";
  // On the cells, not the row: a pane's rounded corner would show a row's
  // background square behind it.
  const tint = (v: number, filled: boolean, month?: number) =>
    look === "summary"
      ? month && isForecastMonth(year, month) ? "" : "bg-surface-2/60"
      : !profit || !filled ? "" : v < 0 ? "bg-danger/8" : v > 0 ? "bg-[var(--success)]/8" : "";
  const rowCls = `${edge ? `pane-${edge}` : ""} ${
    look === "summary" ? "border-t-2 border-border-strong font-semibold" : profit ? "text-sm font-semibold" : "border-t border-border text-xs"
  }`;
  const labelCls =
    look === "summary" ? "bg-surface-2 font-semibold" : profit ? "bg-surface text-sm font-semibold" : "bg-surface text-muted";
  const total = r.raw[MONTHS.length];
  return (
    <tr className={rowCls}>
      <td className={`sticky left-0 z-10 px-3 ${profit ? "py-2.5" : "py-1.5"} ${labelCls}`}>{label ?? r.label}</td>
      <td className={RATE_COL} />
      {r.cells.map((c, i) => (
        <td
          key={i}
          data-cell={cellKey.rollup(r.label, i + 1)}
          className={`whitespace-nowrap px-2 ${profit ? "py-2.5" : "py-1.5"} text-right tabular-nums ${tone(r.raw[i], !!c)} ${tint(r.raw[i], !!c, i + 1)} ${
            !tint(r.raw[i], !!c, i + 1) && isForecastMonth(year, i + 1) ? "bg-surface" : ""
          } ${sel.isSelected(rowIdx, i) ? SEL_CLS : ""}`}
          onMouseDown={(e) => sel.cellMouseDown(rowIdx, i, e)}
          onMouseEnter={(e) => sel.cellMouseEnter(rowIdx, i, e)}
        >
          {c}
        </td>
      ))}
      <td
        data-cell={r.total ? cellKey.rollup(r.label, TOTAL_COL) : undefined}
        className={`whitespace-nowrap px-2 ${profit ? "py-2.5" : "py-1.5"} text-right tabular-nums ${tone(total, !!r.total)} ${tint(total, !!r.total)} ${
          sel.isSelected(rowIdx, MONTHS.length) ? SEL_CLS : ""
        }`}
        onMouseDown={(e) => sel.cellMouseDown(rowIdx, MONTHS.length, e)}
        onMouseEnter={(e) => sel.cellMouseEnter(rowIdx, MONTHS.length, e)}
      >
        {r.total}
      </td>
    </tr>
  );
}

