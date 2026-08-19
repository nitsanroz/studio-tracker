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
import { fetchAll, mapReportLink, updateWithOptional } from "@/lib/db";
import {
  addDays,
  formatDate,
  formatFeedDate,
  formatHoursShort,
  toISODate,
  MONTH_NAMES_SHORT,
} from "@/lib/format";
import { EditableDateCell, EditableTextCell } from "@/components/editable-cell";
import { MiniColumns } from "@/components/charts";
import { ReportTable } from "@/components/report-table";
import { buildReportSnapshot } from "@/lib/report-snapshot";
import type { Client, ReportLink } from "@/lib/types";

/**
 * A view filter pill. `dim` marks a filter that is set but currently overridden by
 * "Show all", so the setting it will return to stays legible instead of looking off.
 */
function ViewToggle({
  on,
  dim = false,
  onClick,
  title,
  children,
}: {
  on: boolean;
  dim?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        on
          ? "border-brand bg-brand text-white"
          : dim
            ? "border-dashed border-border text-faint hover:text-muted"
            : "border-border text-muted hover:bg-background hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Which of two active links for one client the app should use.
 *
 * ⚠️ NEWEST WINS IS WRONG HERE, and that was the rule until now. A report URL is
 * permanent and gets pasted into a client's email, so if a duplicate is created
 * later the app must not silently start publishing to it — the client would keep
 * opening the old token and never see another update. So: a link that has been
 * PUBLISHED wins (only that one can be in a client's hands), and otherwise the
 * OLDEST wins, being the one that has had the most chance to be shared.
 */
function preferLink(candidate: ReportLink, current: ReportLink): boolean {
  const pubC = !!candidate.publishedAt;
  const pubK = !!current.publishedAt;
  if (pubC !== pubK) return pubC;
  return candidate.createdAt < current.createdAt;
}

/** iso date + n days → iso date */
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(addDays(new Date(y, m - 1, d), n));
}

const shortDate = (iso: string) => formatFeedDate(iso).split(" ").slice(0, 2).join(" ");
const periodLabel = (from: string, to: string) => `${shortDate(from)} – ${shortDate(to)}`;

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
      .map(([key, minutes]) => ({
        label: MONTH_NAMES_SHORT[Number(key.slice(5, 7)) - 1],
        // the axis reads as months, so the year lives in the hover instead — with 12
        // buckets one month name can appear twice and the label alone is ambiguous
        title: `${MONTH_NAMES_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
        minutes,
      }));
  }, [clientEntries]);

  function addPeriod() {
    const last = periods[periods.length - 1];
    const now = new Date();
    const from = last
      ? addDaysIso(last.dateTo, 1)
      : toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
    const [y, m, d] = from.split("-").map(Number);
    const to = toISODate(new Date(y, m, d - 1)); // one month, inclusive
    addBillingPeriod({
      clientId: client.id,
      label: periodLabel(from, to),
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
                    onCommit={(v) => v && updateBillingPeriod(p.id, { dateFrom: v })}
                    format={formatDate}
                  />
                </span>
                <span className="text-faint">→</span>
                <span className="w-[5.5rem]">
                  <EditableDateCell
                    value={p.dateTo}
                    onCommit={(v) => v && updateBillingPeriod(p.id, { dateTo: v })}
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
          <div className="grid grid-cols-3 gap-2">
            <div title="Hours logged on billable tasks in the current payment period">
              <div className="text-[11px] font-medium text-muted">Current period</div>
              <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                {current ? formatHoursShort(currentMinutes) : "–"}
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
      </div>
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
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);

  // load links + hidden tabs once
  useEffect(() => {
    fetchAll<Record<string, unknown>>(supabase, "report_links", "*", (q) => q.eq("active", true))
      .then((rows) => {
        const map = new Map<string, ReportLink>();
        for (const r of rows) {
          const link = mapReportLink(r);
          const cur = map.get(link.clientId);
          if (!cur || preferLink(link, cur)) map.set(link.clientId, link);
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
    const cutoff = toISODate(new Date(Date.now() - 90 * 86400000));
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
        label: periodLabel(addDaysIso(boundary, 1), containing.dateTo),
        dateFrom: addDaysIso(boundary, 1),
        dateTo: containing.dateTo,
        hourCap: null,
        advanceHours: null,
      });
      updateBillingPeriod(containing.id, { dateTo: boundary });
    } else {
      const prevEnd = [...clientPeriods].reverse().find((p) => p.dateTo < boundary)?.dateTo;
      const from = prevEnd ? addDaysIso(prevEnd, 1) : (preview.weeks[0]?.from ?? boundary);
      addBillingPeriod({
        clientId: selectedClient.id,
        label: periodLabel(from, boundary),
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
    if (next) updateBillingPeriod(next.id, { dateFrom: addDaysIso(col.to, 1) });
  }

  /** change a column's date range; persisted per client on its report link */
  async function handleEditColumnDates(colIndex: number, patch: { from: string; to: string }) {
    if (!preview?.weeks || !selectedClient) return;
    const next = preview.weeks.map((w, i) =>
      i === colIndex ? { from: patch.from, to: patch.to, label: periodLabel(patch.from, patch.to) } : w,
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
      const link = found.map(mapReportLink).reduce((a, b) => (preferLink(b, a) ? b : a));
      setLinks((prev) => new Map(prev).set(clientId, link));
      return link;
    }
    const { data, error } = await supabase
      .from("report_links")
      .insert({ client_id: clientId, created_by: currentUserId })
      .select()
      .single();
    if (error) {
      console.error("create link failed", error.message);
      return null;
    }
    const link = mapReportLink(data);
    setLinks((prev) => new Map(prev).set(clientId, link));
    return link;
  }

  async function publish() {
    if (!selectedClient || !preview) return;
    setPublishing(true);
    const link = await ensureLink(selectedClient.id);
    if (!link) {
      setPublishing(false);
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
    await navigator.clipboard.writeText(`${window.location.origin}/report/${link.token}`);
    showToast(
      degraded
        ? "Published — link copied. The view filters weren't saved: migration 0031 hasn't been run."
        : "Report published — link copied to clipboard",
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
              title="Freeze the current preview and publish it to the client link"
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
                on={periodOnly && !showAll}
                dim={showAll}
                onClick={() => setPeriodOnly((v) => !v)}
                title="Show only the week columns of the latest payment period"
              >
                Latest period only
              </ViewToggle>
              <ViewToggle
                on={hideEmptyRows && !showAll}
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
              showSectionTotals
              periodOnly={periodOnly && !showAll}
              hideEmptyRows={hideEmptyRows && !showAll}
              foldedSections={showAll ? [] : foldedSections}
              onToggleSection={(name) =>
                setFoldedSections((prev) =>
                  prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
                )
              }
              onOpenTask={openTask}
              onEditEstimate={(taskId, hours) => updateTask(taskId, { estimateHours: hours })}
              onToggleColumn={(key) =>
                setHiddenColumns((prev) =>
                  prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                )
              }
              onToggleTask={(id) =>
                setHiddenTaskIds((prev) =>
                  prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
                )
              }
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
