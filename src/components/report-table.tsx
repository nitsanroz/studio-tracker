"use client";

import { Eye, EyeOff } from "lucide-react";
import { formatHoursShort } from "@/lib/format";
import type { ReportSnapshot } from "@/lib/types";

/** Column keys: "estimate", "total", or `p:{index}` for payment periods. */
export function columnKey(i: number): string {
  return `p:${i}`;
}

const fmtH = (m: number) => (m > 0 ? formatHoursShort(m) : "–");

/**
 * The client-report table per the studio's spreadsheet: sections → tasks,
 * estimate vs total, one column per payment period, totals row.
 * `editable` shows hide/show toggles (admin preview); otherwise hidden
 * rows/columns are simply not rendered unless `revealHidden` is true.
 */
export function ReportTable({
  snapshot,
  hiddenColumns,
  hiddenTaskIds,
  editable = false,
  revealHidden = false,
  onToggleColumn,
  onToggleTask,
  onOpenTask,
  onEditEstimate,
}: {
  snapshot: ReportSnapshot;
  hiddenColumns: string[];
  hiddenTaskIds: string[];
  editable?: boolean;
  revealHidden?: boolean;
  onToggleColumn?: (key: string) => void;
  onToggleTask?: (taskId: string) => void;
  /** admin preview: click a task name to open its panel */
  onOpenTask?: (taskId: string) => void;
  /** admin preview: inline-edit the estimate (null clears it) */
  onEditEstimate?: (taskId: string, hours: number | null) => void;
}) {
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-faint">
            <th className="px-2 py-2 text-left">Section</th>
            <th className="px-2 py-2 text-left">Task</th>
            {showCol("estimate") && (
              <th className={`${num} ${colCls("estimate")}`}>
                Estimate
                {editable && (
                  <HideToggle hidden={hiddenCols.has("estimate")} onClick={() => onToggleColumn?.("estimate")} />
                )}
              </th>
            )}
            {showCol("total") && (
              <th className={`${num} ${colCls("total")}`}>
                Total
                {editable && (
                  <HideToggle hidden={hiddenCols.has("total")} onClick={() => onToggleColumn?.("total")} />
                )}
              </th>
            )}
            {visiblePeriods.map((p) => (
              <th key={p.key} className={`${num} ${colCls(p.key)}`} title={`${p.from} → ${p.to}`}>
                {p.label}
                {editable && (
                  <HideToggle hidden={hiddenCols.has(p.key)} onClick={() => onToggleColumn?.(p.key)} />
                )}
              </th>
            ))}
            {latestPeriod && (
              <th
                className={`${num} bg-green-100 text-green-900`}
                title={`${latestPeriod.label}: ${latestPeriod.from} → ${latestPeriod.to}`}
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
                  <td key={p.key} className={`${num} text-muted ${colCls(p.key)}`}>
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
              <td className={num}>{totalEstimate > 0 ? `${Math.round(totalEstimate * 10) / 10}h` : "–"}</td>
            )}
            {showCol("total") && <td className={num}>{fmtH(totalMinutes)}</td>}
            {visiblePeriods.map((p) => (
              <td key={p.key} className={num}>
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
