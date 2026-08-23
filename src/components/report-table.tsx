"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Plus } from "lucide-react";
import { formatHoursShort } from "@/lib/format";
import { ResizeHandle, useColWidths } from "@/components/resizable";
import type { ReportSnapshot } from "@/lib/types";

/** Column keys: "estimate", "total", or `p:{index}` for payment periods. */
export function columnKey(i: number): string {
  return `p:${i}`;
}

const fmtH = (m: number) => (m > 0 ? formatHoursShort(m) : "–");
/** estimates are stored in HOURS, and read to one decimal */
const fmtEst = (h: number) => (h > 0 ? `${Math.round(h * 10) / 10}h` : "–");

type ReportTask = ReportSnapshot["sections"][number]["tasks"][number];

/**
 * The client-report table per the studio's spreadsheet: sections → tasks,
 * estimate vs total, one column per week, totals row. Payment periods group
 * the week columns — a strong vertical divider marks each period boundary and
 * a title row above the dates names the period.
 * `editable` shows hide/show toggles (admin preview); otherwise hidden
 * rows/columns are simply not rendered unless `revealHidden` is true.
 * `periodsEditable` additionally allows editing column dates, creating a
 * period divider (hover plus between column titles) and dragging an existing
 * divider to another column.
 */
export function ReportTable({
  snapshot,
  hiddenColumns,
  hiddenTaskIds,
  editable = false,
  revealHidden = false,
  periodsEditable = false,
  onToggleColumn,
  onToggleTask,
  onOpenTask,
  onEditEstimate,
  onAddBoundary,
  onMoveBoundary,
  onTogglePeriodHidden,
  onEditColumnDates,
  periodOnly = false,
  hideEmptyRows = false,
  foldedSections,
  onToggleSection,
  selectable = false,
}: {
  snapshot: ReportSnapshot;
  hiddenColumns: string[];
  hiddenTaskIds: string[];
  editable?: boolean;
  revealHidden?: boolean;
  /** admin preview: edit column dates + create/move period dividers */
  periodsEditable?: boolean;
  onToggleColumn?: (key: string) => void;
  onToggleTask?: (taskId: string) => void;
  /** admin preview: click a task name to open its panel */
  onOpenTask?: (taskId: string) => void;
  /** admin preview: inline-edit the estimate (null clears it) */
  onEditEstimate?: (taskId: string, hours: number | null) => void;
  /** end a payment period right after this column */
  onAddBoundary?: (colIndex: number) => void;
  /** move an existing period boundary to end after another column */
  onMoveBoundary?: (periodIndex: number, colIndex: number) => void;
  /** batch hide/show all column keys of a period */
  onTogglePeriodHidden?: (keys: string[], hide: boolean) => void;
  /** change a column's date range */
  onEditColumnDates?: (colIndex: number, patch: { from: string; to: string }) => void;
  /** show just the columns of the latest payment period */
  periodOnly?: boolean;
  /** drop tasks with no hours in the columns currently on screen */
  hideEmptyRows?: boolean;
  /** collapsed section names; omit for a table that cannot fold */
  foldedSections?: string[];
  onToggleSection?: (name: string) => void;
  /** click / drag hour cells and show what they add up to */
  selectable?: boolean;
}) {
  const [editingCol, setEditingCol] = useState<number | null>(null);
  const hiddenCols = new Set(hiddenColumns);
  const hiddenTasks = new Set(hiddenTaskIds);
  const showCol = (key: string) => editable || revealHidden || !hiddenCols.has(key);
  const showTask = (id: string) => editable || revealHidden || !hiddenTasks.has(id);

  // week columns like the Excel; old snapshots without weeks fall back to periods
  const cols = snapshot.weeks?.length
    ? snapshot.weeks.map((w, i) => ({ label: w.label, from: w.from, to: w.to, key: `w:${i}`, index: i }))
    : snapshot.periods.map((p, i) => ({ label: p.label, from: p.from, to: p.to, key: columnKey(i), index: i }));
  const useWeeks = !!snapshot.weeks?.length;
  const minutesAt = (t: { periodMinutes: number[]; weekMinutes?: number[] }, i: number) =>
    (useWeeks ? t.weekMinutes?.[i] : t.periodMinutes[i]) ?? 0;

  // which payment period each column belongs to (by the column's start date)
  const colPeriod = cols.map((c) =>
    snapshot.periods.findIndex((p) => c.from >= p.from && c.from <= p.to),
  );

  // The LATEST period by end date -- not the one today falls inside. A published
  // report is frozen, and a "today" rule would make the same link total a different
  // period next month with nobody republishing it.
  // `>` rather than localeCompare: these are YYYY-MM-DD, where the two agree.
  const latestIndex = snapshot.periods.reduce(
    (best, p, j, all) => (best < 0 || p.to > all[best].to ? j : best),
    -1,
  );
  const latestPeriod = latestIndex >= 0 ? snapshot.periods[latestIndex] : undefined;

  // Which week buckets fall inside the latest period, worked out ONCE. Scanning
  // every week the client has ever logged is loop-invariant, and `latestMinutes` is
  // asked for the same task three times per render (row cell, section subtotal,
  // grand total) -- hence the cache too.
  const latestWeeks = latestPeriod
    ? (snapshot.weeks ?? []).flatMap((w, i) =>
        w.to >= latestPeriod.from && w.from <= latestPeriod.to ? [i] : [],
      )
    : [];
  const latestCache = new Map<string, number>();
  /** minutes a task logged inside the latest period */
  const latestMinutes = (t: ReportTask) => {
    if (!latestPeriod) return 0;
    if (!useWeeks) return t.periodMinutes[latestIndex] ?? 0;
    const hit = latestCache.get(t.id);
    if (hit !== undefined) return hit;
    const sum = latestWeeks.reduce((a, i) => a + (t.weekMinutes?.[i] ?? 0), 0);
    latestCache.set(t.id, sum);
    return sum;
  };

  const visiblePeriods = cols.filter(
    (p) => showCol(p.key) && (!periodOnly || colPeriod[p.index] === latestIndex),
  );
  // "rows with hours" means hours in the columns ON SCREEN RIGHT NOW -- so it
  // narrows further when the period filter is on, and a column hidden from the
  // client never keeps a row alive.
  const rowVisible = (t: ReportTask) =>
    showTask(t.id) &&
    (!hideEmptyRows || visiblePeriods.some((p) => minutesAt(t, p.index) > 0));
  const folded = new Set(foldedSections ?? []);
  const dividerBefore = (i: number) => i > 0 && colPeriod[i] !== colPeriod[i - 1];
  const boundaryAfter = (i: number) =>
    colPeriod[i] >= 0 && (i === cols.length - 1 || colPeriod[i + 1] !== colPeriod[i]);
  const divCls = (i: number) => (dividerBefore(i) ? "border-l-2 border-l-border-strong" : "");

  // consecutive visible columns of the same period → one title-row group
  const groups: { periodIndex: number; count: number; keys: string[] }[] = [];
  for (const c of visiblePeriods) {
    const pi = colPeriod[c.index];
    const last = groups[groups.length - 1];
    if (last && last.periodIndex === pi) {
      last.count += 1;
      last.keys.push(c.key);
    } else {
      groups.push({ periodIndex: pi, count: 1, keys: [c.key] });
    }
  }
  const showPeriodRow = snapshot.periods.length > 0 && groups.some((g) => g.periodIndex >= 0);
  // The two hideable lead columns. Named once and used everywhere below -- `showCol`
  // is left to the `w:`/`p:` week keys.
  const showEst = showCol("estimate");
  const showTot = showCol("total");
  const leadingCols = 1 + (showEst ? 1 : 0) + (showTot ? 1 : 0);

  const colCls = (key: string) =>
    editable && hiddenCols.has(key) ? "opacity-35" : "";
  const rowCls = (id: string) =>
    editable && hiddenTasks.has(id) ? "opacity-35" : "";

  // `rowVisible` is not free -- with `hideEmptyRows` on it scans the visible columns
  // per task -- so the filter runs ONCE here and both the totals and the rendered
  // section groups read this one result.
  const sectionRows = snapshot.sections
    .map((sec) => ({ sec, rows: sec.tasks.filter(rowVisible) }))
    .filter((g) => g.rows.length > 0);

  // totals across visible tasks only
  const visibleTasks = sectionRows.flatMap((g) => g.rows);
  const totalEstimate = visibleTasks.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
  const totalMinutes = visibleTasks.reduce((s, t) => s + t.totalMinutes, 0);
  // Keyed by column index over the VISIBLE columns only: the footer reads nothing
  // else, and with the period filter on that is a handful out of every week logged.
  const periodTotals = new Map(
    visiblePeriods.map((p) => [p.index, visibleTasks.reduce((s, t) => s + minutesAt(t, p.index), 0)]),
  );

  // "Period" (green) = hours inside the latest billing period, like the Excel
  const periodTotal = visibleTasks.reduce((s, t) => s + latestMinutes(t), 0);

  const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

  // ── the four lead columns are pinned, so their widths must be definite ──────
  // Sticky needs a left offset per column, and an offset can only be computed from
  // widths we control. They are resizable because the task titles are the reason
  // anyone scrolls this table in the first place.
  const { widths, startResize } = useColWidths(
    "client-report-lead",
    // task 340, not 260: dropping the Section column freed 140px, and the task name
    // is what that width was being spent on reading
    { task: 340, estimate: 76, total: 76 },
    // 72 rather than 56: at 56 the task name is left ~27px of box after the padding
    // and the eye toggle, which is two characters and an ellipsis. Still under the
    // 76 default of the two number columns, so none of them is forced to move.
    { min: 72, max: 520 },
  );
  // With a section heading row above each group, a Section COLUMN would be empty on
  // every task row — the name already has a line of its own — so there is no Section
  // column at all and the task names indent under the heading instead.
  const leadOffset = {
    task: 0,
    estimate: widths.task,
    total: widths.task + (showEst ? widths.estimate : 0),
  };
  const leadWidth =
    widths.task + (showEst ? widths.estimate : 0) + (showTot ? widths.total : 0);
  const lastPinned = showTot ? "total" : showEst ? "estimate" : "task";
  type Lead = keyof typeof leadOffset;
  const pinStyle = (col: Lead): React.CSSProperties => ({
    left: leadOffset[col],
    width: widths[col],
    minWidth: widths[col],
    maxWidth: widths[col],
  });
  /**
   * `bg` must be opaque or the scrolling columns show through a pinned cell. The
   * separator on the last frozen column is an inset SHADOW, not a border, because
   * `border-collapse: collapse` does not paint borders on sticky cells reliably.
   */
  const pinCls = (col: Lead, bg: string, z = "z-10") =>
    `sticky ${z} ${bg} ${col === lastPinned ? "shadow-[inset_-1px_0_0_0_var(--border-strong)]" : ""}`;

  // ── horizontal scrollbar pinned to the bottom of the screen ────────────────
  // The table's own scrollbar sits at the end of the table, which on a long report
  // is far below the fold. This is a proxy bar: a sticky strip whose only content is
  // a spacer as wide as the table, with the two scroll positions kept in step.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);
  /**
   * ⚠️ THE MEASUREMENT IS WRITTEN STRAIGHT TO THE DOM, NOT INTO STATE, and that is
   * the whole point of this shape.
   *
   * It used to be `useState` fed by the observer. A Performance capture of the
   * client-reports page on DualBird showed the consequence:
   *   flushPassiveEffects → … → flushSyncWorkAcrossRoots_impl → renderRootSync →
   *   ReportTable → (effects run again) → …
   * i.e. a passive effect setting state, React flushing that synchronously, the
   * effects running again, forever — inside ONE long task, which is why the page
   * wedged with no console error while the dev server sat idle. The deep
   * `commitLayoutEffects` recursion in that capture is React walking this table's
   * ~4,200 cell fibers on every turn of the loop.
   *
   * A width that only ever becomes a style has no business being state: nothing
   * else reads it and no render depends on it. Writing it to the node cannot
   * schedule a render, so the loop is impossible by construction rather than
   * merely guarded against.
   */
  const spacerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = () => {
      if (spacerRef.current) spacerRef.current.style.width = `${el.scrollWidth}px`;
    };
    apply();
    // ⚠️ Observe the TABLE as well as the scroller. The scroller's own box does not
    // change when its CONTENT gets wider, so switching from a client with 58 columns
    // to one with 238 left the proxy bar sized for the old one — it scrolled a
    // quarter of the table and stopped.
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  const mirror = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || to.scrollLeft === from.scrollLeft) return;
    to.scrollLeft = from.scrollLeft;
  };

  // ── the cell grid selection sits on ───────────────────────────────────────
  // Only unfolded rows are addressable, so folding renumbers the grid. Selection
  // is cleared on any fold change (below) rather than remapped -- a selection that
  // silently changed which cells it covers would report the wrong total.
  const gridRows = sectionRows.flatMap((g) => (folded.has(g.sec.name) ? [] : g.rows));
  // Built once: the row loop used to find its grid index with `gridRows.indexOf(t)`,
  // which is a linear scan per row (quadratic overall) AND silently depends on the
  // pipeline preserving object identity -- one stray `.map()` would make every index
  // -1 with no type error. Keyed on the id instead, which is the actual identity.
  const gridIndex = new Map(gridRows.map((t, i) => [t.id, i]));

  // The selection carries the signature of the layout it was made against. Folding
  // a section or changing a filter renumbers the grid, so instead of clearing the
  // selection from an effect, a stale signature simply reads as no selection --
  // there is no render in between where the old coordinates address new cells.
  const [sel, setSel] = useState<
    { r0: number; c0: number; r1: number; c1: number; sig: string } | null
  >(null);
  const [dragging, setDragging] = useState(false);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const clearSel = () => {
    setSel(null);
    setBubble(null);
  };

  useEffect(() => {
    if (!selectable) return;
    const up = () => setDragging(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && clearSel();
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key);
    };
  }, [selectable]);

  const sig = `${[...folded].sort().join("|")}|${periodOnly}|${hideEmptyRows}`;
  const live = sel && sel.sig === sig ? sel : null;

  const bounds = live && {
    r0: Math.min(live.r0, live.r1),
    r1: Math.max(live.r0, live.r1),
    c0: Math.min(live.c0, live.c1),
    c1: Math.max(live.c0, live.c1),
  };
  const isSelected = (r: number, c: number) =>
    !!bounds && r >= bounds.r0 && r <= bounds.r1 && c >= bounds.c0 && c <= bounds.c1;

  // cheap enough to recompute each render: at most a few hundred cells
  let selMinutes = 0;
  let selCells = 0;
  let selFilled = 0;
  if (bounds) {
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      const t = gridRows[r];
      if (!t) continue;
      for (let c = bounds.c0; c <= bounds.c1; c++) {
        const col = visiblePeriods[c];
        if (!col) continue;
        const m = minutesAt(t, col.index);
        selMinutes += m;
        selCells += 1;
        if (m > 0) selFilled += 1;
      }
    }
  }

  const cellProps = (r: number, c: number) =>
    selectable
      ? {
          onMouseDown: (e: React.MouseEvent) => {
            e.preventDefault(); // or the drag turns into a text selection
            setSel(
              e.shiftKey && live
                ? { ...live, r1: r, c1: c }
                : { r0: r, c0: c, r1: r, c1: c, sig },
            );
            setDragging(true);
            setBubble({ x: e.clientX, y: e.clientY });
          },
          onMouseEnter: (e: React.MouseEvent) => {
            if (!dragging) return;
            setSel((s) => (s ? { ...s, r1: r, c1: c } : s));
            setBubble({ x: e.clientX, y: e.clientY });
          },
        }
      : {};

  /** drop-target props so an existing divider can be dragged onto any column */
  const dropProps = (colIndex: number) =>
    periodsEditable && onMoveBoundary
      ? {
          onDragOver: (e: React.DragEvent) => e.preventDefault(),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const pi = Number(e.dataTransfer.getData("text/plain"));
            if (Number.isInteger(pi) && pi >= 0) onMoveBoundary(pi, colIndex);
          },
        }
      : {};

  return (
    <>
      {/* the real scroller, with its own scrollbar hidden in favour of the pinned one */}
      <div
        ref={scrollRef}
        onScroll={() => mirror(scrollRef.current, proxyRef.current)}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
      <table className="w-full border-collapse text-sm">
        <thead>
          {showPeriodRow && (
            <tr className="text-[10px] font-semibold text-foreground">
              <th
                colSpan={leadingCols}
                className="sticky left-0 z-20 bg-surface"
                style={{ width: leadWidth, minWidth: leadWidth }}
              />
              {groups.map((g, gi) => (
                <th
                  key={gi}
                  colSpan={g.count}
                  className={`px-2 pt-1.5 text-center ${
                    g.periodIndex >= 0 ? "border-l-2 border-l-border-strong" : ""
                  }`}
                  title={
                    g.periodIndex >= 0
                      ? `Payment period: ${snapshot.periods[g.periodIndex].from} → ${snapshot.periods[g.periodIndex].to}`
                      : "Columns not covered by a payment period"
                  }
                >
                  {g.periodIndex >= 0 && (
                    <span className="inline-flex max-w-full items-center gap-1">
                      <span className="truncate">{snapshot.periods[g.periodIndex].label}</span>
                      {editable && onTogglePeriodHidden && (
                        <button
                          onClick={() =>
                            onTogglePeriodHidden(g.keys, !g.keys.every((k) => hiddenCols.has(k)))
                          }
                          className="text-faint hover:text-brand"
                          title={
                            g.keys.every((k) => hiddenCols.has(k))
                              ? "Show this period in the client view"
                              : "Hide this whole period from the client view"
                          }
                        >
                          {g.keys.every((k) => hiddenCols.has(k)) ? (
                            <EyeOff size={10} />
                          ) : (
                            <Eye size={10} />
                          )}
                        </button>
                      )}
                    </span>
                  )}
                </th>
              ))}
              {latestPeriod && <th />}
            </tr>
          )}
          <tr className="group/thead border-b border-border text-xs font-medium uppercase tracking-wide text-faint">
            <th
              style={pinStyle("task")}
              className={`${pinCls("task", "bg-surface", "z-20")} relative px-2 py-2 text-left`}
              title="Tasks with logged hours or an estimate"
            >
              Task
              <ResizeHandle onMouseDown={startResize("task")} />
            </th>
            {showEst && (
              <th
                style={pinStyle("estimate")}
                className={`${pinCls("estimate", "bg-surface", "z-20")} relative ${num} ${colCls("estimate")}`}
                title="Estimated hours budget per task"
              >
                <ResizeHandle onMouseDown={startResize("estimate")} />
                Estimate
                {editable && (
                  <HideToggle hidden={hiddenCols.has("estimate")} onClick={() => onToggleColumn?.("estimate")} />
                )}
              </th>
            )}
            {showTot && (
              <th
                style={pinStyle("total")}
                className={`${pinCls("total", "bg-surface", "z-20")} relative ${num} ${colCls("total")}`}
                title="All hours ever logged on the task"
              >
                <ResizeHandle onMouseDown={startResize("total")} />
                Total
                {editable && (
                  <HideToggle hidden={hiddenCols.has("total")} onClick={() => onToggleColumn?.("total")} />
                )}
              </th>
            )}
            {visiblePeriods.map((p) => (
              <th
                key={p.key}
                className={`group/col relative ${num} ${colCls(p.key)} ${divCls(p.index)}`}
                title={`${p.from} → ${p.to}${periodsEditable ? " — click the dates to edit this column's range" : ""}`}
                {...dropProps(p.index)}
              >
                {periodsEditable && editingCol === p.index ? (
                  <span
                    className="flex flex-col items-end gap-0.5"
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                        setEditingCol(null);
                    }}
                    onKeyDown={(e) => e.key === "Escape" && setEditingCol(null)}
                  >
                    <input
                      type="date"
                      autoFocus
                      defaultValue={p.from}
                      onChange={(e) =>
                        e.target.value && onEditColumnDates?.(p.index, { from: e.target.value, to: p.to })
                      }
                      className="rounded border border-border bg-surface px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal outline-none focus:border-brand"
                    />
                    <input
                      type="date"
                      defaultValue={p.to}
                      onChange={(e) =>
                        e.target.value && onEditColumnDates?.(p.index, { from: p.from, to: e.target.value })
                      }
                      className="rounded border border-border bg-surface px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal outline-none focus:border-brand"
                    />
                  </span>
                ) : (
                  <span
                    onClick={() => periodsEditable && setEditingCol(p.index)}
                    className={periodsEditable ? "cursor-pointer rounded px-0.5 hover:bg-background" : ""}
                  >
                    {p.label}
                  </span>
                )}
                {editable && (
                  <HideToggle hidden={hiddenCols.has(p.key)} onClick={() => onToggleColumn?.(p.key)} />
                )}
                {periodsEditable &&
                  (boundaryAfter(p.index) ? (
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(colPeriod[p.index]));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 cursor-grab items-center rounded bg-foreground p-0.5 text-white group-hover/col:flex"
                      title="Period divider — drag to another column to move it"
                    >
                      <GripVertical size={10} />
                    </span>
                  ) : (
                    <button
                      onClick={() => onAddBoundary?.(p.index)}
                      className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 items-center rounded-full bg-brand p-0.5 text-white group-hover/col:flex"
                      title="End a payment period after this column"
                    >
                      <Plus size={10} />
                    </button>
                  ))}
              </th>
            ))}
            {latestPeriod && (
              <th
                className={`${num} bg-green-100 text-green-900`}
                title={`Hours in the latest payment period — ${latestPeriod.label}: ${latestPeriod.from} → ${latestPeriod.to}`}
              >
                Period
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sectionRows.map((g) => {
            const isFolded = folded.has(g.sec.name);
            const secEstimate = g.rows.reduce((a, t) => a + (t.estimateHours ?? 0), 0);
            const secTotal = g.rows.reduce((a, t) => a + t.totalMinutes, 0);
            const secPeriod = g.rows.reduce((a, t) => a + latestMinutes(t), 0);
            return (
              <Fragment key={g.sec.name}>
                <tr className="border-t-2 border-t-border bg-background text-xs font-bold">
                  <td
                    className="sticky left-0 z-10 bg-background px-2 py-1.5 text-left"
                    style={{ width: widths.task, minWidth: widths.task }}
                  >
                    {onToggleSection ? (
                      <button
                        onClick={() => onToggleSection(g.sec.name)}
                        className="flex max-w-full items-center gap-1 text-left hover:text-brand"
                        title={isFolded ? "Unfold this section" : "Fold this section"}
                      >
                        {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <span className="bidi-auto min-w-0 truncate" title={g.sec.name}>
                          {g.sec.name}
                        </span>
                        <span className="shrink-0 font-normal text-faint">{g.rows.length}</span>
                      </button>
                    ) : (
                      <span className="bidi-auto block truncate" title={g.sec.name}>
                        {g.sec.name}
                      </span>
                    )}
                  </td>
                  {showEst && (
                    <td
                      style={pinStyle("estimate")}
                      className={`${pinCls("estimate", "bg-background")} ${num} ${colCls("estimate")}`}
                    >
                      {fmtEst(secEstimate)}
                    </td>
                  )}
                  {showTot && (
                    <td
                      style={pinStyle("total")}
                      className={`${pinCls("total", "bg-background")} ${num} ${colCls("total")}`}
                    >
                      {fmtH(secTotal)}
                    </td>
                  )}
                  {visiblePeriods.map((p) => (
                    <td key={p.key} className={`${num} ${colCls(p.key)} ${divCls(p.index)}`}>
                      {fmtH(g.rows.reduce((a, t) => a + minutesAt(t, p.index), 0))}
                    </td>
                  ))}
                  {latestPeriod && (
                    <td className={`${num} bg-green-100 text-green-900`}>{fmtH(secPeriod)}</td>
                  )}
                </tr>
                {!isFolded &&
                  g.rows.map((t) => {
                    const r = gridIndex.get(t.id) ?? -1;
                    return (
                      <tr key={t.id} className={`border-t border-border/60 ${rowCls(t.id)}`}>
                        {/* ⚠️ The ellipsis must live on the NAME, not on the cell. A `truncate`
                            cell holding an inline-block <button> cannot break it, so the
                            browser replaces the whole button with the ellipsis and a long
                            title renders as three dots and nothing else. Flex row + a
                            `min-w-0` name is what makes it truncate as text; `title` gives
                            the full name back on hover. */}
                        <td
                          style={pinStyle("task")}
                          className={`${pinCls("task", "bg-surface")} py-1.5 pl-7 pr-2 text-left`}
                        >
                          <span className="flex items-center gap-1.5">
                            {editable && (
                              <button
                                onClick={() => onToggleTask?.(t.id)}
                                className="shrink-0 text-faint hover:text-brand"
                                title={
                                  hiddenTasks.has(t.id)
                                    ? "Show row in client view"
                                    : "Hide row from client view"
                                }
                              >
                                {hiddenTasks.has(t.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            )}
                            {onOpenTask ? (
                              <button
                                onClick={() => onOpenTask(t.id)}
                                title={t.title}
                                className="bidi-auto min-w-0 flex-1 truncate text-left hover:text-brand hover:underline"
                              >
                                {t.title}
                              </button>
                            ) : (
                              <span className="bidi-auto min-w-0 flex-1 truncate" title={t.title}>
                                {t.title}
                              </span>
                            )}
                          </span>
                        </td>
                        {showEst && (
                          <td
                            style={pinStyle("estimate")}
                            className={`${pinCls("estimate", "bg-surface")} ${num} text-muted ${colCls("estimate")}`}
                          >
                            {editable && onEditEstimate ? (
                              <input
                                key={`${t.id}-${t.estimateHours}`}
                                defaultValue={t.estimateHours ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  const h = v === "" ? null : Number(v);
                                  if (v !== "" && (Number.isNaN(h!) || h! < 0)) {
                                    e.target.value =
                                      t.estimateHours == null ? "" : String(t.estimateHours);
                                    return;
                                  }
                                  if (h !== t.estimateHours) onEditEstimate(t.id, h);
                                }}
                                onKeyDown={(e) =>
                                  e.key === "Enter" && (e.target as HTMLInputElement).blur()
                                }
                                className="w-12 rounded border border-transparent bg-transparent text-right tabular-nums outline-none hover:border-border focus:border-brand"
                                title="Edit estimate (hours)"
                              />
                            ) : t.estimateHours != null ? (
                              `${t.estimateHours}h`
                            ) : (
                              "–"
                            )}
                          </td>
                        )}
                        {showTot && (
                          <td
                            style={pinStyle("total")}
                            className={`${pinCls("total", "bg-surface")} ${num} font-semibold ${colCls("total")}`}
                          >
                            {fmtH(t.totalMinutes)}
                          </td>
                        )}
                        {visiblePeriods.map((p, ci) => (
                          <td
                            key={p.key}
                            {...cellProps(r, ci)}
                            className={`${num} ${colCls(p.key)} ${divCls(p.index)} ${
                              selectable ? "cursor-cell select-none" : "text-muted"
                            } ${
                              isSelected(r, ci)
                                ? "bg-brand-soft font-semibold text-foreground"
                                : selectable
                                  ? // a weak wash of the SELECTED colour, so the hint reads as
                                    // "this is what selecting looks like" rather than as its own
                                    // state — and faint enough not to compete with the numbers
                                    "text-muted hover:bg-brand-soft/40"
                                  : ""
                            }`}
                          >
                            {fmtH(minutesAt(t, p.index))}
                          </td>
                        ))}
                        {latestPeriod && (
                          <td className={`${num} bg-green-50 font-medium text-green-900`}>
                            {fmtH(latestMinutes(t))}
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-foreground/20 font-semibold">
            <td
              style={pinStyle("task")}
              className={`${pinCls("task", "bg-surface")} px-2 py-2 text-left text-xs uppercase tracking-wide`}
            >
              Total
            </td>
            {showEst && (
              <td
                style={pinStyle("estimate")}
                className={`${pinCls("estimate", "bg-surface")} ${num}`}
                title="Sum of visible task estimates"
              >
                {fmtEst(totalEstimate)}
              </td>
            )}
            {showTot && (
              <td
                style={pinStyle("total")}
                className={`${pinCls("total", "bg-surface")} ${num}`}
                title="Sum of all hours on visible tasks"
              >
                {fmtH(totalMinutes)}
              </td>
            )}
            {visiblePeriods.map((p) => (
              <td key={p.key} className={`${num} ${divCls(p.index)}`}>
                {fmtH(periodTotals.get(p.index) ?? 0)}
              </td>
            ))}
            {latestPeriod && (
              <td className={`${num} bg-green-100 text-green-900`}>{fmtH(periodTotal)}</td>
            )}
          </tr>
        </tfoot>
      </table>
      </div>
      {/* Always rendered, and its spacer is sized by the effect above rather than by
          a render. With nothing to scroll the spacer matches the strip, so no thumb
          is drawn and the strip is invisible. */}
      <div
        ref={proxyRef}
        onScroll={() => mirror(proxyRef.current, scrollRef.current)}
        className="sticky bottom-0 z-30 overflow-x-auto"
        title="Scroll the table sideways"
      >
        <div ref={spacerRef} style={{ width: "100%", height: 1 }} />
      </div>
      {/* Fixed, and a sibling of the scroll box rather than a child: an absolutely
          positioned bubble inside `overflow-x-auto` is clipped, which is exactly the
          bug the client tab menu had. pointer-events-none so it never eats a drag. */}
      {selectable && bubble && selCells > 1 && (
        <div
          style={{ left: bubble.x + 16, top: bubble.y + 16 }}
          className="pointer-events-none fixed z-50 rounded-xl bg-foreground px-3 py-2 text-white shadow-xl"
        >
          <div className="text-2xl font-bold leading-none tabular-nums">{fmtH(selMinutes)}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-white/70">
            {selFilled} of {selCells} cells
            {selFilled > 1 && ` · avg ${fmtH(Math.round(selMinutes / selFilled))}`}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A view-filter pill, shared by the studio toolbar and the client report.
 *
 * `dim` marks a filter that is set but currently overridden by "Show all", so the
 * setting it will return to stays legible instead of looking off. `touch` gives the
 * pill a 44px minimum target below `sm` — the client report is opened on phones.
 *
 * Lives here rather than in `ui.tsx` because both toolbars already import this
 * module, and `ui.tsx` pulls the data store into the public report's bundle.
 */
export function ViewToggle({
  on,
  dim = false,
  touch = false,
  onClick,
  title,
  children,
}: {
  on: boolean;
  dim?: boolean;
  touch?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`rounded-full border font-medium ${
        touch ? "min-h-11 px-3 py-1 text-xs sm:min-h-0" : "px-2.5 py-1 text-[11px]"
      } ${
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

function HideToggle({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="ml-1 align-middle text-faint hover:text-brand"
      title={hidden ? "Show column in client view" : "Hide column from client view"}
    >
      {hidden ? <EyeOff size={11} /> : <Eye size={11} />}
    </button>
  );
}
