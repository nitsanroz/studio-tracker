"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  /** Budgeted hours — the agreed scope, never the hours spent against it. */
  budgetHours: number | null;
}

export interface PublicGanttGroup {
  key: string;
  name: string;
  rank: number;
  tasks: PublicGanttTask[];
}

/**
 * The pinned column is the task's name and its budget. There is no Dates column:
 * it repeated, in text, what the bar beside it already says in position and
 * length, and it was the widest thing competing with the chart for a screen the
 * client is reading on. The exact dates are in the bar's tooltip.
 */
const NAME_W = 260;
/** On a phone, 260px of task name leaves ~40px of calendar — so the pinned
 *  column has to give way. It is the ONLY responsive dimension here: the bars
 *  are drawn at a fixed px-per-day so the chart can be read the same way on
 *  every screen, and it scrolls. */
const NAME_W_NARROW = 150;
const NARROW_PX = 640;
const BUDGET_W = 56;
const FALLBACK = "#0b43ed";

/** Server-rendered wide, corrected on mount — the width is a browser fact. */
function useStickyWidth() {
  const [nameW, setNameW] = useState(NAME_W);
  useEffect(() => {
    const apply = () => setNameW(window.innerWidth < NARROW_PX ? NAME_W_NARROW : NAME_W);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  return nameW + BUDGET_W;
}

/**
 * The client's view of the plan.
 *
 * Same geometry as the studio's Timeline — `@/lib/gantt` is the single source
 * for both, so a bar cannot land on a different day here — and deliberately
 * less of everything else. There are no LOGGED hours, no status, no assignees
 * and no controls beyond the zoom: the page never receives those fields (see
 * the `select` in page.tsx), so there is nothing to hide, only nothing to show.
 * The budget IS shown — it is the scope the client agreed to, and it says
 * nothing about how much of it has been used.
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
  const STICKY_W = useStickyWidth();
  // Day zoom on a phone shows five days, which reads as an empty plan. Only on
  // MOUNT — rotating the device must not overrule a zoom the reader picked.
  useEffect(() => {
    if (window.innerWidth < NARROW_PX) setZoom("week");
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const centred = useRef(false);
  const [tip, setTip] = useState<{ x: number; y: number; task: PublicGanttTask } | null>(null);
  /** Section keys the reader has folded away. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fold = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
  const bodyH = rows.reduce(
    (h, g) => h + SECTION_H + (collapsed.has(g.key) ? 0 : g.rows.length * ROW_H),
    0,
  );
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
    // ⚠️ `w-full min-w-0`. `body` is `display: flex`, so this is a FLEX ITEM,
    // and a flex item's automatic minimum size is its MIN-CONTENT — which here
    // is the 4000px-wide chart. Without this the whole page grew to 1500px on a
    // 1180px screen, scrolled horizontally as a document, and pushed the studio
    // wordmark clean off the right edge. The card's own scroller is what should
    // absorb a wide chart, and it can only do that once this can shrink.
    // The width cap is DELIBERATELY wider than the app's own 1500px. Every
    // other page is reading-width text and tables; this page is one chart that
    // is always wider than the window (91 days × 26px at day zoom = 2.4k), so
    // every pixel given to it is another day the client can see without
    // scrolling. Capped at all only so it doesn't stretch absurdly on a 34"
    // ultrawide.
    // ⚠️ `h-dvh`, NOT `min-h-screen`. A minimum height is not a height, so the
    // card below grew to its own content (1700px of rows on Anchor) and the
    // PAGE scrolled — which is exactly what the card's own scroller exists to
    // prevent. A definite height is what makes `flex-1` cap the card instead
    // of merely letting it grow. `dvh` so a phone's collapsing URL bar doesn't
    // leave a dead strip.
    <main className="mx-auto flex h-dvh w-full min-w-0 max-w-[2200px] flex-col gap-4 p-4 sm:p-8">
      {/* Three tracks so the zoom control is centred on the ROW, not in whatever
          space the two ends happen to leave — the same reason the app's tab
          strip is a grid. That is right on a desktop and impossible on a phone:
          at 375px the middle track squeezed the client's own name to nothing
          and the wordmark sat on top of it. Below `sm` it wraps to two rows —
          name, then zoom and wordmark at either end. */}
      <header className="flex flex-wrap items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
        {clientIconUrl ? (
          // `brightness(0)` paints every opaque pixel black while keeping the
          // alpha, because these marks are drawn WHITE for the coloured tile
          // they sit on inside the app — on this page there is no tile, so the
          // logo was white on white and simply absent.
          // eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL, no loader configured
          <img
            src={clientIconUrl}
            alt=""
            className="size-10 shrink-0 object-contain"
            style={{ filter: "brightness(0)" }}
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
        </div>
        <div className="mr-auto flex justify-center rounded-lg border border-border bg-surface p-0.5 sm:mr-0">
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
        {/* Whose plan this is. The mask + `bg-brand` is how every other public
            page (intake, password reset) draws the wordmark. */}
        <span
          className="brand-wordmark w-24 shrink-0 justify-self-end bg-brand sm:w-28"
          role="img"
          aria-label="Studio&more"
        />
      </header>

      {/* The card TAKES the height the header and footer leave, rather than
          capping at a fixed 760px — on a 27" screen that cap left a third of
          the window empty while the chart scrolled inside it. `min-h-0` is
          what lets a flex child shrink below its content so its own scroller
          absorbs the overflow. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <div ref={onScrollerReady} className="min-h-0 flex-1 overflow-auto">
          <div className="relative" style={{ width: STICKY_W + chartW }}>
            {/* header */}
            <div className="sticky top-0 z-30 border-b border-border bg-surface">
              <div className="relative flex h-7 items-center">
                <span
                  className="sticky left-0 z-10 flex h-full shrink-0 items-center bg-surface pl-3 text-[10px] font-medium uppercase tracking-wide text-faint"
                  style={{ width: STICKY_W }}
                >
                  <span className="flex-1">Task</span>
                  <span className="pr-3 text-right" style={{ width: BUDGET_W }}>
                    Budget
                  </span>
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
              const isFolded = collapsed.has(g.key);
              return (
                <div key={g.key || "none"}>
                  <div
                    className="relative flex border-b border-border"
                    style={{ height: SECTION_H, width: STICKY_W + chartW }}
                  >
                    {/* The whole block is the toggle: a client scanning a long
                        plan wants whole workstreams out of the way, and a 13px
                        chevron is a poor target for that. */}
                    <button
                      onClick={() => fold(g.key)}
                      aria-expanded={!isFolded}
                      title={isFolded ? `Show ${g.name}` : `Hide ${g.name}`}
                      className="sticky left-0 z-20 flex h-full shrink-0 items-center gap-1.5 bg-surface px-3 text-left text-sm font-semibold hover:text-brand"
                      style={{ width: STICKY_W }}
                    >
                      {isFolded ? (
                        <ChevronRight size={14} className="shrink-0 text-muted" />
                      ) : (
                        <ChevronDown size={14} className="shrink-0 text-muted" />
                      )}
                      <span className="bidi-auto truncate">{g.name}</span>
                      <span className="shrink-0 text-[11px] font-normal tabular-nums text-faint">
                        {g.rows.length}
                      </span>
                    </button>
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

                  {!isFolded &&
                    g.rows.map((r) => {
                    const color = r.task.typeColor ?? FALLBACK;
                    const left = daysBetween(from, r.start) * pxPerDay;
                    const barW = Math.max(10, (daysBetween(r.start, r.due) + 1) * pxPerDay);
                    return (
                      <div
                        key={r.task.id}
                        className="relative flex border-b border-border last:border-b-0"
                        style={{ height: ROW_H, width: STICKY_W + chartW }}
                      >
                        {/* `pl-8` lines the name up under its section's title,
                            which the chevron has pushed in by that much. */}
                        <div
                          className="sticky left-0 z-20 flex h-full shrink-0 items-center bg-surface pl-8 pr-3"
                          style={{ width: STICKY_W }}
                        >
                          <span
                            className="bidi-auto min-w-0 flex-1 truncate text-xs"
                            title={r.task.title}
                          >
                            {r.task.title}
                          </span>
                          {/* The budget, and only the budget: what was agreed,
                              not what has been spent against it. */}
                          <span
                            className="shrink-0 pr-3 text-right text-[11px] tabular-nums text-muted"
                            style={{ width: BUDGET_W }}
                          >
                            {r.task.budgetHours != null ? `${r.task.budgetHours}h` : "–"}
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
        {task.budgetHours != null && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-faint">Budget</span>
            <span className="truncate tabular-nums text-foreground">{task.budgetHours}h</span>
          </div>
        )}
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
