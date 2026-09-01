"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { invoiceDayToStore, nextPeriod, parseInvoiceDay } from "@/lib/billing-rollover";
import { createClient } from "@/lib/supabase/client";
import { canonicalReportLink, fetchAll, mapReportLink, updateWithOptional } from "@/lib/db";
import { capTone } from "@/lib/cap";
import {
  formatDate,
  formatHoursShort,
  parseISO,
  formatDayMonth,
  shortRangeLabel,
  shiftDays,
  toISODate,
  MONTH_NAMES_SHORT,
} from "@/lib/format";
import { cutoffIsStale, lastCompleteWeekEnd } from "@/lib/period-math";
import { EditableDateCell, EditableTextCell } from "@/components/editable-cell";
import { MiniColumns } from "@/components/charts";
import { ReportTable, ViewToggle } from "@/components/report-table";
import { Modal, ModalClose } from "@/components/ui";
import { toggleIn } from "@/lib/toggle";
import {
  currentPeriodIndex,
  periodIndexFromDate,
  previousPeriodIndex,
} from "@/lib/report-period-focus";
import { buildReportSnapshot } from "@/lib/report-snapshot";
import type { BillingPeriod, Client, ReportLink, ReportSnapshot } from "@/lib/types";

/** "Show all" hands the table an empty fold list; a module constant so the identity
    is stable across renders rather than a fresh [] each time. */
const EMPTY_FOLDS: string[] = [];
const EMPTY_PERIODS: ReportSnapshot["periods"] = [];

/**
 * What a pre-v1.43.0 `view_flags.periodOnly: true` was pointing at, named as a date.
 *
 * ⚠️ Read off the PUBLISHED snapshot rather than the live period list, because that
 * is the list the flag was written against. If the studio has since deleted or moved
 * that period the date will not resolve and the client opens on every period —
 * strictly better than opening on a period nobody chose.
 */
function legacyPeriodFrom(link: ReportLink | undefined): string | null {
  if (!link?.viewFlags?.periodOnly) return null;
  const periods = link.snapshot?.periods ?? [];
  const i = currentPeriodIndex(periods);
  return i < 0 ? null : periods[i].from;
}


/**
 * What the numeric field SHOWS for a value still stored the old way ("20th" → "20").
 *
 * ⚠️ Display only — nothing is rewritten until somebody edits the field, so a note
 * this cannot read (there are none today) stays visible as itself rather than being
 * silently blanked by the input that is about to save over it.
 */
function invoiceDayText(note: string | null | undefined): string {
  const day = parseInvoiceDay(note);
  return day != null ? String(day) : (note ?? "");
}

/**
 * "1st" / "22nd" — for a TOOLTIP only. The badge itself is the bare number, which
 * is what Nitsan asked for ("just the number (no th or st)"): at 10px in a 16px
 * square a suffix is unreadable and costs the width the second digit needs.
 */
function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/** iso date + n CALENDAR days → iso date. */
function shiftDaysIso(iso: string, n: number): string {
  return toISODate(shiftDays(parseISO(iso), n));
}


/** One "include this" line in the publish checklist. */
function IncludeRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 py-2 hover:border-brand">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-brand"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[11px] text-faint">{hint}</span>
      </span>
    </label>
  );
}

// ── payment periods pane (below the report table) + info pane + graph ──────

function PaymentPeriods({ client }: { client: Client }) {
  const {
    billingPeriods,
    addBillingPeriod,
    updateBillingPeriod,
    deleteBillingPeriod,
    tasks,
    entrySumsAll,
    updateClient,
  } = useData();
  const periods = billingPeriods.filter((p) => p.clientId === client.id);
  const todayIso = toISODate(new Date());

  const clientTaskIds = useMemo(
    () =>
      new Set(
        tasks.filter((t) => t.clientId === client.id && t.billable && !t.pending).map((t) => t.id),
      ),
    [tasks, client.id],
  );
  const clientEntries = useMemo(
    () => entrySumsAll.filter((e) => clientTaskIds.has(e.taskId)),
    [entrySumsAll, clientTaskIds],
  );

  const minutesIn = (from: string, to: string) =>
    clientEntries.reduce((s, e) => (e.date >= from && e.date <= to ? s + e.minutes : s), 0);

  /**
   * ⚠️ REJECT A DATE THAT WOULD OVERLAP A NEIGHBOUR OR INVERT THE PERIOD.
   * `buildReportSnapshot` adds an entry's minutes to EVERY period containing its
   * date, so two overlapping periods bill the same hours twice — in the per-period
   * totals `hourCap`/`advanceHours` are read against. These two cells committed
   * anything the picker returned, unchecked. (Measured 2026-08-24: no client's
   * periods actually overlap, so this closes the door rather than repairing data.)
   */
  const commitPeriodDate = (p: BillingPeriod, key: "dateFrom" | "dateTo", v: string) => {
    const from = key === "dateFrom" ? v : p.dateFrom;
    const to = key === "dateTo" ? v : p.dateTo;
    if (from > to) return;
    const i = periods.findIndex((x) => x.id === p.id);
    const before = periods[i - 1];
    const after = periods[i + 1];
    if (before && from <= before.dateTo) return;
    if (after && to >= after.dateFrom) return;
    updateBillingPeriod(p.id, { [key]: v });
  };

  /**
   * The client's hour cap. Blank clears it.
   *
   * ⚠️ Anything that is not a non-negative number is REFUSED rather than coerced:
   * `Number("")` is 0, so a naive parse would turn a cleared cap into a 0h cap
   * and tell the client their whole period is overspent.
   */
  /**
   * The invoice day, written as a bare number.
   *
   * ⚠️ REFUSED RATHER THAN COERCED, exactly like the cap below: `Number("")` is 0
   * and `parseInt("30 days")` is 30, and either would put a day nobody chose into
   * the field the ROLLOVER aligns periods to. Blank clears it, 1–31 commits, and
   * anything else leaves the value alone.
   * ⚠️ 1–31 and not 1–28: `nextInvoiceDate` clamps a 31st into a short month, which
   * is the behaviour a client billed on the 31st actually wants.
   */
  const commitInvoiceDay = (c: Client, raw: string) => {
    const next = invoiceDayToStore(raw);
    if (next === null) return; // refused — see `invoiceDayToStore`
    updateClient(c.id, { invoiceNote: next });
  };

  const commitClientCap = (c: Client, raw: string) => {
    const v = raw.trim();
    if (v === "") {
      updateClient(c.id, { hourCap: null });
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    updateClient(c.id, { hourCap: n });
  };

  const current = periods.find((p) => todayIso >= p.dateFrom && todayIso <= p.dateTo);
  const currentMinutes = current ? minutesIn(current.dateFrom, current.dateTo) : 0;
  const activeTasks = useMemo(() => {
    if (!current) return 0;
    const ids = new Set<string>();
    for (const e of clientEntries)
      if (e.date >= current.dateFrom && e.date <= current.dateTo) ids.add(e.taskId);
    return ids.size;
  }, [clientEntries, current]);

  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of clientEntries) {
      const key = e.date.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + e.minutes);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([key, minutes]) => {
        const mon = MONTH_NAMES_SHORT[Number(key.slice(5, 7)) - 1];
        // the axis reads as months, so the year lives in the hover instead — with 12
        // buckets one month name can appear twice and the label alone is ambiguous,
        // which is also why `id` carries the YYYY-MM the chart keys on
        return { id: key, label: mon, title: `${mon} ${key.slice(0, 4)}`, minutes };
      });
  }, [clientEntries]);

  function addPeriod() {
    const last = periods[periods.length - 1];
    const now = new Date();
    const from = last
      ? shiftDaysIso(last.dateTo, 1)
      : toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
    const [y, m, d] = from.split("-").map(Number);
    const to = toISODate(new Date(y, m, d - 1)); // one month, inclusive
    addBillingPeriod({
      clientId: client.id,
      label: shortRangeLabel(from, to),
      dateFrom: from,
      dateTo: to,
      hourCap: null,
      advanceHours: null,
    });
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center gap-3 border-b border-border bg-background px-3 py-2 text-xs font-medium uppercase tracking-wide text-faint">
          <span className="min-w-0 flex-1" title="Payment period title — click a name to rename it">
            Payment period
          </span>
          <span className="w-56 shrink-0" title="Period date range — click a date to change it">
            Dates
          </span>
          <span
            className="w-16 shrink-0 text-right"
            title="Hours logged on this client's billable tasks inside the period"
          >
            Hours
          </span>
          <span className="w-14 shrink-0" />
        </div>
        {periods.map((p) => {
          const isCurrent = p.id === current?.id;
          const strike = p.paid ? "line-through" : "";
          return (
            <div
              key={p.id}
              className={`group flex items-center gap-3 border-b border-border px-3 py-1.5 text-sm last:border-b-0 ${
                isCurrent ? "bg-brand-soft/50" : ""
              } ${p.paid ? "opacity-60" : ""}`}
              title={isCurrent ? "Current period" : undefined}
            >
              <span className={`min-w-0 flex-1 ${strike}`}>
                <EditableTextCell
                  value={p.label}
                  onCommit={(v) => v && updateBillingPeriod(p.id, { label: v })}
                  className={isCurrent ? "font-semibold text-brand-dark" : ""}
                />
              </span>
              <span className={`flex w-56 shrink-0 items-center gap-1 text-xs ${strike}`}>
                <span className="w-[5.5rem]">
                  <EditableDateCell
                    value={p.dateFrom}
                    onCommit={(v) => v && commitPeriodDate(p, "dateFrom", v)}
                    format={formatDate}
                  />
                </span>
                <span className="text-faint">→</span>
                <span className="w-[5.5rem]">
                  <EditableDateCell
                    value={p.dateTo}
                    onCommit={(v) => v && commitPeriodDate(p, "dateTo", v)}
                    format={formatDate}
                  />
                </span>
              </span>
              <span className={`w-16 shrink-0 text-right font-medium tabular-nums ${strike}`}>
                {formatHoursShort(minutesIn(p.dateFrom, p.dateTo))}
              </span>
              <span className="flex w-14 shrink-0 items-center justify-end gap-0.5">
                <button
                  onClick={() => updateBillingPeriod(p.id, { paid: !p.paid })}
                  title={p.paid ? "Paid — click to mark as not paid" : "Mark this period as paid"}
                  className={`rounded p-1 ${
                    p.paid ? "text-success" : "invisible text-muted hover:text-success group-hover:visible"
                  }`}
                >
                  <Banknote size={14} />
                </button>
                <button
                  onClick={() => deleteBillingPeriod(p.id)}
                  className="invisible rounded p-1 text-faint hover:text-danger group-hover:visible"
                  title="Delete period"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          );
        })}
        {periods.length === 0 && (
          <p className="px-3 py-4 text-sm text-faint">
            No payment periods yet — add one here, or hover between two column titles in the table
            above and press +.
          </p>
        )}
        <button
          onClick={addPeriod}
          className="m-2 self-start rounded-md border border-dashed border-border-strong px-2 py-1 text-xs text-muted hover:border-brand hover:text-brand"
        >
          + Add period
        </button>
      </div>

      {/* 504 = 360 + 40%. The payment-period table beside this is `flex-1`, so it
          simply yields the difference — one number moves both panes. */}
      <div className="flex w-full shrink-0 flex-col gap-4 xl:w-[504px]">
        <div className="rounded-2xl border border-border bg-surface shadow-card p-4">
          <div className="grid grid-cols-4 gap-2">
            <div
              title={
                client.hourCap != null
                  ? `Hours logged on billable tasks in the current payment period, against this client's ${client.hourCap}h cap`
                  : "Hours logged on billable tasks in the current payment period"
              }
            >
              <div className="text-[11px] font-medium text-muted">Current period</div>
              {/* ⚠️ `136/150`, and the COLOUR is the whole point of the cap: it is
                  semantic, so the number has to say by itself that the period is
                  filling up. Amber from 70%, red from 90% — Nitsan's thresholds,
                  so nobody goes over without noticing and asking. */}
              <div
                className={`mt-0.5 text-2xl font-semibold tabular-nums ${capTone(currentMinutes, client.hourCap)}`}
              >
                {current ? formatHoursShort(currentMinutes) : "–"}
                {current && client.hourCap != null && (
                  <span className="text-base font-medium opacity-70">/{client.hourCap}h</span>
                )}
              </div>
            </div>
            <div title="Hours agreed per billing period for this client. The client's report shows it as a cap with the hours remaining — leave it blank for no cap and neither appears. Click to edit.">
              <div className="text-[11px] font-medium text-muted">Hour cap</div>
              <div className="mt-0.5">
                <EditableTextCell
                  value={client.hourCap != null ? String(client.hourCap) : ""}
                  placeholder="none"
                  bidi={false}
                  onCommit={(v) => commitClientCap(client, v)}
                  className="text-2xl font-semibold"
                  inputClassName="text-2xl font-semibold"
                />
              </div>
            </div>
            {/* ⚠️⚠️ A DAY NUMBER, NOT A NOTE — and it stopped being free text on
                2026-09-01 at Nitsan's word: *"numeric please it just state when a
                billing period ends - nothing to do with payment terms"*. Checked
                against the real data before changing it, because v1.42.1 had built
                `parseInvoiceDay` to defend this column from payment TERMS ("Net 30")
                that would otherwise read as a day: all nine non-empty values were
                ordinals — 20th, 1st, 15th — and not one was a term. His call is the
                right one for the data that exists.
                ⚠️ THIS FIELD SHAPES DATA. The automatic rollover aligns each new
                billing period to end the day before it; blank falls back to a plain
                calendar month, which is why blank is still allowed and is not an
                error state.
                ⚠️ `parseInvoiceDay` STAYS as the reader. The stored values are still
                the old ordinals until the normalising UPDATE is run, a published
                report link is permanent, and a reader that accepts both costs
                nothing. Do not "simplify" it to `Number()` without checking the
                column first. */}
            <div title="Day of the month the invoice goes out — click to edit, 1–31. New billing periods are aligned to end the day before this; leave it blank and they simply run a calendar month.">
              <div className="text-[11px] font-medium text-muted">Invoice day</div>
              <div className="mt-0.5">
                <EditableTextCell
                  value={invoiceDayText(client.invoiceNote)}
                  placeholder="e.g. 15"
                  onCommit={(v) => commitInvoiceDay(client, v)}
                  className="text-2xl font-semibold tabular-nums"
                  inputClassName="text-2xl font-semibold tabular-nums"
                />
              </div>
            </div>
            <div title="Tasks with hours logged in the current payment period">
              <div className="text-[11px] font-medium text-muted">Active tasks</div>
              <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                {current ? activeTasks : "–"}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface shadow-card p-4">
          <h3
            className="mb-2 text-xs font-medium uppercase tracking-wide text-faint"
            title="This client's logged hours per month (last 12 months with activity)"
          >
            Hours by month
          </h3>
          {byMonth.length > 0 ? (
            <MiniColumns points={byMonth} />
          ) : (
            <p className="text-sm text-faint">No hours yet.</p>
          )}
        </div>
        <InternalNotes client={client} />
      </div>
    </div>
  );
}

/**
 * The studio's own notes about a client's reporting — why a month ran over, what
 * was agreed on the phone, what to raise before the next invoice.
 *
 * ⚠️⚠️ INTERNAL. THIS MUST NEVER REACH A CLIENT. It is safe by construction, not
 * by care: it lives on `clients`, and the public report page selects nothing from
 * that table — it reads `report_links.snapshot` alone, and `sanitizeSnapshot`
 * builds its output field by field (v1.27.1), so a new client column cannot leak
 * into a published report even by accident. Keep it that way: if this ever needs
 * to be shown to a client it should be a DIFFERENT field, not this one.
 *
 * Commits on blur rather than behind a Save button — same reasoning as the client
 * Overview notes: there is no modal to hang a save on, and losing a typed
 * paragraph is worse than saving one somebody meant to abandon (⌘Z still undoes
 * it). An incoming value is adopted only when the textarea is not being edited,
 * so a colleague's refresh cannot overwrite what is being typed here.
 */
function InternalNotes({ client }: { client: Client }) {
  const { updateClient } = useData();
  const [draft, setDraft] = useState(client.reportNotes);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(client.reportNotes);
  }, [client.reportNotes, editing]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h3
        className="mb-2 text-xs font-medium uppercase tracking-wide text-faint"
        title="Only the studio sees this — it is never part of a published client report"
      >
        Internal notes
      </h3>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (draft !== client.reportNotes) updateClient(client.id, { reportNotes: draft });
        }}
        rows={5}
        placeholder="Notes for the studio — never shown to the client."
        className="bidi-auto w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
    </div>
  );
}

// ── publish workspace ───────────────────────────────────────────────────────

const HIDDEN_TABS_KEY = "reports.hiddenTabs";

/** What the studio is currently looking at for ONE client. See `views`. */
type ViewDraft = {
  /**
   * The focused payment period's START DATE, or null for every period.
   *
   * ⚠️ A DATE AND NOT AN INDEX, for two separate reasons. (1) This page EDITS
   * periods — dragging a divider, adding one, renaming one — and an index would
   * quietly slide onto a different period the moment the list changed underneath
   * it. (2) It is published verbatim as `view_flags.periodFrom`, which has to
   * survive `sanitizeSnapshot` dropping hidden periods from the client's copy.
   */
  periodFrom: string | null;
  hideEmptyRows: boolean;
  /** The "show all" peek. Per client like the rest, so a tab switch cannot flip it. */
  showAll: boolean;
  foldedSections: string[];
  through: string;
};

function PublishWorkspace() {
  const {
    clients,
    sections,
    tasks,
    entrySumsAll,
    billingPeriods,
    currentUserId,
    openTask,
    updateTask,
    addBillingPeriod,
    updateBillingPeriod,
    refresh,
  } = useData();
  const supabase = useMemo(() => createClient(), []);
  const [links, setLinks] = useState<Map<string, ReportLink>>(new Map());
  // ⚠️ Gates the view-draft seeding below, which must not run against an
  // empty-because-still-loading `links`.
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [periodPickOpen, setPeriodPickOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [hiddenTaskIds, setHiddenTaskIds] = useState<string[]>([]);
  const [customWeeks, setCustomWeeks] = useState<{ label: string; from: string; to: string }[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);

  // load links + hidden tabs once
  useEffect(() => {
    fetchAll<Record<string, unknown>>(supabase, "report_links", "*", (q) => q.eq("active", true))
      .then((rows) => {
        const byClient = new Map<string, ReportLink[]>();
        for (const r of rows) {
          const link = mapReportLink(r);
          const list = byClient.get(link.clientId);
          if (list) list.push(link);
          else byClient.set(link.clientId, [link]);
        }
        const map = new Map<string, ReportLink>();
        for (const [clientId, list] of byClient) {
          const link = canonicalReportLink(list);
          if (link) map.set(clientId, link);
        }
        setLinks(map);
      })
      .catch((e) => console.error("links load failed", e))
      .finally(() => setLinksLoaded(true));
    try {
      const raw = localStorage.getItem(HIDDEN_TABS_KEY);
      if (raw) setHiddenTabs(JSON.parse(raw));
    } catch {}
  }, [supabase]);

  // candidate tabs: recent activity or an existing link
  const taskClient = useMemo(() => new Map(tasks.map((t) => [t.id, t.clientId])), [tasks]);
  const candidates = useMemo(() => {
    // Calendar days, not 90×24h of milliseconds: the ms form is an hour short across
    // a clocks-back transition, so the cutoff landed on the wrong DAY and a client
    // whose only recent activity sat on the boundary appeared a day early or late.
    const cutoff = toISODate(shiftDays(new Date(), -90));
    const activeIds = new Set<string>();
    for (const e of entrySumsAll) {
      if (e.date >= cutoff) {
        const cid = taskClient.get(e.taskId);
        if (cid) activeIds.add(cid);
      }
    }
    for (const [cid] of links) activeIds.add(cid);
    return clients
      .filter((c) => !c.archived && activeIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, entrySumsAll, taskClient, links]);

  const visibleTabs = candidates.filter((c) => !hiddenTabs.includes(c.id));
  const selectedClient =
    clients.find((c) => c.id === selected) ?? visibleTabs[0] ?? null;

  /**
   * ⚠️ Recomputed per render rather than held in state: this page stays open for
   * long stretches, and a value captured at mount would still name last Saturday
   * after midnight on the Sunday somebody publishes from it.
   */
  const weekEnd = lastCompleteWeekEnd(new Date());
  /**
   * View-only filters, held PER CLIENT. Deliberately NOT hiddenColumns/hiddenTaskIds:
   * those are the published state that decides what the client sees, so folding the
   * table down to one period here must never leak into the next publish.
   *
   * ⚠️⚠️ ONE MAP KEYED BY CLIENT AND NOT FIVE LOOSE SCALARS, AND THE TAB STRIP IS
   * WHY. They were plain state re-seeded from the published link whenever `selectedClient` OR
   * `links` changed, which threw the studio's picks away twice over: switching to
   * another tab and back reverted the pills and the cut-off to whatever was last
   * published, and — with the tab standing still — so did ANY write to `links`, i.e.
   * dragging a period divider, publishing, or the session's first `ensureLink`.
   *
   * ⚠️ So each client is seeded ONCE and the draft is the studio's from then until
   * the page reloads. That is also why seeding is idempotent: `links` refreshing must
   * never overwrite a draft that already exists.
   */
  const [views, setViews] = useState<Record<string, ViewDraft>>({});
  // ⚠️ `EMPTY_FOLDS` and not a fresh `[]`: a new array identity every render would
  // re-render the whole table through `effFolded`.
  const unseeded = (): ViewDraft => ({
    periodFrom: null,
    hideEmptyRows: false,
    showAll: false,
    foldedSections: EMPTY_FOLDS,
    through: weekEnd,
  });
  const { periodFrom, hideEmptyRows, showAll, foldedSections, through } =
    (selectedClient ? views[selectedClient.id] : undefined) ?? unseeded();
  function patchView(patch: (d: ViewDraft) => Partial<ViewDraft>) {
    const id = selectedClient?.id;
    if (!id) return;
    setViews((prev) => {
      const cur = prev[id] ?? unseeded();
      return { ...prev, [id]: { ...cur, ...patch(cur) } };
    });
  }
  /** Focus one period by its start date; clicking the focused one clears the scope. */
  const focusPeriod = (from: string | null) =>
    patchView((d) => ({ periodFrom: d.periodFrom === from ? null : from }));
  const clearPeriod = () => patchView(() => ({ periodFrom: null }));
  const toggleShowAll = () => patchView((d) => ({ showAll: !d.showAll }));
  const toggleHideEmpty = () => patchView((d) => ({ hideEmptyRows: !d.hideEmptyRows }));
  const setThrough = (v: string) => patchView(() => ({ through: v }));
  const setFoldedSections = (next: string[] | ((prev: string[]) => string[])) =>
    patchView((d) => ({ foldedSections: typeof next === "function" ? next(d.foldedSections) : next }));
  // "Show all" SUSPENDS the filters rather than clearing them, so the studio gets its
  // view back when it switches off. That rule was spelled out at each of the eight
  // places that needed it; here it is once, and the pills and the table cannot
  // disagree about what is currently on screen. `periodOnly`/`hideEmptyRows` stay the
  // studio's actual setting -- which is what a publish records.
  const effHideEmpty = hideEmptyRows && !showAll;
  const effFolded = showAll ? EMPTY_FOLDS : foldedSections;
  /**
   * ⚠️ HOURS UP TO THIS DAY ONLY (`through`). A weekly report is a summary of the
   * week that ENDED, and Nitsan published Anchor's on the Sunday afternoon — by which
   * time colleagues had logged into the NEW week, putting 8h the report was not meant
   * to cover in front of the client.
   *
   * ⚠️ IT DEFAULTS TO THE END OF THE LAST COMPLETE WEEK (the Saturday), because
   * that is right for every normal Sunday-morning publish as well as a late one.
   * It is a plain date, not a "skip the current week" switch, so a client billed to
   * the 20th can be cut there too.
   *
   * ⚠️ The PREVIEW is built with it, so what the studio checks is exactly what
   * publishes — the cut-off cannot be a publish-time surprise.
   *
   * ⚠️⚠️ AND A REMEMBERED CUT-OFF GOES STALE EVERY WEEK, SILENTLY.
   *
   * Seeding deliberately adopts `link.throughDate` so a client billed to the 20th
   * keeps that cut-off across republishes. But the ordinary case is the Sunday weekly
   * summary, where the cut-off must ADVANCE — and a remembered date does the
   * opposite: Anchor sat at 22 Aug, so publishing on 30 Aug would have reported the
   * week ending 29 Aug **with 23–29 Aug excluded**. Every figure would have agreed
   * with every other, which is exactly what makes it dangerous: v1.33.0 built this
   * field because a report that quietly misstates its period is worse than one that
   * visibly contradicts itself.
   *
   * ⚠️ SO IT WARNS RATHER THAN CORRECTING. `max(stored, default)` looks tempting
   * and breaks the case the memory exists for — it would drag a deliberate 20th
   * cut-off forward to the 22nd. Showing the difference and offering one click is
   * the same choice v1.19.7 made for the client's requested due date.
   * ⚠️ And it must NOT block publishing: an older date is legitimate.
   */
  const throughIsStale = cutoffIsStale(through, new Date());

  // sync hide-state + column overrides when switching client
  useEffect(() => {
    if (!selectedClient) return;
    const link = links.get(selectedClient.id);
    setHiddenColumns(link?.hiddenColumns ?? []);
    setHiddenTaskIds(link?.hiddenTaskIds ?? []);
    setCustomWeeks(link?.customWeeks ?? null);
    // ⚠️⚠️ SEED ONLY, NEVER OVERWRITE — see `views`. A link published before hands
    // the draft its cut-off and pills; a client already opened this session keeps
    // the draft it has, so neither a tab switch nor a `links` refresh undoes a pick.
    // ⚠️ And it waits for `linksLoaded`: the links arrive after first paint, so
    // seeding before that would bank the defaults and then refuse — being a draft
    // already — to adopt what was actually published.
    if (!linksLoaded) return;
    setViews((prev) =>
      prev[selectedClient.id]
        ? prev
        : {
            ...prev,
            [selectedClient.id]: {
              // ⚠️ `periodFrom` first, `periodOnly` only for links published before
              // v1.43.0 — those carry the boolean alone, and it meant "the current
              // period". `null` there resolves to no scope at render time, which is
              // what the old `false` did.
              periodFrom: link?.viewFlags?.periodFrom ?? legacyPeriodFrom(link),
              hideEmptyRows: link?.viewFlags?.hideEmptyRows ?? false,
              showAll: false,
              foldedSections: EMPTY_FOLDS, // section names are per client
              // A link that has been published before remembers what it was scoped
              // to; one that has not falls back to the last complete week.
              through: link?.throughDate ?? lastCompleteWeekEnd(new Date()),
            },
          },
    );
  }, [selectedClient?.id, links, linksLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // show the tab-strip arrows only when it actually overflows
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const check = () => setTabsOverflow(el.scrollWidth > el.clientWidth + 4);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [visibleTabs.length]);

  function persistHiddenTabs(next: string[]) {
    setHiddenTabs(next);
    try {
      localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(next));
    } catch {}
  }

  /**
   * Opens the next billing period for any client whose last one has ended.
   *
   * ⚠️ WHY IT IS NEEDED: nothing ever created these. They are hand-added rows, so
   * once the last period ended, hours kept logging and the **Total and week
   * columns stayed correct while the period breakdown silently dropped them** — a
   * period bucket only counts entries inside its own dates. A report that looks
   * right and is incomplete is the worst shape for something a client is invoiced
   * from.
   *
   * ⚠️ RUNS HERE RATHER THAN ON A SCHEDULE because this app deliberately has no
   * cron (Hobby plan — see `src/app/api/egress/route.ts`). Opening Client Reports
   * is the moment periods matter, and an admin does that before every publish.
   *
   * ⚠️ ONE PERIOD PER CLIENT PER VISIT, and only for clients that ALREADY have at
   * least one. It never invents a client's FIRST period — when billing starts is a
   * business decision, not something to guess — and it never backfills a run of
   * months at once (`nextPeriod` returns a single period; see its tests).
   *
   * ⚠️ `hourCap: null` is correct and is NOT an oversight: migration 0033 moved the
   * cap to the CLIENT ("cap is general for client - not different each month") and
   * the app fills each period's cap from there at render time.
   *
   * ⚠️ `ranRef` guards the effect, not the data. Two open tabs can still both
   * insert; the unique index in the migration below is what actually prevents a
   * duplicate, and a rejected insert is harmless here.
   */
  const rolloverRan = useRef(false);
  useEffect(() => {
    if (rolloverRan.current) return;
    if (!clients.length || !billingPeriods.length) return;
    rolloverRan.current = true;
    (async () => {
      const today = new Date();
      const todayIso = toISODate(today);
      /**
       * ⚠️ THE STORE MUST BE REFRESHED AFTER THIS, or the work is invisible. These
       * rows are written STRAIGHT to Supabase (the upsert is what makes the write
       * idempotent, and `addBillingPeriod` cannot do that), so the store's own
       * `billingPeriods` never learns about them and the page keeps rendering the
       * OLD latest period until a poll happens to land. Measured on Maccabi: the
       * periods were correctly created and the PERIOD column still read
       * "Jan – Jul", which is indistinguishable from the feature not working —
       * and is exactly what Nitsan reported.
       */
      let wrote = false;
      for (const client of clients) {
        /**
         * ⚠️⚠️ ARCHIVED CLIENTS ARE SKIPPED, AND THIS IS THE WHOLE BALLGAME. A dry
         * run against real data found 15 clients whose last period had ended —
         * and TWELVE were archived, some for over a year (Monday's last period
         * ended May 2025). Opening new billing periods on finished engagements
         * would have quietly grown every one of them a fresh, empty period.
         */
        if (client.archived) continue;
        const mine = billingPeriods.filter((p) => p.clientId === client.id);
        if (!mine.length) continue;

        /**
         * ⚠️ CATCH UP TO TODAY, not one period per visit. Whitebox's last period
         * ended 20 July and Checkmarx's 29 June, so a single new period would
         * ALSO be in the past and the client would still have no current one —
         * the exact gap this feature exists to close.
         *
         * ⚠️ Capped, because an active client dormant for years should not gain
         * dozens of periods from one page load. The cap is logged rather than
         * silent: reaching it means the client needs a look, not a retry.
         */
        const MAX_CATCH_UP = 12;
        let last: { dateFrom: string; dateTo: string } = mine.reduce((a, b) =>
          b.dateTo > a.dateTo ? b : a,
        );
        const taken = new Set(mine.map((p) => p.dateFrom));
        const rows: {
          client_id: string;
          label: string;
          date_from: string;
          date_to: string;
          position: number;
        }[] = [];
        let position = Math.max(0, ...mine.map((p) => p.position));
        while (rows.length < MAX_CATCH_UP) {
          const next = nextPeriod(last, parseInvoiceDay(client.invoiceNote), today);
          if (!next) break;
          if (taken.has(next.dateFrom)) break;
          position += 1;
          rows.push({
            client_id: client.id,
            label: next.label,
            date_from: next.dateFrom,
            date_to: next.dateTo,
            position,
          });
          taken.add(next.dateFrom);
          last = next;
          if (next.dateTo >= todayIso) break;
        }
        if (!rows.length) continue;
        /**
         * ⚠️ KEYED ON WHETHER WE ACTUALLY REACHED TODAY, not on the row count. The
         * loop breaks successfully the moment a period covers today, so a client
         * needing exactly MAX_CATCH_UP periods hit the cap AND finished — and the
         * old `rows.length >= MAX_CATCH_UP` test sent somebody to audit dates that
         * were already correct.
         */
        if (rows[rows.length - 1].date_to < todayIso) {
          console.warn(
            `[billing] ${client.name}: stopped after ${rows.length} periods without reaching today — check its dates by hand`,
          );
        }
        /**
         * ⚠️⚠️ UPSERT WITH `ignoreDuplicates`, NEVER A PLAIN INSERT, AND NOT VIA
         * `addBillingPeriod`. AN IN-MEMORY GUARD IS NOT A GUARD HERE — proven the
         * hard way on 2026-08-27: this effect ran THREE TIMES against a Client
         * Reports page that was already open in a browser (saving this file
         * hot-reloads it, which remounts the component and resets `rolloverRan`),
         * each run read the same stale `billingPeriods`, and every one of them
         * inserted. 60 unwanted rows across 20 clients in one second, which then
         * had to be deleted and restored from a backup.
         *
         * ⚠️ THE DATABASE IS THE ONLY HONEST GUARD, so the unique index in the
         * migration is a HARD PREREQUISITE, not a nice-to-have. Until it exists
         * this upsert fails and the feature is simply INERT — which is the correct
         * failure direction, and far better than silently multiplying a client's
         * billing periods.
         */
        const { error } = await supabase
          .from("client_billing_periods")
          .upsert(rows, { onConflict: "client_id,date_from", ignoreDuplicates: true });
        if (error) {
          // Not a toast: this runs unprompted on page load, and a person who did
          // not ask for it should not be handed its failures.
          console.warn(
            `[billing] could not open the next period for ${client.name} — has migration 0036 been run? ${error.message}`,
          );
        } else {
          wrote = true;
        }
      }
      if (wrote) refresh();
    })();
  }, [clients, billingPeriods, supabase, refresh]);

  /**
   * ⚠️⚠️ TWO SNAPSHOTS, AND MIXING THEM UP SENDS A CLIENT HOURS THEY SHOULD NOT
   * SEE. `preview` is what NITSAN looks at and runs to TODAY, so the current,
   * incomplete week has a column and he can watch Sun–Mon hours land in it.
   * `publishable` is what the CLIENT gets and is cut at `through`.
   *
   * ⚠️ THE PUBLISH BUTTON MUST WRITE `publishable`. Publishing stores the snapshot
   * VERBATIM (`snapshot: publishable`) — the public page renders that frozen object
   * and never rebuilds from `through_date` — so handing it `preview` would ship
   * every hour logged up to today no matter what the cut-off field said.
   *
   * ⚠️ The extra columns only ever appear at the END, because weeks are
   * chronological. That is what keeps `hiddenColumns` indices — which are positions
   * in this list — valid across both snapshots. If week ordering ever stops being
   * chronological, those indices silently point at the wrong columns.
   */
  const previewThrough = toISODate(new Date());
  const buildFor = useCallback(
    (cutoff: string | null) =>
      selectedClient
        ? buildReportSnapshot(
            selectedClient,
            sections,
            tasks,
            entrySumsAll,
            billingPeriods.filter((p) => p.clientId === selectedClient.id),
            customWeeks,
            cutoff,
          )
        : null,
    [selectedClient, sections, tasks, entrySumsAll, billingPeriods, customWeeks],
  );
  const preview = useMemo(() => buildFor(previewThrough), [buildFor, previewThrough]);
  const publishable = useMemo(() => buildFor(through || null), [buildFor, through]);

  /**
   * The focused period, resolved at RENDER against the periods the preview is
   * showing — see `ViewDraft.periodFrom` for why the draft holds a date instead.
   *
   * ⚠️ It has to sit BELOW `preview`, not up with the rest of the view state: the
   * draft is a date and only the built snapshot knows which index that is.
   */
  const previewPeriods = preview?.periods ?? EMPTY_PERIODS;
  const currentIndex = currentPeriodIndex(previewPeriods);
  const previousIndex = previousPeriodIndex(previewPeriods);
  const periodIndex = periodIndexFromDate(previewPeriods, periodFrom);
  const effPeriodIndex = showAll ? null : periodIndex;

  // ── period dividers + editable columns ────────────────────────────────
  const clientPeriods = useMemo(
    () =>
      selectedClient
        ? billingPeriods
            .filter((p) => p.clientId === selectedClient.id)
            .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
        : [],
    [billingPeriods, selectedClient],
  );

  /** end a payment period right after column `colIndex` (splits if inside one) */
  function handleAddBoundary(colIndex: number) {
    if (!preview?.weeks || !selectedClient) return;
    const col = preview.weeks[colIndex];
    if (!col) return;
    const boundary = col.to;
    const containing = clientPeriods.find((p) => boundary >= p.dateFrom && boundary < p.dateTo);
    if (containing) {
      // split: the existing period now ends at the boundary, a new one covers the rest
      addBillingPeriod({
        clientId: selectedClient.id,
        label: shortRangeLabel(shiftDaysIso(boundary, 1), containing.dateTo),
        dateFrom: shiftDaysIso(boundary, 1),
        dateTo: containing.dateTo,
        hourCap: null,
        advanceHours: null,
      });
      updateBillingPeriod(containing.id, { dateTo: boundary });
    } else {
      const prevEnd = [...clientPeriods].reverse().find((p) => p.dateTo < boundary)?.dateTo;
      const from = prevEnd ? shiftDaysIso(prevEnd, 1) : (preview.weeks[0]?.from ?? boundary);
      addBillingPeriod({
        clientId: selectedClient.id,
        label: shortRangeLabel(from, boundary),
        dateFrom: from,
        dateTo: boundary,
        hourCap: null,
        advanceHours: null,
      });
    }
  }

  /** drag an existing divider: period `periodIndex` now ends after column `colIndex` */
  function handleMoveBoundary(periodIndex: number, colIndex: number) {
    if (!preview?.weeks) return;
    const p = clientPeriods[periodIndex];
    const col = preview.weeks[colIndex];
    if (!p || !col || col.to <= p.dateFrom) return;
    updateBillingPeriod(p.id, { dateTo: col.to });
    const next = clientPeriods[periodIndex + 1];
    if (next) updateBillingPeriod(next.id, { dateFrom: shiftDaysIso(col.to, 1) });
  }

  /** change a column's date range; persisted per client on its report link */
  async function handleEditColumnDates(colIndex: number, patch: { from: string; to: string }) {
    if (!preview?.weeks || !selectedClient) return;
    // ⚠️ NORMALISE AND CLAMP, because `buildReportSnapshot` adds an entry's minutes
    // to EVERY column whose range contains its date. An overlap therefore counts the
    // same hours twice and the week cells stop summing to the row's Total — on a
    // report a client reads. Visitt had a column edited to 2–25 Jul that swallowed
    // three whole weeks, 57h double-counted. An inverted pair matches nothing and
    // shows a dash for ever, so swap it rather than store it.
    const [rawFrom, rawTo] = patch.from <= patch.to ? [patch.from, patch.to] : [patch.to, patch.from];
    const prev = preview.weeks[colIndex - 1];
    const following = preview.weeks[colIndex + 1];
    const from = prev && rawFrom <= prev.to ? shiftDaysIso(prev.to, 1) : rawFrom;
    const to = following && rawTo >= following.from ? shiftDaysIso(following.from, -1) : rawTo;
    if (from > to) return; // clamped to nothing: neighbours leave no room, so refuse
    const next = preview.weeks.map((w, i) =>
      i === colIndex ? { from, to, label: shortRangeLabel(from, to) } : w,
    );
    setCustomWeeks(next);
    const link = await ensureLink(selectedClient.id);
    if (!link) return;
    const { error } = await supabase
      .from("report_links")
      .update({ custom_weeks: next })
      .eq("id", link.id);
    if (error) console.error("save custom columns failed", error.message);
    else setLinks((prev) => new Map(prev).set(selectedClient.id, { ...link, customWeeks: next }));
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function ensureLink(clientId: string): Promise<ReportLink | null> {
    const existing = links.get(clientId);
    if (existing) return existing;
    // ⚠️ Ask the DATABASE before minting one. The map is filled by an effect, so a
    // Copy-link or Publish pressed before it resolves used to insert a SECOND link
    // for a client that already had one -- which is how Blazepod and No Traffic
    // ended up with two. A duplicate is how a client's permanent URL goes stale.
    const found = await fetchAll<Record<string, unknown>>(supabase, "report_links", "*", (q) =>
      q.eq("client_id", clientId).eq("active", true),
    ).catch(() => [] as Record<string, unknown>[]);
    if (found.length) {
      const link = canonicalReportLink(found.map(mapReportLink));
      if (link) {
        setLinks((prev) => new Map(prev).set(clientId, link));
        return link;
      }
    }
    const { data, error } = await supabase
      .from("report_links")
      .insert({ client_id: clientId, created_by: currentUserId })
      .select()
      .single();
    if (error) {
      // ⚠️ 23505 = the one-active-link-per-client unique index (0032) fired, which
      // means a CONCURRENT caller inserted first. The check above cannot prevent
      // this: it awaits between reading and writing, so two callers both read an
      // empty result and both insert. Visitt got two links 89ms apart that way,
      // two days AFTER that check shipped. Losing the race is not an error — the
      // link we wanted now exists, so adopt it.
      if (error.code === "23505") {
        const raced = await fetchAll<Record<string, unknown>>(supabase, "report_links", "*", (q) =>
          q.eq("client_id", clientId).eq("active", true),
        ).catch(() => [] as Record<string, unknown>[]);
        const link = canonicalReportLink(raced.map(mapReportLink));
        if (link) {
          setLinks((prev) => new Map(prev).set(clientId, link));
          return link;
        }
      }
      console.error("create link failed", error.message);
      return null;
    }
    const link = mapReportLink(data);
    setLinks((prev) => new Map(prev).set(clientId, link));
    return link;
  }

  async function publish() {
    if (!selectedClient || !preview) return;
    // ⚠️ The tab is opened NOW, blank, and pointed at the report further down once the
    // write has landed. It cannot be opened at the end instead: by then the awaits
    // below have spent the click's "transient activation", so `window.open` counts as
    // an unsolicited popup and Safari blocks it outright. Blank-then-navigate is the
    // one shape that survives. It is closed again on any path that does not publish,
    // so a failure never leaves a stray tab behind.
    const tab = window.open("about:blank", "_blank");
    setPublishing(true);
    const link = await ensureLink(selectedClient.id);
    if (!link) {
      setPublishing(false);
      tab?.close();
      return;
    }
    const publishedAt = new Date().toISOString();
    // ⚠️ `view_flags` needs migration 0031, and a missing column on a WRITE reports
    // PGRST204 — so publishing would FAIL outright until that SQL is run, taking the
    // one button this page exists for with it. The filters step down instead: the
    // report publishes, and the client simply sees the unfiltered grid.
    const { error, degraded } = await updateWithOptional(
      supabase,
      "report_links",
      { id: link.id },
      {
        // ⚠️ `publishable`, NOT `preview` — see the two-snapshot note above.
        snapshot: publishable,
        published_at: publishedAt,
        hidden_columns: hiddenColumns,
        hidden_task_ids: hiddenTaskIds,
      },
      // ⚠️ `through_date` joins `view_flags` in the OPTIONAL bucket: a missing column
      // on a WRITE is PGRST204 and fails the whole update, so before 0034 is run
      // publishing would break outright — taking the one button this page exists
      // for. The scoping still WORKS without the column, because it is applied when
      // the snapshot is built; only the record of which day it was is lost.
      {
        view_flags: { periodOnly: periodIndex !== null, periodFrom, hideEmptyRows },
        through_date: through || null,
      },
    );
    setPublishing(false);
    if (error) {
      console.error("publish failed", error.message);
      showToast("Publish failed — check console");
      tab?.close();
      return;
    }
    const updated = {
      ...link,
      snapshot: publishable,
      publishedAt,
      hiddenColumns,
      hiddenTaskIds,
      viewFlags: degraded ? null : { periodOnly: periodIndex !== null, periodFrom, hideEmptyRows },
      throughDate: degraded ? null : through || null,
    };
    setLinks((prev) => new Map(prev).set(selectedClient.id, updated));
    const url = `${window.location.origin}/report/${link.token}`;
    // Every publish opens what was just published, so the thing the client will see
    // gets looked at by someone before they see it. `tab` is the blank one from the
    // top; the fallback covers a browser that blocked even that.
    //
    // ⚠️ Point the tab BEFORE copying. Opening the tab moves focus, and
    // `clipboard.writeText` rejects on an unfocused document -- awaiting it first
    // would strand the tab on about:blank and swallow the toast. The copy is a
    // convenience, so a refusal only changes what the toast claims.
    if (tab) tab.location.replace(url);
    else window.open(url, "_blank");
    const copied = await navigator.clipboard.writeText(url).then(
      () => true,
      () => false,
    );
    showToast(
      degraded
        ? `Published & opened${copied ? " — link copied" : ""}. The view filters weren't saved: migration 0031 hasn't been run.`
        : `Report published — opened in a new tab${copied ? ", link copied" : ""}`,
    );
  }

  async function copyLink() {
    if (!selectedClient) return;
    const link = await ensureLink(selectedClient.id);
    if (!link) return;
    await navigator.clipboard.writeText(`${window.location.origin}/report/${link.token}`);
    showToast("Link to report copied to clipboard");
  }

  const currentLink = selectedClient ? links.get(selectedClient.id) : undefined;
  const lastPublished = currentLink?.publishedAt
    ? new Date(currentLink.publishedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  /**
   * PUBLISH CHECKLIST — what the client is about to be given.
   *
   * ⚠️⚠️ THE POINT IS THAT THESE FOUR THINGS WERE DECIDED IN FOUR DIFFERENT PLACES
   * and only ever met each other in the published result. Nitsan asked for a
   * confirmation on Publish listing "total column, estimate column, end date of the
   * report to show (hours through) and anything else relevant to set before creating
   * the link or updating it" — because Publish overwrites what a client sees at a
   * PERMANENT url, and the eye on a column header two screens down is not where you
   * remember to look on the way to the button.
   *
   * ⚠️ The rows below EDIT THE PAGE'S REAL STATE — there is no draft copy. Toggling
   * a column here is the same act as clicking its eye in the table, and the preview
   * behind the dialog updates as you do it, which is what makes the checklist a
   * checklist rather than a second source of truth to keep in sync. Cancel therefore
   * leaves any toggles applied — exactly as the eyes do, since neither is persisted
   * until a publish.
   */
  const hiddenWeekCols = hiddenColumns.filter((k) => k.startsWith("w:")).length;
  const hiddenPeriodCols = hiddenColumns.filter((k) => k.startsWith("p:")).length;
  const showsColumn = (key: string) => !hiddenColumns.includes(key);
  const setShowsColumn = (key: string, show: boolean) =>
    setHiddenColumns((prev) => (show ? prev.filter((k) => k !== key) : [...new Set([...prev, key])]));
  const opensOn =
    periodIndex !== null ? previewPeriods[periodIndex]?.label ?? "one period" : "every period";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-serif-accent text-3xl">Client Reports</h1>
          <p className="text-sm text-muted">
            Per-client hours tables, payment periods, and the shareable report links.
          </p>
        </div>
        {selectedClient && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">
              {lastPublished ? (
                <span className="flex items-center gap-1">
                  <Check size={12} className="text-success" /> Last published {lastPublished}
                </span>
              ) : (
                "Never published — clients see nothing until you publish."
              )}
            </span>
            {/*
              ⚠️ IT SITS BESIDE PUBLISH, NOT IN THE FILTER PILLS ABOVE, and the
              placement is the point: the pills only change what the STUDIO is
              looking at, while this changes the hours the client is billed against.
              Different kind of control, so it lives with the button that commits it.
              ⚠️ Clearing it means "everything", which is the pre-feature behaviour.
            */}
            <label
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                throughIsStale
                  ? "border-amber-500 bg-amber-50 text-amber-900"
                  : "border-border bg-surface text-muted"
              }`}
              title="Count hours up to and including this day. Defaults to the end of the last complete week, so publishing on a Sunday afternoon does not pull in the new week's hours."
            >
              <span className="whitespace-nowrap">Hours through</span>
              <input
                type="date"
                value={through}
                onChange={(e) => setThrough(e.target.value)}
                className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-brand"
              />
            </label>
            {/* ⚠️ Placed AFTER the field and before Publish, so it is read on the
                way to the button that commits it. See `throughIsStale`. */}
            {throughIsStale && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                a week behind — the last complete week ended {formatDayMonth(weekEnd)}
                <button
                  onClick={() => setThrough(weekEnd)}
                  className="rounded-md border border-amber-500 px-1.5 py-0.5 font-semibold text-amber-900 hover:bg-amber-100"
                  title="Scope this report to the end of the last complete week"
                >
                  use {formatDayMonth(weekEnd)}
                </button>
              </span>
            )}
            <button
              onClick={copyLink}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted hover:border-brand hover:text-brand"
              title="Copy this client's report link"
            >
              <Copy size={14} /> Copy link
            </button>
            {/* ⚠️ OPENS THE CHECKLIST, DOES NOT PUBLISH. Publishing is the one
                irreversible thing this page does — it replaces what a client sees at
                a permanent URL — and everything that decides its contents was spread
                across the table's eye icons, a date field and the filter pills. See
                `PUBLISH CHECKLIST` below. */}
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={publishing}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              title="Check what the client will get, then publish"
            >
              <Send size={14} />
              {publishing ? "Publishing…" : "Publish"}
            </button>
          </div>
        )}
      </div>

      {/*
        The tab strip IS the top of the panel below it, so a folder tab reads as
        attached to its own client's pane. Three parts make that work:
          · `-mb-3` cancels the page's `gap-3`, so the panel butts against the rail
          · the rail carries the left/right/top border and NO bottom one, and the
            panel carries no TOP one — so the only thing dividing them is the
            background change, which the active tab (bg-surface, like the panel)
            interrupts. No 1px overlap trick, nothing for the scroller to clip.
          · `pt-1.5` on the scroller gives the hide badge back the 4px it hangs above
            the tab, plus 2px of slack so a later nudge cannot silently re-clip it;
            `overflow-x: auto` computes overflow-y to auto too, which was cutting
            the top off the black ✕.
      */}
      <div className="-mb-3 flex items-center gap-1 rounded-t-2xl border border-b-0 border-border bg-background px-2 pt-2">
        {tabsOverflow && (
          <button
            onClick={() => tabsRef.current?.scrollBy({ left: -260, behavior: "smooth" })}
            className="shrink-0 rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
            title="Scroll tabs left"
          >
            <ChevronLeft size={15} />
          </button>
        )}
        <div
          ref={tabsRef}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pt-1.5 [scrollbar-width:none]"
        >
          {visibleTabs.map((c) => (
            <span key={c.id} className="group relative shrink-0">
              <button
                onClick={() => setSelected(c.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-b-0 px-3 py-1.5 text-sm font-medium ${
                  selectedClient?.id === c.id
                    ? "border-border bg-surface text-foreground"
                    : "border-transparent bg-transparent text-muted hover:text-foreground"
                }`}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
                {/* ⚠️⚠️ THE INVOICE DAY, WHERE THE "PUBLISHED" DOT USED TO BE — Nitsan's
                    swap, and the reason is what the strip is FOR: you scan it to decide
                    who to bill next, and a green dot only said "this one has a link".
                    ⚠️ STILL PARSED, NOT READ RAW. The field is numeric now, but the
                    stored values are the old ordinals ("20th") until the normalising
                    UPDATE runs, and older ones live on in nothing else — so the badge
                    goes through `parseInvoiceDay` like every other reader. A value it
                    cannot read shows NO badge, which is honest: better than a guessed
                    30th on the tab you bill from. */}
                {parseInvoiceDay(c.invoiceNote) != null && (
                  <span
                    className="min-w-4 rounded-[5px] border border-border-strong px-0.5 text-center text-[10px] font-semibold leading-4 tabular-nums"
                    title={`Invoice day — the ${parseInvoiceDay(c.invoiceNote)}${ordinalSuffix(
                      parseInvoiceDay(c.invoiceNote)!,
                    )} of the month`}
                  >
                    {parseInvoiceDay(c.invoiceNote)}
                  </span>
                )}
              </button>
              <button
                onClick={() => persistHiddenTabs([...hiddenTabs, c.id])}
                className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-foreground text-white group-hover:flex"
                title="Hide tab"
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className="rounded-lg px-2 py-1.5 text-muted hover:bg-background"
            title="More clients"
          >
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-0 top-full z-40 max-h-72 w-56 overflow-y-auto rounded-2xl border border-border bg-surface shadow-card p-1 shadow-xl">
                {clients
                  .filter((c) => !c.archived && (hiddenTabs.includes(c.id) || !candidates.some((x) => x.id === c.id)))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        persistHiddenTabs(hiddenTabs.filter((id) => id !== c.id));
                        setSelected(c.id);
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-background"
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
        {tabsOverflow && (
          <button
            onClick={() => tabsRef.current?.scrollBy({ left: 260, behavior: "smooth" })}
            className="shrink-0 rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
            title="Scroll tabs right"
          >
            <ChevronRight size={15} />
          </button>
        )}
      </div>

      {selectedClient && preview ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-b-2xl border border-t-0 border-border bg-surface shadow-card p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {/* ⚠️ "Current period", not "Latest period only" — Nitsan's wording,
                  and it now names one choice among several rather than describing a
                  switch. The pills are radio-like: the table is scoped to exactly one
                  period or to none, so two of them lit would describe a state that
                  cannot exist. Clicking the lit one clears the scope, which is the
                  toggle behaviour this pill has always had. */}
              <ViewToggle
                on={effPeriodIndex !== null && effPeriodIndex === currentIndex}
                dim={showAll}
                onClick={() => focusPeriod(previewPeriods[currentIndex]?.from ?? null)}
                title={
                  previewPeriods[currentIndex]
                    ? `Show only the week columns of ${previewPeriods[currentIndex].label}`
                    : "Show only the week columns of the current payment period"
                }
              >
                Current period
              </ViewToggle>
              {/* Hidden, not disabled, for a client with a single period — there is
                  no previous one to show and a dead pill only invites a click. */}
              {previousIndex >= 0 && (
                <ViewToggle
                  on={effPeriodIndex === previousIndex}
                  dim={showAll}
                  onClick={() => focusPeriod(previewPeriods[previousIndex].from)}
                  title={`Show only the week columns of ${previewPeriods[previousIndex].label}`}
                >
                  Previous period
                </ViewToggle>
              )}
              {/* ⚠️ THE REST OF THE PERIODS LIVE BEHIND THIS, NOT AS MORE PILLS: a
                  client with two years of history has two dozen, and a pill row that
                  wraps to four lines buries the two filters beside it. The button
                  carries the chosen period's NAME once the choice is not one of the
                  two pills, so the scope is never a state you have to open a menu to
                  discover. */}
              {previewPeriods.length > 2 && (
                <div className="relative">
                  <button
                    onClick={() => setPeriodPickOpen((o) => !o)}
                    title="Scope the table to any payment period"
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      effPeriodIndex !== null &&
                      effPeriodIndex !== currentIndex &&
                      effPeriodIndex !== previousIndex
                        ? "border-brand bg-brand text-white"
                        : "border-border bg-surface text-muted hover:border-brand hover:text-brand"
                    } ${showAll ? "opacity-40" : ""}`}
                  >
                    {effPeriodIndex !== null &&
                    effPeriodIndex !== currentIndex &&
                    effPeriodIndex !== previousIndex
                      ? previewPeriods[effPeriodIndex].label
                      : "Period"}
                    <ChevronDown size={12} />
                  </button>
                  {periodPickOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setPeriodPickOpen(false)} />
                      <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-64 overflow-y-auto rounded-2xl border border-border bg-surface p-1 shadow-card shadow-xl">
                        <button
                          onClick={() => {
                            clearPeriod();
                            setPeriodPickOpen(false);
                          }}
                          disabled={periodIndex === null}
                          className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs text-muted hover:bg-background disabled:opacity-40"
                        >
                          All periods
                        </button>
                        {previewPeriods
                          .map((p, i) => ({ p, i }))
                          .reverse()
                          .map(({ p, i }) => (
                            <button
                              key={p.from + p.label}
                              onClick={() => {
                                focusPeriod(p.from);
                                setPeriodPickOpen(false);
                              }}
                              className={`flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-background ${
                                periodIndex === i ? "bg-brand-soft font-semibold" : ""
                              }`}
                            >
                              <span className="truncate">{p.label}</span>
                              <span className="shrink-0 text-[11px] text-faint">
                                {formatDayMonth(p.from)} – {formatDayMonth(p.to)}
                              </span>
                            </button>
                          ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <ViewToggle
                on={effHideEmpty}
                dim={showAll}
                onClick={toggleHideEmpty}
                title="Hide tasks with no hours in the columns currently shown"
              >
                Only rows with hours
              </ViewToggle>
              <ViewToggle
                on={showAll}
                onClick={toggleShowAll}
                title="Temporarily show every row, column and section — turning it off restores the filters you had"
              >
                Show all
              </ViewToggle>
              {foldedSections.length > 0 && !showAll && (
                <button
                  onClick={() => setFoldedSections([])}
                  className="rounded-full px-2.5 py-1 text-[11px] text-muted hover:bg-background hover:text-foreground"
                >
                  Unfold {foldedSections.length} section
                  {foldedSections.length > 1 ? "s" : ""}
                </button>
              )}
              <span className="ml-auto text-[11px] text-faint">
                These only change your view — the eye icons are what the client sees
              </span>
            </div>
            <p className="mb-2 text-[11px] text-faint">
              Preview — eye toggles hide rows/columns from the client&apos;s view, + between column
              titles ends a payment period there, drag a divider to move it, click column dates to
              edit them. Click or drag the hour cells to total them. Publishing freezes this exact
              data.
            </p>
            <ReportTable
              snapshot={preview}
              hiddenColumns={hiddenColumns}
              hiddenTaskIds={hiddenTaskIds}
              editable
              periodsEditable
              selectable
              periodIndex={effPeriodIndex}
              hideEmptyRows={effHideEmpty}
              foldedSections={effFolded}
              onToggleSection={(name) => setFoldedSections((prev) => toggleIn(prev, name))}
              onOpenTask={openTask}
              onEditEstimate={(taskId, hours) => updateTask(taskId, { estimateHours: hours })}
              onToggleColumn={(key) => setHiddenColumns((prev) => toggleIn(prev, key))}
              onToggleTask={(id) => setHiddenTaskIds((prev) => toggleIn(prev, id))}
              onAddBoundary={handleAddBoundary}
              onMoveBoundary={handleMoveBoundary}
              onTogglePeriodHidden={(keys, hide) =>
                setHiddenColumns((prev) =>
                  hide ? [...new Set([...prev, ...keys])] : prev.filter((k) => !keys.includes(k)),
                )
              }
              onEditColumnDates={handleEditColumnDates}
              clientCutoff={through || null}
            />
          </div>

          <PaymentPeriods client={selectedClient} />
        </div>
      ) : (
        <p className="rounded-b-2xl border border-t-0 border-border bg-surface shadow-card p-6 text-center text-sm text-faint">
          No clients with recent activity. Use ⋯ to pick one.
        </p>
      )}

      {confirmOpen && selectedClient && (
        <Modal onClose={() => setConfirmOpen(false)} labelledBy="publish-confirm-title">
          <div className="flex items-start justify-between gap-3">
            <h2 id="publish-confirm-title" className="text-lg font-semibold">
              {currentLink?.publishedAt ? "Update" : "Create"} {selectedClient.name}&apos;s report
            </h2>
            <ModalClose onClose={() => setConfirmOpen(false)} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {currentLink?.publishedAt
              ? `Replaces what the client sees at the existing link — last published ${lastPublished}.`
              : "Creates the client's permanent link and publishes this preview to it."}
          </p>

          <div className="mt-3 flex flex-col gap-1.5">
            <IncludeRow
              label="Total column"
              hint="Every hour ever logged on each task"
              checked={showsColumn("total")}
              onChange={(v) => setShowsColumn("total", v)}
            />
            <IncludeRow
              label="Estimate column"
              hint="The estimate set on each task"
              checked={showsColumn("estimate")}
              onChange={(v) => setShowsColumn("estimate", v)}
            />
          </div>

          {/* ⚠️ THE CUT-OFF SITS IN THE DIALOG TOO, WITH ITS WARNING. It is the one
              field here that decides the HOURS rather than the columns, and a stale
              one is the failure this whole feature exists around — see
              `throughIsStale`. Publishing is exactly the moment to be shown it. */}
          <label className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
            <span className="text-sm font-medium">Hours through</span>
            <input
              type="date"
              value={through}
              onChange={(e) => setThrough(e.target.value)}
              className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-brand"
            />
            <span className="text-[11px] text-faint">
              {through ? "Hours logged after this day are left out" : "Every hour logged"}
            </span>
            {throughIsStale && (
              <span className="flex w-full items-center gap-1.5 text-[11px] font-medium text-amber-700">
                a week behind — the last complete week ended {formatDayMonth(weekEnd)}
                <button
                  onClick={() => setThrough(weekEnd)}
                  className="rounded-md border border-amber-500 px-1.5 py-0.5 font-semibold text-amber-900 hover:bg-amber-100"
                >
                  use {formatDayMonth(weekEnd)}
                </button>
              </span>
            )}
          </label>

          {/* ⚠️ READ-ONLY, AND DELIBERATELY SO. Everything below is already set by a
              control on the page — the pills, the eyes on rows and column headings.
              Repeating them as editors here would be a second way to set the same
              thing; repeating them as FACTS is the point, because a task hidden three
              weeks ago is invisible from this button. */}
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-xs">
            <dt className="text-muted">Opens on</dt>
            <dd className="font-medium">
              {opensOn}
              {hideEmptyRows && ", only rows with hours"}
            </dd>
            {/* ⚠️ "ALSO hidden", not "hidden from the client" — the two checkboxes
                above are hidden columns too, and a line reading "nothing" directly
                under an unticked Total would flatly contradict them. */}
            <dt className="text-muted">Also hidden</dt>
            <dd className={hiddenTaskIds.length + hiddenWeekCols + hiddenPeriodCols > 0 ? "font-medium text-warning" : "font-medium"}>
              {[
                hiddenTaskIds.length && `${hiddenTaskIds.length} task${hiddenTaskIds.length > 1 ? "s" : ""}`,
                hiddenWeekCols && `${hiddenWeekCols} week column${hiddenWeekCols > 1 ? "s" : ""}`,
                hiddenPeriodCols && `${hiddenPeriodCols} period${hiddenPeriodCols > 1 ? "s" : ""}`,
              ]
                .filter(Boolean)
                .join(" · ") || "nothing"}
            </dd>
          </dl>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setConfirmOpen(false)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:border-brand hover:text-brand"
            >
              Cancel
            </button>
            {/* ⚠️ `publish()` OPENS ITS TAB FROM INSIDE THIS CLICK, which is what keeps
                Safari from treating it as an unsolicited popup — the transient
                activation belongs to this gesture just as it did to the old button. */}
            <button
              onClick={() => {
                setConfirmOpen(false);
                void publish();
              }}
              disabled={publishing}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              <Send size={14} />
              {currentLink?.publishedAt ? "Update the report" : "Publish"}
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function ClientReportsPage() {
  const {  } = useData();
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return <p className="text-sm text-muted">Client reports are for admins only.</p>;
  }

  return <PublishWorkspace />;
}
