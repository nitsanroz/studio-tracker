"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { canonicalReportLink, fetchAll, mapReportLink, updateWithOptional } from "@/lib/db";
import {
  formatDate,
  formatHoursShort,
  parseISO,
  shortRangeLabel,
  shiftDays,
  toISODate,
  MONTH_NAMES_SHORT,
} from "@/lib/format";
import { EditableDateCell, EditableTextCell } from "@/components/editable-cell";
import { MiniColumns } from "@/components/charts";
import { ReportTable, ViewToggle } from "@/components/report-table";
import { toggleIn } from "@/lib/toggle";
import { buildReportSnapshot } from "@/lib/report-snapshot";
import type { BillingPeriod, Client, ReportLink } from "@/lib/types";

/** "Show all" hands the table an empty fold list; a module constant so the identity
    is stable across renders rather than a fresh [] each time. */
const EMPTY_FOLDS: string[] = [];

/**
 * How close a period is to the client's cap, as a text colour.
 *
 * ⚠️ The cap is SEMANTIC — Nitsan, 2026-08-24: "its only semantic for us and the
 * client to see that he doesn't exceed the cap without noticing, without
 * permission." So it is not a gate and nothing is blocked; the number just has to
 * say for itself that the period is filling. Notice at 70%, severe at 90%.
 */
const CAP_NOTICE = 0.7;
const CAP_SEVERE = 0.9;

export function capTone(minutes: number, capHours: number | null): string {
  if (capHours == null || capHours <= 0) return "";
  const used = minutes / 60 / capHours;
  if (used >= CAP_SEVERE) return "text-danger";
  if (used >= CAP_NOTICE) return "text-amber-600";
  return "";
}

/** iso date + n CALENDAR days → iso date. */
function shiftDaysIso(iso: string, n: number): string {
  return toISODate(shiftDays(parseISO(iso), n));
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
            <div title="Day of the month the invoice goes out — click to edit">
              <div className="text-[11px] font-medium text-muted">Invoice day</div>
              <div className="mt-0.5">
                <EditableTextCell
                  value={client.invoiceNote}
                  placeholder="e.g. 15th"
                  onCommit={(v) => updateClient(client.id, { invoiceNote: v })}
                  className="text-2xl font-semibold"
                  inputClassName="text-2xl font-semibold"
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
  } = useData();
  const supabase = useMemo(() => createClient(), []);
  const [links, setLinks] = useState<Map<string, ReportLink>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [hiddenTaskIds, setHiddenTaskIds] = useState<string[]>([]);
  const [customWeeks, setCustomWeeks] = useState<{ label: string; from: string; to: string }[] | null>(null);
  // View-only filters. Deliberately NOT hiddenColumns/hiddenTaskIds: those are the
  // published state that decides what the client sees, so folding the table down to
  // one period here must never leak into the next publish.
  const [periodOnly, setPeriodOnly] = useState(false);
  const [hideEmptyRows, setHideEmptyRows] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [foldedSections, setFoldedSections] = useState<string[]>([]);
  // "Show all" SUSPENDS the filters rather than clearing them, so the studio gets its
  // view back when it switches off. That rule was spelled out at each of the eight
  // places that needed it; here it is once, and the pills and the table cannot
  // disagree about what is currently on screen. `periodOnly`/`hideEmptyRows` stay the
  // studio's actual setting -- which is what a publish records.
  const effPeriodOnly = periodOnly && !showAll;
  const effHideEmpty = hideEmptyRows && !showAll;
  const effFolded = showAll ? EMPTY_FOLDS : foldedSections;
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
      .catch((e) => console.error("links load failed", e));
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

  // sync hide-state + column overrides when switching client
  useEffect(() => {
    if (!selectedClient) return;
    const link = links.get(selectedClient.id);
    setHiddenColumns(link?.hiddenColumns ?? []);
    setHiddenTaskIds(link?.hiddenTaskIds ?? []);
    setCustomWeeks(link?.customWeeks ?? null);
    setFoldedSections([]); // section names are per client
    setPeriodOnly(link?.viewFlags?.periodOnly ?? false);
    setHideEmptyRows(link?.viewFlags?.hideEmptyRows ?? false);
    setShowAll(false);
  }, [selectedClient?.id, links]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const preview = useMemo(() => {
    if (!selectedClient) return null;
    return buildReportSnapshot(
      selectedClient,
      sections,
      tasks,
      entrySumsAll,
      billingPeriods.filter((p) => p.clientId === selectedClient.id),
      customWeeks,
    );
  }, [selectedClient, sections, tasks, entrySumsAll, billingPeriods, customWeeks]);

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
        snapshot: preview,
        published_at: publishedAt,
        hidden_columns: hiddenColumns,
        hidden_task_ids: hiddenTaskIds,
      },
      { view_flags: { periodOnly, hideEmptyRows } },
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
      snapshot: preview,
      publishedAt,
      hiddenColumns,
      hiddenTaskIds,
      viewFlags: degraded ? null : { periodOnly, hideEmptyRows },
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
            <button
              onClick={copyLink}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted hover:border-brand hover:text-brand"
              title="Copy this client's report link"
            >
              <Copy size={14} /> Copy link
            </button>
            <button
              onClick={publish}
              disabled={publishing}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              title="Freeze the current preview, publish it to the client link, and open that link in a new tab so you can check what the client will see"
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
                {links.get(c.id)?.publishedAt && (
                  <span className="size-1.5 rounded-full bg-success" title="Published" />
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
              <ViewToggle
                on={effPeriodOnly}
                dim={showAll}
                onClick={() => setPeriodOnly((v) => !v)}
                title="Show only the week columns of the latest payment period"
              >
                Latest period only
              </ViewToggle>
              <ViewToggle
                on={effHideEmpty}
                dim={showAll}
                onClick={() => setHideEmptyRows((v) => !v)}
                title="Hide tasks with no hours in the columns currently shown"
              >
                Only rows with hours
              </ViewToggle>
              <ViewToggle
                on={showAll}
                onClick={() => setShowAll((v) => !v)}
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
              periodOnly={effPeriodOnly}
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
            />
          </div>

          <PaymentPeriods client={selectedClient} />
        </div>
      ) : (
        <p className="rounded-b-2xl border border-t-0 border-border bg-surface shadow-card p-6 text-center text-sm text-faint">
          No clients with recent activity. Use ⋯ to pick one.
        </p>
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
