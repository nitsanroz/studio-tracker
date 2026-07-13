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
}: {
  snapshot: ReportSnapshot;
  hiddenColumns: string[];
  hiddenTaskIds: string[];
  editable?: boolean;
  revealHidden?: boolean;
  onToggleColumn?: (key: string) => void;
  onToggleTask?: (taskId: string) => void;
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

  const num = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-faint">
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
          </tr>
        </thead>
        <tbody>
          {snapshot.sections.map((sec) => {
            const rows = sec.tasks.filter((t) => showTask(t.id));
            if (rows.length === 0) return null;
            return [
              <tr key={`s-${sec.name}`} className="bg-gray-200/70">
                <td
                  colSpan={1 + (showCol("estimate") ? 1 : 0) + (showCol("total") ? 1 : 0) + visiblePeriods.length}
                  className="bidi-auto px-2 py-1.5 text-xs font-bold"
                >
                  {sec.name}
                </td>
              </tr>,
              ...rows.map((t) => (
                <tr key={t.id} className={`border-b border-border/60 last:border-b-0 ${rowCls(t.id)}`}>
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
                    {t.title}
                  </td>
                  {showCol("estimate") && (
                    <td className={`${num} text-muted ${colCls("estimate")}`}>
                      {t.estimateHours != null ? `${t.estimateHours}h` : "–"}
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
                </tr>
              )),
            ];
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-foreground/20 font-semibold">
            <td className="px-2 py-2 text-left text-xs uppercase tracking-wide">Total</td>
            {showCol("estimate") && (
              <td className={num}>{totalEstimate > 0 ? `${Math.round(totalEstimate * 10) / 10}h` : "–"}</td>
            )}
            {showCol("total") && <td className={num}>{fmtH(totalMinutes)}</td>}
            {visiblePeriods.map((p) => (
              <td key={p.key} className={num}>
                {fmtH(periodTotals[p.index])}
              </td>
            ))}
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
