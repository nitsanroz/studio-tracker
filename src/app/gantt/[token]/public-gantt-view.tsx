"use client";

import { useMemo, useRef, useState } from "react";
import {
  BAR_H,
  BAR_LABEL_MIN_PX,
  BAR_R,
  DIAMOND,
  PX_PER_DAY,
  ROW_H,
  SECTION_BAR_H,
  SECTION_H,
  SHADE_MIN_PX_PER_DAY,
  TIP_H,
  TIP_MIN_W,
  TIP_W,
  dateRangeLabel,
  daysBetween,
  isWorkDay,
  parseISO,
  shiftDays,
  ticksFor,
  toISO,
  workDaysBetween,
  type Zoom,
} from "@/lib/gantt";

export interface PublicGanttTask {
  id: string;
  title: string;
  sectionId: string | null;
  startDate: string | null;
  dueDate: string;
  typeName: string | null;
  typeColor: string | null;
  order: number | null;
}

export interface PublicGanttGroup {
  key: string;
  name: string;
  rank: number;
  tasks: PublicGanttTask[];
}

const NAME_W = 240;
const DATES_W = 116;
const STICKY_W = NAME_W + DATES_W;
const FALLBACK = "#0b43ed";

/**
 * The client's view of the plan.
 *
 * Same geometry as the studio's Timeline — `@/lib/gantt` is the single source
 * for both, so a bar cannot land on a different day here — and deliberately
 * less of everything else. There are no hours, no status, no assignees and no
 * controls beyond the zoom: the page never receives those fields (see the
 * `select` in page.tsx), so there is nothing to hide, only nothing to show.
 */
export function PublicGanttView({
  clientName,
  clientColor,
  clientIcon,
  clientIconUrl,
  groups,
  offDays,
}: {
  clientName: string;
  clientColor: string;
  clientIcon: string | null;
  clientIconUrl: string | null;
  groups: PublicGanttGroup[];
  offDays: { from: string; to: string; label: string }[];
}) {
  const [zoom, setZoom] = useState<Zoom>("day");
  const scroller = useRef<HTMLDivElement>(null);
  const centred = useRef(false);
  const [tip, setTip] = useState<{ x: number; y: number; task: PublicGanttTask } | null>(null);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const off = useMemo(() => {
    const dates = new Set<string>();
    for (const d of offDays) {
      const from = parseISO(d.from);
      const span = daysBetween(from, parseISO(d.to));
      for (let i = 0; i <= Math.min(span, 400); i++) dates.add(toISO(shiftDays(from, i)));
    }
    return dates;
  }, [offDays]);

  /** Every row's resolved dates. A task with no start is a DEADLINE, not a one-day job. */
  const rows = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        rows: g.tasks.map((t) => {
          const due = parseISO(t.dueDate);
          return {
            task: t,
            start: t.startDate ? parseISO(t.startDate) : due,
            due,
            hasStart: !!t.startDate,
          };
        }),
      })),
    [groups],
  );

  const all = rows.flatMap((g) => g.rows);

  const { from, totalDays } = useMemo(() => {
    const marks: Date[] = [today];
    for (const r of all) marks.push(r.start, r.due);
    let min = marks[0];
    let max = marks[0];
    for (const d of marks) {
      if (d < min) min = d;
      if (d > max) max = d;
    }
    let start = shiftDays(min, -7);
    // snap to a Sunday (the studio's week starts Sunday) so week columns line up
    if (zoom !== "day") start = shiftDays(start, -start.getDay());
    const end = shiftDays(max, 7);
    return {
      from: start,
      totalDays: Math.max(daysBetween(start, end), zoom === "month" ? 365 : 91),
    };
  }, [all, today, zoom]);

  const pxPerDay = PX_PER_DAY[zoom];
  const chartW = totalDays * pxPerDay;
  const { ticks } = ticksFor(from, totalDays, zoom, pxPerDay);
  const bodyH = rows.reduce((h, g) => h + SECTION_H + g.rows.length * ROW_H, 0);
  const todayLeft = daysBetween(from, today) * pxPerDay;

  /** Open on today rather than on the oldest thing anyone ever scheduled. */
  function onScrollerReady(el: HTMLDivElement | null) {
    scroller.current = el;
    if (!el || centred.current) return;
    centred.current = true;
    el.scrollLeft = Math.max(0, todayLeft - el.clientWidth / 3);
  }

  const shade = pxPerDay >= SHADE_MIN_PX_PER_DAY;
  const offCols: number[] = [];
  if (shade) {
    for (let d = 0; d < totalDays; d++) {
      if (!isWorkDay(shiftDays(from, d), off)) offCols.push(d * pxPerDay);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1500px] flex-col gap-4 p-4 sm:p-8">
      <header className="flex items-center gap-3">
        {clientIconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clientIconUrl}
            alt=""
            className="size-10 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white"
            style={{ backgroundColor: clientColor }}
          >
            {clientIcon || clientName[0]}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <h1 className="truncate text-2xl font-bold leading-tight tracking-tight">{clientName}</h1>
          <span className="text-xs text-muted">Schedule · updates automatically</span>
        </span>
        <div className="ml-auto flex rounded-lg border border-border bg-surface p-0.5">
          {(["day", "week", "month"] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                z === zoom ? "bg-brand-soft text-brand-dark" : "text-muted hover:text-foreground"
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div ref={onScrollerReady} className="max-h-[min(78vh,760px)] overflow-auto">
          <div className="relative" style={{ width: STICKY_W + chartW }}>
            {/* header */}
            <div className="sticky top-0 z-30 border-b border-border bg-surface">
              <div className="relative flex h-7 items-center">
                <span
                  className="sticky left-0 z-10 flex h-full shrink-0 items-center bg-surface pl-3 text-[10px] font-medium uppercase tracking-wide text-faint"
                  style={{ width: STICKY_W }}
                >
                  Task
                </span>
                <span className="relative h-full flex-1 border-l border-border">
                  {ticks.map((t) => (
                    <span
                      key={t.left}
                      className={`absolute top-0 flex h-full items-center truncate px-1 text-[10px] ${
                        t.boundary
                          ? "border-l border-foreground/15 font-semibold text-foreground"
                          : `tabular-nums ${
                              zoom === "day" && !isWorkDay(shiftDays(from, Math.round(t.left / pxPerDay)), off)
                                ? "text-faint/60"
                                : "text-muted"
                            }`
                      }`}
                      style={{ left: t.left, width: t.width }}
                    >
                      {t.label}
                    </span>
                  ))}
                </span>
              </div>
            </div>

            {/* the calendar behind the rows */}
            <div
              className="pointer-events-none absolute top-7 z-0"
              style={{ left: STICKY_W, width: chartW, height: bodyH }}
              aria-hidden
            >
              {offCols.map((left) => (
                <div
                  key={left}
                  className="absolute top-0 h-full bg-foreground/[0.045]"
                  style={{ left, width: pxPerDay }}
                />
              ))}
              {ticks.map((t) => (
                <div
                  key={t.left}
                  className={`absolute top-0 h-full border-l ${
                    t.boundary
                      ? "border-foreground/15"
                      : t.weekStart
                        ? "border-foreground/[0.07]"
                        : "border-border/40"
                  }`}
                  style={{ left: t.left }}
                />
              ))}
              {todayLeft >= 0 && todayLeft <= chartW && (
                <div
                  className="absolute top-0 h-full border-l-2 border-brand/70"
                  style={{ left: todayLeft }}
                />
              )}
            </div>

            {rows.map((g) => {
              const gStart = g.rows.reduce((a, r) => (r.start < a ? r.start : a), g.rows[0].start);
              const gDue = g.rows.reduce((a, r) => (r.due > a ? r.due : a), g.rows[0].due);
              const gLeft = daysBetween(from, gStart) * pxPerDay;
              const gWidth = Math.max(8, (daysBetween(gStart, gDue) + 1) * pxPerDay);
              return (
                <div key={g.key || "none"}>
                  <div
                    className="relative flex border-b border-border"
                    style={{ height: SECTION_H, width: STICKY_W + chartW }}
                  >
                    <div
                      className="sticky left-0 z-20 flex h-full shrink-0 items-center bg-surface px-3 text-sm font-semibold"
                      style={{ width: STICKY_W }}
                    >
                      <span className="bidi-auto truncate">{g.name}</span>
                    </div>
                    <div className="relative h-full shrink-0" style={{ width: chartW }}>
                      <span
                        className="absolute"
                        style={{ left: gLeft, width: gWidth, top: `calc(50% - ${SECTION_BAR_H / 2}px)` }}
                      >
                        <span
                          className="absolute inset-x-0 top-0 rounded-[1px]"
                          style={{ height: SECTION_BAR_H, backgroundColor: clientColor, opacity: 0.85 }}
                        />
                        {gWidth >= TIP_MIN_W && (
                          <>
                            <span
                              className="absolute left-0 top-0"
                              style={{
                                borderTop: `${TIP_H}px solid ${clientColor}`,
                                borderRight: `${TIP_W}px solid transparent`,
                                opacity: 0.85,
                              }}
                            />
                            <span
                              className="absolute top-0"
                              style={{
                                left: gWidth - TIP_W,
                                borderTop: `${TIP_H}px solid ${clientColor}`,
                                borderLeft: `${TIP_W}px solid transparent`,
                                opacity: 0.85,
                              }}
                            />
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {g.rows.map((r) => {
                    const color = r.task.typeColor ?? FALLBACK;
                    const left = daysBetween(from, r.start) * pxPerDay;
                    const barW = Math.max(10, (daysBetween(r.start, r.due) + 1) * pxPerDay);
                    return (
                      <div
                        key={r.task.id}
                        className="relative flex border-b border-border last:border-b-0"
                        style={{ height: ROW_H, width: STICKY_W + chartW }}
                      >
                        <div
                          className="sticky left-0 z-20 flex h-full shrink-0 items-center gap-2 bg-surface px-3"
                          style={{ width: STICKY_W }}
                        >
                          <span
                            className="bidi-auto min-w-0 flex-1 truncate text-xs"
                            title={r.task.title}
                          >
                            {r.task.title}
                          </span>
                          <span
                            className="shrink-0 text-[11px] tabular-nums text-muted"
                            style={{ width: DATES_W - 24 }}
                          >
                            {dateRangeLabel(r.start, r.due, r.hasStart)}
                          </span>
                        </div>
                        <div className="relative h-full shrink-0" style={{ width: chartW }}>
                          {r.hasStart ? (
                            <div
                              onMouseEnter={(e) =>
                                setTip({ x: e.clientX, y: e.clientY, task: r.task })
                              }
                              onMouseLeave={() => setTip(null)}
                              className="absolute top-1/2 -translate-y-1/2 overflow-hidden"
                              style={{
                                left,
                                width: barW,
                                height: BAR_H,
                                borderRadius: BAR_R,
                                backgroundColor: `${color}52`,
                              }}
                            >
                              {barW >= BAR_LABEL_MIN_PX && (
                                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center truncate px-1.5 text-[11px] font-medium leading-none text-foreground">
                                  {r.task.title}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div
                              onMouseEnter={(e) =>
                                setTip({ x: e.clientX, y: e.clientY, task: r.task })
                              }
                              onMouseLeave={() => setTip(null)}
                              className="absolute top-1/2 -translate-y-1/2 rotate-45 rounded-[2px]"
                              style={{
                                left: left + Math.max(0, pxPerDay / 2 - DIAMOND / 2),
                                width: DIAMOND,
                                height: DIAMOND,
                                backgroundColor: color,
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-xs text-faint">
        Open work only, and only what has a date. A diamond is a deadline with no start date yet.
      </p>

      {tip && <Tip x={tip.x} y={tip.y} task={tip.task} off={off} />}
    </main>
  );
}

/** The same three-band tooltip as the studio's chart, minus the hours. */
function Tip({
  x,
  y,
  task,
  off,
}: {
  x: number;
  y: number;
  task: PublicGanttTask;
  off: Set<string>;
}) {
  const due = parseISO(task.dueDate);
  const start = task.startDate ? parseISO(task.startDate) : due;
  const hasStart = !!task.startDate;
  const color = task.typeColor ?? FALLBACK;
  const left = Math.min(Math.max(8, x + 12), window.innerWidth - 252);
  const below = y + 18;
  const flip = below + 120 > window.innerHeight;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-[244px] overflow-hidden rounded-xl border border-border bg-surface text-[11px] leading-normal shadow-xl"
      style={{ left, top: flip ? y - 12 : below, transform: flip ? "translateY(-100%)" : undefined }}
    >
      <div className="px-3 py-1.5" style={{ backgroundColor: `${color}29` }}>
        <div className="text-[13px] font-semibold leading-tight text-foreground">{task.title}</div>
        {task.typeName && <div className="leading-tight text-muted">{task.typeName}</div>}
      </div>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="shrink-0 text-faint">{hasStart ? "Dates" : "Due"}</span>
          <span className="truncate tabular-nums text-foreground">
            {dateRangeLabel(start, due, hasStart)}
          </span>
        </div>
        {hasStart && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-faint">Duration</span>
            <span className="truncate tabular-nums text-foreground">
              {(() => {
                const n = workDaysBetween(start, due, off);
                return `${n} working day${n === 1 ? "" : "s"}`;
              })()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
