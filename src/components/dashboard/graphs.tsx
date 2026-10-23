"use client";

// The two charts on the home page and the tab strip that swaps between them.
//
// ⚠️ The running bucket is PROJECTED, and only when enough of it has elapsed —
// see `bucketProjection`. On the 1st of a month a plain run-rate scales one day
// by the whole month and draws a bar that dwarfs every real one beside it.

import { ChartBarBig, ChartLine, Clock } from "lucide-react";
import { EmptyState } from "../empty-state";
import Link from "next/link";
import { MiniColumnsLabeled, MultiLineChart } from "../charts";
import { formatHoursShort } from "@/lib/format";
import { Tabs } from "../ui";
import { BAR_CLIENTS, TOTAL_SERIES, useHoursScope } from "./shared";
import { PaceChart } from "./pace-chart";
import type { HomeFilter } from "./shared";
import { bucketProjection, bucketize } from "@/lib/period-math";
import { useData } from "@/lib/store";
import { useMemo, useState } from "react";


export function MyGraphs({
  filter,
  isAdmin,
  prevRange = null,
  prevLabel = "",
}: {
  filter: HomeFilter;
  isAdmin: boolean;
  /** Admin pace chart only: the whole previous period, drawn as its reference line. */
  prevRange?: { from: string; to: string } | null;
  prevLabel?: string;
}) {
  // Admins, any bounded period: the running total against the goal or the
  // previous period (pace-chart.tsx). "All time" has no period to pace against,
  // so it keeps the per-bucket line. Two components, so the buckets below are
  // never counted only to be thrown away.
  const range = filter.range;
  if (isAdmin && range) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-3 font-heading text-base" title="Hours added up day by day over the selected period">
          Hours over time
        </h2>
        <PaceChart filter={{ ...filter, range }} prevRange={prevRange} prevLabel={prevLabel} />
      </div>
    );
  }
  return <BucketGraph filter={filter} isAdmin={isAdmin} />;
}

/** "Hours over time" per day/week/month bucket — members, and admins on "All time". */
function BucketGraph({ filter, isAdmin }: { filter: HomeFilter; isAdmin: boolean }) {
  const { scoped, taskById } = useHoursScope(filter, isAdmin);

  const { perBucket, projection } = useMemo(() => {
    const { keyFor, labelFor, unit } = bucketize(scoped.map((e) => e.date), !!filter.range);
    const map = new Map<string, { all: number; billable: number }>();
    for (const e of scoped) {
      const key = keyFor(e.date);
      const cur = map.get(key) ?? { all: 0, billable: 0 };
      cur.all += e.minutes;
      if (taskById.get(e.taskId)?.billable) cur.billable += e.minutes;
      map.set(key, cur);
    }
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const rows = sorted.map(([key, v]) => ({
      label: labelFor(key),
      minutes: v.all,
      billable: v.billable,
    }));
    const lastKey = sorted.at(-1)?.[0];
    const factor = lastKey ? bucketProjection(unit, lastKey) : null;
    const last = rows.at(-1);
    return {
      perBucket: rows,
      projection:
        factor != null && last
          ? {
              index: rows.length - 1,
              // one entry per series, in the order the chart is given them
              values: [Math.round(last.minutes * factor), Math.round(last.billable * factor)],
            }
          : undefined,
    };
  }, [scoped, filter.range, taskById]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-3 font-heading text-sm" title="Your logged hours over the selected period">
        Hours over time
      </h2>
      {perBucket.length > 0 ? (
        // Admins get the line form (same chart as the client-trend pane beside
        // it, single series) — it thins the x labels, which matters at 20+ daily
        // buckets. Members keep the labelled columns.
        isAdmin ? (
          <MultiLineChart
            labels={perBucket.map((p) => p.label)}
            series={[
              { label: TOTAL_SERIES, color: "#0b43ed", values: perBucket.map((p) => p.minutes) },
              // Showing everything? Then the billable slice rides along as a
              // second line. With "Billable only" on it would just retrace the
              // first one, so it's dropped.
              ...(filter.billableOnly
                ? []
                : [
                    {
                      label: "Billable",
                      color: "#16a34a",
                      values: perBucket.map((p) => p.billable),
                    },
                  ]),
            ]}
            // billable ⊂ all hours, so the headline must read ONE series
            totalSeries={TOTAL_SERIES}
            totalLabel={filter.label.toLowerCase()}
            projection={projection}
          />
        ) : (
          <MiniColumnsLabeled points={perBucket} />
        )
      ) : (
        <EmptyState compact icon={Clock} text="No hours in this scope." />
      )}
    </div>
  );
}


/**
 * The split half of "Hours by client": one bar per client in the client's own
 * colour, longest first (design-lab "Graphs 1"). Replaced a donut — slices of a
 * ring are hard to compare once there are more than four, and bars aren't.
 */
export function HoursByClientBars({ filter, isAdmin }: { filter: HomeFilter; isAdmin: boolean }) {
  const { scoped, taskById, clientById } = useHoursScope(filter, isAdmin);

  const { rows, total } = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of scoped) {
      const clientId = taskById.get(e.taskId)?.clientId;
      if (!clientId) continue;
      map.set(clientId, (map.get(clientId) ?? 0) + e.minutes);
    }
    const sorted = [...map.entries()]
      .map(([clientId, minutes]) => ({ client: clientById.get(clientId), minutes }))
      .filter((r) => r.client)
      .sort((a, b) => b.minutes - a.minutes);
    const rows: { label: string; minutes: number; color: string; href?: string }[] = sorted
      .slice(0, BAR_CLIENTS)
      .map((r) => ({
        label: r.client!.name,
        minutes: r.minutes,
        color: r.client!.color,
        href: `/clients/${r.client!.id}`,
      }));
    const rest = sorted.slice(BAR_CLIENTS).reduce((s, r) => s + r.minutes, 0);
    if (rest > 0) rows.push({ label: `${sorted.length - BAR_CLIENTS} other clients`, minutes: rest, color: "#9ca3af" });
    return { rows, total: sorted.reduce((s, r) => s + r.minutes, 0) };
  }, [scoped, taskById, clientById]);

  if (rows.length === 0) return <EmptyState compact icon={Clock} text="No hours in this scope." />;
  const top = Math.max(...rows.map((r) => r.minutes));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        // The bar carries the client's colour, so the name needs no swatch; the
        // hours sit just before the bar and the share just after it, so each
        // figure is read beside the thing it measures (Nitsan, 2026-10-23).
        const name = <span className="bidi-auto block truncate font-medium">{r.label}</span>;
        return (
          <li key={r.label} className="grid grid-cols-[minmax(0,7.5rem)_4.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-[13px]">
            {r.href ? (
              <Link href={r.href} className="min-w-0 hover:text-brand">
                {name}
              </Link>
            ) : (
              name
            )}
            <span className="text-right font-medium tabular-nums">{formatHoursShort(r.minutes)}</span>
            <span className="h-3.5 overflow-hidden rounded bg-background">
              <span className="block h-full rounded" style={{ width: `${(r.minutes / top) * 100}%`, backgroundColor: r.color }} />
            </span>
            <span className="tabular-nums text-muted">{((r.minutes / total) * 100).toFixed(1)}%</span>
          </li>
        );
      })}
    </ul>
  );
}


/**
 * "Hours by client", two ways, in one pane. The split (bars) and the trend over
 * time answer the same question — who the studio's hours went to — so they were
 * two panes competing for the same slot rather than two separate facts.
 * Members only ever had the split, so they get it without a tab strip.
 */
export function ClientBreakdown({ filter, isAdmin }: { filter: HomeFilter; isAdmin: boolean }) {
  const [tab, setTab] = useState<"split" | "trend">("split");
  const show = isAdmin ? tab : "split";

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2
          className="font-heading text-base"
          title={
            show === "split"
              ? "Hours split by client over the selected period"
              : "Studio hours per client over the selected period"
          }
        >
          Hours by client
        </h2>
        {isAdmin && (
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: "split" as const, label: "Split", icon: ChartBarBig },
              { value: "trend" as const, label: "Over time", icon: ChartLine },
            ]}
            variant="segmented"
            size="sm"
            ariaLabel="Hours by client view"
          />
        )}
      </div>
      {show === "split" ? (
        <HoursByClientBars filter={filter} isAdmin={isAdmin} />
      ) : (
        <StudioClientTrend filter={filter} />
      )}
    </div>
  );
}


/** Admin overview: studio hours per client over time — one colored line per client.
 *  Admin-only and per-client, never per-person, so it includes the recovered
 *  pre-Everhour history (entrySumsAll). */
export function StudioClientTrend({ filter }: { filter: HomeFilter }) {
  const { entrySumsAll, tasks, clients } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const { labels, series, projection } = useMemo(() => {
    const scoped = entrySumsAll.filter((e) => {
      if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) return false;
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) return false;
      if (filter.billableOnly && !task?.billable) return false;
      return true;
    });
    const { keyFor, labelFor, unit } = bucketize(scoped.map((e) => e.date), !!filter.range);
    const keys = [...new Set(scoped.map((e) => keyFor(e.date)))].sort();

    const totalByClient = new Map<string, number>();
    const byClientBucket = new Map<string, Map<string, number>>();
    for (const e of scoped) {
      const cid = taskById.get(e.taskId)?.clientId;
      if (!cid) continue;
      totalByClient.set(cid, (totalByClient.get(cid) ?? 0) + e.minutes);
      let m = byClientBucket.get(cid);
      if (!m) {
        m = new Map();
        byClientBucket.set(cid, m);
      }
      const k = keyFor(e.date);
      m.set(k, (m.get(k) ?? 0) + e.minutes);
    }
    // Pick the leaders of EACH BUCKET, then top up by overall total — not simply
    // the top 6 overall. Ranking by the whole range's total let the modern clients
    // win every slot, and they have no early hours at all: on "All time" the six
    // chosen lines covered 0% of every year before 2022, so the chart was flat
    // across 2016–2021 while the studio had really logged 3,068h in that stretch.
    // The actual leaders then were Quadream, Cognigo, Volta, New Era and Anchor.
    const MAX_SERIES = 7;
    const chosen = new Set<string>();
    for (const k of keys) {
      const leaders = [...byClientBucket.entries()]
        .map(([cid, m]) => [cid, m.get(k) ?? 0] as const)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2);
      for (const [cid] of leaders) chosen.add(cid);
    }
    const byTotal = [...totalByClient.entries()].sort((a, b) => b[1] - a[1]).map(([cid]) => cid);
    // Trim to the biggest overall if per-bucket leaders overflow, then top up.
    const top = byTotal.filter((cid) => chosen.has(cid)).slice(0, MAX_SERIES);
    for (const cid of byTotal) {
      if (top.length >= MAX_SERIES) break;
      if (!top.includes(cid)) top.push(cid);
    }

    const series = top.map((cid) => {
      const c = clientById.get(cid);
      const m = byClientBucket.get(cid)!;
      return { label: c?.name ?? "?", color: c?.color ?? "#9ca3af", values: keys.map((k) => m.get(k) ?? 0) };
    });

    // Everything not given its own line, so the lines account for the studio's
    // whole total instead of silently dropping 20–60% of it.
    const shown = new Set(top);
    const otherValues = keys.map((k) => {
      let sum = 0;
      for (const [cid, m] of byClientBucket) if (!shown.has(cid)) sum += m.get(k) ?? 0;
      return sum;
    });
    if (otherValues.some((v) => v > 0)) {
      series.push({ label: "Other clients", color: "#9ca3af", values: otherValues });
    }

    // still-running last bucket → run-rate estimate of the whole period, per line
    const factor = keys.length ? bucketProjection(unit, keys.at(-1)!) : null;
    const projection =
      factor != null
        ? {
            index: keys.length - 1,
            values: series.map((s) => Math.round((s.values.at(-1) ?? 0) * factor)),
          }
        : undefined;

    return { labels: keys.map(labelFor), series, projection };
  }, [entrySumsAll, filter, taskById, clientById]);

  if (series.length === 0) return <EmptyState compact icon={Clock} text="No hours in this scope." />;
  return (
    <MultiLineChart
      labels={labels}
      series={series}
      totalLabel={`top clients · ${filter.label.toLowerCase()}`}
      projection={projection}
    />
  );
}
