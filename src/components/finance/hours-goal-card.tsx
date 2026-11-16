"use client";

import { BarCaret, Caret } from "@/components/caret";
import type { ReactNode } from "react";
import { InfoDot } from "@/components/finance/ui";
import { MONTH_NAMES, MONTH_SHORT } from "@/components/finance/explain-card";
import { formatILSShort, formatNum } from "@/lib/finance/format";
import type { HoursGoal } from "@/lib/finance/overview";

// ⚠️ The same banner as studio-tracker's "Studio pace" strip
// (src/components/dashboard/studio-pace.tsx there) — keep the two looking alike.

const h = (n: number) => `${formatNum(Math.round(n))}h`;
const dayLabel = (iso: string) => `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** The month in progress as one number to hit — the billable hours a workday
 * from today that cover its costs — beside a pace meter. */
export function HoursGoalCard({ goal: g }: { goal: HoursGoal }) {
  const monthName = MONTH_NAMES[g.month - 1];
  const rm = g.rateMonths;
  const rateSpan = `${MONTH_SHORT[rm[0].month - 1]}–${MONTH_SHORT[rm[rm.length - 1].month - 1]}`;
  const counted = [
    ...g.away.map(
      (a) =>
        `${a.name} away ${a.dates.length > 1 ? `${dayLabel(a.dates[0])}–${Number(a.dates.at(-1)!.slice(8, 10))}` : dayLabel(a.dates[0])}`,
    ),
    ...g.freelance.map((f) => `${f.name.split(" ")[0]} at ${Math.round(f.hours)}h logged (${formatILSShort(f.cost)}, plan said ${formatILSShort(f.planned)})`),
  ];

  return (
    <section className="mt-4 flex items-center gap-8 rounded-2xl border border-border bg-surface px-5 py-4 shadow-card">
      <GoalText
        month={monthName}
        soFar={g.soFar}
        min={g}
        goal={g.profit}
        info={
          <>
            The minimum covers {monthName}&apos;s costs: {formatILSShort(g.costs)}
            {g.projectIncome > 0 && ` less ${formatILSShort(g.projectIncome)} project fees`} at ₪{Math.round(g.rate)}/h,
            {` the ${rateSpan} average rate, over the month's workdays (holidays out).`} The goal also leaves a profit.
            &quot;From today&quot; is what each workday left needs; a day with someone away counts for less.
            {counted.length > 0 && <> Already counted in: {counted.join(" · ")}.</>}
          </>
        }
      />
      <PaceMeter pace={g.actualPerDay} min={g.perDay} goal={g.profit.perDay} />
    </section>
  );
}

interface Level {
  hours: number;
  perDay: number;
  neededPerDay: number | null;
}

function GoalText({
  month,
  soFar,
  min,
  goal,
  info,
}: {
  month: string;
  soFar: number;
  min: Level;
  goal: Level;
  info: ReactNode;
}) {
  const toGo = (l: Level) => Math.max(0, l.hours - soFar);
  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {month} · billable hours to cover costs
        <InfoDot>{info}</InfoDot>
      </p>
      {min.neededPerDay === 0 ? (
        <p className="mt-0.5 text-2xl font-semibold text-success">Costs covered ✓</p>
      ) : min.neededPerDay == null ? (
        <p className="mt-0.5 text-2xl font-semibold text-danger">{h(toGo(min))} short — the month&apos;s workdays are over</p>
      ) : (
        <p className="mt-0.5">
          <span className="text-3xl font-semibold tabular-nums">{h(min.neededPerDay)}+</span>{" "}
          <span className="text-sm text-muted">a workday from today</span>{" "}
          <span className="text-sm tabular-nums text-faint">({h(toGo(min))} to go)</span>
        </p>
      )}
      <p className="mt-0.5 text-xs text-muted">
        Goal:{" "}
        {goal.neededPerDay === 0 ? (
          <b className="font-semibold text-success">reached</b>
        ) : (
          <>
            <b className="font-semibold tabular-nums text-success">{h(goal.neededPerDay ?? goal.perDay)}</b> a workday
          </>
        )}
      </p>
    </div>
  );
}

/** A flat speedometer: your pace (hours a workday so far) as a needle over a
 * scale coloured red below the minimum, amber up to the goal, green beyond. */
function PaceMeter({ pace, min, goal }: { pace: number | null; min: number; goal: number }) {
  const top = Math.max(goal * 1.3, (pace ?? 0) * 1.1);
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  const tone = pace == null ? "text-muted" : pace >= goal ? "text-success" : pace >= min ? "text-warning" : "text-danger";
  return (
    <div className="w-[44%] shrink-0" role="img" aria-label="Your pace against the minimum and the goal">
      {/* the pace's label, then a caret pointing down at its place on the
          bar (no tick through the bar — caret.tsx) */}
      <div className="relative h-6">
        {pace != null && <BarCaret left={at(pace)} dir="down" offset={0} className={tone} />}
        {pace != null && (
          <span
            className={`absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums ${tone}`}
            style={{ left: `clamp(2.5rem, ${at(pace)}, calc(100% - 2.5rem))` }}
          >
            {h(pace)} <span className="font-normal text-muted">your pace</span>
          </span>
        )}
      </div>
      <div className="relative mt-0.5 flex h-2.5 overflow-hidden rounded-full">
        <div className="bg-[var(--danger)]/30" style={{ width: at(min) }} />
        <div className="bg-[var(--warning)]/35" style={{ width: `calc(${at(goal)} - ${at(min)})` }} />
        <div className="flex-1 bg-[var(--success)]/35" />
      </div>
      <div className="relative">
        {[
          { v: min, cls: "text-danger" },
          { v: goal, cls: "text-success" },
        ].map((m) => (
          <span
            key={m.v}
            className={`absolute top-0.5 flex -translate-x-1/2 flex-col items-center text-[11px] font-medium tabular-nums ${m.cls}`}
            style={{ left: at(m.v) }}
          >
            <Caret dir="up" size={8} />
            {h(m.v)}
          </span>
        ))}
      </div>
      <div className="h-7" />
    </div>
  );
}
