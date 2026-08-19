"use client";

import { useMemo, useState } from "react";
import { formatHoursShort } from "@/lib/format";
import { ReportTable, ViewToggle, columnKey } from "@/components/report-table";
import { toggleIn } from "@/lib/toggle";
import type { ReportSnapshot, ReportViewFlags } from "@/lib/types";

function ReportTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-serif-accent text-2xl tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/**
 * Client-facing snapshot view. The snapshot arrives already sanitized by the
 * server (see page.tsx `sanitizeSnapshot`) — admin-hidden tasks and columns are
 * gone from the data entirely, so there is no reveal/toggle for those: the client
 * physically cannot see hidden rows/columns. `hiddenColumns` only ever carries
 * the leading estimate/total columns, whose values were already nulled.
 *
 * ⚠️ `viewFlags` is a DIFFERENT thing and the difference matters. Those are the
 * filters the studio had on when it published — how the report opens — and the
 * client can switch them off, because the data behind them was deliberately sent.
 * Anything that must not be seen belongs in the hidden lists above, not here.
 */
export function PublicReportView({
  clientName,
  clientColor,
  snapshot,
  publishedAt,
  hiddenColumns,
  viewFlags,
}: {
  clientName: string;
  clientColor: string;
  snapshot: ReportSnapshot;
  publishedAt: string | null;
  hiddenColumns: string[];
  viewFlags: ReportViewFlags | null;
}) {
  const [periodOnly, setPeriodOnly] = useState(viewFlags?.periodOnly ?? false);
  const [hideEmptyRows, setHideEmptyRows] = useState(viewFlags?.hideEmptyRows ?? false);
  const [foldedSections, setFoldedSections] = useState<string[]>([]);
  const lastUpdated = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // per-period charged totals for the invoices pane (all tasks are visible)
  const periodSummary = useMemo(() => {
    const tasks = snapshot.sections.flatMap((s) => s.tasks);
    return snapshot.periods.map((p, i) => ({
      ...p,
      minutes: tasks.reduce((s, t) => s + (t.periodMinutes[i] ?? 0), 0),
    }));
  }, [snapshot]);

  const visiblePeriods = periodSummary.filter((_, i) => !hiddenColumns.includes(columnKey(i)));
  const delivered = visiblePeriods.reduce((s, p) => s + p.minutes, 0);
  const current = visiblePeriods.at(-1) ?? null;
  const remaining =
    current?.hourCap != null ? Math.max(0, current.hourCap * 60 - current.minutes) : null;

  return (
    <main className="mx-auto max-w-6xl p-6 md:p-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 items-center justify-center rounded-xl text-lg font-bold text-white"
            style={{ backgroundColor: clientColor }}
          >
            {clientName[0]}
          </span>
          <div>
            <h1 className="font-serif-accent text-3xl">{clientName}</h1>
            <p className="text-sm text-muted">
              Hours report{lastUpdated && <> · last updated {lastUpdated}</>}
            </p>
          </div>
        </div>
        <span
          className="brand-wordmark h-5 w-32 shrink-0"
          style={{ backgroundColor: "#0b43ed" }}
          role="img"
          aria-label="Studio&more"
        />
      </header>

      {visiblePeriods.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ReportTile label="Delivered to date" value={formatHoursShort(delivered)} />
          {current && (
            <ReportTile label={current.label} value={formatHoursShort(current.minutes)} sub="this period" />
          )}
          {current?.hourCap != null && <ReportTile label="Period cap" value={`${current.hourCap}h`} />}
          {remaining != null && <ReportTile label="Remaining" value={formatHoursShort(remaining)} />}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card lg:col-span-3">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <ViewToggle
              touch
              on={!periodOnly}
              onClick={() => setPeriodOnly((v) => !v)}
              title={
                periodOnly
                  ? "Show every period, not just the latest"
                  : "Show only the latest payment period"
              }
            >
              {periodOnly ? "Show all periods" : "All periods"}
            </ViewToggle>
            <ViewToggle
              touch
              on={hideEmptyRows}
              onClick={() => setHideEmptyRows((v) => !v)}
              title="Hide tasks with no hours in the columns shown"
            >
              Only rows with hours
            </ViewToggle>
            {foldedSections.length > 0 && (
              <button
                onClick={() => setFoldedSections([])}
                className="min-h-11 rounded-full px-2.5 py-1 text-xs text-muted hover:bg-background hover:text-foreground sm:min-h-0"
              >
                Unfold {foldedSections.length} section{foldedSections.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
          <ReportTable
            snapshot={snapshot}
            hiddenColumns={hiddenColumns}
            hiddenTaskIds={[]}
            periodOnly={periodOnly}
            hideEmptyRows={hideEmptyRows}
            foldedSections={foldedSections}
            onToggleSection={(name) => setFoldedSections((prev) => toggleIn(prev, name))}
          />
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
              Billing periods
            </h2>
            {periodSummary.length === 0 && (
              <p className="text-sm text-faint">No payment periods defined.</p>
            )}
            <div className="flex flex-col gap-2">
              {periodSummary
                .filter((p, i) => !hiddenColumns.includes(columnKey(i)))
                .map((p) => (
                  <div key={p.label} className="rounded-lg bg-background p-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.label}</span>
                      <span className="font-semibold tabular-nums">{formatHoursShort(p.minutes)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {p.hourCap != null && <span>cap {p.hourCap}h</span>}
                      {p.hourCap != null && p.advanceHours != null && " · "}
                      {p.advanceHours != null && <span>advance {p.advanceHours}h</span>}
                      {p.hourCap == null && p.advanceHours == null && (
                        <span>
                          {p.from} → {p.to}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <p className="px-1 text-center text-[11px] text-faint">
            Generated by Studio&amp;more · updated only when the studio publishes a new version.
          </p>
        </aside>
      </div>
    </main>
  );
}
