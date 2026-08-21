"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  BAR_H,
  BAR_LABEL_MIN_PX,
  BAR_R,
  DIAMOND,
  GROUP_BAR_H,
  GROUP_H,
  GROUP_LAYER_INSET,
  GROUP_LAYER_STEP,
  GROUP_LAYERS,
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
  /** Its subject group within that section (0027), or null when loose. */
  groupId: string | null;
  startDate: string | null;
  dueDate: string;
  typeName: string | null;
  typeColor: string | null;
  order: number | null;
}

/** A subject group and the tasks in it (0027). */
export interface PublicGanttBlock {
  id: string;
  name: string;
  tasks: PublicGanttTask[];
}

export interface PublicGanttGroup {
  key: string;
  name: string;
  rank: number;
  /** Its subject groups, in position order. Rendered above the loose tasks. */
  blocks: PublicGanttBlock[];
  /** The section's LOOSE tasks — those not in one of its groups. */
  tasks: PublicGanttTask[];
}

/** A named point in time — kickoff, launch — drawn as a line across the chart. */
export interface PublicGanttMark {
  id: string;
  onDate: string;
  title: string;
}

/** The ruler's height (`h-7`). The milestone flags stick directly under it. */
const RULER_H = 28;

/** How the reader's collapse set names a group, kept apart from section keys. */
const blockKey = (groupId: string) => `g:${groupId}`;

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
const FALLBACK = "#0b43ed";
/** The tail under today's date chip, pointing down at its line. */
const TODAY_TAIL = 5;

/** Server-rendered wide, corrected on mount — the width is a browser fact. */
function useStickyWidth() {
  const [nameW, setNameW] = useState(NAME_W);
  useEffect(() => {
    const apply = () =>
      setNameW(window.innerWidth < NARROW_PX ? NAME_W_NARROW : NAME_W);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  return nameW;
}

/**
 * The client's view of the plan.
 *
 * Same geometry as the studio's Timeline — `@/lib/gantt` is the single source
 * for both, so a bar cannot land on a different day here — and deliberately
 * less of everything else. There are no LOGGED hours, no status, no assignees
 * and no hours in either direction: the page never receives those fields (see
 * the `select` in page.tsx), so there is nothing to hide, only nothing to show.
 * The controls it DOES have are the zoom and the type filter — both are ways of
 * reading the same plan, neither reveals anything the payload does not carry.
 */
export function PublicGanttView({
  clientName,
  clientColor,
  clientIcon,
  clientIconUrl,
  groups,
  offDays,
  milestones,
}: {
  clientName: string;
  clientColor: string;
  clientIcon: string | null;
  clientIconUrl: string | null;
  groups: PublicGanttGroup[];
  offDays: { from: string; to: string; label: string }[];
  milestones: PublicGanttMark[];
}) {
  const [zoom, setZoom] = useState<Zoom>("day");
  const STICKY_W = useStickyWidth();
  // Day zoom on a phone shows five days, which reads as an empty plan. Only on
  // MOUNT — rotating the device must not overrule a zoom the reader picked.
  useEffect(() => {
    if (window.innerWidth < NARROW_PX) setZoom("week");
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  /**
   * Seams, ported from the studio's own chart so the two read alike. The
   * calendar scrolls sideways UNDER the pinned name column and the rows scroll
   * up under the ruler, with nothing to say so. Each edge stays silent until
   * there is actually something behind it, which makes the shadow information
   * rather than decoration. Only a boundary CROSSING re-renders.
   */
  const [shadow, setShadow] = useState({ x: false, y: false });
  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const x = el.scrollLeft > 0;
    const y = el.scrollTop > 0;
    setShadow((s) => (s.x === x && s.y === y ? s : { x, y }));
  }
  const centred = useRef(false);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    task: PublicGanttTask;
  } | null>(null);
  /**
   * Type names the reader has switched OFF. Held as the hidden set rather than
   * the shown one so the default — nothing hidden — needs no seeding from the
   * data, and a type appearing in a later republish is visible without asking.
   */
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  /**
   * Colour the bars by type, or draw them plain. The studio's own chart has the
   * same switch (`plainBars`, "🎨 Color by type" in its Show menu) — same
   * default, same plain rendering, so the two charts cannot disagree about what
   * a plain bar looks like.
   */
  const [colourTypes, setColourTypes] = useState(true);
  /** Section keys the reader has folded away. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fold = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /**
   * The types actually in THIS plan, first-seen order, each with its colour —
   * the legend and the filter are the same control, because a colour key you
   * cannot act on and a filter with no colours are both half a thing.
   * ⚠️ Untyped tasks get a real chip ("Other"). Without one they would be
   * unfilterable, and switching every named type off would leave a chart still
   * showing rows with nothing on screen explaining why.
   */
  const types = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; color: string }>();
    for (const g of groups)
      for (const t of [...g.blocks.flatMap((b) => b.tasks), ...g.tasks]) {
        const key = t.typeName ?? "";
        if (!seen.has(key))
          seen.set(key, {
            key,
            label: t.typeName ?? "Other",
            color: t.typeColor ?? FALLBACK,
          });
      }
    return [...seen.values()];
  }, [groups]);

  /** The plan with switched-off types dropped, containers that empty out included. */
  const shown = useMemo(() => {
    if (!hiddenTypes.size) return groups;
    const keep = (t: PublicGanttTask) => !hiddenTypes.has(t.typeName ?? "");
    return groups
      .map((g) => ({
        ...g,
        tasks: g.tasks.filter(keep),
        blocks: g.blocks
          .map((b) => ({ ...b, tasks: b.tasks.filter(keep) }))
          .filter((b) => b.tasks.length > 0),
      }))
      .filter((g) => g.tasks.length > 0 || g.blocks.length > 0);
  }, [groups, hiddenTypes]);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const off = useMemo(() => {
    const dates = new Set<string>();
    for (const d of offDays) {
      const from = parseISO(d.from);
      const span = daysBetween(from, parseISO(d.to));
      for (let i = 0; i <= Math.min(span, 400); i++)
        dates.add(toISO(shiftDays(from, i)));
    }
    return dates;
  }, [offDays]);

  /** Every row's resolved dates. A task with no start is a DEADLINE, not a one-day job. */
  const rows = useMemo(() => {
    const resolve = (t: PublicGanttTask) => {
      const due = parseISO(t.dueDate);
      return {
        task: t,
        start: t.startDate ? parseISO(t.startDate) : due,
        due,
        hasStart: !!t.startDate,
      };
    };
    return shown.map((g) => ({
      ...g,
      // Every group here holds at least one dated task — the server drops the
      // empty ones — so the span below always has something to measure.
      blocks: g.blocks.map((b) => {
        const list = b.tasks.map(resolve);
        return {
          ...b,
          rows: list,
          start: list.reduce((a, r) => (r.start < a ? r.start : a), list[0].start),
          due: list.reduce((a, r) => (r.due > a ? r.due : a), list[0].due),
        };
      }),
      rows: g.tasks.map(resolve),
    }));
  }, [shown]);

  const all = rows.flatMap((g) => [...g.blocks.flatMap((b) => b.rows), ...g.rows]);

  const { from, totalDays } = useMemo(() => {
    const marks: Date[] = [today];
    for (const r of all) marks.push(r.start, r.due);
    // ⚠️ Milestone dates widen the window too. A launch is routinely set AFTER
    // the last task's due date, and a chart sized to the tasks alone would put
    // the one date the client most wants to see off the right-hand edge.
    for (const m of milestones) marks.push(parseISO(m.onDate));
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
  }, [all, today, zoom, milestones]);

  const pxPerDay = PX_PER_DAY[zoom];
  const chartW = totalDays * pxPerDay;
  const { ticks } = ticksFor(from, totalDays, zoom, pxPerDay);
  const bodyH = rows.reduce((h, g) => {
    let out = h + SECTION_H;
    if (collapsed.has(g.key)) return out;
    for (const b of g.blocks) {
      // The group's own row always counts; its tasks only when unfolded.
      out += GROUP_H + (collapsed.has(blockKey(b.id)) ? 0 : b.rows.length * ROW_H);
    }
    return out + g.rows.length * ROW_H;
  }, 0);
  const todayLeft = daysBetween(from, today) * pxPerDay;

  /** Open on today rather than on the oldest thing anyone ever scheduled. */
  function onScrollerReady(el: HTMLDivElement | null) {
    scroller.current = el;
    if (!el || centred.current) return;
    centred.current = true;
    el.scrollLeft = Math.max(0, todayLeft - el.clientWidth / 3);
  }

  /**
   * One task row, at whichever depth it sits — loose in a section, or inside a
   * group. A function rather than two copies of the JSX: the bar, the diamond and
   * the tooltip wiring are the same at both depths, and `pad` is the only thing
   * that differs.
   */
  function taskRow(
    r: { task: PublicGanttTask; start: Date; due: Date; hasStart: boolean },
    pad: string,
  ) {
    const color = r.task.typeColor ?? FALLBACK;
    const left = daysBetween(from, r.start) * pxPerDay;
    const barW = Math.max(10, (daysBetween(r.start, r.due) + 1) * pxPerDay);
    const hover = {
      onMouseEnter: (e: React.MouseEvent) =>
        setTip({ x: e.clientX, y: e.clientY, task: r.task }),
      onMouseLeave: () => setTip(null),
    };
    return (
      <div
        key={r.task.id}
        className="relative flex border-b border-border last:border-b-0"
        style={{ height: ROW_H, width: STICKY_W + chartW }}
      >
        {/* `pad` lines the name up under the heading above it, which the chevron
            has pushed in — one step for a section, two inside a group. */}
        <div
          className={`sticky left-0 z-20 flex h-full shrink-0 items-center pr-3 ${pad} bg-surface`}
          style={{ width: STICKY_W }}
        >
          <span className="bidi-auto min-w-0 flex-1 truncate text-xs" title={r.task.title}>
            {r.task.title}
          </span>
        </div>
        <div className="relative h-full shrink-0" style={{ width: chartW }}>
          {r.hasStart ? (
            <div
              {...hover}
              className="absolute top-1/2 -translate-y-1/2 overflow-hidden"
              style={{
                left,
                width: barW,
                height: BAR_H,
                borderRadius: BAR_R,
                backgroundColor: colourTypes ? `${color}52` : "var(--color-surface)",
                boxShadow: colourTypes
                  ? undefined
                  : "inset 0 0 0 1px var(--color-border-strong)",
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
              {...hover}
              className="absolute top-1/2 -translate-y-1/2 rotate-45 rounded-[2px]"
              style={{
                left: left + Math.max(0, pxPerDay / 2 - DIAMOND / 2),
                width: DIAMOND,
                height: DIAMOND,
                backgroundColor: colourTypes ? color : "var(--color-surface)",
                boxShadow: colourTypes
                  ? undefined
                  : "inset 0 0 0 1px var(--color-border-strong)",
              }}
            />
          )}
        </div>
      </div>
    );
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
          <span className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-2xl font-bold leading-tight tracking-tight">
              {clientName}
            </h1>
            <span className="text-xs text-muted">
              Schedule · updates automatically
            </span>
          </span>
          {/* ⚠️ A SECOND instance of the wordmark, phone-only, and the duplication is
              deliberate. On a phone the header has to be two rows — name+mark, then
              zoom+switch — because zoom (154px) + switch (112px) + mark (96px) will
              not fit 343px on one line. Moving the single mark into the name row
              instead would mean one DOM order serving both a 2-column mobile grid
              and the desktop 3-track row that CENTRES the zoom, and the zoom loses
              its centring. It is a CSS-mask span: no image, no request. */}
          {/* ⚠️ The show/hide goes on a WRAPPER, never on `.brand-wordmark` itself:
              that class sets `display: inline-block` in globals.css, which is
              UNLAYERED, and Tailwind emits `hidden`/`sm:block` inside
              `@layer utilities` — so an unlayered rule wins whatever the
              specificity and the mark simply refuses to hide. Same precedence
              trap as the 16px form-field rule. */}
          <span className="shrink-0 sm:hidden">
            <span
              className="brand-wordmark w-20 bg-brand"
              role="img"
              aria-label="Studio&more"
            />
          </span>
        </div>
        <div className="flex shrink-0 justify-center rounded-lg border border-border bg-surface p-0.5">
          {(["day", "week", "month"] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                z === zoom
                  ? "bg-brand-soft text-brand-dark"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {z}
            </button>
          ))}
        </div>
        {/* Colour switch then wordmark, both in the header's right-hand track.
            The switch belongs up here rather than beside the chips below: it
            governs how the CHART IS DRAWN, the same kind of setting as the zoom,
            while the chips are about which work is on screen.
            The mask + `bg-brand` is how every other public page (intake,
            password reset) draws the wordmark. */}
        <div className="ml-auto flex items-center gap-3 sm:ml-0 sm:justify-self-end">
          <button
            onClick={() => setColourTypes((v) => !v)}
            aria-pressed={colourTypes}
            title={
              colourTypes
                ? "Draw the bars plain, without type colours"
                : "Colour the bars by type of work"
            }
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
              colourTypes
                ? "border-brand bg-brand-soft text-brand-dark"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            <span aria-hidden>🎨</span>
            Color by type
          </button>
          <span className="hidden shrink-0 sm:block">
            <span
              className="brand-wordmark w-24 bg-brand sm:w-28"
              role="img"
              aria-label="Studio&more"
            />
          </span>
        </div>
      </header>

      {/* The card TAKES the height the header and footer leave, rather than
          capping at a fixed 760px — on a 27" screen that cap left a third of
          the window empty while the chart scrolled inside it. `min-h-0` is
          what lets a flex child shrink below its content so its own scroller
          absorbs the overflow. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <div
          ref={onScrollerReady}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto"
        >
          <div className="relative" style={{ width: STICKY_W + chartW }}>
            {/* ⚠️ ONE full-height gradient stuck at the pinned column's edge, NOT a
                box-shadow per row: on the studio's chart the per-row version came
                out broken by every row border it crossed. z-[24] puts it over the
                rows and under the pinned column (z-20 cells sit in their own
                stacking contexts) and the ruler. */}
            {shadow.x && (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-[24] w-full">
                <div
                  className="sticky h-full w-2.5"
                  style={{
                    left: STICKY_W,
                    background:
                      "linear-gradient(to right, rgba(0,0,0,0.075), rgba(0,0,0,0))",
                  }}
                />
              </div>
            )}
            {/* header */}
            <div
              className={`sticky top-0 z-30 border-b border-border bg-surface ${
                // the negative spread confines it to the bottom edge; without it
                // the shadow smears sideways across the column titles too
                shadow.y ? "shadow-[0_5px_8px_-6px_rgba(0,0,0,0.14)]" : ""
              }`}
            >
              <div className="relative flex h-7 items-center">
                <span
                  className="sticky left-0 z-10 flex h-full shrink-0 items-center bg-surface pl-3 text-[10px] font-medium uppercase tracking-wide text-faint"
                  style={{ width: STICKY_W }}
                >
                  <span className="flex-1">Task</span>
                </span>
                <span className="relative h-full flex-1 border-l border-border">
                  {ticks.map((t) => {
                    const isToday =
                      zoom === "day" &&
                      Math.round(t.left / pxPerDay) === daysBetween(from, today);
                    return (
                    <span
                      key={t.left}
                      className={`absolute top-0 flex h-full items-center truncate px-1 text-[10px] ${
                        t.boundary
                          ? "border-l border-foreground/15 font-semibold text-foreground"
                          : `tabular-nums ${
                              zoom === "day" &&
                              !isWorkDay(
                                shiftDays(from, Math.round(t.left / pxPerDay)),
                                off,
                              )
                                ? "text-faint/60"
                                : "text-muted"
                            }`
                      }`}
                      style={{ left: t.left, width: t.width }}
                    >
                      {/* Today is ONE object, as on the studio's chart: a tag
                          holding the date, a tail pointing down out of it, and
                          the line continuing from the tail into the chart. The
                          tail is why it lives in the RULER rather than the
                          chart — the date and the pointer have to be the same
                          piece, or they read as two markers for one day. */}
                      {isToday ? (
                        <span className="relative rounded-md bg-foreground px-1.5 py-0.5 text-white">
                          {t.label}
                          <span
                            className="absolute left-1/2 top-full -translate-x-1/2"
                            style={{
                              borderLeft: `${TODAY_TAIL}px solid transparent`,
                              borderRight: `${TODAY_TAIL}px solid transparent`,
                              borderTop: `${TODAY_TAIL}px solid var(--foreground)`,
                            }}
                            aria-hidden
                          />
                        </span>
                      ) : (
                        t.label
                      )}
                    </span>
                    );
                  })}
                </span>
              </div>
            </div>

            {/* the calendar behind the rows */}
            <div
              className="pointer-events-none absolute top-7 z-0"
              style={{ left: STICKY_W, width: chartW, height: bodyH }}
              aria-hidden
            >
              {/* Time that has already gone: a wash from the start of the range up
                  to the today line, which is where it ENDS — so that line reads
                  as the edge of the past rather than as one more vertical in a
                  chart full of them. 5% reads at a glance without competing with
                  a bar, and the weekend shading beneath is 4.5%, so a past
                  weekend comes out a little darker still, which is true. */}
              {todayLeft > 0 && (
                <div
                  className="absolute top-0 z-0 h-full bg-foreground/[0.05]"
                  style={{ left: 0, width: Math.min(todayLeft, chartW) }}
                />
              )}
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
              {/* ⚠️ BLACK, not brand blue — the studio's chart made this change in
                  v1.11.0 for a reason that applies here identically: with a type
                  colour on every bar, a blue vertical reads as one more category
                  rather than as today. */}
              {todayLeft >= 0 && todayLeft <= chartW && (
                <div
                  className="absolute top-0 h-full border-l-2 border-foreground"
                  style={{ left: todayLeft }}
                />
              )}
            </div>

            {/* Milestones. Read-only here — no drag, no rename, no trash — but
                the SAME line and the same flag the studio sees, because the two
                charts are meant to be the same picture.
                ⚠️ TWO layers, because the line and its label want opposite
                depths, and the root carries NO z-index of its own: a positioned
                element with one creates a stacking context the label could never
                escape. Same trap the studio's chart hit (v1.10.0). */}
            {milestones.length > 0 && (
              <div
                className="pointer-events-none absolute top-0"
                style={{ left: STICKY_W, width: 1, height: RULER_H + bodyH }}
              >
                {/* Lines ABOVE the rows, not under them: every row carries a
                    `border-b`, and each one painted across a line drawn beneath,
                    leaving a 1px gap every 34px — the line came out dashed.
                    ⚠️ But BELOW the pinned column's `z-20`, unlike the studio's
                    chart, which puts marks at 20/30 and lets a flag ride over
                    the task names when you scroll. Measured here: "brand begins"
                    overlapped the name column by 50px. The studio can live with
                    that; on the page a client reads it looks like a fault. */}
                <div className="absolute top-0 z-[14]" style={{ width: 1 }}>
                  {milestones.map((m) => {
                    const left =
                      daysBetween(from, parseISO(m.onDate)) * pxPerDay;
                    if (left < 0 || left > chartW) return null;
                    return (
                      <div
                        key={m.id}
                        className="absolute w-0.5 bg-brand/50"
                        style={{ left, top: RULER_H, height: bodyH }}
                      />
                    );
                  })}
                </div>
                {/* The flags, above the bars but still under the pinned column
                    and the ruler, and `sticky` so a milestone forty rows down
                    still says what it is. Sticky needs a containing block taller
                    than itself, hence the full-height wrapper per flag. */}
                <div className="absolute top-0 z-[15]" style={{ width: 1 }}>
                  {milestones.map((m) => {
                    const left =
                      daysBetween(from, parseISO(m.onDate)) * pxPerDay;
                    if (left < 0 || left > chartW) return null;
                    return (
                      <div
                        key={m.id}
                        className="absolute"
                        style={{ left, top: 0, height: RULER_H + bodyH }}
                      >
                        {/* Square where it meets its pole, rounded away from it,
                            offset by the line's own width so the line runs
                            beside the flag rather than under it. */}
                        <div
                          className="sticky flex max-w-[220px] items-center whitespace-nowrap rounded-r-md border border-l-0 border-brand bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-brand-dark shadow-sm"
                          style={{ top: RULER_H, marginLeft: 2 }}
                          // `hasStart: false` is how `dateRangeLabel` renders a
                          // single day ("9 Aug") rather than a range of one.
                          title={`${m.title} · ${dateRangeLabel(parseISO(m.onDate), parseISO(m.onDate), false)}`}
                        >
                          <span className="min-w-0 truncate">{m.title}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {rows.map((g) => {
              // ⚠️ Over the section's WHOLE contents, groups included — and no
              // longer seeded from `g.rows[0]`, which a section holding only
              // groups doesn't have. That read would have thrown the moment
              // somebody put every task in one.
              const own = [...g.blocks.flatMap((b) => b.rows), ...g.rows];
              const gStart = own.reduce((a, r) => (r.start < a ? r.start : a), own[0].start);
              const gDue = own.reduce((a, r) => (r.due > a ? r.due : a), own[0].due);
              const gLeft = daysBetween(from, gStart) * pxPerDay;
              const gWidth = Math.max(
                8,
                (daysBetween(gStart, gDue) + 1) * pxPerDay,
              );
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
                        <ChevronRight
                          size={14}
                          className="shrink-0 text-muted"
                        />
                      ) : (
                        <ChevronDown
                          size={14}
                          className="shrink-0 text-muted"
                        />
                      )}
                      <span className="bidi-auto min-w-0 flex-1 truncate">{g.name}</span>
                      <span className="shrink-0 text-[11px] font-normal tabular-nums text-faint">
                        {own.length}
                      </span>
                    </button>
                    <div
                      className="relative h-full shrink-0"
                      style={{ width: chartW }}
                    >
                      <span
                        className="absolute"
                        style={{
                          left: gLeft,
                          width: gWidth,
                          top: `calc(50% - ${SECTION_BAR_H / 2}px)`,
                        }}
                      >
                        <span
                          className="absolute inset-x-0 top-0 rounded-[1px]"
                          style={{
                            height: SECTION_BAR_H,
                            backgroundColor: clientColor,
                            opacity: 0.85,
                          }}
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

                  {/* Groups first, then the section's loose tasks — the same
                      order the studio's Timeline uses, so the two charts are the
                      same picture. */}
                  {!isFolded &&
                    g.blocks.map((b) => {
                      const bFolded = collapsed.has(blockKey(b.id));
                      const bLeft = daysBetween(from, b.start) * pxPerDay;
                      const bWidth = Math.max(
                        8,
                        (daysBetween(b.start, b.due) + 1) * pxPerDay,
                      );
                      return (
                        <div key={b.id}>
                          <div
                            className="relative flex border-b border-border"
                            style={{ height: GROUP_H, width: STICKY_W + chartW }}
                          >
                            <button
                              onClick={() => fold(blockKey(b.id))}
                              aria-expanded={!bFolded}
                              title={bFolded ? `Show ${b.name}` : `Hide ${b.name}`}
                              className="sticky left-0 z-20 flex h-full shrink-0 items-center gap-1.5 bg-surface pl-7 pr-3 text-left text-[13px] font-semibold hover:text-brand"
                              style={{ width: STICKY_W }}
                            >
                              {bFolded ? (
                                <ChevronRight size={13} className="shrink-0 text-muted" />
                              ) : (
                                <ChevronDown size={13} className="shrink-0 text-muted" />
                              )}
                              <span className="bidi-auto min-w-0 flex-1 truncate">{b.name}</span>
                              <span className="shrink-0 text-[11px] font-normal tabular-nums text-faint">
                                {b.rows.length}
                              </span>
                            </button>
                            <div
                              className="relative h-full shrink-0"
                              style={{ width: chartW }}
                            >
                              {/* A BAR across the group's span, drawn as a stack
                                  to say it gathers several tasks — not a
                                  section's bracket, which is a claim about rows.
                                  In the client's own colour, like the section
                                  bracket above it: the type colours belong to the
                                  task bars and the legend explains them, so a
                                  container must not borrow one. */}
                              <span
                                className="absolute"
                                style={{
                                  left: bLeft,
                                  width: bWidth,
                                  top: Math.round((GROUP_H - GROUP_BAR_H) / 2),
                                }}
                              >
                                {Array.from({ length: GROUP_LAYERS }, (_, i) => {
                                  const step = GROUP_LAYERS - i; // furthest first
                                  const inset = GROUP_LAYER_INSET * step;
                                  // No room to taper on a narrow bar; drawing one
                                  // anyway leaves the layers wider than the bar.
                                  if (bWidth - inset * 2 < 8) return null;
                                  return (
                                    <span
                                      key={i}
                                      className="absolute rounded-[3px]"
                                      style={{
                                        left: inset,
                                        width: bWidth - inset * 2,
                                        top: -GROUP_LAYER_STEP * step,
                                        height: GROUP_BAR_H,
                                        backgroundColor: clientColor,
                                        opacity: 0.3 - i * 0.08,
                                      }}
                                    />
                                  );
                                })}
                                <span
                                  className="absolute inset-x-0 flex items-center overflow-hidden rounded-[3px] px-1.5"
                                  style={{
                                    top: 0,
                                    height: GROUP_BAR_H,
                                    backgroundColor: clientColor,
                                    opacity: 0.85,
                                  }}
                                >
                                  {bFolded && bWidth >= BAR_LABEL_MIN_PX && (
                                    <span className="truncate text-[11px] font-semibold leading-none text-white">
                                      {b.name}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </div>
                          </div>
                          {!bFolded && b.rows.map((r) => taskRow(r, "pl-12"))}
                        </div>
                      );
                    })}

                  {!isFolded && g.rows.map((r) => taskRow(r, "pl-8"))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* One row under the chart: the footnote keeps the left, the type filter
          takes the right. Below the table rather than above it, per Nitsan — the
          chart is what the client came for, and a row of controls between the
          header and the plan pushes the plan down for a filter most readers will
          never touch. A colour key also makes more sense AFTER the thing it
          explains. */}
      <div className="flex flex-wrap-reverse items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-faint">
          {shown.length === 0 ? (
            // Switching every type off is allowed — refusing the last one would be
            // a control that silently stops working. But a blank chart has to say
            // why, or it reads as "there is no work" rather than "you hid it".
            <>Every type is switched off — turn one back on to see the plan.</>
          ) : (
            <>
              Open work only, and only what has a date. A diamond is a deadline
              with no start date yet.
            </>
          )}
        </p>
        {/* The colour key AND the filter, one control. Laid out SPREAD rather than
            folded into a menu: on the studio's own chart these live behind a "Show"
            dropdown, which is right there because that page has a dozen controls
            competing — here there are two, the reader is a client seeing this once
            a week, and a filter they have to discover inside a menu is one they
            will not use. Right-aligned under the header, so it reads as belonging
            to the chart's top edge; wraps on a phone.
            Only rendered past ONE type: a single-type plan needs neither a key
            (every bar is that colour) nor a filter (the only thing to switch off
            is everything).
            ⚠️ No "Show all" reset, per Nitsan — with every chip on screen carrying
            its own state, the way back is the chip you switched off, and a reset
            that only appears once you have used the control is one more thing to
            read for a reader who is here for the dates. */}
        {types.length > 1 && (
          // ⚠️ ONE ROW THAT SCROLLS on a phone, not three wrapped ones: seven chips
          // wrapped cost 144px of an 812px screen, which is chart the client came
          // for. `-mx-4 px-4` lets it bleed to the screen edges so a swipe has
          // somewhere to go and the row does not look clipped mid-chip; from `sm`
          // it wraps as before, where there is width to spare.
          <div className="-mx-4 flex max-w-full items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:justify-end sm:overflow-visible sm:px-0">
              {/* Leftmost, per Nitsan — a reset belongs before the things it resets,
                and it only exists once there is something to undo. */}
            {hiddenTypes.size > 0 && (
              <button
                onClick={() => setHiddenTypes(new Set())}
                className="min-h-11 shrink-0 rounded-full px-2 py-1 text-xs font-medium text-muted hover:text-foreground sm:min-h-0"
              >
                Show all
              </button>
            )}
            {types.map((t) => {
              const on = !hiddenTypes.has(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() =>
                    setHiddenTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.key)) next.delete(t.key);
                      else next.add(t.key);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  title={on ? `Hide ${t.label}` : `Show ${t.label}`}
                  className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
                    on
                      ? "border-border bg-surface text-foreground hover:border-border-strong hover:bg-background"
                      : "border-dashed border-border bg-transparent text-faint hover:border-solid hover:text-muted"
                  }`}
                >
                  {/* Filled when shown, hollow when hidden — the swatch carries the
                      state as well as the colour, so the chip reads at a glance.
                      ⚠️ Only while the chart is actually USING the colours: with
                      "Color types" off, a coloured key beside plain bars claims a
                      mapping the chart is not making. The chip stays either way,
                      because it is still the filter; it loses only its swatch. */}
                  {colourTypes && (
                    <span
                      className="size-2.5 shrink-0 rounded-full border-2"
                      style={{
                        borderColor: t.color,
                        backgroundColor: on ? t.color : "transparent",
                      }}
                    />
                  )}
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

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
      style={{
        left,
        top: flip ? y - 12 : below,
        transform: flip ? "translateY(-100%)" : undefined,
      }}
    >
      <div className="px-3 py-1.5" style={{ backgroundColor: `${color}29` }}>
        <div className="text-[13px] font-semibold leading-tight text-foreground">
          {task.title}
        </div>
        {task.typeName && (
          <div className="leading-tight text-muted">{task.typeName}</div>
        )}
      </div>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="shrink-0 text-faint">
            {hasStart ? "Dates" : "Due"}
          </span>
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
