"use client";

// The admin home's "hours over time", as a running total (design-lab "Graphs 1").
//
// A per-day line answers "was Tuesday busy?"; a running total answers the
// question the studio actually asks of a month — "are we on track?" — because a
// reference line can sit beside it:
//   - this month, no client picked → a grey band from the line that covers
//     COSTS up to the month's GOAL, both from /api/hours-goal (the same figures
//     as the navy pace banner above), spread evenly over the Sun–Thu workdays
//   - any other period → the previous period's running total, a pale line
//
// ⚠️ THE GOAL IS IN BILLABLE HOURS, so against it the chart draws billable hours
// ONLY — all hours would flatter the studio by the whole internal share (~13%),
// and a second line there told a story the band doesn't speak to.

import { useMemo, useState } from "react";
import { DAY_NAMES, MONTH_NAMES_SHORT, formatHoursShort, isWeekend, parseISO, shiftDays, toISODate } from "@/lib/format";
import { periodRange } from "@/lib/period-math";
import { useHoursScope } from "./shared";
import type { HomeFilter } from "./shared";
import { useHoursGoal } from "./studio-pace";
import { useIsNarrow } from "@/lib/use-is-narrow";

const PAD = { l: 48, r: 18, t: 16, b: 30 };

const ALL_COLOR = "#0b43ed";
const BILL_COLOR = "#0ea5c6";

/** Every date from → to inclusive, as ISO strings. Calendar steps, never ms. */
function daysOf(range: { from: string; to: string }): string[] {
  const out: string[] = [];
  const end = parseISO(range.to);
  for (let d = parseISO(range.from); d <= end; d = shiftDays(d, 1)) out.push(toISODate(d));
  return out;
}

/** Running totals (minutes) per day, for all hours and the billable subset. */
function useRunning(filter: HomeFilter, days: string[]) {
  const { scoped, taskById } = useHoursScope(filter, true);
  return useMemo(() => {
    const all = new Map<string, number>();
    const bill = new Map<string, number>();
    for (const e of scoped) {
      all.set(e.date, (all.get(e.date) ?? 0) + e.minutes);
      if (taskById.get(e.taskId)?.billable) bill.set(e.date, (bill.get(e.date) ?? 0) + e.minutes);
    }
    let a = 0;
    let b = 0;
    const runAll: number[] = [];
    const runBill: number[] = [];
    for (const d of days) {
      a += all.get(d) ?? 0;
      b += bill.get(d) ?? 0;
      runAll.push(a);
      runBill.push(b);
    }
    return { runAll, runBill };
  }, [scoped, taskById, days]);
}

/** A tick step that gives at most five gridlines. */
function niceStep(maxHours: number): number {
  for (const s of [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) if (maxHours / s <= 5) return s;
  return 25000;
}

export function PaceChart({
  filter,
  prevRange,
  prevLabel,
}: {
  filter: HomeFilter & { range: { from: string; to: string } };
  /** The WHOLE previous period — not truncated to today, so its line runs to the end. */
  prevRange: { from: string; to: string } | null;
  /** e.g. "Last month", for the legend and the chip */
  prevLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const goal = useHoursGoal();
  // The SVG scales to its pane, text included — so the drawing is sized near
  // the pane's real width, or a phone would show 12px labels at about 5px.
  const narrow = useIsNarrow();
  const W = narrow ? 400 : 760;
  const H = narrow ? 230 : 260;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const days = useMemo(() => daysOf(filter.range), [filter.range]);
  const prevDays = useMemo(() => (prevRange ? daysOf(prevRange) : []), [prevRange]);
  // No previous period → an empty range rather than null, which would mean "all time".
  const prevFilter = useMemo(() => ({ ...filter, range: prevRange ?? { from: "", to: "" } }), [filter, prevRange]);
  const cur = useRunning(filter, days);
  const prev = useRunning(prevFilter, prevDays);

  const todayIso = toISODate(new Date());
  // The last day that has HAPPENED — a running total drawn into the future would
  // read as a flat line, i.e. as the studio stopping.
  const lastIdx = days.findLastIndex((d) => d <= todayIso);

  // The goal only describes the current month, the whole studio, and every task.
  const thisMonth = periodRange("This month", 0);
  const isThisMonth = filter.range.from === thisMonth?.from && filter.range.to === thisMonth?.to;
  const goalApplies = isThisMonth && !filter.clientId;
  const showGoal = !!goal && goalApplies;
  // Still fetching a goal that would apply: draw no reference line yet, rather
  // than last month's for a few seconds and then swap it out under the reader.
  const showPrev = !goalApplies || goal === null;

  const goalRuns = useMemo(() => {
    if (!showGoal || !goal) return null;
    const isWork = days.map((d) => !isWeekend(parseISO(d)));
    const total = isWork.filter(Boolean).length || 1;
    let n = 0;
    const share = isWork.map((w) => (n += w ? 1 : 0) / total);
    return { goal: share.map((s) => s * goal.goal.hours * 60), costs: share.map((s) => s * goal.min.hours * 60) };
  }, [showGoal, goal, days]);

  // ⚠️ AGAINST THE GOAL THE CHART IS BILLABLE HOURS ONLY (Nitsan, 2026-10-23).
  // The goal and the costs line are both billable figures, so an all-hours line
  // beside them was a second story the reference lines don't speak to. Every
  // other period keeps all hours with billable beside it. `goalRuns` is THE
  // switch — it exists exactly when the goal is drawn.
  const main = goalRuns ? cur.runBill : cur.runAll;
  const reached = lastIdx >= 0 ? main[lastIdx] : 0;
  const showBill = !goalRuns && !filter.billableOnly;

  const maxMin = Math.max(
    60,
    reached,
    goalRuns ? goalRuns.goal.at(-1)! : 0,
    showPrev ? (prev.runAll.at(-1) ?? 0) : 0,
  );
  const step = niceStep((maxMin / 60) * 1.08);
  const yMaxH = Math.ceil(((maxMin / 60) * 1.08) / step) * step;
  const x = (i: number) => PAD.l + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const y = (minutes: number) => PAD.t + plotH - (minutes / 60 / yMaxH) * plotH;
  const path = (vals: number[], upTo = vals.length - 1) =>
    vals
      .slice(0, upTo + 1)
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");

  // Headline chip: billable against the goal's pace, or all hours against the
  // same point of the previous period.
  let chip: { text: string; good: boolean; title: string } | null = null;
  if (goalRuns && lastIdx >= 0 && goalRuns.goal[lastIdx] > 0) {
    const pct = Math.round((reached / goalRuns.goal[lastIdx] - 1) * 100);
    chip = {
      text: `Billable ${Math.abs(pct)}% ${pct >= 0 ? "ahead of" : "behind"} goal pace`,
      good: pct >= 0,
      title: `Billable hours so far (${formatHoursShort(reached)}) against where the month's goal would be today if it were spread evenly over the Sun–Thu workdays (${formatHoursShort(goalRuns.goal[lastIdx])}).`,
    };
  } else if (showPrev && lastIdx >= 0 && prev.runAll.length) {
    const at = prev.runAll[Math.min(lastIdx, prev.runAll.length - 1)];
    if (at > 0) {
      const pct = Math.round((reached / at - 1) * 100);
      chip = {
        text: `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}% vs ${prevLabel.toLowerCase()}`,
        good: pct >= 0,
        title: `${formatHoursShort(reached)} so far against ${formatHoursShort(at)} at the same point of ${prevLabel.toLowerCase()}.`,
      };
    }
  }

  // x labels: day names for a week, a weekly date for a month, months for a year
  const xLabels: { i: number; text: string }[] = [];
  days.forEach((iso, i) => {
    const d = parseISO(iso);
    if (days.length <= 7) xLabels.push({ i, text: `${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getDate()}` });
    else if (days.length <= 31) {
      if (i % 7 === 0) xLabels.push({ i, text: `${d.getDate()}/${d.getMonth() + 1}` });
    } else if (d.getDate() === 1 && (!narrow || d.getMonth() % 2 === 0))
      xLabels.push({ i, text: MONTH_NAMES_SHORT[d.getMonth()] });
  });
  const slot = days.length > 1 ? plotW / (days.length - 1) : plotW;

  const tip = hover == null ? null : (() => {
    const done = hover <= lastIdx;
    const rows: { label: string; value: string; color?: string }[] = [];
    if (done) rows.push({ label: goalRuns ? "Billable" : "All hours", value: formatHoursShort(main[hover]), color: ALL_COLOR });
    if (done && showBill) rows.push({ label: "Billable", value: formatHoursShort(cur.runBill[hover]), color: BILL_COLOR });
    if (goalRuns) {
      rows.push({ label: "Goal pace", value: formatHoursShort(goalRuns.goal[hover]) });
      rows.push({ label: "Covers costs", value: formatHoursShort(goalRuns.costs[hover]) });
    } else if (showPrev && prev.runAll[hover] != null) {
      rows.push({ label: prevLabel, value: formatHoursShort(prev.runAll[hover]) });
    }
    const d = parseISO(days[hover]);
    return { left: (x(hover) / W) * 100, title: `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, rows, done };
  })();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-serif-accent text-[34px] leading-none">{formatHoursShort(reached)}</span>
          {goalRuns && <span className="-ml-1.5 text-sm text-muted">billable</span>}
          {chip && (
            <span
              title={chip.title}
              className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
                chip.good ? "bg-success/10 text-success" : "bg-warning/15 text-[#855800]"
              }`}
            >
              {chip.text}
            </span>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-muted">
          <Key color={ALL_COLOR} label={goalRuns ? "Billable hours" : "All hours"} />
          {showBill && <Key color={BILL_COLOR} label="Billable" />}
          {goalRuns ? (
            <Key band label={`Covers costs ${Math.round(goalRuns.costs.at(-1)! / 60)}h → goal ${Math.round(goalRuns.goal.at(-1)! / 60)}h`} />
          ) : (
            showPrev && prevRange && <Key grey label={prevLabel} />
          )}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Running total of hours, ${filter.label.toLowerCase()}`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="pace-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={ALL_COLOR} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ALL_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* No weekend strips (2026-10-23): with the goal drawn as a band they
              were a second set of grey shapes and the two clashed. */}

          {Array.from({ length: yMaxH / step + 1 }, (_, k) => k * step).map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t * 60)} y2={y(t * 60)} style={{ stroke: "var(--color-border)" }} strokeWidth={1} />
              <text x={PAD.l - 10} y={y(t * 60) + 4} textAnchor="end" fontSize={12} style={{ fill: "var(--color-faint)" }}>
                {t ? `${t.toLocaleString("en-US")}h` : "0"}
              </text>
            </g>
          ))}
          {xLabels.map((l) => (
            <text key={l.i} x={x(l.i)} y={H - 8} textAnchor="middle" fontSize={12} style={{ fill: "var(--color-faint)" }}>
              {l.text}
            </text>
          ))}

          {/* reference first, so the real line sits on top.
              ⚠️ THE GOAL IS A BAND, NOT TWO DASHED LINES (Nitsan, 2026-10-23:
              dashes were noise). Grey between "covers costs" and "the goal" —
              under the band is short of costs, inside it covers them, over it
              is past the goal — with each edge named once at the right. */}
          {goalRuns ? (
            <>
              <path
                d={`${path(goalRuns.goal)} ${goalRuns.costs
                  .map((v, i) => [x(i), y(v)] as const)
                  .reverse()
                  .map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`)
                  .join(" ")} Z`}
                style={{ fill: "var(--color-foreground)" }}
                fillOpacity={0.07}
              />
              <text x={W - PAD.r} y={y(goalRuns.goal.at(-1)!) - 7} textAnchor="end" fontSize={12} style={{ fill: "var(--color-muted)" }}>
                Goal {Math.round(goalRuns.goal.at(-1)! / 60)}h
              </text>
              <text x={W - PAD.r} y={y(goalRuns.costs.at(-1)!) + 16} textAnchor="end" fontSize={12} style={{ fill: "var(--color-muted)" }}>
                Covers costs {Math.round(goalRuns.costs.at(-1)! / 60)}h
              </text>
            </>
          ) : (
            showPrev && prev.runAll.length > 0 && (
              <path d={path(prev.runAll.slice(0, days.length))} fill="none" style={{ stroke: "var(--color-foreground)" }} strokeOpacity={0.2} strokeWidth={2} strokeLinejoin="round" />
            )
          )}

          {lastIdx >= 0 && (
            <>
              <path d={`${path(main, lastIdx)} L${x(lastIdx)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#pace-fill)" />
              {showBill && <path d={path(cur.runBill, lastIdx)} fill="none" stroke={BILL_COLOR} strokeWidth={2.5} strokeLinejoin="round" />}
              <path d={path(main, lastIdx)} fill="none" stroke={ALL_COLOR} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(lastIdx)} cy={y(reached)} r={5} fill={ALL_COLOR} stroke="white" strokeWidth={2.5} />
            </>
          )}

          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} style={{ stroke: "var(--color-foreground)" }} strokeOpacity={0.25} />
          )}
          {/* ONE invisible plate catches the pointer and works out the day —
              a rect per day was 365 nodes (and closures) re-rendered on every
              move across "This year". */}
          <rect
            x={PAD.l - slot / 2}
            y={PAD.t}
            width={plotW + slot}
            height={plotH}
            fill="transparent"
            onMouseMove={(e) => {
              const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
              const sx = ((e.clientX - box.left) / box.width) * W;
              const i = days.length === 1 ? 0 : Math.round((sx - PAD.l) / slot);
              const next = Math.max(0, Math.min(days.length - 1, i));
              if (next !== hover) setHover(next);
            }}
          />
        </svg>

        {tip && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[170px] rounded-xl bg-[#06112f] px-3 py-2.5 text-xs text-white shadow-xl"
            style={tip.left > 55 ? { right: `${100 - tip.left + 2}%` } : { left: `${tip.left + 2}%` }}
          >
            <div className="mb-1.5 font-medium">{tip.title}</div>
            {!tip.done && <div className="mb-1 text-white/50">Still to come</div>}
            {tip.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 tabular-nums">
                <span className="flex items-center gap-1.5 text-white/70">
                  <span
                    className="inline-block h-0.5 w-3"
                    style={{ backgroundColor: r.color ?? "rgba(255,255,255,.45)" }}
                  />
                  {r.label}
                </span>
                <span className="font-medium">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A legend swatch: a line in `color`, a pale grey line (`grey`), or the goal's
 *  grey band (`band`). No dashes anywhere — see the band's note above. */
function Key({ color, label, grey, band }: { color?: string; label: string; grey?: boolean; band?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-3.5"
        style={
          band
            ? { height: 10, borderRadius: 2, backgroundColor: "var(--color-foreground)", opacity: 0.12 }
            : { height: 3, borderRadius: 3, backgroundColor: color ?? "var(--color-foreground)", opacity: grey ? 0.25 : 1 }
        }
      />
      {label}
    </span>
  );
}
