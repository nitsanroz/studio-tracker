"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Clock,
} from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { InfoDot } from "../ui";

// The studio's pace this month against the billable hours a workday that cover
// its costs — admins only (Nitsan and Michal watch it). The figures come from
// /api/hours-goal, which works them out from the finance P&L and returns HOURS
// ONLY; the full picture, in ₪, lives on finance-admin's Overview.
// ⚠️ The same banner as finance-admin's hours goal (src/components/
// hours-goal-card.tsx there) — keep the two looking alike. As of the 2026-10
// refresh this one is navy and finance-admin's is not yet; same content, new skin.

export interface Level {
  hours: number;
  perDay: number;
  neededPerDay: number | null;
}
export interface Goal {
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

// One request per page load, shared: the banner and the home's pace chart both
// read the goal, and two panes mounting together must not fetch it twice.
let goalRequest: Promise<Goal | null> | null = null;
function loadGoal(): Promise<Goal | null> {
  goalRequest ??= fetch("/api/hours-goal")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { goal: Goal | null } | null) => j?.goal ?? null)
    .catch(() => null);
  return goalRequest;
}

/** This month's hours goal: `undefined` while it loads, `null` when there is none.
 * The route is slow (it reads the finance P&L), so a reader that would draw
 * something else in its place has to be able to tell "not yet" from "no". */
export function useHoursGoal(): Goal | null | undefined {
  const [goal, setGoal] = useState<Goal | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadGoal().then((g) => alive && setGoal(g));
    return () => {
      alive = false;
    };
  }, []);
  return goal;
}

export function StudioPace() {
  const goal = useHoursGoal();
  if (!goal) return null;

  const month = MONTHS[goal.month - 1];
  const toGo = (l: Level) => Math.max(0, l.hours - goal.soFar);
  const away = goal.away.map(
    (a) => `${a.name} away ${a.dates.length > 1 ? `${dayLabel(a.dates[0])}–${Number(a.dates.at(-1)!.slice(8, 10))}` : dayLabel(a.dates[0])}`,
  );

  return (
    // Studio Black, white type (design-lab "Pace 2"): the one pane on the home
    // that is the studio talking about itself rather than a figure in a grid.
    // ⚠️ The status colours are the LIGHT tints below, not --success/--danger —
    // those are tuned for white and drop to ~3.5:1 on navy.
    <section className="flex items-center gap-8 rounded-[20px] bg-[#06112f] px-6 py-5 text-white shadow-[0_12px_28px_-14px_rgba(6,17,47,.6)]">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs text-white/65">
          {month} · billable hours to cover costs
          <InfoDot>
            The billable hours each workday left needs so that {month} pays for its costs; the goal also leaves a
            profit. Worked out from the finance plan, over the month&apos;s workdays — a day with someone away in the
            weekly plan counts for less.{away.length > 0 && <> Counted in: {away.join(" · ")}.</>}
          </InfoDot>
        </p>
        {goal.min.neededPerDay === 0 ? (
          <p className="mt-0.5 text-2xl font-semibold text-[#4ade80]">Costs covered ✓</p>
        ) : goal.min.neededPerDay == null ? (
          <p className="mt-0.5 text-2xl font-semibold text-[#f87171]">{h(toGo(goal.min))} short — the month&apos;s workdays are over</p>
        ) : (
          <p className="mt-0.5">
            <span className="text-3xl font-semibold tabular-nums">{h(goal.min.neededPerDay)}+</span>{" "}
            <span className="text-sm text-white/70">a workday from today</span>{" "}
            <span className="text-sm tabular-nums text-white/50">({h(toGo(goal.min))} to go)</span>
          </p>
        )}
        <p className="mt-0.5 text-xs text-white/65">
          Goal:{" "}
          {goal.goal.neededPerDay === 0 ? (
            <b className="font-semibold text-[#4ade80]">reached</b>
          ) : (
            <>
              <b className="font-semibold tabular-nums text-[#4ade80]">{h(goal.goal.neededPerDay ?? goal.goal.perDay)}</b> a workday
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
  const tone = pace == null ? "text-white/60" : pace >= goal ? "text-[#4ade80]" : pace >= min ? "text-[#fbbf24]" : "text-[#f87171]";
  return (
    <div className="w-[44%] shrink-0" role="img" aria-label="Your pace against the minimum and the goal">
      <div className="relative h-5">
        {pace != null && (
          <span
            className={`absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums ${tone}`}
            style={{ left: `clamp(2.5rem, ${at(pace)}, calc(100% - 2.5rem))` }}
          >
            {h(pace)} <span className="font-normal text-white/60">your pace</span>
          </span>
        )}
      </div>
      <div className="relative mt-1 flex h-2.5 overflow-hidden rounded-full">
        <div className="bg-[#f87171]/45" style={{ width: at(min) }} />
        <div className="bg-[#fbbf24]/45" style={{ width: `calc(${at(goal)} - ${at(min)})` }} />
        <div className="flex-1 bg-[#4ade80]/45" />
      </div>
      <div className="relative">
        {pace != null && (
          <div
            className="absolute -top-[17px] h-5 w-1 -translate-x-1/2 rounded-full bg-white ring-2 ring-[#06112f]"
            style={{ left: at(pace) }}
          />
        )}
        {[
          { v: min, cls: "text-[#f87171]" },
          { v: goal, cls: "text-[#4ade80]" },
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
      <StudioArrow size={18} className="ml-auto" />
    </Link>
  );
}
