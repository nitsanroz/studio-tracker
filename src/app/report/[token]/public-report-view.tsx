"use client";

import { useMemo, useState } from "react";
import { formatHoursShort } from "@/lib/format";
import { ReportTable, ViewToggle } from "@/components/report-table";
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
  periodTotals,
  viewFlags,
}: {
  clientName: string;
  clientColor: string;
  snapshot: ReportSnapshot;
  publishedAt: string | null;
  hiddenColumns: string[];
  /** True hours per visible period, spanning hidden tasks too — see `sanitizeSnapshot`. */
  periodTotals: number[];
  viewFlags: ReportViewFlags | null;
}) {
  const [periodOnly, setPeriodOnly] = useState(viewFlags?.periodOnly ?? false);
  const [hideEmptyRows, setHideEmptyRows] = useState(viewFlags?.hideEmptyRows ?? false);
  const [foldedSections, setFoldedSections] = useState<string[]>([]);
  const lastUpdated = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  /**
   * Per-period charged totals.
   *
   * ⚠️ FROM `periodTotals`, NOT SUMMED FROM THE ROWS ON SCREEN. Summing the
   * visible rows made hiding a task change the client's figures: the tiles below
   * and the Billing periods pane both understated, and `remaining` — cap minus
   * charged — therefore OVERSTATED the budget left. Hiding is a focus tool, not
   * confidentiality (the same reason `totalMinutes` spans hidden periods), so
   * the summary has to be the real one. Computed server-side before the hidden
   * rows are removed, since afterwards those hours are simply gone.
   */
  const periodSummary = useMemo(
    () => snapshot.periods.map((p, i) => ({ ...p, minutes: periodTotals[i] ?? 0 })),
    [snapshot, periodTotals],
  );

  /**
   * ⚠️ NO PERIOD FILTER HERE, AND THAT IS THE POINT: hidden period columns are
   * already GONE from `snapshot.periods`, removed server-side by
   * `sanitizeSnapshot` before this component ever runs.
   *
   * This used to filter on `hiddenColumns.includes(columnKey(i))`, which could
   * never match — `hiddenColumns` on this page only ever holds "estimate" and/or
   * "total" (the two leading columns, whose values are nulled rather than
   * dropped), while `columnKey` returns `p:{i}`. So it kept every element and
   * merely read as though the view were enforcing the rule. Anyone trusting that
   * could move period-hiding into the client, or drop the server-side filtering
   * believing this covered it, and either would ship hidden columns to the
   * browser. The enforcement is server-side, full stop.
   */
  const delivered = periodSummary.reduce((s, p) => s + p.minutes, 0);
  const current = periodSummary.at(-1) ?? null;
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

      {periodSummary.length > 0 && (
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
              {/* No filter: hidden periods are already absent — see above. */}
              {periodSummary
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
