"use client";

// The admin home's headline band: the four KPI figures, and the alert that can
// sit above them.
//
// ⚠️ Each tile carries its own (i) explaining what it counts and what it
// deliberately EXCLUDES — recovered pre-Everhour rows are left out of the
// per-person figures, and a tile that quietly included them would overstate
// somebody's month by years of backfill.

import Link from "next/link";
import { InfoDot } from "../ui";
import { splitHours } from "./shared";
import type { HomeFilter } from "./shared";
import { toISODate } from "@/lib/format";
import { useData } from "@/lib/store";
import { PencilLine } from "lucide-react";
import { useMemo } from "react";


export function StatTile({
  hi = false,
  label,
  figure,
  unit = "",
  delta,
  sub,
  info,
  infoAlign,
}: {
  hi?: boolean;
  label: string;
  figure: string;
  unit?: string;
  delta?: { value: number; unit: string } | null;
  sub?: string;
  /** what the figure counts and what the delta compares — shown behind the "i" */
  info?: React.ReactNode;
  infoAlign?: "left" | "right";
}) {
  const up = delta ? delta.value >= 0 : true;
  return (
    <div
      className={`rounded-2xl border p-4 shadow-card ${hi ? "border-brand bg-brand text-white" : "border-border bg-surface"}`}
    >
      <div
        className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wide ${hi ? "text-white/80" : "text-muted"}`}
      >
        {label}
        {info && (
          <InfoDot title={label} align={infoAlign}>
            {info}
          </InfoDot>
        )}
      </div>
      <div className="mt-1.5 font-serif-accent text-[32px] leading-none">
        {figure}
        {unit && <span className="text-xl">{unit}</span>}
      </div>
      <div className={`mt-2.5 flex items-center gap-1.5 text-[11px] ${hi ? "text-white/85" : "text-muted"}`}>
        {delta ? (
          <>
            <span
              className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${
                hi ? "bg-white/20 text-white" : up ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
              }`}
            >
              {up ? "▲" : "▼"} {Math.abs(delta.value)}
              {delta.unit}
            </span>
            <span>vs last</span>
          </>
        ) : sub ? (
          <span>{sub}</span>
        ) : null}
      </div>
    </div>
  );
}


export function StatTiles({ filter, prevRange }: { filter: HomeFilter; prevRange: { from: string; to: string } | null }) {
  // entrySumsAll: "Studio hours" and "Billable" are studio-wide history and should
  // reach back to 2016 on "All time". The per-person figures below deliberately do
  // NOT — see `curLive`.
  const { entrySumsAll, tasks } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const s = useMemo(() => {
    // curAll/prevAll ignore the billable-only toggle on purpose: they are the
    // denominator of the Billable share, which is the one figure that has to stay
    // "billable out of everything" whatever the page is scoped to.
    let cur = 0,
      curAll = 0,
      curB = 0,
      prev = 0,
      prevAll = 0,
      prevB = 0,
      curLive = 0;
    const designers = new Set<string>();
    const worked = new Set<string>();
    for (const e of entrySumsAll) {
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      const counts = !filter.billableOnly || !!task?.billable;
      const inCur = !filter.range || (e.date >= filter.range.from && e.date <= filter.range.to);
      if (inCur) {
        curAll += e.minutes;
        if (task?.billable) curB += e.minutes;
        if (counts) cur += e.minutes;
        // A task was worked whoever logged it — no author gate here, or every year
        // before 2022 read "0 tasks worked" beside thousands of hours.
        if (counts && e.minutes > 0) worked.add(e.taskId);
        // The average needs a divisor, so it counts only ATTRIBUTED hours: recovered
        // entries that name a person are in (they are two thirds of the 2019 total's
        // problem solved), the authorless ones are out of both halves of the
        // fraction. This used to exclude every legacy row, which made the tile read
        // "0h · 0 designers" for any year before 2022.
        if (counts && e.minutes > 0 && e.userId) {
          curLive += e.minutes;
          designers.add(e.userId);
        }
      } else if (prevRange && e.date >= prevRange.from && e.date <= prevRange.to) {
        prevAll += e.minutes;
        if (task?.billable) prevB += e.minutes;
        if (counts) prev += e.minutes;
      }
    }
    return { cur, curAll, curB, prev, prevAll, prevB, curLive, designers: designers.size, worked: worked.size };
  }, [entrySumsAll, taskById, filter, prevRange]);

  const hoursDelta = prevRange && s.prev > 0 ? Math.round(((s.cur - s.prev) / s.prev) * 100) : null;
  const curPct = s.curAll > 0 ? Math.round((s.curB / s.curAll) * 100) : 0;
  const prevPct = s.prevAll > 0 ? Math.round((s.prevB / s.prevAll) * 100) : null;
  const pctDelta = prevPct != null ? curPct - prevPct : null;
  // Live hours over live designers. Dividing the history-inclusive total by the
  // count of people working today would report an average nobody worked.
  const perDesigner = s.designers > 0 ? s.curLive / s.designers : 0;

  const [hFig, hUnit] = splitHours(s.cur);
  const [pdFig, pdUnit] = splitHours(perDesigner, true);

  // Spelling the compared window out is the point of the "i": the previous period
  // is CLIPPED to the same elapsed portion, and a reader can only trust the delta
  // once they can see which dates it actually weighed.
  // A period in the past is already complete, so there is nothing to clip and saying
  // so would be a lie about what the dates mean.
  const todayIso = toISODate(new Date());
  const ongoing = !!filter.range && todayIso >= filter.range.from && todayIso <= filter.range.to;
  const vs = prevRange ? (
    <>
      Compared with <b>{prevRange.from} → {prevRange.to}</b>
      {ongoing ? (
        <>
          {" "}— the same stretch of the previous period, clipped to today so a
          part-finished period isn&apos;t weighed against a whole one.
        </>
      ) : (
        <> — the whole of the previous period, since this one is already complete.</>
      )}
    </>
  ) : (
    <>No comparison on &ldquo;All time&rdquo; — there is no earlier period to read it against.</>
  );
  const scope = filter.clientId ? " Limited to the selected client." : "";

  return (
    // 2×2, not a row of four: on the admin home these sit in the left half of a
    // two-column grid beside the week timesheet, so each tile keeps roughly the
    // width it had when the four spanned the page.
    <div className="grid grid-cols-2 gap-4">
      <StatTile
        hi
        label={filter.billableOnly ? "Billable hours" : "Studio hours"}
        figure={hFig}
        unit={hUnit}
        delta={hoursDelta != null ? { value: hoursDelta, unit: "%" } : null}
        sub="this period"
        info={
          <>
            Every hour logged by the whole studio in {filter.label.toLowerCase()},
            {filter.billableOnly ? " on billable tasks only" : " billable and internal alike"},
            including the recovered pre-Everhour history.{scope} {vs}
          </>
        }
      />
      <StatTile
        label="Billable"
        figure={String(curPct)}
        unit="%"
        delta={pctDelta != null ? { value: pctDelta, unit: "pp" } : null}
        sub={filter.billableOnly ? "of all hours" : "of hours"}
        info={
          <>
            Hours on billable tasks ÷ <b>all</b> hours in the period. The denominator
            ignores the &ldquo;Billable only&rdquo; toggle on purpose — scoped to billable
            hours this would otherwise read a meaningless 100%. The delta is in
            percentage points, not percent.{scope} {vs}
          </>
        }
      />
      <StatTile
        label="Tasks worked"
        figure={String(s.worked)}
        sub="this period"
        info={
          <>
            Distinct tasks that received at least one minute in {filter.label.toLowerCase()}
            {filter.billableOnly ? ", counting billable tasks only" : ""}. Not tasks
            created, and not tasks assigned. Recovered pre-Everhour work counts, whoever
            logged it.{scope}
          </>
        }
      />
      <StatTile
        label="Avg / designer"
        figure={pdFig}
        unit={pdUnit}
        sub={`${s.designers} designer${s.designers === 1 ? "" : "s"}`}
        infoAlign="right"
        info={
          <>
            Hours logged in the period ÷ the {s.designers} {s.designers === 1 ? "person" : "people"}{" "}
            who logged any. People who logged nothing are not in the divisor, so this is
            the average of those who worked, not of the roster. Hours whose author was
            never recorded — common in the recovered pre-Everhour years — are left out of
            <b> both</b> sides of the fraction, so this can read lower than the studio
            total suggests.{scope}
          </>
        }
      />
    </div>
  );
}


/** Studio-wide KPI tiles for admins: hours, billable, active tasks, avg/designer. */
/**
 * "A client changed a brief you've already handled" — on the admin home, not
 * only in the queue.
 *
 * ⚠️ Renders NOTHING when there is nothing to say (no empty state, no zero
 * count). A permanent pane reporting "0 updates" is one nobody reads by the
 * second week, which would defeat the point of putting it above the figures.
 */
export function UpdatedBriefsAlert() {
  const { updatedRequests: updated } = useData();
  if (!updated.length) return null;
  return (
    <Link
      href="/intake-queue"
      className="flex items-start gap-3 rounded-2xl border-2 border-brand/40 bg-brand/5 px-4 py-3 hover:bg-brand/10"
    >
      <PencilLine size={18} className="mt-0.5 shrink-0 text-brand" />
      <span className="min-w-0">
        <span className="block text-base font-semibold">
          {updated.length === 1
            ? "A client changed a brief"
            : `${updated.length} briefs were changed by clients`}
        </span>
        {/* Names them, so it is obvious at a glance whether this is the job
            somebody is working on today. */}
        <span className="bidi-auto block truncate text-sm text-muted">
          {updated.map((r) => r.title).join(" · ")} — see what changed
        </span>
      </span>
    </Link>
  );
}
