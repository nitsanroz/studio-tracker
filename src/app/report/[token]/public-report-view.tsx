"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { formatHoursShort } from "@/lib/format";
import { ReportTable, columnKey } from "@/components/report-table";
import type { ReportSnapshot } from "@/lib/types";

/**
 * Client-facing snapshot view. Admin-hidden rows/columns start hidden; the
 * viewer may reveal or re-hide them — that preference is local to the
 * viewer's browser only (localStorage) and never touches the studio data.
 */
export function PublicReportView({
  token,
  clientName,
  clientColor,
  snapshot,
  publishedAt,
  defaultHiddenColumns,
  defaultHiddenTaskIds,
}: {
  token: string;
  clientName: string;
  clientColor: string;
  snapshot: ReportSnapshot;
  publishedAt: string | null;
  defaultHiddenColumns: string[];
  defaultHiddenTaskIds: string[];
}) {
  const storageKey = `report-view-${token}`;
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(defaultHiddenColumns);
  const [hiddenTaskIds, setHiddenTaskIds] = useState<string[]>(defaultHiddenTaskIds);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.cols)) setHiddenColumns(saved.cols);
        if (Array.isArray(saved.tasks)) setHiddenTaskIds(saved.tasks);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function persist(cols: string[], tasks: string[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ cols, tasks }));
    } catch {}
  }

  const anythingHidden = hiddenColumns.length > 0 || hiddenTaskIds.length > 0;

  const lastUpdated = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // per-period charged totals for the invoices pane (visible tasks only)
  const periodSummary = useMemo(() => {
    const visible = snapshot.sections
      .flatMap((s) => s.tasks)
      .filter((t) => !hiddenTaskIds.includes(t.id));
    return snapshot.periods.map((p, i) => ({
      ...p,
      minutes: visible.reduce((s, t) => s + (t.periodMinutes[i] ?? 0), 0),
    }));
  }, [snapshot, hiddenTaskIds]);

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
            <h1 className="text-2xl font-bold tracking-tight">{clientName}</h1>
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

      <div className="grid items-start gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4 lg:col-span-3">
          <div className="mb-2 flex items-center justify-end gap-2">
            {anythingHidden && (
              <button
                onClick={() => setReveal((r) => !r)}
                className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-brand hover:text-brand"
              >
                {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
                {reveal ? "Hide hidden rows" : "Show hidden rows"}
              </button>
            )}
          </div>
          <ReportTable
            snapshot={snapshot}
            hiddenColumns={hiddenColumns}
            hiddenTaskIds={hiddenTaskIds}
            editable={reveal}
            onToggleColumn={(key) => {
              const next = hiddenColumns.includes(key)
                ? hiddenColumns.filter((k) => k !== key)
                : [...hiddenColumns, key];
              setHiddenColumns(next);
              persist(next, hiddenTaskIds);
            }}
            onToggleTask={(id) => {
              const next = hiddenTaskIds.includes(id)
                ? hiddenTaskIds.filter((k) => k !== id)
                : [...hiddenTaskIds, id];
              setHiddenTaskIds(next);
              persist(hiddenColumns, next);
            }}
          />
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
              Billing periods
            </h2>
            {periodSummary.length === 0 && (
              <p className="text-sm text-faint">No payment periods defined.</p>
            )}
            <div className="flex flex-col gap-2">
              {periodSummary
                .filter((p, i) => reveal || !hiddenColumns.includes(columnKey(i)))
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
            Generated by Studio&amp;more · hours are rounded to the nearest minute · updated only
            when the studio publishes a new version.
          </p>
        </aside>
      </div>
    </main>
  );
}
