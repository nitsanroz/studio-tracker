"use client";

// "The studio": every designer's hours for the period, with their billable share.
//
// ⚠️ It counts anyone who logged in the period, PAST MEMBERS INCLUDED — the pane
// describes a period, and someone who left in March did the March work. They are
// marked rather than dropped, because their hours are as real as anyone's.

import Link from "next/link";
import { Avatar } from "../ui";
import type { HomeFilter } from "./shared";
import { formatHoursShort } from "@/lib/format";
import { addEntry, billablePct, keysPct, keysTaskIds, newSplit, splitTitle } from "@/lib/hours-split";
import type { HoursSplit } from "@/lib/hours-split";
import { useData } from "@/lib/store";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";


/** Compact studio roster on the admin home: per-designer hours + billable bar. */
export function StudioTeamStrip({ filter }: { filter: HomeFilter }) {
  // entrySumsAll, NOT entrySums: the legacy-free list is empty before 2022 (every
  // entry that far back is recovered pre-Everhour history), so the pane rendered
  // nothing at all for those years while the tiles above it reported thousands of
  // hours. About a third of those old entries DO name a person; the rest name
  // nobody, and `unattributed` below owns up to that instead of quietly shrinking
  // the studio's total.
  const { entrySumsAll, tasks, profiles, clients } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const { rows, unattributed } = useMemo(() => {
    // ⚠️ Built inside the memo, not shared from one of its own: a `Set` held in a
    // separate `useMemo` and read here made the React Compiler refuse to preserve
    // this one, which re-aggregates every entry in the period on every render.
    const keysIds = keysTaskIds(clients);
    const per = new Map<string, HoursSplit>();
    // no billable filter in this loop: `pct` below is the billable SHARE and has to
    // keep all hours as its denominator, so every part is always accumulated
    let orphan = newSplit();
    for (const e of entrySumsAll) {
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) continue;
      const kind = { billable: !!task?.billable, keys: keysIds.has(e.taskId) };
      if (e.userId) per.set(e.userId, addEntry(per.get(e.userId) ?? newSplit(), e.minutes, kind));
      else orphan = addEntry(orphan, e.minutes, kind);
    }
    // Archived people are NOT filtered out: the pane describes a period, and
    // someone who left in March did log hours in March. `min > 0` below is the real
    // gate — an archived designer with nothing in the period still doesn't appear.
    const rows = profiles
      .map((p) => {
        const r = per.get(p.id) ?? newSplit();
        // The bar is the billable SHARE, so it stays over all hours even when the
        // page shows billable only — otherwise every designer reads a flat 100%.
        return {
          p,
          min: filter.billableOnly ? r.billable : r.total,
          pct: billablePct(r) ?? 0,
          split: r,
          /**
           * ⚠️ ADMINS GET NO BILLABLE SHARE, and their HOURS still show. Nitsan's
           * call: an admin barely logs against client tasks and never gets hours
           * written down, so a share computed over their handful of internal
           * entries reads as a terrible number about a person it does not
           * describe. `Office` is a shared ADMIN account that does log real hours
           * (v0.99.3), which is why the hours themselves must not be hidden with
           * the percentage.
           */
          share: p.role !== "admin",
          archived: !p.active,
        };
      })
      .filter((x) => x.min > 0)
      .sort((a, b) => b.min - a.min);
    return { rows, unattributed: filter.billableOnly ? orphan.billable : orphan.total };
  }, [entrySumsAll, taskById, clients, profiles, filter]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm">
          The studio · {rows.length} designer{rows.length === 1 ? "" : "s"}
          {unattributed > 0 && (
            // Without this the cards silently account for less than the period's
            // total — most old recovered entries name nobody at all.
            <span
              className="ml-1.5 font-normal text-faint"
              title="Recovered pre-Everhour hours whose author isn't recorded. They count in the studio totals above but can't be put on anyone's card."
            >
              · {formatHoursShort(unattributed)} unattributed
            </span>
          )}
        </h2>
        <Link href="/team" className="flex shrink-0 items-center gap-1 text-xs text-brand hover:underline">
          View team <ArrowRight size={12} />
        </Link>
      </div>
      {/* half-width pane since v0.99.35 (it took the My-tasks slot), so 4 across at
          most — 8 columns here would leave each card too narrow to read */}
      {/* full-page width again (the client-trend pane merged into its neighbour),
          so the roster fits more designers per row instead of wrapping at four */}
      {/* A LIST below `sm`, cards above it. Two columns of portrait cards on a
          phone give each about 150px to spend on an avatar, a name, an hours
          figure and a bar stacked vertically — four rows of chrome per person
          and only two people per screen. Laid on their side the same four facts
          take one row each, so the whole studio fits without scrolling. */}
      <div className="flex flex-col gap-1.5 sm:grid sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-5 xl:grid-cols-7">
        {rows.map(({ p, min, pct, split, share, archived }) => (
          <Link
            key={p.id}
            href={`/team/${p.id}`}
            title={
              (share ? splitTitle(split, p.name) : `${p.name} — ${formatHoursShort(split.total)}`) +
              (archived
                ? `\n${p.endDate ? `left ${p.endDate}` : "no longer in the studio"}, but logged these hours in the period`
                : "")
            }
            // dashed border rather than a dimmed card: the hours are as real as
            // anyone else's, it's the person who is no longer on the roster
            // Same four children in the same order — only the axis changes, so
            // the desktop card is byte-identical above `sm`.
            className={`flex items-center gap-3 rounded-xl border bg-background p-2.5 hover:border-brand sm:flex-col sm:gap-1.5 sm:p-3 ${
              archived ? "border-dashed border-border-strong" : "border-border"
            }`}
          >
            <Avatar profile={p} size={40} />
            <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm font-semibold sm:max-w-full sm:flex-none sm:text-xs">
              <span className="truncate">{p.name.split(" ")[0]}</span>
              {archived && <span className="shrink-0 font-normal text-faint">·&nbsp;past</span>}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted sm:text-[10px]">
              {formatHoursShort(min)}
              {share && ` · ${pct}%`}
            </span>
            {/* A fixed 56px on the row; full width once it sits under the name.
                ⚠️ Red = the keys share, i.e. billable work written down before a
                client report. It sits between the billable head and the plain
                non-billable tail, so the bar still reads left-to-right as
                "charged → written down → internal". */}
            {share && (
              <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-border sm:w-full">
                <div className="flex h-full">
                  <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
                  <div className="h-full bg-danger" style={{ width: `${keysPct(split)}%` }} />
                </div>
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
