"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { InfoDot } from "../ui";

// The studio's pace this month against the billable hours a workday that cover
// its costs — admins only (Nitsan and Michal watch it). The figures come from
// /api/hours-goal, which works them out from the finance P&L and returns HOURS
// ONLY; the full picture, in ₪, lives on finance-admin's Overview.
// ⚠️ The same banner as finance-admin's hours goal (src/components/
// hours-goal-card.tsx there) — keep the two looking alike.

interface Level {
  hours: number;
  perDay: number;
  neededPerDay: number | null;
}
interface Goal {
  month: number;
  soFar: number;
  pace: number | null;
  min: Level;
  goal: Level;
  away: { name: string; dates: string[] }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const h = (n: number) => `${Math.round(n).toLocaleString("en-US")}h`;
const dayLabel = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export function StudioPace() {
  const [goal, setGoal] = useState<Goal | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/hours-goal")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { goal: Goal | null } | null) => alive && setGoal(j?.goal ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!goal) return null;

  const month = MONTHS[goal.month - 1];
  const toGo = (l: Level) => Math.max(0, l.hours - goal.soFar);
  const away = goal.away.map(
    (a) => `${a.name} away ${a.dates.length > 1 ? `${dayLabel(a.dates[0])}–${Number(a.dates.at(-1)!.slice(8, 10))}` : dayLabel(a.dates[0])}`,
  );

  return (
    <section className="flex items-center gap-8 rounded-2xl border border-border bg-surface px-5 py-4 shadow-card">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          {month} · billable hours to cover costs
          <InfoDot>
            The billable hours each workday left needs so that {month} pays for its costs; the goal also leaves a
            profit. Worked out from the finance plan, over the month&apos;s workdays — a day with someone away in the
            weekly plan counts for less.{away.length > 0 && <> Counted in: {away.join(" · ")}.</>}
          </InfoDot>
        </p>
        {goal.min.neededPerDay === 0 ? (
          <p className="mt-0.5 text-2xl font-semibold text-success">Costs covered ✓</p>
        ) : goal.min.neededPerDay == null ? (
          <p className="mt-0.5 text-2xl font-semibold text-danger">{h(toGo(goal.min))} short — the month&apos;s workdays are over</p>
        ) : (
          <p className="mt-0.5">
            <span className="text-3xl font-semibold tabular-nums">{h(goal.min.neededPerDay)}+</span>{" "}
            <span className="text-sm text-muted">a workday from today</span>{" "}
            <span className="text-sm tabular-nums text-faint">({h(toGo(goal.min))} to go)</span>
          </p>
        )}
        <p className="mt-0.5 text-xs text-muted">
          Goal:{" "}
          {goal.goal.neededPerDay === 0 ? (
            <b className="font-semibold text-success">reached</b>
          ) : (
            <>
              <b className="font-semibold tabular-nums text-success">{h(goal.goal.neededPerDay ?? goal.goal.perDay)}</b> a workday
            </>
          )}
        </p>
      </div>
      <PaceMeter pace={goal.pace} min={goal.min.perDay} goal={goal.goal.perDay} />
    </section>
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
      <div className="relative h-5">
        {pace != null && (
          <span
            className={`absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums ${tone}`}
            style={{ left: `clamp(2.5rem, ${at(pace)}, calc(100% - 2.5rem))` }}
          >
            {h(pace)} <span className="font-normal text-muted">your pace</span>
          </span>
        )}
      </div>
      <div className="relative mt-1 flex h-2.5 overflow-hidden rounded-full">
        <div className="bg-[var(--danger)]/30" style={{ width: at(min) }} />
        <div className="bg-[var(--warning)]/35" style={{ width: `calc(${at(goal)} - ${at(min)})` }} />
        <div className="flex-1 bg-[var(--success)]/35" />
      </div>
      <div className="relative">
        {pace != null && (
          <div
            className="absolute -top-[17px] h-5 w-1 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-surface"
            style={{ left: at(pace) }}
          />
        )}
        {[
          { v: min, cls: "text-danger" },
          { v: goal, cls: "text-success" },
        ].map((m) => (
          <span
            key={m.v}
            className={`absolute top-1 -translate-x-1/2 text-[11px] font-medium tabular-nums ${m.cls}`}
            style={{ left: at(m.v) }}
          >
            {h(m.v)}
          </span>
        ))}
      </div>
      <div className="h-5" />
    </div>
  );
}

/** Freelancers' logs waiting for review (0054) — a nudge on the admin home, in
 * the voice of the intake alert beside it. Nothing when there are none. */
export function FreelancerLogsAlert() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/freelancers?count=1")
      .then((r) => (r.ok ? r.json() : { pending: 0 }))
      .then((j: { pending?: number }) => alive && setPending(j.pending ?? 0))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (pending === 0) return null;
  return (
    <Link
      href="/freelancers"
      className="flex items-center gap-2 rounded-xl border-2 border-warning/40 bg-warning/10 px-4 py-3 text-sm font-semibold hover:bg-warning/15"
    >
      <Clock size={16} strokeWidth={2} className="text-warning" />
      {pending} freelancer log{pending > 1 ? "s" : ""} waiting for review
      <ArrowRight size={15} className="ml-auto" />
    </Link>
  );
}
