"use client";

import { useState } from "react";
import { Eye, EyeOff, GripVertical, Plus } from "lucide-react";
import { formatHoursShort } from "@/lib/format";
import type { ReportSnapshot } from "@/lib/types";

/** Column keys: "estimate", "total", or `p:{index}` for payment periods. */
export function columnKey(i: number): string {
  return `p:${i}`;
}

const fmtH = (m: number) => (m > 0 ? formatHoursShort(m) : "–");

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
  const visiblePeriods = cols.filter((p) => showCol(p.key));

  // which payment period each column belongs to (by the column's start date)
  const colPeriod = cols.map((c) =>
    snapshot.periods.findIndex((p) => c.from >= p.from && c.from <= p.to),
  );
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
  const leadingCols = 2 + (showCol("estimate") ? 1 : 0) + (showCol("total") ? 1 : 0);

  const colCls = (key: string) =>
    editable && hiddenCols.has(key) ? "opacity-35" : "";
  const rowCls = (id: string) =>
    editable && hiddenTasks.has(id) ? "opacity-35" : "";

  // totals across visible tasks only
  const visibleTasks = snapshot.sections.flatMap((s) => s.tasks.filter((t) => showTask(t.id)));
  const totalEstimate = visibleTasks.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
  const totalMinutes = visibleTasks.reduce((s, t) => s + t.totalMinutes, 0);
  const periodTotals = cols.map((_, i) =>
    visibleTasks.reduce((s, t) => s + minutesAt(t, i), 0),
  );

  // "Period" (green) = hours inside the latest billing period, like the Excel
  const latestPeriod = [...snapshot.periods].sort((a, b) => a.to.localeCompare(b.to)).at(-1);
  const periodMinutesFor = (t: (typeof visibleTasks)[number]) => {
    if (!latestPeriod || !snapshot.weeks?.length) {
      const i = snapshot.periods.indexOf(latestPeriod!);
      return i >= 0 ? (t.periodMinutes[i] ?? 0) : 0;
    }
    // sum week buckets that overlap the period
    return snapshot.weeks.reduce(
      (s, w, i) =>
        w.to >= latestPeriod.from && w.from <= latestPeriod.to ? s + (t.weekMinutes?.[i] ?? 0) : s,
      0,
    );
  };
  const periodTotal = visibleTasks.reduce((s, t) => s + periodMinutesFor(t), 0);

  const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

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
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          {showPeriodRow && (
            <tr className="text-[10px] font-semibold text-foreground">
              <th colSpan={leadingCols} />
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
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-faint">
            <th className="px-2 py-2 text-left" title="Board section the tasks belong to">
              Section
            </th>
            <th className="px-2 py-2 text-left" title="Tasks with logged hours or an estimate">
              Task
            </th>
            {showCol("estimate") && (
              <th className={`${num} ${colCls("estimate")}`} title="Estimated hours budget per task">
                Estimate
                {editable && (
                  <HideToggle hidden={hiddenCols.has("estimate")} onClick={() => onToggleColumn?.("estimate")} />
                )}
              </th>
            )}
            {showCol("total") && (
              <th className={`${num} ${colCls("total")}`} title="All hours ever logged on the task">
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
          {snapshot.sections.map((sec) => {
            const rows = sec.tasks.filter((t) => showTask(t.id));
            if (rows.length === 0) return null;
            return rows.map((t, ri) => (
              <tr
                key={t.id}
                className={`border-border/60 ${ri === 0 ? "border-t-2 border-t-border" : "border-t"} ${rowCls(t.id)}`}
              >
                <td className="bidi-auto max-w-36 truncate px-2 py-1.5 text-left text-xs font-bold">
                  {ri === 0 ? sec.name : ""}
                </td>
                <td className="bidi-auto max-w-72 truncate px-2 py-1.5 text-left">
                  {editable && (
                    <button
                      onClick={() => onToggleTask?.(t.id)}
                      className="mr-1.5 align-middle text-faint hover:text-brand"
                      title={hiddenTasks.has(t.id) ? "Show row in client view" : "Hide row from client view"}
                    >
                      {hiddenTasks.has(t.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  )}
                  {onOpenTask ? (
                    <button
                      onClick={() => onOpenTask(t.id)}
                      className="bidi-auto text-left hover:text-brand hover:underline"
                    >
                      {t.title}
                    </button>
                  ) : (
                    t.title
                  )}
                </td>
                {showCol("estimate") && (
                  <td className={`${num} text-muted ${colCls("estimate")}`}>
                    {editable && onEditEstimate ? (
                      <input
                        key={`${t.id}-${t.estimateHours}`}
                        defaultValue={t.estimateHours ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          const h = v === "" ? null : Number(v);
                          if (v !== "" && (Number.isNaN(h!) || h! < 0)) {
                            e.target.value = t.estimateHours == null ? "" : String(t.estimateHours);
                            return;
                          }
                          if (h !== t.estimateHours) onEditEstimate(t.id, h);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
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
                {showCol("total") && (
                  <td className={`${num} font-semibold ${colCls("total")}`}>{fmtH(t.totalMinutes)}</td>
                )}
                {visiblePeriods.map((p) => (
                  <td key={p.key} className={`${num} text-muted ${colCls(p.key)} ${divCls(p.index)}`}>
                    {fmtH(minutesAt(t, p.index))}
                  </td>
                ))}
                {latestPeriod && (
                  <td className={`${num} bg-green-50 font-medium text-green-900`}>
                    {fmtH(periodMinutesFor(t))}
                  </td>
                )}
              </tr>
            ));
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-foreground/20 font-semibold">
            <td className="px-2 py-2 text-left text-xs uppercase tracking-wide">Total</td>
            <td />
            {showCol("estimate") && (
              <td className={num} title="Sum of visible task estimates">
                {totalEstimate > 0 ? `${Math.round(totalEstimate * 10) / 10}h` : "–"}
              </td>
            )}
            {showCol("total") && (
              <td className={num} title="Sum of all hours on visible tasks">
                {fmtH(totalMinutes)}
              </td>
            )}
            {visiblePeriods.map((p) => (
              <td key={p.key} className={`${num} ${divCls(p.index)}`}>
                {fmtH(periodTotals[p.index])}
              </td>
            ))}
            {latestPeriod && (
              <td className={`${num} bg-green-100 text-green-900`}>{fmtH(periodTotal)}</td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
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
