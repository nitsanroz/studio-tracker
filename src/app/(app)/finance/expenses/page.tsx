"use client";

import { EmptyState } from "@/components/empty-state";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, CreditCard, Eye, EyeOff, FileText, Link as LinkIcon, Lock, LockOpen, Mail, PanelRightClose, PanelRightOpen, Paperclip, Plus, AlertTriangle, RotateCcw, Search, Trash2, X, ChartPie } from "lucide-react";
import { createClient } from "@/lib/finance/supabase-client";
import {
  fetchAll,
  mapExpense,
  mapLock,
  updatePreservingLock,
  type ExpenseRowDb,
  type LockRow,
  type QueryModifier,
} from "@/lib/finance/db";
import {
  cellStateClass,
  isForecastMonth,
  isLocked,
  vatRate,
  expenseNetIls,
  expenseLineOf,
  expenseShares,
  LINE,
  round2,
  EXPENSE_CURRENCIES,
  CURRENCY_SYMBOL,
  SYNTHETIC_YEARLY_MARKER,
  type ExpenseCategory,
  type FinanceLock,
  type FinanceState,
} from "@/lib/finance/finance";
import { MONTHS, monthLocked } from "@/lib/finance/plan-model";
import { formatILS, studioToday, studioYear } from "@/lib/finance/format";
import { addMonths, daysBetween } from "@/lib/finance/advice/tools";
import { FIRST_YEAR } from "@/lib/finance/use-year-param";
import { FILING_RESET_DAY, isFiled } from "@/lib/finance/filing";
import { useTableCrosshair } from "@/lib/finance/table-crosshair";
import {
  PageHeader,
  Loading,
  ErrorState,
  MismatchTriangle,
  StateLegend,
  ConfirmDialog,
  InfoDot,
} from "@/components/finance/ui";
import {
  CommentBadge,
  CommentEditorDialog,
  useCommentEditor,
} from "@/components/finance/cell-comment";
import {
  CellIconButton,
  SEL_CLS,
  type CellSelectionProps,
} from "@/components/finance/lockable-cell";
import {
  useCellSelection,
  selectionSummary,
} from "@/lib/finance/cell-selection";
import { SelectionBubble } from "@/components/finance/selection-bubble";
import { MONTH_NAMES, NOUNS, breakdownCard, trend, useExplainHover, type Explanation } from "@/components/finance/explain-card";
import { useResizableColumns, ResizeHandle } from "@/lib/finance/resizable-columns";
import { DRAG_TH, useColumnOrder, type DragProps } from "@/lib/finance/column-order";
import {
  MonthlyLineChart,
  MultiMonthlyLineChart,
  PieChart,
  PIE_COLORS,
  type MonthPoint,
  type MonthSeries,
  type PieSlice,
} from "@/components/finance/finance-charts";
import { paidByMonth, topVendorsForYear, vendorPieSlices } from "@/lib/finance/overview";
import { buildFxTable, fxQuote, FX_MARKUP, type FxRow, type FxTable } from "@/lib/finance/fx";
import { EXPENSES_CHANGED, applyFix } from "@/lib/finance/advice/client";
import { MailReceipts, type AfterEndFlag } from "@/components/finance/mail-receipts";
import { DocList } from "@/components/finance/doc-list";
import { docsFor, type RowReceipt } from "@/lib/finance/docs-client";
import { RENT_SOURCES } from "@/lib/finance/mail/rent";
import type { DocRef } from "@/lib/finance/mail/receipts";
import {
  EMPTY_AMOUNT,
  amountDraftOf,
  amountFieldsOf,
  monthOfDate,
  vatShapeOf,
  yearOfDate,
  type AmountDraft,
} from "@/lib/finance/amount-vat";

/** The monthly exchange rates, loaded once by the page and read by every net
 * calculation below it — so a row, a month total and a form preview can never
 * convert the same dollars at different rates. */
const FxContext = createContext<FxTable | undefined>(undefined);
const useFx = () => useContext(FxContext);
/**
 * An expense's paperwork: whether `invoice_number` / `paid_with` exist yet
 * (reference/0018), and each row's documents (reference/0019, v1.16.0) — null
 * until it's run, or for someone who can't see them (Michal's expenses-only access).
 */
const DetailsContext = createContext<{
  details: boolean;
  docs: Map<string, DocRef[]> | null;
  /** the receipt emails put on each row (v1.22.0) — a Monthly row's months */
  receipts: Map<string, RowReceipt[]>;
  reloadDocs: () => void;
  flags: Map<string, AfterEndFlag>;
  /** Rows an open &advice price card is about (v1.20.1) — owner only; empty for anyone else. */
  priceFlags: Map<string, PriceFlag>;
  /** Make that card's change from the row's note — resolves once it's done or has failed. */
  fixPrice: (itemId: string) => Promise<void>;
  /** Rows added from a mail receipt, with what the receipt said (so a value still as read gets the mail mark). */
  fromMail: Map<string, MailOrigin>;
}>({
  details: false,
  docs: null,
  receipts: new Map(),
  reloadDocs: () => {},
  flags: new Map(),
  priceFlags: new Map(),
  fixPrice: async () => {},
  fromMail: new Map(),
});

/**
 * An open &advice card saying a row's price is out of date (signals
 * `priceChange`): the red note under the row's name, with the card's fix
 * (Nitsan, 2026-11-08: Plnty's bigger plan showed only in the &advice pane).
 */
interface PriceFlag {
  itemId: string;
  /** "New plan since 3 Oct — the row has the old price" */
  text: string;
  /** the card's own explanation, on hover */
  detail: string;
  /** the card's fix button, when it has one */
  fixLabel: string | null;
}

/** Open price cards → the row each points at (`focus: "row:<id>"`). The table is owner-only: anyone else gets none. */
async function priceFlagsFor(): Promise<Map<string, PriceFlag>> {
  const { data, error } = await createClient()
    .from("finance_advice_items")
    .select("id, title, body, facts")
    .like("key", "mail-over:%")
    .is("done_at", null)
    .is("resolved_at", null);
  const out = new Map<string, PriceFlag>();
  if (error || !data) return out;
  for (const it of data as { id: string; title: string; body: string; facts: Record<string, unknown> | null }[]) {
    const f = it.facts ?? {};
    const row = typeof f.focus === "string" ? f.focus.match(/row:([\w-]+)/)?.[1] : null;
    if (!row) continue;
    const since = typeof f.since === "string" ? f.since : typeof f.sent === "string" ? f.sent : null;
    let fixLabel: string | null = null;
    try {
      fixLabel = typeof f.fix === "string" ? ((JSON.parse(f.fix) as { label?: string }).label ?? null) : null;
    } catch {
      // no fix
    }
    const day = since ? ` since ${fmtDayMonth(since)}` : "";
    out.set(row, {
      itemId: it.id,
      text: f.planChanged ? `New plan${day} — this row has the old price` : `Charged ${String(f.over ?? "more")} more${day} — check the price`,
      detail: it.body,
      fixLabel,
    });
  }
  return out;
}

/** The red note under a row's name while its price is out of date, with the fix. */
function PriceNote({ id }: { id: string }) {
  const { priceFlags, fixPrice } = useContext(DetailsContext);
  const [busy, setBusy] = useState(false);
  const flag = priceFlags.get(id);
  if (!flag) return null;
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-medium text-danger" title={flag.detail}>
      <AlertTriangle size={11} className="shrink-0" />
      {flag.text}
      {flag.fixLabel && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            // Back from "Saving…" however it ends: a failed fix leaves the card (and this note) in place,
            // and the button used to stay on "Saving…" for good.
            void fixPrice(flag.itemId).finally(() => setBusy(false));
          }}
          className="rounded border border-danger/40 px-1.5 py-px text-[11px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          {busy ? "Saving…" : flag.fixLabel}
        </button>
      )}
    </p>
  );
}

/** What the receipt email gave a row it was added from (finance_mail_receipts, status "added"). */
interface MailOrigin {
  invoice: string | null;
  paid: string | null;
}

/** A stored `link` is free text a user typed, never validated on write — only
 * ever render it as a clickable `href` when it's actually http(s), so a
 * `javascript:` value can't execute on click. */
function safeHref(link: string): string | null {
  return /^https?:\/\//i.test(link) ? link : null;
}

/** This month (1–12) in Tel Aviv — read when called, beside `studioYear()`, so a tab left open over
 * a month's (or the year's) turn doesn't keep the month it was opened in. */
const studioMonth = () => Number(studioToday().slice(5, 7));
/** The month Summary opens on for a year: this month in this year, else January. */
const summaryMonthFor = (y: number) => (y === studioYear() ? studioMonth() : 1);

/** The Expenses page's own tab set — "summary" and "trends" are synthetic,
 * cross-category views, not real `finance_expenses.category` values. */
type PageTab = ExpenseCategory | "summary" | "trends";

const TABS: { key: PageTab; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
  { key: "misc", label: "Misc" },
  { key: "investment", label: "Investments" },
  { key: "rent", label: "Rent" },
];

const TAB_HINT: Record<PageTab, string> = {
  summary: "Every category together, month by month",
  monthly: "Subscriptions charged every month",
  yearly: "Renewals paid once and spread over the months they cover",
  misc: "One-off operating costs (food, supplies, services…)",
  investment: "One-off purchases treated as capital spend",
  rent: "Rent and building costs, as a month grid",
  trends: "Spend by vendor across all years",
};

/** Shown instead of TABS when "All years" is selected — every other tab is a
 * single-year editable grid, which "All years" has no data loaded for. */
const ALL_YEARS_TABS: { key: PageTab; label: string }[] = [
  { key: "trends", label: "Trends" },
];

// Tracker-style inline-edit affordances (see studio-tracker editable-cell.tsx):
// resting cells hint editability on hover, editing gets a brand ring.
const CELL_HOVER =
  "rounded-md transition-shadow hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--border-strong)]";
const CELL_FOCUS =
  "focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--brand)]";

/** "21 Feb" — the table is already scoped to one year. */
function fmtDayMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Chip color for a "days until renewal" figure: red ≤7, orange ≤30, else neutral. */
function renewChipClass(days: number): string {
  if (days <= 7) return "bg-danger/10 text-danger";
  if (days <= 30) return "bg-warning/10 text-warning";
  return "bg-surface-2 text-muted";
}

/** Renewal period (months) — the real `renew_months` column; default 12. */
function renewMonths(r: ExpenseRowDb): number {
  return r.renew_months && r.renew_months >= 1 ? r.renew_months : 12;
}

/**
 * The next renewal after today: the anchor stepped by whole periods. Each step is taken from the
 * anchor (k × period) with the day clamped to the month's end — stepping a Date by `setMonth` ran
 * 31 Jan into 3 Mar and kept the drift — and counted in calendar days of the studio's own date,
 * not milliseconds (a clock change put a day on or off).
 */
function nextRenewal(anchorIso: string, periodMonths: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorIso) || periodMonths < 1) return null;
  const today = studioToday();
  let next = anchorIso;
  for (let k = 1; next <= today; k++) next = addMonths(anchorIso, k * periodMonths);
  return next;
}

/** Days until the next renewal (anchor stepped by period into the future). */
function daysToRenewal(anchorIso: string, periodMonths: number): number {
  const next = nextRenewal(anchorIso, periodMonths);
  return next ? daysBetween(studioToday(), next) : 0;
}


/** A yearly row with an end date in the past won't renew again — its "Renews
 * in" countdown would otherwise keep ticking toward a payment that isn't
 * coming. */
function isEnded(r: ExpenseRowDb): boolean {
  return !!r.end_date && r.end_date < studioToday();
}

/**
 * A subscription still running — monthly or yearly, not ended. It stays
 * editable whatever year it was entered in (Nitsan, 2026-11-06: Wix's Happy
 * Keto plan, entered in Dec 2024, couldn't have its cycle or end changed).
 * Closed years are still kept as booked: the P&L recompute never writes them.
 */
function stillRunning(r: ExpenseRowDb): boolean {
  return (r.category === "monthly" || r.category === "yearly") && r.description !== SYNTHETIC_YEARLY_MARKER && !isEnded(r);
}

/**
 * The year gate on a row's own terms. A row carried in from an earlier year (a renewal paid last
 * year, a subscription started then — see `load`) belongs to that year, so the viewed year being
 * editable doesn't open it; `stillRunning` still does, as everywhere. For the year's own rows this
 * is just `editable`.
 */
function ownYearEditable(r: ExpenseRowDb, editable: boolean): boolean {
  return editable && Number(r.date.slice(0, 4)) >= studioYear();
}

/** A yearly row whose end date comes before its next renewal won't renew: the day it ends, else null. */
function endsBeforeRenewal(r: ExpenseRowDb): string | null {
  if (!r.end_date || isEnded(r)) return null;
  const next = nextRenewal(r.date, renewMonths(r));
  return next && r.end_date < next ? r.end_date : null;
}

// ── Sorting ──────────────────────────────────────────────────────────────────

type SortDir = 1 | -1;
interface Sort {
  key: string;
  dir: SortDir;
}

function SortTh({
  label,
  k,
  sort,
  setSort,
  right,
  onResizeStart,
  drag,
}: {
  label: string;
  k: string;
  sort: Sort;
  setSort: (s: Sort) => void;
  right?: boolean;
  onResizeStart?: (e: React.MouseEvent) => void;
  /** set where the column can be dragged to a new place */
  drag?: DragProps;
}) {
  const active = sort.key === k;
  return (
    <th
      {...drag}
      className={`relative px-3 py-2 font-medium ${right ? "text-right" : "text-left"} ${drag ? DRAG_TH : ""}`}
    >
      <button
        onClick={() =>
          setSort(
            active ? { key: k, dir: -sort.dir as SortDir } : { key: k, dir: 1 },
          )
        }
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        {active &&
          (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
      {onResizeStart && <ResizeHandle onMouseDown={onResizeStart} />}
    </th>
  );
}

/** Plain (non-sortable) resizable header cell. */
function ResizableTh({
  children,
  right,
  onResizeStart,
  drag,
  title,
}: {
  children?: React.ReactNode;
  right?: boolean;
  onResizeStart?: (e: React.MouseEvent) => void;
  drag?: DragProps;
  title?: string;
}) {
  return (
    <th
      {...drag}
      title={title}
      className={`relative px-3 py-2 font-medium uppercase tracking-wide ${right ? "text-right" : "text-left"} ${drag ? DRAG_TH : ""}`}
    >
      {children}
      {onResizeStart && <ResizeHandle onMouseDown={onResizeStart} />}
    </th>
  );
}

const sortNet = (r: ExpenseRowDb) => expenseNetIls(r, Number(r.date.slice(0, 4)));

function sortRows(rows: ExpenseRowDb[], sort: Sort): ExpenseRowDb[] {
  const cmp = (a: ExpenseRowDb, b: ExpenseRowDb): number => {
    switch (sort.key) {
      case "date":
        return a.date.localeCompare(b.date);
      case "description":
        return a.description.localeCompare(b.description);
      case "vendor":
        return a.vendor.localeCompare(b.vendor);
      // In ₪ without VAT (the stored snapshot), so $306 and ₪105 compare as
      // what they cost rather than as raw numbers in different currencies.
      case "amount":
        return sortNet(a) - sortNet(b);
      case "monthly":
        return sortNet(a) / renewMonths(a) - sortNet(b) / renewMonths(b);
      case "renew":
        return (
          daysToRenewal(a.date, renewMonths(a)) -
          daysToRenewal(b.date, renewMonths(b))
        );
      default:
        return 0;
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) * sort.dir);
}

const THEAD_CLS =
  "border-b border-border text-xs font-medium uppercase tracking-wide text-faint";
const TOTAL_ROW_CLS = "border-t-2 border-foreground/20 font-semibold";

/** One month's expected No-VAT total for a category, per the Expenses sheet. */
interface SheetCheck {
  sheetNoVat: number;
  note: string | null;
}

export default function ExpensesPage() {
  const [year, setYear] = useState(studioYear);
  const [allYears, setAllYears] = useState(false);
  const [tab, setTab] = useState<PageTab>("monthly");
  // Summary's month lives here, not in SummaryTab: ◀ from January changes the year, whose load
  // unmounts the tab, and it came back on January of the year before instead of its December.
  // Picking a year (or following a link) still opens on that year's own month, as it did.
  const [summaryMonth, setSummaryMonth] = useState(() => summaryMonthFor(studioYear()));
  // An &advice card links here with ?tab=yearly&year=2026 (v1.11.0): open that
  // tab and year — on arrival, and again when a card is followed from this page.
  const params = useSearchParams();
  const link = params.toString();
  const [seenLink, setSeenLink] = useState<string | null>(null);
  if (link !== seenLink) {
    setSeenLink(link);
    const y = Number(params.get("year"));
    const t = params.get("tab");
    if (y >= FIRST_YEAR && y <= studioYear() + 1) {
      setAllYears(false);
      setYear(y);
      setSummaryMonth(summaryMonthFor(y));
    }
    if (t && TABS.some((x) => x.key === t)) setTab(t as PageTab);
  }
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ExpenseRowDb[]>([]);
  const [detailsOn, setDetailsOn] = useState(false);
  const [docs, setDocs] = useState<Map<string, DocRef[]> | null>(null);
  const [rowReceipts, setRowReceipts] = useState<Map<string, RowReceipt[]>>(() => new Map());
  const [docsTick, setDocsTick] = useState(0);
  const reloadDocs = useCallback(() => setDocsTick((t) => t + 1), []);
  const rowIds = useMemo(() => rows.map((r) => r.id).join(","), [rows]);
  // Each row's documents (reference/0019) — best effort, after the rows.
  useEffect(() => {
    if (!rowIds) return;
    let live = true;
    void docsFor(rowIds.split(",")).then((m) => {
      if (!live) return;
      setDocs(m?.docs ?? null);
      setRowReceipts(m?.receipts ?? new Map());
    });
    return () => {
      live = false;
    };
  }, [rowIds, docsTick]);
  // Monthly rows a mail receipt came after (v1.16.1) — the "From your mail" list reports them.
  const [mailFlags, setMailFlags] = useState<Map<string, AfterEndFlag>>(() => new Map());
  // Rows that came from a mail receipt (v1.19.0) — best effort, empty before reference/0016.
  const [fromMail, setFromMail] = useState<Map<string, MailOrigin>>(() => new Map());
  const [note, setNote] = useState<string | null>(null);
  // Rows an open &advice price card is about (v1.20.1), reloaded with the rows and after any fix.
  const [priceFlags, setPriceFlags] = useState<Map<string, PriceFlag>>(() => new Map());
  const [flagsTick, setFlagsTick] = useState(0);
  useEffect(() => {
    let live = true;
    void priceFlagsFor().then((m) => live && setPriceFlags(m));
    return () => {
      live = false;
    };
  }, [rowIds, flagsTick]);
  const [fixNotice, setFixNotice] = useState<{ text: string; undo: () => Promise<boolean> } | null>(null);
  const fixPrice = useCallback(async (itemId: string) => {
    const r = await applyFix(itemId);
    if ("error" in r) {
      setNote(r.error);
      setFlagsTick((t) => t + 1);
      return;
    }
    setFixNotice({ text: r.done, undo: r.undo });
  }, []);
  const paperwork = useMemo(
    () => ({ details: detailsOn, docs, receipts: rowReceipts, reloadDocs, flags: mailFlags, priceFlags, fixPrice, fromMail }),
    [detailsOn, docs, rowReceipts, reloadDocs, mailFlags, priceFlags, fixPrice, fromMail],
  );
  const [checks, setChecks] = useState<
    {
      month: number;
      category: string;
      sheet_no_vat: number | string;
      note: string | null;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [summaryFilterSlot, setSummaryFilterSlot] = useState<HTMLDivElement | null>(null);
  const [fx, setFx] = useState<FxTable | undefined>(undefined);

  // Exchange rates are tiny (one row per month) — load them all once.
  // Best-effort: without them foreign amounts fall back to the stored figure.
  useEffect(() => {
    let cancelled = false;
    fetchAll<FxRow>(createClient(), "fx_rates", "*")
      .then((rows) => !cancelled && setFx(buildFxTable(rows)))
      .catch((e: unknown) => console.error("Failed to load fx_rates:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  // The newest load: an older one that answers after it (a quick year switch, a reload racing the
  // year's own load) must not put its year's rows on screen.
  const loadSeq = useRef(0);
  /**
   * `quiet` = re-read after a write WITHOUT the loading screen (as plan-grid's `load`). The full one
   * unmounts the page, which threw away the tab's folds and scroll, the cards half-filled in "From
   * your mail", and Summary's month. Only the first load and a year change blank the page.
   */
  const load = useCallback(async (y: number, { quiet = false }: { quiet?: boolean } = {}) => {
    const seq = ++loadSeq.current;
    const live = () => seq === loadSeq.current;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const sb = createClient();
      const cols =
        "id, date, end_date, category, vendor, description, amount_gross, amount_no_vat, currency, vat_included, renew_months, recurrence, link, notes, state, filed_at";
      // ⚠️ Carried-in rows (Nitsan, 2026-11-10: "the Expenses page follows the P&L"). Besides the
      // year's own rows, the P&L counts yearly renewals paid in the 3 years before (still spread
      // over this year's months) and subscriptions dated earlier that still run into this year —
      // read here with runRollup's own filters, or this page's months were short of the Plan's
      // expense lines. Each shows in its own tab with its real date, and is read-only unless still
      // running: its own year is closed (`ownYearEditable`).
      const sets: ((q: QueryModifier) => QueryModifier)[] = [
        (q) => q.gte("date", `${y}-01-01`).lte("date", `${y}-12-31`),
        (q) => q.eq("category", "yearly").gte("date", `${y - 3}-01-01`).lte("date", `${y - 1}-12-31`),
        (q) => q.eq("category", "monthly").lte("date", `${y - 1}-12-31`).or(`end_date.is.null,end_date.gte.${y}-01-01`),
      ];
      // Invoice number and card (reference/0018) — best effort: before it's run the page loads without them.
      // Paged like the rows themselves: one capped read left every row past the 1000th without its number and card.
      // Read for the carried-in rows too, through the same filters — started now, beside the rows' own read
      // (it doesn't depend on it), and awaited once the rows are in.
      type More = { id: string; invoice_number: string | null; paid_with: string | null };
      const moreRead = Promise.all(
        sets.map((f) => fetchAll<More>(sb, "finance_expenses", "id, invoice_number, paid_with", (q) => f(q).order("id", { ascending: true }))),
      )
        .then((r) => r.flat())
        .catch(() => null);
      const [own, ...carriedSets] = await Promise.all(
        sets.map((f) => fetchAll<ExpenseRowDb>(sb, "finance_expenses", cols, (q) => f(q).order("date", { ascending: true }))),
      );
      // Only what really costs this year something (a 2024 renewal that ran out in 2025 isn't
      // listed), once each: the sets can't overlap by their filters, but a row must never count twice.
      const seen = new Set(own.map((r) => r.id));
      const carried: ExpenseRowDb[] = [];
      for (const r of carriedSets.flat()) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (expenseShares(mapExpense(r), y).length > 0) carried.push(r);
      }
      carried.sort((a, b) => a.date.localeCompare(b.date));
      const data = [...carried, ...own];
      const more = await moreRead;
      // Which rows were added from the mail, and what their receipt said.
      const ids = data.map((r) => r.id);
      const origin = new Map<string, MailOrigin>();
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        // Paged too: 200 rows can carry more than 1000 receipts between them (a subscription's every month).
        const read = (cols: string) =>
          fetchAll<{ expense_id: string; invoice_number?: string | null; paid_with?: string | null }>(sb, "finance_mail_receipts", cols, (q) =>
            q.eq("status", "added").in("expense_id", chunk).order("id", { ascending: true }),
          ).catch(() => null);
        // The number and card columns come with reference/0018.
        const got = (await read("expense_id, invoice_number, paid_with")) ?? (await read("expense_id"));
        if (!got) break;
        for (const m of got)
          origin.set(m.expense_id, { invoice: m.invoice_number ?? null, paid: m.paid_with ?? null });
      }
      if (!live()) return;
      if (!more) setRows(data);
      else {
        const byId = new Map(more.map((m) => [m.id, m]));
        setRows(data.map((r) => ({ ...r, invoice_number: byId.get(r.id)?.invoice_number ?? null, paid_with: byId.get(r.id)?.paid_with ?? null })));
      }
      setDetailsOn(!!more);
      setFromMail(origin);
    } catch (e: unknown) {
      if (!live()) return;
      const msg = e instanceof Error ? e.message : "Failed to load expenses";
      // A quiet reload keeps what's on screen and says so, rather than swapping the page for an error.
      if (quiet) setNote(`Couldn't refresh the expenses: ${msg}`);
      else setError(msg);
    } finally {
      if (live()) setLoading(false);
    }
    // Best-effort: the sheet-comparison reference table is optional (may not
    // exist yet), so a missing table must never break the expenses page.
    try {
      const sb = createClient();
      const data = await fetchAll<{
        month: number;
        category: string;
        sheet_no_vat: number | string;
        note: string | null;
      }>(
        sb,
        "finance_expense_month_check",
        "month, category, sheet_no_vat, note",
        (q) => q.eq("year", y),
      );
      if (live()) setChecks(data);
    } catch (e: unknown) {
      // Silent-empty here reads as "matches the sheet" — log so a broken
      // query is distinguishable from a genuinely absent reference table.
      console.error("Failed to load finance_expense_month_check:", e);
      if (live()) setChecks([]);
    }
  }, []);

  useEffect(() => {
    void load(year);
  }, [year, load]);
  // An &advice card's fix changed rows here (v1.13.0): show them as they now are.
  useEffect(() => {
    const onChanged = () => {
      void load(year, { quiet: true });
      setFlagsTick((t) => t + 1);
    };
    window.addEventListener(EXPENSES_CHANGED, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED, onChanged);
  }, [year, load]);

  // Search narrows every tab at once: each word must appear in the vendor,
  // description, notes or amount.
  const searched = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r) => {
      const hay = [r.vendor, r.description, r.notes, r.amount_gross, r.amount_no_vat].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, query]);
  const shown = useMemo(
    () =>
      searched.filter(
        (r) => r.category === tab && r.description !== SYNTHETIC_YEARLY_MARKER,
      ),
    [searched, tab],
  );
  const checksForTab = useMemo(() => {
    const m = new Map<number, SheetCheck>();
    for (const c of checks) {
      if (c.category === tab)
        m.set(c.month, { sheetNoVat: Number(c.sheet_no_vat), note: c.note });
    }
    return m;
  }, [checks, tab]);
  // Read on every render, not once when the module loaded: a tab left open over New Year kept last
  // year editable and this year missing from the picker.
  const editable = year >= studioYear();

  async function insertExpense(
    category: ExpenseCategory,
    patch: Partial<ExpenseRowDb>,
  ) {
    const sb = createClient();
    const { error: e } = await sb.from("finance_expenses").insert({
      date: `${year}-${String(Math.min(new Date().getMonth() + 1, 12)).padStart(2, "0")}-01`,
      category,
      vendor: "",
      description: "",
      amount_gross: 0,
      recurrence:
        category === "monthly" || category === "rent"
          ? "monthly"
          : category === "yearly"
            ? "yearly"
            : "one_off",
      state: "actual",
      ...patch,
    });
    if (e) return setNote(`Add failed: ${e.message}`);
    setNote(null);
    await load(year, { quiet: true });
  }

  /** Tab-scoped insert — used by each tab's own "add line" form, which never
   * runs while `tab` is the synthetic "summary" view. */
  async function insertRow(patch: Partial<ExpenseRowDb>) {
    await insertExpense(tab as ExpenseCategory, patch);
  }

  /** Reflect a write that already succeeded on the server into local state,
   * with no network call of its own — for callers (like RentGrid) that do
   * their own DB write and previously followed it with a full `onReload()`,
   * which blinked the whole grid for a single-cell edit. */
  function patchRowLocal(id: string, patch: Partial<ExpenseRowDb>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function update(id: string, patch: Partial<ExpenseRowDb>) {
    const sb = createClient();
    const { error: e } = await sb
      .from("finance_expenses")
      .update(patch)
      .eq("id", id);
    if (e) {
      setNote(`Save failed: ${e.message}`);
      return;
    }
    setNote(null);
    patchRowLocal(id, patch);
  }

  /** Comment saves must survive a "final" row — bypass the guard trigger the
   * same way a locked-gap fix would, then sync local state once. */
  async function markFiled(id: string, filed: boolean, state: FinanceState) {
    const filed_at = filed ? new Date().toISOString() : null;
    const before = rows.find((r) => r.id === id)?.filed_at ?? null;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, filed_at } : r)));
    const err = await updatePreservingLock(createClient(), "finance_expenses", id, { filed_at }, state);
    if (err) {
      setNote(`Filing mark failed: ${err.message}`);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, filed_at: before } : r)));
    }
  }

  async function saveNotes(id: string, notes: string, state: FinanceState) {
    const sb = createClient();
    const err = await updatePreservingLock(
      sb,
      "finance_expenses",
      id,
      { notes },
      state,
    );
    if (err) {
      setNote(`Comment save failed: ${err.message}`);
      return;
    }
    setNote(null);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, notes } : r)));
  }

  async function remove(id: string) {
    const sb = createClient();
    const { error: e } = await sb
      .from("finance_expenses")
      .delete()
      .eq("id", id);
    if (e) return setNote(`Delete failed: ${e.message}`);
    setNote(null);
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;

  const years: number[] = [];
  for (let y = studioYear() + 1; y >= FIRST_YEAR; y--) years.push(y);

  return (
    <FxContext.Provider value={fx}>
    <DetailsContext.Provider value={paperwork}>
    <div className="w-full">
      <PageHeader
        title="Expenses"
        subtitle={`Each tab mirrors its sheet — subscriptions, yearly renewals, misc, investments and rent. All ₪ figures are without VAT; foreign-currency expenses (overseas suppliers) carry no VAT and are converted at that month's Bank of Israel rate + ${Math.round(FX_MARKUP * 100)}%.`}
        actions={
          <>
            <select
              title="Year shown"
              value={allYears ? "all" : year}
              onChange={(e) => {
                if (e.target.value === "all") {
                  setAllYears(true);
                  setTab("trends");
                } else {
                  setAllYears(false);
                  setYear(Number(e.target.value));
                  setSummaryMonth(summaryMonthFor(Number(e.target.value)));
                  setTab((t) => (t === "trends" ? "summary" : t));
                }
              }}
              className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm"
            >
              <option value="all">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {!allYears && (
              <button
                onClick={() => setShowAdd(true)}
                title="Add any expense — it goes to the right tab from whether it repeats"
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
              >
                <Plus size={15} />
                Add expense
              </button>
            )}
          </>
        }
      />

      {showAdd && (
        <AddExpenseDialog
          onClose={() => setShowAdd(false)}
          onAdd={(category, patch) => {
            void insertExpense(category, patch);
            setTab(category);
            setShowAdd(false);
          }}
        />
      )}

      {/* Receipts from the billing mail, ready to add (v1.14.0) — everyone on Expenses since v1.18.0 (reference/0022). */}
      <MailReceipts onFlags={setMailFlags} onAttached={reloadDocs} />

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {/* One swipeable row of tabs on a phone, rather than wrapping. */}
        <div className="-mb-px flex max-w-full gap-1 overflow-x-auto [scrollbar-width:none]">
        {(allYears ? ALL_YEARS_TABS : TABS).map((t) => {
          const active = tab === t.key;
          const count = searched.filter(
            (r) =>
              (t.key === "summary" || r.category === t.key) &&
              r.description !== SYNTHETIC_YEARLY_MARKER,
          ).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={TAB_HINT[t.key]}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                active
                  ? "border-brand font-medium text-brand-dark"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
              {t.key !== "trends" && <span className="ml-1.5 text-xs text-faint">{count}</span>}
            </button>
          );
        })}
        </div>
        {!allYears && (
          <span className="hidden pb-2 md:inline">
            <InfoDot>
              <p>
                <strong>Monthly</strong> — recurring subscriptions charged every month (or every N months), tracked
                by accrual window.
              </p>
              <p className="mt-1.5">
                <strong>Yearly</strong> — a lump-sum renewal (e.g. once a year), spread evenly across months for
                reporting.
              </p>
              <p className="mt-1.5">
                <strong>Misc</strong> — one-off operating costs (supplies, services, etc).
              </p>
              <p className="mt-1.5">
                <strong>Investments</strong> — one-off purchases treated as capital spend, not routine expense.
              </p>
            </InfoDot>
          </span>
        )}
        <div ref={setSummaryFilterSlot} className="ml-auto flex flex-wrap items-center gap-2 pb-2" />
        {tab !== "trends" && (
          <label className="mb-2 flex w-full items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm focus-within:border-brand md:w-auto">
            <Search size={14} className="shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search expenses"
              title="Search every tab by vendor, description, notes or amount"
              className="bidi-auto w-full bg-transparent outline-none placeholder:text-faint md:w-40"
            />
            {query && (
              <button onClick={() => setQuery("")} title="Clear the search" className="text-faint hover:text-foreground">
                <X size={13} />
              </button>
            )}
          </label>
        )}
      </div>

      {note && (
        <div className="mb-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          {note}
        </div>
      )}
      {fixNotice && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
          <Check size={14} className="shrink-0 text-success" />
          <span className="flex-1">{fixNotice.text}</span>
          <button
            onClick={async () => {
              const ok = await fixNotice.undo();
              if (ok) setFixNotice(null);
              else setNote("Couldn't undo that — open the row to check");
            }}
            className="text-sm font-medium text-brand hover:underline"
          >
            Undo
          </button>
          <button onClick={() => setFixNotice(null)} title="Close" className="text-faint hover:text-foreground">
            <X size={14} />
          </button>
        </div>
      )}

      {tab === "trends" ? (
        <TrendsTab />
      ) : tab === "summary" ? (
        <SummaryTab
          rows={searched}
          year={year}
          setYear={setYear}
          month={summaryMonth}
          setMonth={setSummaryMonth}
          editable={editable}
          update={update}
          remove={remove}
          filterSlot={summaryFilterSlot}
        />
      ) : tab === "rent" ? (
        <RentGrid
          year={year}
          rows={shown}
          editable={editable}
          onReload={() => load(year, { quiet: true })}
          patchRow={patchRowLocal}
          setNote={setNote}
        />
      ) : tab === "yearly" ? (
        <YearlyList
          rows={shown}
          editable={editable}
          update={update}
          remove={remove}
          insertRow={insertRow}
          saveNotes={saveNotes}
          year={year}
        />
      ) : tab === "monthly" ? (
        <MonthlyList
          rows={shown}
          filterSlot={summaryFilterSlot}
          markFiled={markFiled}
          editable={editable}
          update={update}
          remove={remove}
          insertRow={insertRow}
          saveNotes={saveNotes}
          year={year}
        />
      ) : (
        <MonthGroupedList
          key={`${tab}-${year}`}
          rows={shown}
          year={year}
          category={tab}
          checks={checksForTab}
          editable={editable}
          update={update}
          remove={remove}
          insertRow={insertRow}
          saveNotes={saveNotes}
        />
      )}
    </div>
    </DetailsContext.Provider>
    </FxContext.Provider>
  );
}

/** "All years" view: cross-year vendor trends. Loads its own full-history
 * fetch (unfiltered by year), independent of the single-year `rows` state
 * every other tab edits. */
function TrendsTab() {
  const fx = useFx();
  const [allRows, setAllRows] = useState<ExpenseRowDb[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = createClient();
        const data = await fetchAll<ExpenseRowDb>(
          sb,
          "finance_expenses",
          "id, date, end_date, category, vendor, description, amount_gross, amount_no_vat, currency, vat_included, renew_months, recurrence, link, notes, state",
          (q) => q.order("date", { ascending: true }),
        );
        if (!cancelled) setAllRows(data);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load trends");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!allRows) return <Loading />;

  const rows = allRows.filter((r) => r.description !== SYNTHETIC_YEARLY_MARKER);
  // A monthly row pays every month it runs, not once (paidByMonth, 2026-11-09).
  const paid = rows.flatMap((r) => paidByMonth(r, fx).map((p) => ({ ...p, vendor: r.vendor.trim() || "(no vendor)" })));
  const years = [...new Set(paid.map((p) => p.year))].sort((a, b) => a - b);

  const vendorView = topVendorsForYear(rows, null, fx);
  const topVendors = vendorView.vendors.slice(0, 8);

  const series: MonthSeries[] = topVendors.map((v, i) => {
    const byYear = new Map<number, number>();
    for (const p of paid) if (p.vendor === v.vendor) byYear.set(p.year, (byYear.get(p.year) ?? 0) + p.amount);
    return {
      label: v.vendor,
      color: PIE_COLORS[i % PIE_COLORS.length],
      values: years.map((y) => byYear.get(y) ?? 0),
    };
  });

  const totalByYear: MonthPoint[] = years.map((y) => ({
    label: String(y),
    value: paid.filter((p) => p.year === y).reduce((s, p) => s + p.amount, 0),
  }));

  const pie = vendorPieSlices(vendorView.vendors);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          Total expenses by year
        </h3>
        <MonthlyLineChart points={totalByYear} totalLabel="all-time total" />
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          Top {topVendors.length} vendors, by year
        </h3>
        {series.length > 0 ? (
          <MultiMonthlyLineChart
            labels={years.map(String)}
            series={series}
            totalLabel="all-time total, top vendors"
          />
        ) : (
          <EmptyState compact icon={ChartPie} text="No vendor data." />
        )}
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          Split spent on biggest vendors · all years
        </h3>
        {pie.length > 0 ? (
          <PieChart ariaLabel="Total spend by vendor" slices={pie} layout="side" size={220} />
        ) : (
          <EmptyState compact icon={ChartPie} text="No expense data." />
        )}
      </div>
    </div>
  );
}

// ── Shared inline-edit cells ──────────────────────────────────────────────────

/** "21 Feb" text + calendar icon right beside it; opens the native picker. */
function DateCell({
  r,
  editable,
  update,
}: {
  r: ExpenseRowDb;
  editable: boolean;
  update: (id: string, p: Partial<ExpenseRowDb>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex items-center">
      <button
        disabled={!editable}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (typeof el.showPicker === "function") el.showPicker();
          else el.focus();
        }}
        className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 tabular-nums ${
          editable ? `cursor-pointer ${CELL_HOVER}` : "opacity-70"
        }`}
      >
        {fmtDayMonth(r.date)}
      </button>
      <input
        ref={ref}
        type="date"
        defaultValue={r.date}
        tabIndex={-1}
        aria-hidden
        onChange={(e) =>
          e.target.value &&
          e.target.value !== r.date &&
          update(r.id, { date: e.target.value })
        }
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
      />
    </span>
  );
}

function TextCell({
  value,
  editable,
  width,
  onCommit,
}: {
  value: string;
  editable: boolean;
  width: string;
  onCommit: (v: string) => void;
}) {
  return (
    <input
      defaultValue={value}
      disabled={!editable}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      onKeyDown={(e) =>
        e.key === "Enter" && (e.target as HTMLInputElement).blur()
      }
      className={`bidi-auto text-left ${width} bg-transparent px-1.5 py-0.5 outline-none disabled:opacity-70 ${CELL_HOVER} ${CELL_FOCUS}`}
    />
  );
}

interface ListProps {
  rows: ExpenseRowDb[];
  editable: boolean;
  update: (id: string, p: Partial<ExpenseRowDb>) => void;
  remove: (id: string) => void;
  insertRow: (p: Partial<ExpenseRowDb>) => void;
  saveNotes: (id: string, notes: string, state: FinanceState) => void;
  /** Mark (or unmark) a row's invoice as filed this month. */
  markFiled?: (id: string, filed: boolean, state: FinanceState) => void;
}

interface MoveTo {
  toCategory: ExpenseCategory;
  title: string;
}

// ── Amount + VAT: one model, one set of words, used by every tab and form ────
// What someone has in hand is a receipt. They may type its full amount (with
// VAT), its net amount, an item that carries no VAT at all (fruit &
// vegetables, an exempt dealer), or a mixed receipt whose net they know. All
// four end up as the same two stored numbers — amount_gross (the receipt) and
// amount_no_vat (what the app counts) — so every list can show them the same way.

const symbolOf = (currency: string) => CURRENCY_SYMBOL[currency as keyof typeof CURRENCY_SYMBOL] ?? currency;

/** A row of buttons for a short, exclusive choice — used for every such
 * choice on this page (VAT, repeats, type, years) so they all look alike. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" className="flex w-fit overflow-hidden rounded-lg border border-border-strong">
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm transition-colors ${i > 0 ? "border-l border-border-strong" : ""} ${
            o.value === value ? "bg-brand text-white" : "bg-surface text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** How many years one yearly payment covers. */
const RENEW_YEARS = [1, 2, 3, 4, 5];
const yearsOptions = RENEW_YEARS.map((y) => ({ value: y * 12, label: String(y) }));
const renewLabel = (months: number) =>
  months % 12 === 0 ? `${months / 12} year${months === 12 ? "" : "s"}` : `${months} months`;

/** One plain sentence saying exactly what the app will count — shown under
 * every amount field, so the VAT treatment is visible before saving. */
function AmountPreview({ draft, date }: { draft: AmountDraft; date: string }) {
  const fx = useFx();
  const f = amountFieldsOf(draft, date, fx);
  if (!f) return null;
  const y = yearOfDate(date);
  let how: string;
  if (draft.currency !== "ILS") {
    const q = fxQuote(fx, draft.currency, y, monthOfDate(date));
    how = q.official
      ? `no VAT abroad · ${symbolOf(draft.currency)}${f.amount_gross} × ₪${q.rate.toFixed(3)} (Bank of Israel ${q.official.toFixed(3)} + ${Math.round(FX_MARKUP * 100)}%)`
      : `no VAT abroad · ${symbolOf(draft.currency)}${f.amount_gross} × ₪${q.rate.toFixed(2)} (fixed rate)`;
  } else {
    how = draft.withVat ? `${Math.round(vatRate(y) * 100)}% VAT taken off ₪${f.amount_gross}` : "as entered";
  }
  return (
    <p className="w-full text-xs text-muted">
      Counts as <span className="font-medium text-foreground tabular-nums">{formatILS(Number(f.amount_no_vat))}</span> without VAT — {how}.
    </p>
  );
}

const FIELD_CLS =
  "rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand";

/** Amount + currency + a With VAT / Without VAT switch + the preview line.
 * The one way an amount is typed anywhere on this page. */
function AmountFields({
  draft,
  onChange,
  date,
  onEnter,
  preview = true,
}: {
  draft: AmountDraft;
  onChange: (d: AmountDraft) => void;
  date: string;
  onEnter?: () => void;
  /** Off when the form renders <AmountPreview> itself, after its other fields. */
  preview?: boolean;
}) {
  const foreign = draft.currency !== "ILS";
  const enter = (e: React.KeyboardEvent) => e.key === "Enter" && onEnter?.();
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Amount
        <input
          value={draft.amount}
          onChange={(e) => onChange({ ...draft, amount: e.target.value })}
          onKeyDown={enter}
          inputMode="decimal"
          className={`w-24 text-right ${FIELD_CLS}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Currency
        <select
          value={draft.currency}
          // Back to ILS → the usual case, an amount with VAT; the preview shows it.
          onChange={(e) => onChange({ ...draft, currency: e.target.value, withVat: e.target.value === "ILS" })}
          className={FIELD_CLS}
        >
          {EXPENSE_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1 text-xs text-muted">
        VAT
        {foreign ? (
          <span
            title="Overseas suppliers don't charge Israeli VAT"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-faint"
          >
            No VAT · abroad
          </span>
        ) : (
          <Segmented
            options={[
              { value: "with", label: "With VAT" },
              { value: "without", label: "Without VAT" },
            ]}
            value={draft.withVat ? "with" : "without"}
            onChange={(v) => onChange({ ...draft, withVat: v === "with" })}
          />
        )}
      </div>
      {preview && <AmountPreview draft={draft} date={date} />}
    </>
  );
}

/** The VAT chip every list shows beside an amount. */
function VatChip({ r }: { r: ExpenseRowDb }) {
  const foreign = r.currency !== "ILS";
  const shape = foreign ? null : vatShapeOf(r);
  const label = foreign ? "no VAT · abroad" : shape === "incl" ? "incl. VAT" : shape === "mixed" ? "part VAT" : "no VAT";
  const title = foreign
    ? "Overseas supplier — no Israeli VAT, nothing deducted"
    : shape === "incl"
      ? "Amount includes VAT — taken off for the net figure"
      : shape === "mixed"
        ? "Receipt with some VAT — its net was entered from the receipt"
        : "Amount without VAT — counted as is";
  return (
    <span
      title={title}
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${
        shape === "incl" || shape === "mixed" ? "bg-brand-soft text-brand-dark" : "bg-surface-2 text-faint"
      }`}
    >
      {label}
    </span>
  );
}

/** A row's amount as paid + its VAT chip; click to edit both in a small panel. */
function AmountCell({
  r,
  editable,
  update,
}: {
  r: ExpenseRowDb;
  editable: boolean;
  update: ListProps["update"];
}) {
  const fx = useFx();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [draft, setDraft] = useState<AmountDraft>(EMPTY_AMOUNT);
  const fields = anchor ? amountFieldsOf(draft, r.date, fx) : null;
  function save() {
    if (!fields) return;
    update(r.id, fields);
    setAnchor(null);
  }
  return (
    <>
      <button
        disabled={!editable}
        onClick={(e) => {
          setDraft(amountDraftOf(r));
          setAnchor(e.currentTarget.getBoundingClientRect());
        }}
        title={editable ? "Edit amount and VAT" : undefined}
        className={`inline-flex items-center justify-end gap-1.5 rounded-md px-1.5 py-0.5 tabular-nums ${editable ? `cursor-pointer ${CELL_HOVER}` : "opacity-70"}`}
      >
        <VatChip r={r} />
        <span>
          {symbolOf(r.currency)}
          {Number(r.amount_gross)}
        </span>
      </button>
      {anchor &&
        createPortal(
          <div className="fixed inset-0 z-50" onClick={() => setAnchor(null)}>
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === "Escape" && setAnchor(null)}
              style={{
                top: Math.min(anchor.bottom + 6, window.innerHeight - 220),
                left: Math.max(12, Math.min(anchor.right - 460, window.innerWidth - 472)),
              }}
              className="absolute flex w-[460px] flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3 text-left shadow-lg"
            >
              <AmountFields draft={draft} onChange={setDraft} date={r.date} onEnter={save} />
              <div className="flex w-full justify-end gap-2">
                <button onClick={() => setAnchor(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-foreground">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={!fields}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** A row's net (no VAT) ₪ figure, with a hover saying how it was reached.
 * `month` is the month whose exchange rate applies (recurring rows). */
function NetCell({ r, year, month }: { r: ExpenseRowDb; year: number; month?: number }) {
  const fx = useFx();
  // Hovering opens the explain card (useExpensesExplain) — how this net was worked out.
  return <span data-cell={`xr|${r.id}${month ? `|${month}` : ""}`}>{formatILS(rowNetIls(r, year, fx, month))}</span>;
}

/** A recurring row's cost in one month of the viewed year — its share under the P&L's rule
 * (`monthShares`), so the column adds up to its footer; "–" in a month it costs nothing (not
 * started yet, ended, or a renewal's spread not reaching it). */
function ShareCell({ r, year, month }: { r: ExpenseRowDb; year: number; month: number }) {
  const v = monthShares(r, year, useFx())[month - 1];
  return <span data-cell={`xs|${r.id}|${month}`}>{v === undefined ? "–" : formatILS(v)}</span>;
}

// ── Hover cards ──────────────────────────────────────────────────────────────
// The same explain card as the Plan grid. Keys:
//   xm|m        a month's total          xt         the year's total
//   xr|id(|m)   a row's own net amount   xs|id|m    a row's share of month m
//   xp|id       a yearly row's cost per month

/** How a row's net figure is worked out, with its real numbers. */
function rowFormula(r: ExpenseRowDb, year: number, fx: FxTable | undefined, m: number): string {
  const gross = Number(r.amount_gross);
  const sym = CURRENCY_SYMBOL[r.currency as keyof typeof CURRENCY_SYMBOL] ?? `${r.currency} `;
  if (r.currency !== "ILS") {
    const q = fxQuote(fx, r.currency, year, m);
    return q.official
      ? `${sym}${gross} × ₪${q.rate.toFixed(3)} (${MONTH_NAMES[m - 1]}: Bank of Israel ${q.official.toFixed(3)} + ${Math.round(FX_MARKUP * 100)}%) · no VAT abroad`
      : `${sym}${gross} × ₪${q.rate.toFixed(2)} (fixed rate) · no VAT abroad`;
  }
  const shape = vatShapeOf(r);
  if (shape === "incl") return `${formatILS(gross)} incl. VAT − VAT = ${formatILS(Number(r.amount_no_vat))}`;
  if (shape === "mixed") return `${formatILS(Number(r.amount_no_vat))} without VAT, from the receipt (${formatILS(gross)} with it)`;
  return `${formatILS(gross)} — no VAT on it, counted as is`;
}

const rowName = (r: ExpenseRowDb) => r.vendor.trim() || r.description.trim() || "(unnamed)";

/** Hover cards for one expenses list. `at` is what a row puts into month m
 * under this tab's own rule; `yearOf` what it adds to the year's total. */
function useExpensesExplain({
  label,
  rows,
  year,
  at,
  yearOf,
}: {
  label: string;
  rows: ExpenseRowDb[];
  year: number;
  at: (r: ExpenseRowDb, m: number) => number;
  yearOf?: (r: ExpenseRowDb) => number;
}) {
  const fx = useFx();
  const resolve = (key: string): Explanation | null => {
    const [kind, a, b] = key.split("|");
    const itemsAt = (m: number) => rows.map((r) => ({ label: rowName(r), n: at(r, m) })).filter((i) => i.n);
    const totals = MONTH_NAMES.map((_, i) => itemsAt(i + 1).reduce((s, x) => s + x.n, 0));
    if (kind === "xm") {
      const m = Number(a);
      const items = itemsAt(m);
      return breakdownCard({
        title: `${label} · ${MONTH_NAMES[m - 1]} ${year}`,
        value: totals[m - 1],
        formula: `${items.length} ${items.length === 1 ? "entry" : "entries"}, all without VAT`,
        items,
        prev: m > 1 ? { items: itemsAt(m - 1), label: "last month" } : undefined,
        noun: NOUNS.vendor,
        upIsGood: false,
        series: { values: totals, current: m },
        sources: rows.filter((r) => at(r, m)).flatMap((r) => [`xr|${r.id}`, `xr|${r.id}|${m}`, `xs|${r.id}|${m}`]),
      });
    }
    if (kind === "xt") {
      // Rows that add nothing to the year (a renewal carried in from last year, paid then) stay out.
      const items = rows
        .map((r) => ({ label: rowName(r), n: yearOf ? yearOf(r) : totals.reduce((s, _, i) => s + at(r, i + 1), 0) }))
        .filter((i) => i.n);
      const value = items.reduce((s, x) => s + x.n, 0);
      const filled = totals.filter(Boolean);
      return breakdownCard({
        title: `${label} · ${year}`,
        value,
        formula: yearOf ? "Every payment this year, without VAT" : "Sum of the months, all without VAT",
        items,
        noun: NOUNS.vendor,
        upIsGood: false,
        series: { values: totals, current: null },
        notes: [!yearOf && filled.length ? `About ${formatILS(totals.reduce((s, v) => s + v, 0) / filled.length)} a month` : null],
      });
    }
    const r = rows.find((x) => x.id === a);
    if (!r) return null;
    const m = b ? Number(b) : Number(r.date.slice(5, 7));
    const period = renewMonths(r);
    const series = { values: MONTH_NAMES.map((_, i) => at(r, i + 1)), current: kind === "xr" && !b ? null : m };
    const monthShare = totals[m - 1] && at(r, m) ? `${Math.round((at(r, m) / totals[m - 1]) * 100)}% of ${MONTH_NAMES[m - 1]}'s ${label.toLowerCase()}` : null;
    // The payment is converted in the year it was made — a renewal carried in from last year too.
    const own = Number(r.date.slice(0, 4));
    const paid = paidNet(r, fx);
    const value = kind === "xs" ? at(r, m) : kind === "xp" ? paid / period : b ? rowNetIls(r, year, fx, m) : paid;
    const spread = spreadsYearly(r) ? `${formatILS(paid)} spread over ${period} months` : null;
    return {
      title: `${rowName(r)} · ${kind === "xp" ? "per month" : MONTH_NAMES[m - 1]}`,
      value: formatILS(value),
      formula: kind === "xp" || (kind === "xs" && spreadsYearly(r)) ? `${formatILS(paid)} ÷ ${period} months` : rowFormula(r, b ? year : own, fx, m),
      trends: [],
      notes: [spread && kind !== "xp" ? spread : null, kind === "xs" || b ? monthShare : null, r.notes?.trim() ? `Note: ${r.notes.trim()}` : null].filter(
        (n): n is string => !!n,
      ),
      series,
      sources: [],
    };
  };
  return useExplainHover(resolve);
}

type RepeatChoice = "none" | "monthly" | "yearly";

const REPEAT_OPTIONS: { value: RepeatChoice; label: string }[] = [
  { value: "none", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

function categoryForRepeat(
  repeat: RepeatChoice,
  oneOffType: "misc" | "investment",
): ExpenseCategory {
  if (repeat === "none") return oneOffType;
  if (repeat === "monthly") return "monthly";
  return "yearly";
}

/** Global "add expense" popup — figures out which tab a new expense belongs
 * to (and whether it repeats) from a single form, rather than making the
 * user pick the right tab up front. */
function AddExpenseDialog({
  onAdd,
  onClose,
}: {
  onAdd:(category: ExpenseCategory, patch: Partial<ExpenseRowDb>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<AmountDraft>(EMPTY_AMOUNT);
  const [date, setDate] = useState(studioToday());
  const [repeat, setRepeat] = useState<RepeatChoice>("monthly");
  const [renewM, setRenewM] = useState(12);
  const fx = useFx();
  const [oneOffType, setOneOffType] = useState<"misc" | "investment">("misc");

  const category = categoryForRepeat(repeat, oneOffType);
  const catLabel = TABS.find((t) => t.key === category)?.label ?? category;
  const dateLabel =
    category === "monthly"
      ? "Accrues from"
      : category === "yearly"
        ? "Renewal date"
        : "Date";
  const fields = amountFieldsOf(amount, date, fx);
  const valid = name.trim() !== "" && fields != null;

  function submit() {
    if (!valid) return;
    const patch: Partial<ExpenseRowDb> = {
      vendor: name.trim(),
      ...fields,
      date,
    };
    if (repeat === "yearly") patch.renew_months = renewM;
    onAdd(category, patch);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg"
      >
        <h3 className="text-sm font-semibold text-foreground">Add expense</h3>
        <div className="mt-4 space-y-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Company / description
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoFocus
              className="bidi-auto rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <AmountFields draft={amount} onChange={setAmount} date={date} onEnter={submit} />
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {dateLabel}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-[8.6rem] rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="flex flex-col gap-1 text-xs text-muted">
            Repeats
            <Segmented options={REPEAT_OPTIONS} value={repeat} onChange={setRepeat} />
          </div>
          {repeat === "none" && (
            <div className="flex flex-col gap-1 text-xs text-muted">
              Type
              <Segmented
                options={[
                  { value: "misc", label: "Misc" },
                  { value: "investment", label: "Investment" },
                ]}
                value={oneOffType}
                onChange={setOneOffType}
              />
            </div>
          )}
          {repeat === "yearly" && (
            <div className="flex flex-col gap-1 text-xs text-muted">
              One payment covers (years)
              <Segmented options={yearsOptions} value={renewM} onChange={setRenewM} />
            </div>
          )}
          <p className="rounded-lg bg-brand-soft/40 px-3 py-2 text-xs text-brand-dark">
            → Goes to the <span className="font-semibold">{catLabel}</span> tab.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-background"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
          >
            Add expense
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Quick-edit popup opened from a Summary-tab line — the fields shown adapt
 * to the row's own category (only Yearly gets "renews every", only Monthly
 * gets an end date). */
function EditExpenseDialog({
  row,
  editable,
  onSave,
  onDelete,
  onClose,
}: {
  row: ExpenseRowDb;
  /** Whether this row can be edited at all outside this dialog (the page's
   * own year gate) — combined with the row's own lock state below, exactly
   * like every other edit surface in this file (see `Row`'s `canEdit`). A
   * "final" row must be just as read-only from Summary as it is from its
   * native tab, or locking a month from one tab would silently mean nothing
   * from this one. */
  editable: boolean;
  onSave: (id: string, patch: Partial<ExpenseRowDb>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const locked = isLocked(row.state);
  // A subscription still running is editable whatever year it's in — as on its own tab (`Row`,
  // `MonthlyRow`); from Summary it used to open read-only.
  const canEdit = (ownYearEditable(row, editable) || stillRunning(row)) && !locked;
  const [vendor, setVendor] = useState(row.vendor);
  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState<AmountDraft>(() => amountDraftOf(row));
  const [date, setDate] = useState(row.date);
  const [endDate, setEndDate] = useState(row.end_date ?? "");
  const [renewM, setRenewM] = useState(row.renew_months ?? 12);
  const [notes, setNotes] = useState(row.notes ?? "");
  const [link, setLink] = useState(row.link ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fx = useFx();

  const catLabel =
    TABS.find((t) => t.key === row.category)?.label ?? row.category;
  const fields = amountFieldsOf(amount, date, fx);
  const valid = canEdit && fields != null;

  function save() {
    if (!valid) return;
    const patch: Partial<ExpenseRowDb> = {
      vendor: vendor.trim(),
      description: description.trim(),
      ...fields,
      date,
      notes: notes.trim(),
      link: link.trim() || null,
    };
    if (row.category === "monthly" || row.category === "yearly")
      patch.end_date = endDate || null;
    if (row.category === "yearly") patch.renew_months = renewM;
    onSave(row.id, patch);
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Edit expense
          </h3>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
            {catLabel}
          </span>
        </div>
        {locked && (
          <p className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            Locked — this line is finalized. Unlock it from its own tab first to edit or delete it.
          </p>
        )}
        <fieldset disabled={!canEdit} className="mt-4 space-y-3 disabled:opacity-60">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Company / vendor
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="bidi-auto rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bidi-auto rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <AmountFields draft={amount} onChange={setAmount} date={date} onEnter={save} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-[8.6rem] rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            {row.category === "monthly" && (
              <label className="flex flex-col gap-1 text-xs text-muted">
                Ends
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-[8.6rem] rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                />
              </label>
            )}
            {row.category === "yearly" && (
              <>
                <div className="flex flex-col gap-1 text-xs text-muted">
                  One payment covers (years)
                  <Segmented options={yearsOptions} value={renewM} onChange={setRenewM} />
                </div>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Ends (optional)
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-[8.6rem] rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                  />
                </label>
              </>
            )}
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Notes
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bidi-auto rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Link
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
        </fieldset>
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={!canEdit}
            title={locked ? "Locked — unlock the row first" : undefined}
            className="text-sm text-danger hover:underline disabled:opacity-40 disabled:no-underline"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-background"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!valid}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this line?"
          body={
            `"${vendor.trim() || description.trim() || "This line"}" will be permanently removed.` +
            (row.category === "monthly" || row.category === "yearly"
              ? " If you're only ending it, set its “Ends” date instead — deleting also erases what you've already paid for it."
              : "")
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            onDelete(row.id);
            onClose();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>,
    document.body,
  );
}

function Row({
  r,
  editable,
  update,
  remove,
  saveNotes,
  cols,
  cells,
  year,
  moveTo,
}: {
  r: ExpenseRowDb;
  editable: boolean;
  update: ListProps["update"];
  remove: ListProps["remove"];
  saveNotes: ListProps["saveNotes"];
  /** The table's columns after the pinned Date, in order (`useTableColumns`). */
  cols: string[];
  /** The tab's own cells by column key, beside the shared ones (description, vendor, gross, novat, paperwork). */
  cells?: Record<string, ReactNode>;
  year?: number;
  moveTo?: MoveTo;
}) {
  const gross = Number(r.amount_gross);
  const [pending, setPending] = useState<"delete" | "move" | null>(null);
  const label = r.description.trim() || r.vendor.trim() || fmtDayMonth(r.date);
  // The user-facing comment is `notes` itself (a plain free-text field).
  const comment = (r.notes ?? "").trim();
  const commentEditor = useCommentEditor();
  const saveComment = (v: string) => saveNotes(r.id, v.trim(), r.state);
  // A "final" row is admin-locked, not merely within an editable year — the
  // guard trigger blocks any write (including delete/category-move) that
  // leaves it final-to-final. Every field below except the comment (which
  // goes through saveNotes's own unlock-relock dance) must reflect that, or
  // an edit here silently fails with a raw "Save failed" message instead of
  // the field simply being read-only. One flag, used the same way (canEdit /
  // !canEdit) everywhere below, so a field can't get the polarity wrong.
  // `locked` is kept separately only to word the delete/move tooltip
  // correctly — "unlock the row" would be misleading for a row that's simply
  // outside the editable year.
  const locked = isLocked(r.state);
  const canEdit = (ownYearEditable(r, editable) || stillRunning(r)) && !locked;
  const all: Record<string, ReactNode> = {
    description: (
      <td className="px-3 py-1.5">
        <TextCell value={r.description} editable={canEdit} width="w-full" onCommit={(v) => update(r.id, { description: v })} />
      </td>
    ),
    vendor: (
      <td className="px-3 py-1.5">
        <TextCell value={r.vendor} editable={canEdit} width="w-full" onCommit={(v) => update(r.id, { vendor: v })} />
        <PriceNote id={r.id} />
      </td>
    ),
    gross: (
      <td
        className="relative px-3 py-1.5 text-right"
        onContextMenu={(e) => {
          e.preventDefault();
          commentEditor.show();
        }}
      >
        <AmountCell r={r} editable={canEdit} update={update} />
        {comment && <CommentBadge comment={comment} onOpen={commentEditor.show} />}
        {commentEditor.open && (
          <CommentEditorDialog
            initial={comment}
            onSave={(v) => {
              saveComment(v);
              commentEditor.hide();
            }}
            onCancel={commentEditor.hide}
          />
        )}
      </td>
    ),
    novat: (
      <td className="px-3 py-1.5 text-right tabular-nums text-muted">
        <NetCell r={r} year={year ?? studioYear()} />
      </td>
    ),
    ...paperworkCells(r, canEdit, update),
    ...cells,
  };
  return (
    <>
      <tr
        data-advice={`row:${r.id}`}
        className={`group border-t border-border ${isEnded(r) ? "opacity-50" : ""}`}
        title={isEnded(r) ? `Ended ${fmtDayMonth(r.end_date!)} — won't renew again` : undefined}
      >
        <td className="px-3 py-1.5">
          <DateCell r={r} editable={canEdit} update={update} />
        </td>
        {cols.map((k) => (
          <Fragment key={k}>{all[k] ?? <td />}</Fragment>
        ))}
        <td className="px-3 py-1.5 text-right">
          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {moveTo && (
              <button
                onClick={() => setPending("move")}
                disabled={!canEdit}
                title={locked ? "Locked — unlock the row first" : moveTo.title}
                className="text-faint hover:text-brand disabled:opacity-30"
              >
                <ArrowLeftRight size={14} />
              </button>
            )}
            <button
              onClick={() => setPending("delete")}
              disabled={!canEdit}
              title={locked ? "Locked — unlock the row first" : "Delete"}
              className="text-faint hover:text-danger disabled:opacity-30"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </td>
      </tr>
      {pending === "delete" &&
        createPortal(
          <ConfirmDialog
            title="Delete this line?"
            body={
              `"${label}" (${fmtDayMonth(r.date)}, ${symbolOf(r.currency)}${gross}) will be permanently removed.` +
              (r.category === "yearly"
                ? " If you're only ending the subscription, set its “Ends” date instead — deleting also erases this year's already-paid renewal."
                : "")
            }
            confirmLabel="Delete"
            danger
            onConfirm={() => {
              remove(r.id);
              setPending(null);
            }}
            onCancel={() => setPending(null)}
          />,
          document.body,
        )}
      {pending === "move" &&
        moveTo &&
        createPortal(
          <ConfirmDialog
            title={`Move to ${moveTo.toCategory === "misc" ? "Misc" : "Investments"}?`}
            body={`"${label}" (${fmtDayMonth(r.date)}, ${symbolOf(r.currency)}${gross}) will move out of ${
              moveTo.toCategory === "misc" ? "Investments" : "Misc"
            }.`}
            confirmLabel="Move"
            onConfirm={() => {
              update(r.id, { category: moveTo.toCategory });
              setPending(null);
            }}
            onCancel={() => setPending(null)}
          />,
          document.body,
        )}
    </>
  );
}

// ── Monthly (subscriptions) — Company / Price+currency+VAT / Net ₪ / accrual window / notes / link ──

/**
 * An expense's paperwork as its own columns (v1.19.0, Nitsan 2026-11-08: "it
 * should be inside the line as new columns, not hidden behind the icon"):
 * the invoice file(s), the invoice number and what paid it ("Visa ••3562").
 * Filled from the receipt when the row came from the mail — marked with an
 * envelope while the value is still as the email gave it — and editable here.
 * Number and card wait for reference/0018, files for reference/0019.
 */
function usePaperwork() {
  const { details, docs } = useContext(DetailsContext);
  const files = docs != null;
  // A paperwork column shows once its table exists; every other column always does.
  const has = useCallback((k: string) => (k === "file" ? files : k === "invoiceNo" || k === "paidWith" ? details : true), [files, details]);
  return { files, fields: details, has };
}

/** Default widths for the paperwork columns, merged into each table's own. */
const PAPERWORK_COL_DEFAULTS = { file: 70, invoiceNo: 150, paidWith: 160 };
const PAPERWORK_LABEL: Record<string, string> = { file: "Invoice", invoiceNo: "Invoice no.", paidWith: "Paid with" };
const PAPERWORK_TITLE: Record<string, string> = {
  file: "The invoice or receipt file — click to preview or download",
  invoiceNo: "The invoice or receipt number",
  paidWith: "The card or account it was paid with",
};

/**
 * A table's columns (v1.20.0, Nitsan 2026-11-08: "an option to rearrange
 * columns, set their width"): widths and order, each remembered per table in
 * this browser; paperwork columns only once their tables exist. `cols` is the
 * order to render header, `<col>`s and cells in.
 */
function useTableColumns(storageKey: string, order: readonly string[], widthDefaults: Record<string, number>) {
  const { widths, startResize, changed: widened, reset: resetWidths } = useResizableColumns(storageKey, widthDefaults);
  const { order: ordered, drag, changed: moved, reset: resetOrder } = useColumnOrder(storageKey, order);
  const { has } = usePaperwork();
  const cols = ordered.filter(has);
  return {
    cols,
    widths,
    startResize,
    drag,
    width: cols.reduce((s, k) => s + (widths[k] ?? 120), 0),
    changed: widened || moved,
    reset: () => {
      resetWidths();
      resetOrder();
    },
  };
}

/** The empty header over a table's row actions: "reset the columns" once they've been moved or resized. */
function ColumnsResetTh({ t }: { t: { changed: boolean; reset: () => void } }) {
  return (
    <th className="px-2 py-2 text-right">
      {t.changed && (
        <button onClick={t.reset} title="Put the columns back in their usual order and widths" className="text-faint hover:text-brand">
          <RotateCcw size={12} />
        </button>
      )}
    </th>
  );
}

/** The envelope beside a value the receipt email filled in. */
function FromMailMark({ what }: { what: string }) {
  return (
    <span title={`${what} read from the receipt email`} className="shrink-0 text-faint">
      <Mail size={11} aria-label={`${what} read from the receipt email`} />
    </span>
  );
}

/** The paperwork cells of a row, by column key. */
function paperworkCells(r: ExpenseRowDb, editable: boolean, update: (id: string, p: Partial<ExpenseRowDb>) => void): Record<string, ReactNode> {
  return {
    file: (
      <td className="px-3 py-1.5">
        <FilesCell r={r} editable={editable} />
      </td>
    ),
    invoiceNo: <InvoiceNoTd r={r} editable={editable} update={update} />,
    paidWith: <PaidWithTd r={r} editable={editable} update={update} />,
  };
}

function InvoiceNoTd({ r, editable, update }: { r: ExpenseRowDb; editable: boolean; update: (id: string, p: Partial<ExpenseRowDb>) => void }) {
  const origin = useContext(DetailsContext).fromMail.get(r.id);
  const invoice = r.invoice_number ?? "";
  return (
    <td className="px-3 py-1.5" title={invoice || undefined}>
      <span className="flex items-center gap-1">
        {/* keyed on the value, so a change made elsewhere (the mail list's Add) shows */}
        <span className="min-w-0 flex-1">
          <TextCell key={invoice} value={invoice} editable={editable} width="w-full tabular-nums" onCommit={(v) => update(r.id, { invoice_number: v.trim() || null })} />
        </span>
        {origin?.invoice && origin.invoice === invoice && <FromMailMark what="Invoice number" />}
      </span>
    </td>
  );
}

/** "Mastercard ••5065" → "5065": the card's last four digits, or null when the value has none. */
function cardDigits(paid: string): string | null {
  return paid.match(/(\d{4})\D*$/)?.[1] ?? null;
}

/**
 * What paid it, as a card icon and its last four digits (Nitsan, 2026-11-08:
 * "Mastercard ••5065" → the icon and 5065) — the full text on hover, and to
 * edit on click. A value with no card digits ("PayPal") shows as typed.
 */
function PaidWithTd({ r, editable, update }: { r: ExpenseRowDb; editable: boolean; update: (id: string, p: Partial<ExpenseRowDb>) => void }) {
  const origin = useContext(DetailsContext).fromMail.get(r.id);
  const paid = r.paid_with ?? "";
  const digits = cardDigits(paid);
  const [editing, setEditing] = useState(false);
  return (
    <td className="px-3 py-1.5" title={paid || undefined}>
      <span className="flex items-center gap-1">
        <span className="min-w-0 flex-1">
          {digits && !editing ? (
            <button
              type="button"
              disabled={!editable}
              onClick={() => setEditing(true)}
              aria-label={paid}
              className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 tabular-nums disabled:opacity-70 ${editable ? `cursor-pointer ${CELL_HOVER}` : ""}`}
            >
              <CreditCard size={14} className="shrink-0 text-faint" />
              {digits}
            </button>
          ) : (
            <input
              key={paid}
              defaultValue={paid}
              disabled={!editable}
              autoFocus={editing}
              onBlur={(e) => {
                setEditing(false);
                if (e.target.value !== paid) update(r.id, { paid_with: e.target.value.trim() || null });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  (e.target as HTMLInputElement).value = paid;
                  setEditing(false);
                }
              }}
              className={`bidi-auto w-full bg-transparent px-1.5 py-0.5 text-left outline-none disabled:opacity-70 ${CELL_HOVER} ${CELL_FOCUS}`}
            />
          )}
        </span>
        {origin?.paid && origin.paid === paid && <FromMailMark what="Card" />}
      </span>
    </td>
  );
}

/** What each receipt put on a row read (v1.23.0): amount, what was bought, invoice number, card. */
function ReceiptLines({ recs, currency }: { recs: RowReceipt[]; currency: string }) {
  return (
    <>
      {recs.map((rc) => (
        <p key={rc.id} className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-muted">
          {rc.amount != null && (
            <span className="font-medium text-foreground tabular-nums">
              {symbolOf(rc.currency ?? currency)}
              {rc.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </span>
          )}
          {rc.item && <span className="bidi-auto min-w-0 truncate">{rc.item}</span>}
          {rc.invoiceNumber && <span className="tabular-nums" title="Invoice number">№ {rc.invoiceNumber}</span>}
          {rc.paidWith && (
            <span className="inline-flex items-center gap-1 tabular-nums" title="Paid with">
              <CreditCard size={11} className="shrink-0" />
              {rc.paidWith}
            </span>
          )}
        </p>
      ))}
    </>
  );
}

/**
 * A Rent cell's paperwork (v1.24.0, Nitsan 2026-11-09: "adapt the Rent tab to
 * the semi-auto approach"): the bill(s) it came from, its files to preview or
 * download, and a file to add for the cell's month.
 */
function CellFilesDialog({ title, rows, month, editable, onClose }: { title: string; rows: ExpenseRowDb[]; month: string; editable: boolean; onClose: () => void }) {
  const { docs, receipts, reloadDocs } = useContext(DetailsContext);
  const files = rows.flatMap((x) => docs?.get(x.id) ?? []);
  const recs = rows.flatMap((x) => receipts.get(x.id) ?? []);
  const first = rows[0];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!first) return null;
  const own = [first.invoice_number ? `№ ${first.invoice_number}` : "", first.paid_with ?? ""].filter(Boolean);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-surface p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="bidi-auto text-sm font-medium">{title}</p>
        <div className="mt-3 text-xs">
          {recs.length ? (
            <ReceiptLines recs={recs} currency={first.currency ?? "ILS"} />
          ) : own.length ? (
            <p className="mb-1 text-muted tabular-nums">{own.join(" · ")}</p>
          ) : null}
          {/* The bill's own link when there's no file (v1.24.4: Idan Shani's confirmation, Mei Avivim's login). */}
          {!files.length && (first.link?.startsWith("https://") || recs[0]?.link) && (
            <a
              href={first.link?.startsWith("https://") ? first.link : recs[0].link}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-brand hover:bg-brand-soft"
            >
              <LinkIcon size={12} />
              Open the bill ↗
            </a>
          )}
          {files.length || editable ? (
            <DocList docs={files} expenseId={first.id} editable={editable} onChange={reloadDocs} month={month} addLabel={files.length ? "Add" : "Add the bill"} />
          ) : (
            <p className="text-faint">No file for this month yet.</p>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "2026-08" → "Aug 2026". */
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A Monthly row's months, newest first (v1.22.0, Nitsan 2026-11-09: "12 files
 * per line — organise them by month"): from its start to its end or this
 * month, plus any month a file or receipt is for.
 */
function rowMonths(r: ExpenseRowDb, docs: DocRef[], receipts: RowReceipt[]): string[] {
  // This month in Tel Aviv: the UTC month (toISOString) was still last month until 02:00/03:00 on the 1st.
  const now = studioToday().slice(0, 7);
  const last = r.end_date && r.end_date.slice(0, 7) < now ? r.end_date.slice(0, 7) : now;
  const out = new Set<string>();
  let [y, m] = r.date.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < 60; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > last) break;
    out.add(ym);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  for (const d of docs) if (d.month) out.add(d.month);
  for (const rc of receipts) out.add(rc.date.slice(0, 7));
  return [...out].sort().reverse();
}

/** The row's invoice file(s): an icon to preview, download or add — the envelope when the mail brought it. */
function FilesCell({ r, editable }: { r: ExpenseRowDb; editable: boolean }) {
  const { docs: allDocs, receipts: allReceipts, reloadDocs } = useContext(DetailsContext);
  const [open, setOpen] = useState(false);
  const docs = allDocs?.get(r.id) ?? [];
  const receipts = allReceipts.get(r.id) ?? [];
  const mail = docs.some((d) => d.fromMail);
  const monthly = r.category === "monthly" && allDocs != null;
  const months = monthly ? rowMonths(r, docs, receipts) : [];
  const withFile = months.filter((ym) => docs.some((d) => d.month === ym)).length;
  if (!docs.length && !receipts.length && !editable) return null;
  const names = docs.map((d) => d.filename).join(", ");
  const title = monthly ? `Invoices for ${withFile} of ${months.length} month${months.length === 1 ? "" : "s"}` : `${names}${mail ? " — from the receipt email" : ""}`;
  return (
    <>
      {docs.length || receipts.length ? (
        <button onClick={() => setOpen(true)} title={title} className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-brand hover:bg-brand-soft">
          <FileText size={14} />
          {monthly ? (
            <span className={`text-[11px] font-medium tabular-nums ${withFile < months.length ? "text-faint" : ""}`}>
              {withFile}/{months.length}
            </span>
          ) : (
            docs.length > 1 && <span className="text-[11px] font-medium tabular-nums">{docs.length}</span>
          )}
          {mail && <Mail size={11} className="text-faint" aria-label="From the receipt email" />}
        </button>
      ) : (
        <button onClick={() => setOpen(true)} title="Add the invoice file" className="text-faint opacity-0 transition-opacity hover:text-brand group-hover:opacity-100 group-focus-within:opacity-100">
          <Paperclip size={13} />
        </button>
      )}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
            <div className={`flex max-h-[85vh] w-full flex-col rounded-xl bg-surface p-4 shadow-xl ${monthly ? "max-w-lg" : "max-w-sm"}`} onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-medium">
                {r.vendor.trim() || r.description.trim() || "Expense"} · {monthly ? "invoices by month" : fmtDayMonth(r.date)}
              </p>
              {monthly ? (
                <div className="mt-3 min-h-0 overflow-y-auto">
                  <table className="w-full table-fixed text-xs">
                    <tbody>
                      {months.map((ym) => {
                        const files = docs.filter((d) => d.month === ym);
                        const recs = receipts.filter((rc) => rc.date.startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date));
                        return (
                          <tr key={ym} className="border-t border-border align-top first:border-t-0">
                            <td className="w-[4.75rem] py-2 pr-2 font-medium whitespace-nowrap">{monthLabel(ym)}</td>
                            <td className="py-1.5">
                              {/* What each receipt that month read (v1.23.0): amount, what was bought, number, card. */}
                              <ReceiptLines recs={recs} currency={r.currency} />
                              <div className="flex flex-wrap items-center gap-1.5">
                                {files.length > 0 || editable ? (
                                  <DocList docs={files} expenseId={r.id} editable={editable} onChange={reloadDocs} month={ym} addLabel={files.length ? "Add" : "Add the invoice"} />
                                ) : (
                                  !recs.length && <span className="text-faint">—</span>
                                )}
                                {!files.length &&
                                  recs.map((rc) => (
                                    <a key={rc.id} href={rc.link} target="_blank" rel="noopener noreferrer" title="The receipt email didn't attach the invoice — get it from there" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-brand hover:bg-brand-soft">
                                      <Mail size={12} />
                                      Get the invoice ↗
                                    </a>
                                  ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-1 text-xs text-muted">
                  Invoice files
                  <DocList docs={docs} expenseId={r.id} editable={editable} onChange={reloadDocs} />
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2">
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Date-or-"—" cell for a nullable end date, with a clear (×) button once set. */
function EndDateCell({
  r,
  editable,
  update,
}: {
  r: ExpenseRowDb;
  editable: boolean;
  update: (id: string, p: Partial<ExpenseRowDb>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        disabled={!editable}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (typeof el.showPicker === "function") el.showPicker();
          else el.focus();
        }}
        className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 tabular-nums ${
          editable ? `cursor-pointer ${CELL_HOVER}` : "opacity-70"
        }`}
      >
        {r.end_date ? (
          fmtDayMonth(r.end_date)
        ) : (
          <span className="text-faint">still active</span>
        )}
      </button>
      {editable && r.end_date && (
        <button
          onClick={() => update(r.id, { end_date: null })}
          title="Clear — still active"
          className="text-faint hover:text-danger"
        >
          <X size={12} />
        </button>
      )}
      <input
        ref={ref}
        type="date"
        defaultValue={r.end_date ?? ""}
        tabIndex={-1}
        aria-hidden
        onChange={(e) =>
          e.target.value &&
          e.target.value !== r.end_date &&
          update(r.id, { end_date: e.target.value })
        }
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
      />
    </span>
  );
}

function MonthlyRow({
  r,
  editable: yearEditable,
  update,
  remove,
  saveNotes,
  year,
  markFiled,
  cols,
}: {
  r: ExpenseRowDb;
  editable: boolean;
  update: ListProps["update"];
  remove: ListProps["remove"];
  saveNotes: ListProps["saveNotes"];
  year: number;
  markFiled?: ListProps["markFiled"];
  /** The columns after the filed tick, in order (`useTableColumns`). */
  cols: string[];
}) {
  const [pending, setPending] = useState(false);
  // A subscription still running is editable whatever year it started in — but a "final" row is
  // locked whatever its year, as in `Row`: these fields used to stay open and fail with a raw
  // "Save failed" from the guard trigger. Notes are the owner's comments and stay writable on a
  // locked row, through saveNotes's unlock-relock (`notesEditable`).
  const locked = isLocked(r.state);
  const notesEditable = ownYearEditable(r, yearEditable) || stillRunning(r);
  const editable = notesEditable && !locked;
  const label = r.vendor.trim() || fmtDayMonth(r.date);
  // Filing marks are for this month's invoices: this year's live subscriptions only — one carried
  // in from an earlier year (see `load`) is billed this month too, so it gets its ✓ and counts in n/m.
  const canFile = !!markFiled && year === studioYear() && !isEnded(r);
  const filed = canFile && isFiled(r.filed_at);
  // A receipt came after this row ended (Nitsan, 2026-11-07: "a red note — something to check here").
  const flag = useContext(DetailsContext).flags.get(r.id);
  const cells: Record<string, ReactNode> = {
    company: (
      <td className="px-3 py-1.5">
        <TextCell value={r.vendor} editable={editable} width="w-full" onCommit={(v) => update(r.id, { vendor: v })} />
        {flag && (
          <p
            className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-danger"
            title={`"${flag.subject}" — still running, or a charge to check? See "From your mail" above.`}
          >
            <AlertTriangle size={11} className="shrink-0" />
            Receipt {fmtDayMonth(flag.date)}, after it ended — check
          </p>
        )}
        <PriceNote id={r.id} />
      </td>
    ),
    // What it is — from the receipt when it came from the mail; Notes stay the owner's own comments.
    description: (
      <td className="px-3 py-1.5">
        <TextCell value={r.description} editable={editable} width="w-full" onCommit={(v) => update(r.id, { description: v })} />
      </td>
    ),
    price: (
      <td className="px-3 py-1.5 text-right">
        <AmountCell r={r} editable={editable} update={update} />
      </td>
    ),
    net: (
      <td className="px-3 py-1.5 text-right tabular-nums text-muted">
        <ShareCell r={r} year={year} month={displayMonth(year)} />
      </td>
    ),
    start: (
      <td className="px-3 py-1.5">
        <DateCell r={r} editable={editable} update={update} />
      </td>
    ),
    end: (
      <td className="px-3 py-1.5">
        <EndDateCell r={r} editable={editable} update={update} />
      </td>
    ),
    ...paperworkCells(r, editable, update),
    notes: (
      <td className="px-3 py-1.5">
        <TextCell value={r.notes} editable={notesEditable} width="w-full" onCommit={(v) => saveNotes(r.id, v, r.state)} />
      </td>
    ),
    link: (
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1">
          <TextCell value={r.link ?? ""} editable={editable} width="w-full" onCommit={(v) => update(r.id, { link: v || null })} />
          {r.link && safeHref(r.link) && (
            <a href={safeHref(r.link)!} target="_blank" rel="noreferrer" title={r.link} className="shrink-0 text-faint hover:text-brand">
              <LinkIcon size={13} />
            </a>
          )}
        </div>
      </td>
    ),
  };
  return (
    <>
      <tr
        data-advice={`row:${r.id}`}
        className={`group border-t border-border ${isEnded(r) && !flag ? "opacity-50" : ""} ${filed ? "bg-[#dcfce4]" : ""}`}
        title={isEnded(r) ? `Ended ${fmtDayMonth(r.end_date!)} — won't renew again` : undefined}
      >
        <td className="px-2 py-1.5 text-center">
          {canFile && (
            <input
              type="checkbox"
              checked={filed}
              onChange={(e) => markFiled!(r.id, e.target.checked, r.state)}
              title={filed ? `Invoice filed — clears on the ${FILING_RESET_DAY}th` : "Mark the invoice as filed"}
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--success)]"
            />
          )}
        </td>
        {cols.map((k) => (
          <Fragment key={k}>{cells[k] ?? <td />}</Fragment>
        ))}
        <td className="px-3 py-1.5 text-right">
          <span className="inline-flex items-center gap-1">
            <button
              onClick={() => setPending(true)}
              disabled={!editable}
              title={locked ? "Locked — unlock the row first" : "Delete"}
              className="text-faint opacity-0 transition-opacity hover:text-danger disabled:opacity-30 group-hover:opacity-100"
            >
              <Trash2 size={15} />
            </button>
          </span>
        </td>
      </tr>
      {pending &&
        createPortal(
          <ConfirmDialog
            title="Delete this line?"
            body={`"${label}" (${symbolOf(r.currency)}${Number(r.amount_gross)}) will be permanently removed. If you're only ending it, set its “Ends” date instead — deleting also erases what you've already paid for it.`}
            confirmLabel="Delete"
            danger
            onConfirm={() => {
              remove(r.id);
              setPending(false);
            }}
            onCancel={() => setPending(false)}
          />,
          document.body,
        )}
    </>
  );
}

/** Collapse a vendor→amount breakdown to its top N slices, bucketing the rest
 * into "Other" so the pie stays readable regardless of how many vendors exist. */
function topVendorSlices(byVendor: Map<string, number>, max = 6): PieSlice[] {
  const sorted = [...byVendor.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, max);
  const restTotal = sorted.slice(max).reduce((s, [, v]) => s + v, 0);
  const slices: PieSlice[] = top.map(([label, value]) => ({ label, value }));
  if (restTotal > 0) slices.push({ label: "Other", value: restTotal });
  return slices;
}

const CHARTS_KEY = "expenses.charts";

/**
 * The charts beside a tab's table, one under the other in a pane on the
 * right that folds away to give the table the room (Nitsan, 2026-11-08:
 * "one under the other in a foldable pane"). Folded or open is remembered for
 * every tab. `grid` goes on the tab's outer grid, `pane(charts)` in its
 * second cell.
 */
function useChartsPane() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(CHARTS_KEY) !== "0");
    } catch {
      // storage unavailable — open
    }
  }, []);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(CHARTS_KEY, o ? "0" : "1");
      } catch {
        // just won't be remembered
      }
      return !o;
    });
  const grid = `grid grid-cols-1 gap-4 ${open ? "lg:grid-cols-[minmax(0,1fr)_300px]" : "lg:grid-cols-[minmax(0,1fr)_auto]"}`;
  const pane = (charts: ReactNode) =>
    open ? (
      <aside className="min-w-0 space-y-2">
        <button
          onClick={toggle}
          title="Fold the charts away — the table gets the room"
          className="flex w-full items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-faint hover:text-foreground"
        >
          Charts
          <PanelRightClose size={15} />
        </button>
        {charts}
      </aside>
    ) : (
      <button
        onClick={toggle}
        title="Show the charts"
        className="flex items-center gap-2 self-start rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium uppercase tracking-wide text-faint hover:text-foreground lg:flex-col lg:px-2 lg:py-3"
      >
        <PanelRightOpen size={15} />
        <span className="lg:[writing-mode:vertical-rl]">Charts</span>
      </button>
    );
  return { grid, pane };
}

/** The "Monthly totals" trend + "Top vendors" pie shown beside every list tab
 * (except Rent, which is a grid rather than a list of dated rows). */
function TabGraphsPane({
  year,
  monthlyPoints,
  vendorSlices,
}: {
  year: number;
  monthlyPoints: MonthPoint[];
  vendorSlices: PieSlice[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          Monthly totals
        </h3>
        <MonthlyLineChart points={monthlyPoints} />
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          Top vendors · {year}
        </h3>
        <PieChart ariaLabel="Total by vendor" slices={vendorSlices} />
      </div>
    </div>
  );
}

const MONTHLY_COL_DEFAULTS = {
  company: 160,
  description: 160,
  price: 180,
  net: 110,
  start: 100,
  end: 120,
  notes: 180,
  link: 130,
};

const MONTHLY_WIDTHS = { ...MONTHLY_COL_DEFAULTS, ...PAPERWORK_COL_DEFAULTS };
const MONTHLY_ORDER = ["company", "description", "price", "net", "start", "end", "file", "invoiceNo", "paidWith", "notes", "link"];

function MonthlyList({
  rows,
  editable,
  update,
  remove,
  insertRow,
  saveNotes,
  year,
  markFiled,
  filterSlot,
}: ListProps & { year: number; filterSlot: HTMLDivElement | null }) {
  const [sort, setSort] = useState<Sort>({ key: "date", dir: 1 });
  // Ended subscriptions can be tucked away — a per-viewer preference, remembered.
  const [showEnded, setShowEnded] = useState(true);
  useEffect(() => {
    try {
      setShowEnded(localStorage.getItem("expenses.monthly.showEnded") !== "0");
    } catch {
      // storage unavailable — keep showing them
    }
  }, []);
  function toggleEnded() {
    setShowEnded((v) => {
      try {
        localStorage.setItem("expenses.monthly.showEnded", v ? "0" : "1");
      } catch {
        // the choice just won't be remembered
      }
      return !v;
    });
  }
  const endedCount = rows.filter(isEnded).length;
  // An ended row a receipt came after stays in sight — its red note is the point (v1.16.1).
  const { flags } = useContext(DetailsContext);
  const listed = useMemo(() => (showEnded ? rows : rows.filter((r) => !isEnded(r) || flags.has(r.id))), [rows, showEnded, flags]);
  const sorted = useMemo(() => sortRows(listed, sort), [listed, sort]);
  const liveCount = rows.length - endedCount;
  const filedCount = rows.filter((r) => !isEnded(r) && isFiled(r.filed_at)).length;
  const fx = useFx();
  /** A row's net in month m — its share under the P&L's rule (`monthShares`): nothing before it
   * starts or after it ends, and a subscription carried in from last year counts from January. */
  const at = (r: ExpenseRowDb, m: number) => shareAt(r, year, fx, m);
  // The footer's month through the same `at` as its own hover (`xm|month`), over the same rows: it
  // used to add every listed row, so a subscription that had ended, or not yet started, still counted.
  const total = rows.reduce((s, r) => s + at(r, displayMonth(year)), 0);
  const explain = useExpensesExplain({
    label: "Monthly expenses",
    rows,
    year,
    at,
  });
  const t = useTableColumns("expenses.monthly", MONTHLY_ORDER, MONTHLY_WIDTHS);
  const charts = useChartsPane();
  const [draft, setDraft] = useState({
    vendor: "",
    amount: EMPTY_AMOUNT,
    date: studioToday(),
    description: "",
    notes: "",
    link: "",
  });

  const monthlyPoints = useMemo(() => {
    const totals = Array.from({ length: 12 }, () => 0);
    // Each month billed at its own month's rate (`monthShares`).
    for (const r of rows) monthShares(r, year, fx).forEach((v, i) => (totals[i] += v ?? 0));
    return MONTH_NAMES.map((m, i) => ({
      label: m.slice(0, 3),
      value: totals[i],
      future: isForecastMonth(year, i + 1),
    }));
  }, [rows, year, fx]);
  // Each vendor's year — every month of each row's window, as the chart beside it — under the same
  // trimmed name as the other tabs. It weighed one month per row, so a subscription that ended in
  // March counted as a full month's charge, and "Adobe " and "Adobe" were two slices.
  const vendorSlices = useMemo(() => {
    const byVendor = new Map<string, number>();
    for (const r of rows) {
      const key = r.vendor.trim() || r.description.trim() || "(unnamed)";
      const sum = monthShares(r, year, fx).reduce<number>((s, v) => s + (v ?? 0), 0);
      byVendor.set(key, (byVendor.get(key) ?? 0) + sum);
    }
    return topVendorSlices(byVendor);
  }, [rows, year, fx]);

  function addDraft() {
    const fields = amountFieldsOf(draft.amount, draft.date, fx);
    if (!draft.vendor.trim() || !fields) return;
    insertRow({
      vendor: draft.vendor.trim(),
      ...fields,
      date: draft.date,
      description: draft.description.trim(),
      notes: draft.notes.trim(),
      link: draft.link.trim() || null,
    });
    setDraft({
      vendor: "",
      amount: EMPTY_AMOUNT,
      date: studioToday(),
      description: "",
      notes: "",
      link: "",
    });
  }

  return (
    <div className={charts.grid}>
      <div className="min-w-0">
        {explain.card}
        {/* Beside the search field, so it never pushes the table down. */}
        {endedCount > 0 &&
          filterSlot &&
          createPortal(
            <button
              onClick={toggleEnded}
              className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 py-1 text-sm text-muted hover:bg-background hover:text-foreground"
            >
              {showEnded ? <EyeOff size={14} /> : <Eye size={14} />}
              {showEnded ? `Hide ended (${endedCount})` : `Show ended (${endedCount})`}
            </button>,
            filterSlot,
          )}
        <div
          className="overflow-x-auto rounded-xl border border-border bg-surface"
          onMouseOver={explain.onMouseOver}
          onMouseLeave={explain.onMouseLeave}
        >
          <table className="row-hover border-collapse text-[13px]" style={{ tableLayout: "fixed", width: "100%", minWidth: 32 + t.width + 40 }}>
            <colgroup>
              <col style={{ width: 32 }} />
              {t.cols.map((k) => (
                <col key={k} style={{ width: t.widths[k] }} />
              ))}
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr className={THEAD_CLS}>
                <th className="px-2 py-2 text-center" title={`Invoice filed this month — the marks clear on the ${FILING_RESET_DAY}th`}>
                  {year === studioYear() ? "✓" : ""}
                </th>
                {t.cols.map((k) => {
                  const common = { onResizeStart: t.startResize(k), drag: t.drag(k) };
                  const sortable: Record<string, [string, string, boolean?]> = {
                    company: ["Company", "vendor"],
                    description: ["Description", "description"],
                    net: ["Net · no VAT", "amount", true],
                    start: ["Accrues from", "date"],
                  };
                  if (sortable[k]) {
                    const [label, sk, right] = sortable[k];
                    return <SortTh key={k} label={label} k={sk} sort={sort} setSort={setSort} right={right} {...common} />;
                  }
                  const label: Record<string, string> = { price: "Amount", end: "Ends", notes: "Notes", link: "Link", ...PAPERWORK_LABEL };
                  return (
                    <ResizableTh key={k} right={k === "price"} title={PAPERWORK_TITLE[k]} {...common}>
                      {label[k]}
                    </ResizableTh>
                  );
                })}
                <ColumnsResetTh t={t} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <MonthlyRow key={r.id} r={r} markFiled={markFiled} editable={editable} update={update} remove={remove} saveNotes={saveNotes} year={year} cols={t.cols} />
              ))}
              {listed.length === 0 && (
                <tr>
                  <td colSpan={t.cols.length + 2} className="px-3 py-6 text-center text-faint">
                    Nothing here yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className={TOTAL_ROW_CLS}>
                <td
                  className="px-2 py-2 text-center text-[11px] font-normal text-muted tabular-nums"
                  title={year === studioYear() ? `${filedCount} of ${liveCount} invoices filed this month` : undefined}
                >
                  {year === studioYear() ? `${filedCount}/${liveCount}` : ""}
                </td>
                {t.cols.map((k) =>
                  k === "net" ? (
                    <td key={k} data-cell={`xm|${displayMonth(year)}`} className="px-3 py-2 text-right tabular-nums">
                      {formatILS(total)}
                    </td>
                  ) : k === t.cols.find((c) => c !== "net") ? (
                    <td key={k} className="whitespace-nowrap px-3 py-2 text-xs uppercase tracking-wide">
                      Total ({listed.length})
                    </td>
                  ) : (
                    <td key={k} />
                  ),
                )}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {editable && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border-strong bg-surface-2/60 p-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Company
              <input
                value={draft.vendor}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, vendor: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && addDraft()}
                className="bidi-auto w-40 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <AmountFields
              draft={draft.amount}
              onChange={(amount) => setDraft((d) => ({ ...d, amount }))}
              date={draft.date}
              onEnter={addDraft}
              preview={false}
            />
            <label className="flex flex-col gap-1 text-xs text-muted">
              Accrues from
              <input
                type="date"
                value={draft.date}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, date: e.target.value }))
                }
                className="w-[8.6rem] rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Description
              <input
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && addDraft()}
                className="bidi-auto w-40 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Notes
              <input
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && addDraft()}
                className="bidi-auto w-40 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Link
              <input
                value={draft.link}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, link: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && addDraft()}
                className="w-40 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <button
              title="Add a monthly subscription to this year"
              onClick={addDraft}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              <Plus size={15} />
              Add subscription
            </button>
            <AmountPreview draft={draft.amount} date={draft.date} />
          </div>
        )}
      </div>
      {charts.pane(
<TabGraphsPane
        year={year}
        monthlyPoints={monthlyPoints}
        vendorSlices={vendorSlices}
      />)}
    </div>
  );
}

// ── Misc / Investments — grouped by month, collapsible ───────────────────────

/** ₪ tolerance below which a sheet-vs-app difference isn't worth flagging. */
const CHECK_TOLERANCE = 0.02;

const MONTHGROUPED_COL_DEFAULTS = {
  date: 110,
  description: 200,
  vendor: 140,
  gross: 190,
  novat: 130,
};
const MONTHGROUPED_WIDTHS = { ...MONTHGROUPED_COL_DEFAULTS, ...PAPERWORK_COL_DEFAULTS };
/** After the pinned Date (it holds the month's fold button). */
const MONTHGROUPED_ORDER = ["vendor", "description", "gross", "novat", "file", "invoiceNo", "paidWith"];

function MonthGroupedList({
  rows,
  year,
  category,
  checks,
  editable,
  update,
  remove,
  insertRow,
  saveNotes,
}: ListProps & {
  year: number;
  category: ExpenseCategory;
  checks: Map<number, SheetCheck>;
}) {
  // Folded by default — only the current calendar month starts open (none do
  // when viewing a year other than the current one).
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    const s = new Set<number>();
    const currentMonth = year === studioYear() ? studioMonth() : 0;
    for (let m = 1; m <= 12; m++) if (m !== currentMonth) s.add(m);
    return s;
  });
  const t = useTableColumns(`expenses.${category}`, MONTHGROUPED_ORDER, MONTHGROUPED_WIDTHS);
  const charts = useChartsPane();
  const moveTo: MoveTo =
    category === "investment"
      ? { toCategory: "misc", title: "Move to Misc" }
      : { toCategory: "investment", title: "Move to Investments" };

  const defaultDraftDate =
    studioToday() >= `${year}-01-01` && studioToday() <= `${year}-12-31`
      ? studioToday()
      : `${year}-01-15`;
  const fx = useFx();
  const [draft, setDraft] = useState({
    date: defaultDraftDate,
    description: "",
    vendor: "",
    amount: EMPTY_AMOUNT,
  });

  // Known vendor spellings for this category, so a new row can reuse an
  // existing one instead of typing a slightly different variant that then
  // reads as a second vendor everywhere totals are grouped by name.
  const vendorSuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) {
      const v = r.vendor.trim();
      if (v) names.add(v);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [rows]);
  const vendorListId = `vendor-suggestions-${category}`;

  function addDraft() {
    const fields = amountFieldsOf(draft.amount, draft.date, fx);
    if (!fields) return;
    insertRow({
      date: draft.date,
      description: draft.description.trim(),
      vendor: draft.vendor.trim(),
      ...fields,
    });
    setDraft({
      date: draft.date,
      description: "",
      vendor: "",
      amount: EMPTY_AMOUNT,
    });
  }

  const byMonth = useMemo(() => {
    const m = new Map<number, ExpenseRowDb[]>();
    for (const r of rows) {
      const mo = Number(r.date.slice(5, 7));
      const arr = m.get(mo) ?? [];
      arr.push(r);
      m.set(mo, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);
  const totalNoVat = rows.reduce((s, r) => s + rowNetIls(r, year, fx), 0);
  const explain = useExpensesExplain({
    label: category === "investment" ? "Investments" : "Misc expenses",
    rows,
    year,
    at: (r, m) => (Number(r.date.slice(5, 7)) === m ? rowNetIls(r, year, fx) : 0),
  });
  const monthlyPoints = useMemo(() => {
    const byMonthNoVat = new Map(
      byMonth.map(([mo, items]) => [
        mo,
        items.reduce((s, r) => s + rowNetIls(r, year, fx), 0),
      ]),
    );
    return MONTH_NAMES.map((m, i) => ({
      label: m.slice(0, 3),
      value: byMonthNoVat.get(i + 1) ?? 0,
      future: isForecastMonth(year, i + 1),
    }));
  }, [byMonth, year, fx]);
  const vendorSlices = useMemo(() => {
    const byVendor = new Map<string, number>();
    for (const r of rows) {
      const key = r.vendor.trim() || r.description.trim() || "(unnamed)";
      byVendor.set(key, (byVendor.get(key) ?? 0) + rowNetIls(r, year, fx));
    }
    return topVendorSlices(byVendor);
  }, [rows, year, fx]);

  function toggle(mo: number) {
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(mo)) n.delete(mo);
      else n.add(mo);
      return n;
    });
  }

  return (
    <div className={charts.grid}>
      <div className="min-w-0" onMouseOver={explain.onMouseOver} onMouseLeave={explain.onMouseLeave}>
        {explain.card}
        {byMonth.length === 0 && (
          <div className="rounded-xl border border-border px-3 py-8 text-center text-sm text-faint">
            Nothing here yet.
          </div>
        )}
        <div className="space-y-3">
          {byMonth.map(([mo, items]) => {
            const subNoVat = items.reduce((s, r) => s + rowNetIls(r, year, fx), 0);
            const check = checks.get(mo);
            const diff = check ? round2(subNoVat - check.sheetNoVat) : 0;
            const mismatch = check != null && Math.abs(diff) >= CHECK_TOLERANCE;
            const open = !collapsed.has(mo);
            return (
              <div
                key={mo}
                className="overflow-x-auto rounded-xl border border-border bg-surface"
              >
                <table className="row-hover border-collapse text-[13px]" style={{ tableLayout: "fixed", width: "100%", minWidth: t.widths.date + t.width + 40 }}>
                  <colgroup>
                    <col style={{ width: t.widths.date }} />
                    {t.cols.map((k) => (
                      <col key={k} style={{ width: t.widths[k] }} />
                    ))}
                    <col style={{ width: 40 }} />
                  </colgroup>
                  <thead>
                    <tr className={open ? THEAD_CLS : "text-xs font-medium uppercase tracking-wide text-faint"}>
                      <th className="relative px-2 py-2 text-left">
                        <button
                          onClick={() => toggle(mo)}
                          className="inline-flex items-center gap-1.5 text-[13px] font-medium normal-case tracking-normal text-foreground hover:text-brand"
                          title={open ? "Collapse" : "Expand"}
                        >
                          {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                          {MONTH_NAMES[mo - 1]}
                          <span className="text-xs font-normal text-faint">({items.length})</span>
                        </button>
                        <ResizeHandle onMouseDown={t.startResize("date")} />
                      </th>
                      {t.cols.map((k) =>
                        k === "novat" ? (
                          <th key={k} {...t.drag(k)} className={`relative px-3 py-2 text-right tabular-nums text-muted ${DRAG_TH}`}>
                            <span className="inline-flex items-center gap-1.5">
                              {mismatch && (
                                <MismatchTriangle align="right">
                                  Sheet says <span className="tabular-nums">{formatILS(check!.sheetNoVat)}</span>{" "}
                                  · App totals <span className="tabular-nums">{formatILS(subNoVat)}</span> · Diff{" "}
                                  <span className="tabular-nums">{formatILS(Math.abs(diff))}</span>
                                  {diff > 0 ? " (app is higher)" : " (app is lower)"}.
                                  {check!.note ? ` ${check!.note}` : ""} Not all lines carry VAT, so check
                                  for a missing/extra item or a wrong VAT basis rather than assuming a flat
                                  rate.
                                </MismatchTriangle>
                              )}
                              {open ? "Net " : ""}
                              <span data-cell={`xm|${mo}`}>{formatILS(subNoVat)}</span>
                            </span>
                            <ResizeHandle onMouseDown={t.startResize(k)} />
                          </th>
                        ) : (
                          <ResizableTh key={k} right={k === "gross"} title={PAPERWORK_TITLE[k]} onResizeStart={t.startResize(k)} drag={t.drag(k)}>
                            {open ? { vendor: "Vendor", description: "Description", gross: "Amount", ...PAPERWORK_LABEL }[k] : ""}
                          </ResizableTh>
                        ),
                      )}
                      <ColumnsResetTh t={t} />
                    </tr>
                  </thead>
                  {open && (
                    <tbody>
                      {items.map((r) => (
                        <Row key={r.id} r={r} editable={editable} update={update} remove={remove} saveNotes={saveNotes} year={year} moveTo={moveTo} cols={t.cols} />
                      ))}
                    </tbody>
                  )}
                </table>
              </div>
            );
          })}
        </div>
        <div className="mt-3 w-full text-right text-sm text-muted">
          Total ({rows.length}):{" "}
          <span data-cell="xt" className="font-semibold text-foreground tabular-nums">
            {formatILS(totalNoVat)}
          </span>
          <span className="text-faint"> without VAT</span>
        </div>
        {editable && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border-strong bg-surface-2/60 p-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Date
              <input
                type="date"
                value={draft.date}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, date: e.target.value }))
                }
                className="w-[8.6rem] rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Description
              <input
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && addDraft()}
                className="bidi-auto w-44 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Vendor
              <input
                value={draft.vendor}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, vendor: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && addDraft()}
                list={vendorListId}
                className="bidi-auto w-32 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
              <datalist id={vendorListId}>
                {vendorSuggestions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </label>
            <AmountFields
              draft={draft.amount}
              onChange={(amount) => setDraft((d) => ({ ...d, amount }))}
              date={draft.date}
              onEnter={addDraft}
              preview={false}
            />
            <button
              title="Add this receipt to the month it's dated"
              onClick={addDraft}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              <Plus size={15} />
              Add
            </button>
            <AmountPreview draft={draft.amount} date={draft.date} />
          </div>
        )}
      </div>
      {charts.pane(
<TabGraphsPane
        year={year}
        monthlyPoints={monthlyPoints}
        vendorSlices={vendorSlices}
      />)}
    </div>
  );
}

// ── Yearly — renewal tracking, sortable ──────────────────────────────────────

/** Renewal periods offered in the Yearly table's cell: 1–5 years, plus a
 * stored value outside that (e.g. an old 6-month row) so it still shows. */
const renewOptionsFor = (current: number) => {
  const months = RENEW_YEARS.map((y) => y * 12);
  if (!months.includes(current)) months.unshift(current);
  return months.map((m) => ({ months: m, label: renewLabel(m) }));
};

const YEARLY_COL_DEFAULTS = {
  date: 110,
  renewIn: 100,
  description: 180,
  vendor: 130,
  gross: 170,
  renewEvery: 110,
  ends: 110,
  monthly: 110,
};
const YEARLY_WIDTHS = { ...YEARLY_COL_DEFAULTS, ...PAPERWORK_COL_DEFAULTS };
/** After the pinned Date. */
const YEARLY_ORDER = ["renewIn", "description", "vendor", "gross", "renewEvery", "ends", "monthly", "file", "invoiceNo", "paidWith"];

function YearlyList({
  rows,
  editable,
  update,
  remove,
  insertRow,
  saveNotes,
  year,
}: ListProps & { year: number }) {
  const [sort, setSort] = useState<Sort>({ key: "renew", dir: 1 });
  const [form, setForm] = useState({
    description: "",
    vendor: "",
    amount: EMPTY_AMOUNT,
    date: studioToday(),
    endDate: "",
    months: 12,
  });
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  // A yearly payment is converted once, at the rate of the month it was paid.
  const fx = useFx();
  // Net of VAT — as the Summary tab treats these same 'yearly' rows, so this
  // tab's own total doesn't read ~17-18% higher than the rest of the app.
  // Every payment MADE this year: a renewal carried in from last year (see
  // `load`) was paid then, and only its monthly share lands in this year.
  const paidThisYear = (r: ExpenseRowDb) => (Number(r.date.slice(0, 4)) === year ? paidNet(r, fx) : 0);
  const total = rows.reduce((s, r) => s + paidThisYear(r), 0);
  // Per month, the P&L's spread (`monthShares`): each payment ÷ the months it
  // covers, from its date and across the year end — a renewal paid last
  // September still costs this January–August their share.
  const monthlyPoints = useMemo(() => {
    const arr = Array.from({ length: 12 }, () => 0);
    for (const r of rows) monthShares(r, year, fx).forEach((v, i) => (arr[i] += v ?? 0));
    return MONTH_NAMES.map((m, i) => ({
      label: m.slice(0, 3),
      value: arr[i],
      future: isForecastMonth(year, i + 1),
    }));
  }, [rows, year, fx]);
  const vendorSlices = useMemo(() => {
    const byVendor = new Map<string, number>();
    for (const r of rows) {
      const key = r.vendor.trim() || r.description.trim() || "(unnamed)";
      // What it costs THIS year (its shares, as the chart beside it), so a
      // renewal carried in from last year weighs only the months it covers here.
      byVendor.set(key, (byVendor.get(key) ?? 0) + monthShares(r, year, fx).reduce<number>((s, v) => s + (v ?? 0), 0));
    }
    return topVendorSlices(byVendor);
  }, [rows, year, fx]);
  // The "Monthly cost" footer: the displayed month's shares, the same figures as
  // the column above it and its own hover (`xm`) — the P&L's month. It used to add
  // each live row's payment ÷ its months whether or not its spread reached the month.
  const shownMonth = displayMonth(year);
  const totalMonthly = rows.reduce((s, r) => s + shareAt(r, year, fx, shownMonth), 0);
  const t = useTableColumns("expenses.yearly", YEARLY_ORDER, YEARLY_WIDTHS);
  const charts = useChartsPane();
  const explain = useExpensesExplain({
    label: "Yearly expenses",
    rows,
    year,
    at: (r, m) => shareAt(r, year, fx, m),
    yearOf: paidThisYear,
  });

  return (
    <div className={charts.grid}>
      <div className="min-w-0">
        {explain.card}
        <div
          className="overflow-x-auto rounded-xl border border-border bg-surface"
          onMouseOver={explain.onMouseOver}
          onMouseLeave={explain.onMouseLeave}
        >
          <table className="row-hover border-collapse text-[13px]" style={{ tableLayout: "fixed", width: "100%", minWidth: t.widths.date + t.width + 40 }}>
            <colgroup>
              <col style={{ width: t.widths.date }} />
              {t.cols.map((k) => (
                <col key={k} style={{ width: t.widths[k] }} />
              ))}
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr className={THEAD_CLS}>
                <SortTh label="Date" k="date" sort={sort} setSort={setSort} onResizeStart={t.startResize("date")} />
                {t.cols.map((k) => {
                  const common = { onResizeStart: t.startResize(k), drag: t.drag(k) };
                  const sortable: Record<string, [string, string, boolean?]> = {
                    description: ["Description", "description"],
                    vendor: ["Vendor", "vendor"],
                    gross: ["Amount", "amount", true],
                    monthly: ["Monthly cost · no VAT", "monthly", true],
                  };
                  if (sortable[k]) {
                    const [label, sk, right] = sortable[k];
                    return <SortTh key={k} label={label} k={sk} sort={sort} setSort={setSort} right={right} {...common} />;
                  }
                  const label: Record<string, string> = { renewIn: "Renews in", renewEvery: "Renews every", ends: "Ends", ...PAPERWORK_LABEL };
                  return (
                    <ResizableTh key={k} title={PAPERWORK_TITLE[k]} {...common}>
                      {label[k]}
                    </ResizableTh>
                  );
                })}
                <ColumnsResetTh t={t} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const period = renewMonths(r);
                const daysLeft = daysToRenewal(r.date, period);
                // The cycle and end follow `Row`'s canEdit: a "final" row is locked whatever its year
                // (these two stayed open on one, and the guard trigger refused the write).
                const cycleEditable = (ownYearEditable(r, editable) || stillRunning(r)) && !isLocked(r.state);
                return (
                  <Row
                    key={r.id}
                    r={r}
                    editable={editable}
                    update={update}
                    remove={remove}
                    saveNotes={saveNotes}
                    cols={t.cols}
                    cells={{
                      renewIn: (
                        <td className="px-3 py-1.5">
                          {isEnded(r) ? (
                            <span
                              title={`Ended ${fmtDayMonth(r.end_date!)} — won't renew again`}
                              className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-faint"
                            >
                              Ended
                            </span>
                          ) : endsBeforeRenewal(r) ? (
                            <span
                              title={`Won't renew — ends ${fmtDayMonth(r.end_date!)}`}
                              className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted"
                            >
                              Ends {fmtDayMonth(r.end_date!)}
                            </span>
                          ) : (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${renewChipClass(daysLeft)}`}>
                              {daysLeft}d
                            </span>
                          )}
                        </td>
                      ),
                      renewEvery: (
                        <td className="px-3 py-1.5">
                          <select
                            disabled={!cycleEditable}
                            value={period}
                            onChange={(e) => update(r.id, { renew_months: Number(e.target.value) })}
                            className={`rounded-md bg-transparent px-1 py-0.5 text-[13px] outline-none disabled:opacity-70 ${CELL_HOVER} ${CELL_FOCUS}`}
                          >
                            {renewOptionsFor(period).map((o) => (
                              <option key={o.months} value={o.months}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      ),
                      ends: (
                        <td className="px-3 py-1.5">
                          <EndDateCell r={r} editable={cycleEditable} update={update} />
                        </td>
                      ),
                      monthly: (
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted">
                          <ShareCell r={r} year={year} month={shownMonth} />
                        </td>
                      ),
                    }}
                  />
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={t.cols.length + 2} className="px-3 py-6 text-center text-faint">
                    Nothing here yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className={TOTAL_ROW_CLS}>
                <td className="whitespace-nowrap px-3 py-2 text-xs uppercase tracking-wide">Total ({rows.length})</td>
                {t.cols.map((k) =>
                  k === "gross" ? (
                    <td key={k} data-cell="xt" className="px-3 py-2 text-right tabular-nums">
                      {formatILS(total)}
                    </td>
                  ) : k === "monthly" ? (
                    <td key={k} data-cell={`xm|${shownMonth}`} className="px-3 py-2 text-right tabular-nums">
                      {formatILS(totalMonthly)}
                    </td>
                  ) : (
                    <td key={k} />
                  ),
                )}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {editable && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Description
              <input
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                className="bidi-auto w-44 rounded-lg border border-border-strong px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Vendor
              <input
                value={form.vendor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, vendor: e.target.value }))
                }
                className="bidi-auto w-32 rounded-lg border border-border-strong px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <AmountFields
              draft={form.amount}
              onChange={(amount) => setForm((f) => ({ ...f, amount }))}
              date={form.date}
              preview={false}
            />
            <label className="flex flex-col gap-1 text-xs text-muted">
              Date
              <input
                type="date"
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
                className="w-[8.6rem] rounded-lg border border-border-strong px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-muted">
              One payment covers (years)
              <Segmented
                options={yearsOptions}
                value={form.months}
                onChange={(months) => setForm((f) => ({ ...f, months }))}
              />
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Ends (optional)
              <input
                type="date"
                value={form.endDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endDate: e.target.value }))
                }
                className="w-[8.6rem] rounded-lg border border-border-strong px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <button
              title="Add a yearly renewal — spread over the years it covers"
              onClick={() => {
                const fields = amountFieldsOf(form.amount, form.date, fx);
                if (!form.description.trim() || !fields) return;
                void insertRow({
                  description: form.description.trim(),
                  vendor: form.vendor.trim(),
                  ...fields,
                  date: form.date,
                  end_date: form.endDate || null,
                  renew_months: form.months,
                });
                setForm({
                  description: "",
                  vendor: "",
                  amount: EMPTY_AMOUNT,
                  date: studioToday(),
                  endDate: "",
                  months: 12,
                });
              }}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              <Plus size={15} />
              Add yearly expense
            </button>
            <AmountPreview draft={form.amount} date={form.date} />
          </div>
        )}
      </div>
      {charts.pane(
<TabGraphsPane
        year={year}
        monthlyPoints={monthlyPoints}
        vendorSlices={vendorSlices}
      />)}
    </div>
  );
}

// ── Summary — cross-category monthly view, filterable, with charts ──────────

const SUMMARY_CATEGORIES: {
  key: ExpenseCategory;
  label: string;
  color: string;
}[] = [
  { key: "monthly", label: "Monthly", color: "var(--brand)" },
  { key: "yearly", label: "Yearly", color: "var(--warning)" },
  { key: "misc", label: "Misc", color: "var(--aqua)" },
  { key: "investment", label: "Investments", color: "var(--brand-deep)" },
  { key: "rent", label: "Rent", color: "var(--faint)" },
];

/** Net ILS (no VAT) for any expense row, uniformly — the app's one rule
 * (expenseNetIls). `month` is the month whose exchange rate applies: each month
 * of a recurring charge uses its own month's rate; anything else defaults to
 * the month it's dated. */
function rowNetIls(r: ExpenseRowDb, year: number, fx: FxTable | undefined, month?: number): number {
  return expenseNetIls(r, year, { table: fx, month: month ?? Number(r.date.slice(5, 7)) });
}

/** For a single "per month" figure of a recurring row (its list cell): the
 * current month when viewing this year, else December of the viewed year. */
function displayMonth(year: number): number {
  return year === studioYear() ? studioMonth() : 12;
}

interface MonthLine {
  id: string;
  date: string; // ISO — the 1st of the viewed month for recurring monthly/yearly lines
  title: string;
  notes: string;
  category: ExpenseCategory;
  amount: number;
  state: FinanceState;
}

/**
 * What a row costs in each month of `year` (index 0 = January), net ILS — the P&L's own rule,
 * `expenseShares` (Nitsan, 2026-11-10: "the Expenses page follows the P&L"): a yearly renewal is
 * spread over `renewMonths` from its date across year ends (its end date doesn't cut it), a
 * subscription counts every month it runs, into later years, at each month's rate, anything else
 * once in its own month. This page used to clip a renewal to its own year and its end date, so its
 * months and the Plan's expense lines disagreed. `undefined` = nothing that month, so a list can
 * tell "not in this month" from a ₪0 line. Memoised per row object (a write replaces the object).
 */
const sharesMemo = new WeakMap<ExpenseRowDb, { year: number; fx: FxTable | undefined; out: (number | undefined)[] }>();
function monthShares(r: ExpenseRowDb, year: number, fx: FxTable | undefined): (number | undefined)[] {
  const hit = sharesMemo.get(r);
  if (hit && hit.year === year && hit.fx === fx) return hit.out;
  const out: (number | undefined)[] = Array.from({ length: 12 }, () => undefined);
  for (const { month, amount } of expenseShares(mapExpense(r), year, fx)) out[month - 1] = (out[month - 1] ?? 0) + amount;
  sharesMemo.set(r, { year, fx, out });
  return out;
}

/** A row's share of month m of `year` (0 when it costs nothing then) — see `monthShares`. */
const shareAt = (r: ExpenseRowDb, year: number, fx: FxTable | undefined, m: number) => monthShares(r, year, fx)[m - 1] ?? 0;

/** The payment itself, net ILS, at the rate of the month it was paid — a renewal carried in from
 * last year is converted at last year's rate, as its spread in `expenseShares` is. */
const paidNet = (r: ExpenseRowDb, fx: FxTable | undefined) => rowNetIls(r, Number(r.date.slice(0, 4)), fx);

/** Spread as a yearly renewal (expenseShares' yearly branch) — not a payment to the accountant,
 * lawyer or Gur filed under Yearly, which the P&L counts once, in its own month. */
const spreadsYearly = (r: ExpenseRowDb) =>
  r.description !== SYNTHETIC_YEARLY_MARKER && expenseLineOf(mapExpense(r)) === LINE.expensesYearly;

/** The Summary table's columns after the pinned Date. */
const SUMMARY_ORDER = ["title", "category", "notes", "amount"];
const SUMMARY_WIDTHS = { date: 100, title: 180, category: 110, notes: 220, amount: 130 };
const SUMMARY_LABEL: Record<string, [string, boolean?]> = { title: ["Title"], category: ["Type"], notes: ["Notes"], amount: ["Amount ₪", true] };

function SummaryTab({
  rows,
  year,
  setYear,
  month,
  setMonth,
  editable,
  update,
  remove,
  filterSlot,
}: {
  rows: ExpenseRowDb[];
  year: number;
  setYear: (y: number) => void;
  /** The month drilled into — held by the page so it survives the year's reload (see ExpensesPage). */
  month: number;
  setMonth: React.Dispatch<React.SetStateAction<number>>;
  editable: boolean;
  update: ListProps["update"];
  remove: ListProps["remove"];
  filterSlot: HTMLDivElement | null;
}) {
  const [active, setActive] = useState<Set<ExpenseCategory>>(
    new Set(SUMMARY_CATEGORIES.map((c) => c.key)),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const charts = useChartsPane();
  const editingRow = editingId
    ? (rows.find((r) => r.id === editingId) ?? null)
    : null;

  function toggle(cat: ExpenseCategory) {
    setActive((a) => {
      const n = new Set(a);
      if (n.has(cat)) n.delete(cat);
      else n.add(cat);
      return n;
    });
  }

  function goPrev() {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else setMonth((m) => m - 1);
  }
  function goNext() {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else setMonth((m) => m + 1);
  }

  const relevant = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.description !== SYNTHETIC_YEARLY_MARKER && active.has(r.category),
      ),
    [rows, active],
  );

  // Full-year trend per category — every row by the P&L's own rule
  // (`monthShares`, Nitsan 2026-11-10): a yearly renewal spread over the months
  // it covers from its date, across the year end and regardless of its end date;
  // a subscription every month it runs, at that month's rate; the rest once.
  // Kept as one line per active category so the chart can show the split over time.
  const fx = useFx();
  const totalsByCategory = useMemo(() => {
    const out = new Map<ExpenseCategory, number[]>();
    for (const c of SUMMARY_CATEGORIES) out.set(c.key, Array.from({ length: 12 }, () => 0));
    for (const r of relevant) {
      const arr = out.get(r.category)!;
      monthShares(r, year, fx).forEach((v, i) => (arr[i] += v ?? 0));
    }
    return out;
  }, [relevant, year, fx]);

  // Individual lines for the single month currently drilled into.
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const lines = useMemo(() => {
    const out: MonthLine[] = [];
    for (const r of relevant) {
      // Its share of this month under the P&L's rule — the same figure the
      // chart and the hover (`at`) use, so the footer equals both.
      const amount = monthShares(r, year, fx)[month - 1];
      if (amount === undefined) continue;
      out.push({
        id: r.id,
        // A recurring share is dated the 1st of the month; a one-off keeps its own day.
        date: r.category === "monthly" || spreadsYearly(r) ? firstOfMonth : r.date,
        title: r.vendor.trim() || r.description.trim() || fmtDayMonth(r.date),
        notes: r.notes?.trim() ?? "",
        category: r.category,
        amount,
        state: r.state,
      });
    }
    return out;
  }, [relevant, year, month, firstOfMonth, fx]);

  const [lineSort, setLineSort] = useState<Sort>({ key: "amount", dir: -1 });
  const sortedLines = useMemo(() => {
    const cmp = (a: MonthLine, b: MonthLine): number => {
      switch (lineSort.key) {
        case "date":
          return a.date.localeCompare(b.date);
        case "title":
          return a.title.localeCompare(b.title);
        case "category":
          return a.category.localeCompare(b.category);
        case "notes":
          return a.notes.localeCompare(b.notes);
        case "amount":
          return a.amount - b.amount;
        default:
          return 0;
      }
    };
    return [...lines].sort((a, b) => cmp(a, b) * lineSort.dir);
  }, [lines, lineSort]);
  // Drag a header to move its column, its edge to resize — like the other tabs (Date stays first).
  const t = useTableColumns("expenses.summary", SUMMARY_ORDER, SUMMARY_WIDTHS);

  const monthTotal = lines.reduce((s, l) => s + l.amount, 0);
  const explain = useExpensesExplain({
    label: "Expenses",
    rows: relevant,
    year,
    at: (r, m) => shareAt(r, year, fx, m),
  });
  const byCatThisMonth = useMemo(() => {
    const m = new Map<ExpenseCategory, number>();
    for (const l of lines)
      m.set(l.category, (m.get(l.category) ?? 0) + l.amount);
    return m;
  }, [lines]);

  const filterPills = (
    <>
      {SUMMARY_CATEGORIES.map((c) => {
        const on = active.has(c.key);
        return (
          <button
            key={c.key}
            onClick={() => toggle(c.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              on
                ? "border-transparent text-white"
                : "border-border-strong text-muted hover:bg-background"
            }`}
            style={on ? { background: c.color } : undefined}
          >
            {c.label}
          </button>
        );
      })}
    </>
  );

  return (
    <div>
      {filterSlot && createPortal(filterPills, filterSlot)}
      <div className={charts.grid}>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between rounded-xl border border-border bg-surface px-2 py-2">
            <button
              onClick={goPrev}
              title="Previous month"
              className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              onClick={goNext}
              title="Next month"
              className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {explain.card}
          <div
            className="w-full overflow-x-auto rounded-xl border border-border bg-surface"
            onMouseOver={explain.onMouseOver}
            onMouseLeave={explain.onMouseLeave}
          >
            <table className="row-hover border-collapse text-[13px]" style={{ tableLayout: "fixed", width: "100%", minWidth: t.widths.date + t.width + 32 }}>
              <colgroup>
                <col style={{ width: t.widths.date }} />
                {t.cols.map((k) => (
                  <col key={k} style={{ width: t.widths[k] }} />
                ))}
                <col style={{ width: 32 }} />
              </colgroup>
              <thead>
                <tr className={THEAD_CLS}>
                  <SortTh label="Date" k="date" sort={lineSort} setSort={setLineSort} onResizeStart={t.startResize("date")} />
                  {t.cols.map((k) => {
                    const [label, right] = SUMMARY_LABEL[k];
                    return <SortTh key={k} label={label} k={k} sort={lineSort} setSort={setLineSort} right={right} onResizeStart={t.startResize(k)} drag={t.drag(k)} />;
                  })}
                  <ColumnsResetTh t={t} />
                </tr>
              </thead>
              <tbody>
                {sortedLines.length === 0 && (
                  <tr>
                    <td
                      colSpan={t.cols.length + 2}
                      className="px-3 py-8 text-center text-sm text-faint"
                    >
                      Nothing this month.
                    </td>
                  </tr>
                )}
                {sortedLines.map((l) => {
                  const cat = SUMMARY_CATEGORIES.find(
                    (c) => c.key === l.category,
                  )!;
                  const locked = isLocked(l.state);
                  return (
                    <tr
                      key={l.id}
                      onClick={() => setEditingId(l.id)}
                      className="cursor-pointer border-t border-border hover:bg-background"
                      title={locked ? "Locked — click to view" : "Click to edit"}
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                        {fmtDayMonth(l.date)}
                      </td>
                      {t.cols.map((k) => (
                        <Fragment key={k}>
                          {k === "title" ? (
                            <td className="bidi-auto truncate px-3 py-2 text-left">{l.title}</td>
                          ) : k === "category" ? (
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1">
                                <span className="inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ background: cat.color }}>
                                  {cat.label}
                                </span>
                                {locked && <Lock size={11} className="text-faint" />}
                              </span>
                            </td>
                          ) : k === "notes" ? (
                            <td className="bidi-auto truncate px-3 py-2 text-left text-muted">{l.notes || "—"}</td>
                          ) : (
                            <td data-cell={`xs|${l.id}|${month}`} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              {formatILS(l.amount)}
                            </td>
                          )}
                        </Fragment>
                      ))}
                      <td />
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className={TOTAL_ROW_CLS}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs uppercase tracking-wide">Total ({lines.length} lines)</td>
                  {t.cols.map((k) =>
                    k === "amount" ? (
                      <td key={k} data-cell={`xm|${month}`} className="px-3 py-2 text-right tabular-nums">
                        {formatILS(monthTotal)}
                      </td>
                    ) : (
                      <td key={k} />
                    ),
                  )}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        {charts.pane(
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
              Monthly totals
            </h3>
            <MultiMonthlyLineChart
              labels={MONTH_NAMES.map((m) => m.slice(0, 3))}
              series={SUMMARY_CATEGORIES.filter((c) => active.has(c.key)).map((c) => ({
                label: c.label,
                color: c.color,
                values: totalsByCategory.get(c.key) ?? Array(12).fill(0),
              }))}
              futureFromIndex={(() => {
                const i = MONTH_NAMES.findIndex((_, idx) => isForecastMonth(year, idx + 1));
                return i === -1 ? undefined : i;
              })()}
              activeIndex={month - 1}
            />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
              {MONTH_NAMES[month - 1]} by type
            </h3>
            <PieChart
              ariaLabel="Expenses share by type"
              slices={SUMMARY_CATEGORIES.filter((c) => active.has(c.key)).map(
                (c) => ({
                  label: c.label,
                  value: byCatThisMonth.get(c.key) ?? 0,
                }),
              )}
            />
          </div>
        </div>,
        )}
      </div>
      {editingRow && (
        <EditExpenseDialog
          row={editingRow}
          editable={editable}
          onSave={update}
          onDelete={remove}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

// ── Rent — month-grid like the sheet ─────────────────────────────────────────

interface RentGridProps {
  year: number;
  rows: ExpenseRowDb[];
  editable: boolean;
  onReload: () => void;
  patchRow: (id: string, patch: Partial<ExpenseRowDb>) => void;
  setNote: (n: string | null) => void;
}

const RENT_BLOCK: FinanceLock["block"] = "expenses";

function RentGrid({ year, rows, editable, onReload, patchRow, setNote }: RentGridProps) {
  const [newLine, setNewLine] = useState("");
  const [localLines, setLocalLines] = useState<string[]>([]);
  const [pnlByMonth, setPnlByMonth] = useState<
    Map<number, { value: number; state: FinanceState }>
  >(new Map());
  const [locks, setLocks] = useState<FinanceLock[]>([]);
  // Locks start empty and load async — without this flag every month briefly
  // reads (and behaves) as unlocked the instant the grid mounts, since an
  // empty `locks` array is indistinguishable from "nothing here is locked".
  const [locksLoaded, setLocksLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { widths: rentWidths, startResize: rentStartResize } =
    useResizableColumns("expenses.rent", { line: 150, month: 120 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = createClient();
        const pnlRows = await fetchAll<{
          month: number;
          value: number;
          state: FinanceState;
        }>(sb, "finance_pnl_monthly", "month, value, state", (q) =>
          q.eq("year", year).eq("line_item", "rent_expenses"),
        );
        if (!cancelled)
          setPnlByMonth(
            new Map(
              pnlRows.map((r) => [
                r.month,
                { value: Number(r.value), state: r.state },
              ]),
            ),
          );
      } catch (e: unknown) {
        console.error("Failed to load rent_expenses P&L for mismatch check:", e);
        if (!cancelled) setPnlByMonth(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

  const loadLocks = useCallback(async () => {
    try {
      const sb = createClient();
      const lockRows = await fetchAll<LockRow>(
        sb,
        "finance_locks",
        "id, scope_year, scope_month, block, locked_at, note",
        (q) => q.eq("scope_year", year),
      );
      setLocks(lockRows.map(mapLock));
    } catch (e: unknown) {
      // An empty lock list here reads as "nothing is locked" — a genuinely
      // dangerous silent failure mode for a grid whose whole editability
      // gate depends on it, so this one is worth logging loudly.
      console.error("Failed to load finance_locks for Rent grid:", e);
      setLocks([]);
    } finally {
      setLocksLoaded(true);
    }
  }, [year]);

  useEffect(() => {
    setLocksLoaded(false);
    void loadLocks();
  }, [loadLocks]);

  const canEditGrid = editable && locksLoaded;

  /** The month's first and last day, for the date range of its rent rows. */
  function monthRange(month: number): [string, string] {
    const mm = String(month).padStart(2, "0");
    const lastDay = new Date(year, month, 0).getDate();
    return [`${year}-${mm}-01`, `${year}-${mm}-${String(lastDay).padStart(2, "0")}`];
  }

  /*
   * Finalize and reopen are two writes each (the rows' state, the lock) with no transaction from the
   * browser. They used to stop half-way on a failure — rows final with no lock, or the lock gone with
   * the rows still final — and leave the grid showing the old states, since only success reloaded.
   * Now a failed second write puts the first one back, and the grid re-reads either way.
   */
  async function finalizeMonth(month: number) {
    setBusy(`lock-${month}`);
    setNote(null);
    const sb = createClient();
    const [from, to] = monthRange(month);
    // The rows this finalizes and the step each was on, to put back if the lock can't be written.
    let finalized: { id: string; state: FinanceState }[] = [];
    try {
      const { data: open, error: readErr } = await sb
        .from("finance_expenses")
        .select("id, state")
        .eq("category", "rent")
        .gte("date", from)
        .lte("date", to)
        .neq("state", "final");
      if (readErr) throw new Error(readErr.message);
      const toFinalize = (open ?? []) as { id: string; state: FinanceState }[];
      if (toFinalize.length) {
        // Exclude rows already final — the guard trigger blocks a no-op
        // final→final update, which would otherwise abort this whole batch.
        const { error: updateErr } = await sb
          .from("finance_expenses")
          .update({ state: "final" })
          .in("id", toFinalize.map((r) => r.id))
          .neq("state", "final");
        if (updateErr) throw new Error(updateErr.message);
        finalized = toFinalize;
      }
      const { error: e } = await sb
        .from("finance_locks")
        .insert({ scope_year: year, scope_month: month, block: RENT_BLOCK });
      if (e && !e.message.includes("duplicate")) throw new Error(e.message);
    } catch (e: unknown) {
      let undone = true;
      for (const state of new Set(finalized.map((r) => r.state))) {
        const ids = finalized.filter((r) => r.state === state).map((r) => r.id);
        const { error: back } = await sb.from("finance_expenses").update({ state }).in("id", ids);
        if (back) undone = false;
      }
      const msg = e instanceof Error ? e.message : "Finalize failed";
      setNote(undone ? `Finalize failed: ${msg}` : `Finalize failed: ${msg} — some lines stayed final; reopen the month to undo them`);
    } finally {
      onReload();
      await loadLocks();
      setBusy(null);
    }
  }

  async function unlockMonth(month: number) {
    setBusy(`lock-${month}`);
    setNote(null);
    const sb = createClient();
    const [from, to] = monthRange(month);
    let lockDeleted = false;
    try {
      // The lock goes first, as on the other grids; its failure used to be ignored.
      const { error: delErr } = await sb
        .from("finance_locks")
        .delete()
        .eq("scope_year", year)
        .eq("scope_month", month)
        .eq("block", RENT_BLOCK);
      if (delErr) throw new Error(delErr.message);
      lockDeleted = true;
      const { error: updateErr } = await sb
        .from("finance_expenses")
        .update({ state: "actual" })
        .eq("category", "rent")
        .eq("state", "final")
        .gte("date", from)
        .lte("date", to);
      if (updateErr) throw new Error(updateErr.message);
    } catch (e: unknown) {
      // The rows are still final: lock the month again so the two agree.
      let relocked = true;
      if (lockDeleted) {
        const { error: back } = await sb
          .from("finance_locks")
          .insert({ scope_year: year, scope_month: month, block: RENT_BLOCK });
        if (back && !back.message.includes("duplicate")) relocked = false;
      }
      const msg = e instanceof Error ? e.message : "Unlock failed";
      setNote(relocked ? `Reopen failed: ${msg}` : `Reopen failed: ${msg} — the month shows open but its lines are still final; try again`);
    } finally {
      onReload();
      await loadLocks();
      setBusy(null);
    }
  }

  const lines = useMemo(() => {
    const m = new Map<
      string,
      Map<
        number,
        { id: string; amount: number; state: FinanceState; notes: string; count: number }
      >
    >();
    for (const r of rows) {
      const name = r.vendor || r.description || "—";
      const mo = Number(r.date.slice(5, 7));
      let line = m.get(name);
      if (!line) {
        line = new Map();
        m.set(name, line);
      }
      const cur = line.get(mo);
      line.set(mo, {
        id: cur?.id ?? r.id,
        amount: (cur?.amount ?? 0) + Number(r.amount_gross),
        state: cur?.state ?? (r.state as FinanceState),
        notes: cur?.notes ?? r.notes ?? "",
        // How many bills the cell adds up: two or more can't be typed over (see the cell below).
        count: (cur?.count ?? 0) + 1,
      });
    }
    for (const name of localLines) if (!m.has(name)) m.set(name, new Map());
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, localLines]);

  const mismatchByMonth = useMemo(() => {
    const out = new Map<number, { stored: number; fresh: number }>();
    for (const [month, pnl] of pnlByMonth) {
      if (pnl.state !== "final") continue;
      let fresh = 0;
      for (const [, cells] of lines) fresh += cells.get(month)?.amount ?? 0;
      fresh = round2(fresh);
      if (Math.abs(fresh - pnl.value) >= 0.02)
        out.set(month, { stored: pnl.value, fresh });
    }
    return out;
  }, [pnlByMonth, lines]);

  // For a mismatched month, a line whose cell isn't 'final' is the concrete,
  // visible reason it no longer matches the locked total — surface the
  // triangle there instead of just on the column header. When every cell is
  // already 'final' (no visible culprit — the mismatch predates any edit we
  // can see, likely the original import), keep the header-level warning.
  const mismatchLinesByMonth = useMemo(() => {
    const out = new Map<number, Set<string>>();
    for (const month of mismatchByMonth.keys()) {
      const suspects = new Set<string>();
      for (const [name, cells] of lines) {
        const cell = cells.get(month);
        if (cell && cell.state !== "final") suspects.add(name);
      }
      out.set(month, suspects);
    }
    return out;
  }, [mismatchByMonth, lines]);

  const rentValueAt = (r: number, c: number) => lines[r]?.[1].get(c + 1)?.amount ?? null;

  // Each cell's rows, for its files (v1.24.0): a line's rows in that month.
  const { docs: docMap } = useContext(DetailsContext);
  const [filesAt, setFilesAt] = useState<{ name: string; mo: number } | null>(null);
  const cellRows = useMemo(() => {
    const m = new Map<string, ExpenseRowDb[]>();
    for (const r of rows) {
      const k = `${r.vendor || r.description || "—"}|${Number(r.date.slice(5, 7))}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }, [rows]);
  const filesIn = (name: string, mo: number) => (cellRows.get(`${name}|${mo}`) ?? []).reduce((n, r) => n + (docMap?.get(r.id)?.length ?? 0), 0);
  // A two-month bill's file sits on its first month only (Nitsan, 2026-11-09: "no need to add a 2-month
  // invoice twice — put it on one month, and the other gets a dimmed icon"): the second month of the pair
  // (same amount, ±₪1) points to it — also when it holds a copy left by v1.24.0–v1.24.9.
  const docsIn = (name: string, mo: number) => (cellRows.get(`${name}|${mo}`) ?? []).flatMap((r) => docMap?.get(r.id) ?? []);
  const amountAt = (name: string, mo: number) => lines.find(([n]) => n === name)?.[1].get(mo)?.amount ?? 0;
  const fileHome = (name: string, mo: number, inner = false): number | null => {
    if (mo < 2 || !RENT_SOURCES.some((s) => s.months === 2 && s.line === name.trim())) return null;
    const prev = docsIn(name, mo - 1);
    if (!prev.length || Math.abs(amountAt(name, mo) - amountAt(name, mo - 1)) > 1) return null;
    // The month before must be a pair's first month, not itself the second.
    if (!inner && fileHome(name, mo - 1, true) != null) return null;
    const own = docsIn(name, mo);
    return own.every((d) => prev.some((p) => p.filename === d.filename && p.size === d.size)) ? mo - 1 : null;
  };

  // Hover card on a rent cell: the line over the year, and its share of the month.
  const rentMonthTotal = (mo: number) => lines.reduce((s, [, cells]) => s + (cells.get(mo)?.amount ?? 0), 0);
  const crosshair = useTableCrosshair();
  const explain = useExplainHover((key) => {
    const [, name, moStr] = key.split("|");
    const mo = Number(moStr);
    const cells = lines.find(([n]) => n === name)?.[1];
    const v = cells?.get(mo)?.amount ?? 0;
    if (!cells || !v) return null;
    const values = MONTHS.map((_, i) => cells.get(i + 1)?.amount ?? 0);
    const total = rentMonthTotal(mo);
    const prevTotal = mo > 1 ? rentMonthTotal(mo - 1) : 0;
    return {
      title: `${name} · ${MONTH_NAMES[mo - 1]}`,
      value: formatILS(v),
      trends: [trend(v, mo > 1 ? values[mo - 2] || undefined : undefined, formatILS, "last month", false)].filter((t) => t != null),
      notes: [
        total ? `${Math.round((v / total) * 100)}% of ${MONTH_NAMES[mo - 1]}'s rent (${formatILS(total)}${prevTotal ? `, ${total >= prevTotal ? "up" : "down"} ${Math.abs(Math.round(((total - prevTotal) / prevTotal) * 100))}% vs last month` : ""})` : "",
        cells.get(mo)?.notes ? `Note: ${cells.get(mo)!.notes}` : "",
        (cells.get(mo)?.count ?? 0) > 1 ? `${cells.get(mo)!.count} bills this month — change each one from Summary` : "",
      ].filter(Boolean),
      series: { values, current: mo },
      sources: [],
    };
  });
  const rentSel = useCellSelection(
    `rent|${year}|${lines.map(([name]) => name).join(",")}`,
    rentValueAt,
  );
  const rentSummary = useMemo(() => selectionSummary(rentSel.live, rentValueAt), [rentSel.live, lines]);

  async function toggleLock(cell: { id: string; state: FinanceState }) {
    const nextState: FinanceState = cell.state === "final" ? "actual" : "final";
    const sb = createClient();
    const { error: e } = await sb
      .from("finance_expenses")
      .update({ state: nextState })
      .eq("id", cell.id);
    if (e) {
      setNote(`Lock toggle failed: ${e.message}`);
      return;
    }
    patchRow(cell.id, { state: nextState });
  }

  async function togglePredicted(cell: { id: string; state: FinanceState }) {
    if (cell.state === "final") return;
    const nextState: FinanceState =
      cell.state === "predicted" ? "actual" : "predicted";
    const sb = createClient();
    const { error: e } = await sb
      .from("finance_expenses")
      .update({ state: nextState })
      .eq("id", cell.id);
    if (e) {
      setNote(`Update failed: ${e.message}`);
      return;
    }
    patchRow(cell.id, { state: nextState });
  }

  async function saveComment(
    cell: { id: string; state: FinanceState },
    text: string,
  ) {
    const sb = createClient();
    const err = await updatePreservingLock(
      sb,
      "finance_expenses",
      cell.id,
      { notes: text },
      cell.state,
    );
    if (err) {
      setNote(`Comment save failed: ${err.message}`);
      return;
    }
    patchRow(cell.id, { notes: text });
  }

  async function commit(
    lineName: string,
    month: number,
    raw: string,
    existing?: { id: string; amount: number },
  ) {
    const v = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isFinite(v)) return;
    const sb = createClient();
    let e;
    // Rent has no separate no-VAT figure in the sheet — it's entered and
    // rolled up as a flat, already-final monthly cost. Storing amount_no_vat
    // equal to the gross keeps the rollup from applying netOfVat() to it
    // (that fallback is for categories that DO carry a real no-VAT column).
    if (existing) {
      ({ error: e } = await sb
        .from("finance_expenses")
        .update({ amount_gross: v, amount_no_vat: v })
        .eq("id", existing.id));
    } else if (v !== 0) {
      ({ error: e } = await sb.from("finance_expenses").insert({
        date: `${year}-${String(month).padStart(2, "0")}-15`,
        category: "rent",
        vendor: lineName,
        description: "",
        amount_gross: v,
        amount_no_vat: v,
        recurrence: "monthly",
        state: isForecastMonth(year, month) ? "predicted" : "actual",
      }));
    }
    if (e) {
      setNote(`Save failed: ${e.message}`);
      return;
    }
    setNote(null);
    if (existing) {
      // Same value just written, reflected locally — no reload/blink, same
      // as the lock/predicted/comment toggles on this grid.
      patchRow(existing.id, { amount_gross: v, amount_no_vat: v });
    } else {
      // A brand-new row has no id to patch by yet, and this insert doesn't
      // `.select()` it back — a one-time reload for the first value typed
      // into a line/month is a fair trade against a `.select()` here for
      // every save.
      onReload();
    }
  }

  return (
    <div>
      <StateLegend />
      {explain.card}
      <div
        className="w-fit max-w-full overflow-x-auto rounded-xl border border-border bg-surface"
        onMouseOver={explain.onMouseOver}
        onMouseLeave={explain.onMouseLeave}
      >
        <table
          className="select-none border-collapse text-[13px]"
          onMouseOver={crosshair.onMouseOver}
          onMouseLeave={crosshair.onMouseLeave}
          style={{
            tableLayout: "fixed",
            width: rentWidths.line + rentWidths.month * MONTHS.length,
          }}
        >
          <colgroup>
            <col style={{ width: rentWidths.line }} />
            {MONTHS.map((m) => (
              <col key={m} style={{ width: rentWidths.month }} />
            ))}
          </colgroup>
          <thead>
            <tr className={`${THEAD_CLS} bg-surface-2`}>
              <th className="sticky left-0 z-10 min-w-[150px] bg-surface-2 px-3 py-2 text-left">
                Expense line
                <ResizeHandle onMouseDown={rentStartResize("line")} />
              </th>
              {MONTHS.map((m, i) => {
                const monthNum = i + 1;
                const mismatch = mismatchByMonth.get(monthNum);
                // Only warn at the column level when no single line can be
                // pinpointed — otherwise the triangle sits on that line's own cell.
                const showHeaderMismatch =
                  mismatch &&
                  (mismatchLinesByMonth.get(monthNum)?.size ?? 0) === 0;
                const locked = monthLocked(locks, year, monthNum, RENT_BLOCK);
                return (
                  <th
                    key={m}
                    className={`group relative px-2 py-2 text-right ${isForecastMonth(year, monthNum) ? "" : "bg-background"}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {showHeaderMismatch && mismatch && (
                        <MismatchTriangle align={monthNum >= 7 ? "right" : "left"}>
                          Locked rent total <span className="tabular-nums">{formatILS(mismatch.stored)}</span>{" "}
                          no longer matches the current lines (
                          <span className="tabular-nums">{formatILS(mismatch.fresh)}</span>, diff{" "}
                          <span className="tabular-nums">
                            {formatILS(Math.abs(mismatch.fresh - mismatch.stored))}
                          </span>
                          ), but every line here is still marked final — the gap likely predates any
                          edit visible in this app (e.g. the original import). Worth a manual check
                          against the source sheet.
                        </MismatchTriangle>
                      )}
                      {m}
                      {locked && <span className="text-faint">·</span>}
                      {canEditGrid && (
                        <button
                          onClick={() =>
                            locked
                              ? unlockMonth(monthNum)
                              : finalizeMonth(monthNum)
                          }
                          disabled={busy === `lock-${monthNum}`}
                          title={
                            locked ? "Reopen month" : "Finalize whole month"
                          }
                          className="text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          {locked ? <Lock size={11} /> : <LockOpen size={11} />}
                        </button>
                      )}
                    </span>
                    <ResizeHandle onMouseDown={rentStartResize("month")} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lines.map(([name, cells], rowIdx) => {
              return (
                <tr key={name} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                    <span className="bidi-auto">{name}</span>
                  </td>
                  {MONTHS.map((_, i) => {
                    const mo = i + 1;
                    const cell = cells.get(mo);
                    const home = cell && docMap ? fileHome(name, mo) : null;
                    const locked = monthLocked(locks, year, mo, RENT_BLOCK);
                    const mismatch = mismatchByMonth.get(mo);
                    const isMismatchSuspect =
                      mismatch && mismatchLinesByMonth.get(mo)?.has(name);
                    return (
                      <RentCell
                        key={mo}
                        // A cell of two or more bills is their total: a typed figure went onto the
                        // first bill alone (3,000 + 5,000, type 5,000 → 10,000). Each bill is
                        // changed from Summary instead, which lists them one by one.
                        editable={canEditGrid && !locked && (cell?.count ?? 0) < 2}
                        value={cell?.amount ?? 0}
                        state={cell?.state}
                        onCommit={(v) => commit(name, mo, v, cell)}
                        onToggleLock={cell ? () => toggleLock(cell) : undefined}
                        onTogglePredicted={
                          cell ? () => togglePredicted(cell) : undefined
                        }
                        comment={cell?.notes}
                        onSaveComment={
                          cell ? (v) => saveComment(cell, v) : undefined
                        }
                        future={isForecastMonth(year, mo)}
                        dataCell={cell?.amount ? `rc|${name}|${mo}` : undefined}
                        selected={rentSel.isSelected(rowIdx, i)}
                        onCellMouseDown={(e) =>
                          rentSel.cellMouseDown(rowIdx, i, e)
                        }
                        onCellMouseEnter={(e) =>
                          rentSel.cellMouseEnter(rowIdx, i, e)
                        }
                        mismatchContent={
                          isMismatchSuspect && mismatch ? (
                            <>
                              This line isn&rsquo;t &ldquo;final&rdquo; — likely why {MONTHS[mo - 1]}
                              &rsquo;s locked rent total (
                              <span className="tabular-nums">{formatILS(mismatch.stored)}</span>) no
                              longer matches the current lines (
                              <span className="tabular-nums">{formatILS(mismatch.fresh)}</span>).
                            </>
                          ) : undefined
                        }
                        mismatchAlign={mo >= 7 ? "right" : "left"}
                        files={cell && docMap && home == null ? filesIn(name, mo) : 0}
                        filesHome={home != null ? MONTH_NAMES[home - 1] : undefined}
                        onFiles={cell && docMap ? () => setFilesAt({ name, mo: home ?? mo }) : undefined}
                      />
                    );
                  })}
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-faint">
                  No rent lines for {year}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filesAt && (
        <CellFilesDialog
          title={`${filesAt.name.trim()} · ${MONTH_NAMES[filesAt.mo - 1]} ${year}`}
          rows={cellRows.get(`${filesAt.name}|${filesAt.mo}`) ?? []}
          month={`${year}-${String(filesAt.mo).padStart(2, "0")}`}
          editable={editable}
          onClose={() => setFilesAt(null)}
        />
      )}
      <SelectionBubble
        bubble={rentSel.bubble}
        copied={rentSel.copied}
        total={rentSummary.total}
        cells={rentSummary.cells}
        filled={rentSummary.filled}
        formatValue={formatILS}
      />
      {editable && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={newLine}
            onChange={(e) => setNewLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newLine.trim()) {
                setLocalLines((l) => [...l, newLine.trim()]);
                setNewLine("");
              }
            }}
            placeholder="New expense line (e.g. חשמל)"
            className="bidi-auto rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={() => {
              if (!newLine.trim()) return;
              setLocalLines((l) => [...l, newLine.trim()]);
              setNewLine("");
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-background"
          >
            <Plus size={15} />
            Add line
          </button>
        </div>
      )}
    </div>
  );
}

function RentCell({
  editable,
  value,
  state,
  onCommit,
  onToggleLock,
  onTogglePredicted,
  comment,
  onSaveComment,
  selected,
  onCellMouseDown,
  onCellMouseEnter,
  mismatchContent,
  mismatchAlign = "left",
  future,
  dataCell,
  files = 0,
  filesHome,
  onFiles,
}: {
  editable: boolean;
  value: number;
  state?: FinanceState;
  onCommit: (v: string) => void;
  onToggleLock?: () => void;
  onTogglePredicted?: () => void;
  comment?: string;
  onSaveComment?: (v: string) => void;
  /** This specific cell — not just its month in general — looks like the
   * reason the month's locked total no longer matches its line items. */
  mismatchContent?: React.ReactNode;
  /** "right" for a late-year column, so the tooltip doesn't run off the
   * table's right edge. */
  mismatchAlign?: "left" | "right";
  /** Past month — this whole table already sits on bg-surface, so a past
   * column is dimmed slightly instead of a future one being lightened. */
  future?: boolean;
  /** Key for the hover explain card. */
  dataCell?: string;
  /** The cell's files (v1.24.0): how many, and opening them. */
  files?: number;
  /** A two-month bill's file is on this other month (its name): a dimmed mark that opens it. */
  filesHome?: string;
  onFiles?: () => void;
} & CellSelectionProps) {
  const ref = useRef<HTMLInputElement>(null);
  const display = value
    ? round2(value).toLocaleString("en-US", {
        maximumFractionDigits: 2,
      })
    : "";
  const stateCls = cellStateClass(state);
  const pastCls = !future && state !== "predicted" && state !== "final" ? "bg-background" : "";
  const editor = useCommentEditor();
  const contextMenu = onSaveComment
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        editor.show();
      }
    : undefined;
  const commentUi = onSaveComment && (
    <>
      {comment && <CommentBadge comment={comment} onOpen={editor.show} />}
      {editor.open && (
        <CommentEditorDialog
          initial={comment ?? ""}
          onSave={(v) => {
            onSaveComment(v);
            editor.hide();
          }}
          onCancel={editor.hide}
        />
      )}
    </>
  );
  const selCls = selected ? SEL_CLS : "";
  // The bill's file(s) on this cell (v1.24.0): a mark that opens them; on hover, a clip to add one —
  // right beside the number (Nitsan, 2026-11-09: "move the attachment icons left of the number").
  const filesAt = (pos: string, style?: React.CSSProperties) =>
    onFiles &&
    (files ? (
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onFiles();
        }}
        title={`${files} file${files === 1 ? "" : "s"} — open`}
        aria-label={`Open the bill's file${files === 1 ? "" : "s"}`}
        style={style}
        className={`${pos} z-10 flex items-center rounded p-0.5 text-brand hover:bg-brand-soft`}
      >
        <FileText size={14} />
      </button>
    ) : filesHome ? (
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onFiles();
        }}
        title={`The bill covers both months — its file is on ${filesHome}`}
        aria-label={`Open the bill's file, kept on ${filesHome}`}
        style={style}
        className={`${pos} z-10 flex items-center rounded p-0.5 text-brand opacity-35 hover:bg-brand-soft hover:opacity-100`}
      >
        <FileText size={14} />
      </button>
    ) : (
      // Adding one (Nitsan, 2026-11-09: "more prominent and big, with a + before the clip").
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onFiles();
        }}
        title="Add the bill's file"
        aria-label="Add the bill's file"
        style={style}
        className={`${pos} z-10 flex items-center rounded-md bg-surface px-0.5 py-0.5 text-brand opacity-0 shadow-sm ring-1 ring-brand/30 transition-opacity group-hover:opacity-100 hover:bg-brand-soft focus-visible:opacity-100`}
      >
        <Plus size={10} strokeWidth={3} />
        <Paperclip size={14} />
      </button>
    ));
  /** Beside a number shown as text: just left of it. */
  const besideText = (text: string) => (
    <span className="relative">
      {filesAt("absolute top-1/2 right-full mr-1 -translate-y-1/2")}
      {text}
    </span>
  );
  const mismatchUi = mismatchContent && (
    <span className="absolute left-0.5 top-0.5 z-10">
      <MismatchTriangle align={mismatchAlign}>{mismatchContent}</MismatchTriangle>
    </span>
  );
  if (!editable) {
    return (
      <td
        data-cell={dataCell}
        className={`group relative select-none p-0 ${pastCls} ${selCls}`}
        onContextMenu={contextMenu}
        onMouseDown={onCellMouseDown}
        onMouseEnter={onCellMouseEnter}
      >
        <div className={`px-2 py-1.5 text-right tabular-nums ${stateCls}`}>
          {besideText(display)}
        </div>
        {mismatchUi}
        {commentUi}
      </td>
    );
  }
  if (state === "final") {
    return (
      <td
        data-cell={dataCell}
        className={`group relative cursor-cell p-0 select-none ${pastCls} ${selCls}`}
        onContextMenu={contextMenu}
        onMouseDown={onCellMouseDown}
        onMouseEnter={onCellMouseEnter}
      >
        <div
          className={`py-1.5 pl-2 text-right tabular-nums ${onToggleLock ? "pr-5" : "pr-2"} ${stateCls}`}
        >
          {besideText(display)}
        </div>
        {mismatchUi}
        {onToggleLock && (
          <CellIconButton
            onClick={onToggleLock}
            title="Locked — click to unlock"
            offset="right-0.5"
          >
            <Lock size={10} />
          </CellIconButton>
        )}
        {commentUi}
      </td>
    );
  }
  return (
    <td
      data-cell={dataCell}
      className={`group relative p-0 ${stateCls} ${pastCls} ${selCls}`}
      onContextMenu={contextMenu}
      onMouseDown={onCellMouseDown}
      onMouseEnter={onCellMouseEnter}
    >
      {mismatchUi}
      {/* In the input the number's width is its digits (tabular): the icon sits just left of them. */}
      {filesAt("absolute top-1/2 -translate-y-1/2", {
        right: `calc(${display.length}ch + ${onToggleLock || onTogglePredicted ? "2rem" : "0.5rem"} + 4px)`,
      })}
      <input
        ref={ref}
        defaultValue={value ? String(round2(value)) : ""}
        onBlur={(e) => {
          const raw = e.target.value;
          const before = value ? String(round2(value)) : "";
          if (raw !== before) onCommit(raw);
        }}
        onKeyDown={(e) => e.key === "Enter" && ref.current?.blur()}
        inputMode="decimal"
        className={`w-full min-w-16 select-none bg-transparent px-2 py-1.5 text-right tabular-nums outline-none focus:select-text ${
          onToggleLock || onTogglePredicted ? "pr-8" : ""
        } ${CELL_HOVER} ${CELL_FOCUS}`}
      />
      {onTogglePredicted && (
        <CellIconButton
          onClick={onTogglePredicted}
          title={
            state === "predicted"
              ? "Mark as draft"
              : "Mark as predicted"
          }
          offset="right-4"
        >
          {state === "predicted" ? <Check size={10} /> : <Clock size={10} />}
        </CellIconButton>
      )}
      {onToggleLock && (
        <CellIconButton
          onClick={onToggleLock}
          title="Lock this value"
          offset="right-0.5"
        >
          <Lock size={10} />
        </CellIconButton>
      )}
      {commentUi}
    </td>
  );
}
