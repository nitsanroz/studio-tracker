"use client";

// The rows that are not tasks: the ruler, a section's bracket and a group's
// stacked bar, plus the rolled-up figures they share.
//
// ⚠️ Both header rows pin `STICKY_W`, never `leftW`. Pinning the whole left
// table put an opaque 666px band on top of the calendar and swallowed the
// summary bar whole — see the note in the section header.

import { EditableTextCell } from "../editable-cell";
import { GROUP_BAR_COLOR, GROUP_LAYER_COLORS, GROUP_LINE_TOP, SECTION_BAR_COLOR, SECTION_BAR_TOP, SHADOW_Y, STICKY_W, TL_COLS, TODAY_TAIL } from "./shared";
import type { Block, Group, TlCol } from "./shared";
import { HoverTip, TipHead, TipRow } from "./tooltip";
import { formatHoursDecimal } from "@/lib/format";
import { BAR_LABEL_MIN_PX, GROUP_BAR_H, GROUP_H, GROUP_LAYERS, GROUP_LAYER_INSET, GROUP_LAYER_STEP, SECTION_BAR_H, SECTION_H, TIP_H, TIP_MIN_W, TIP_W, dateRangeLabel, daysBetween, isWorkDay, shiftDays, ticksFor } from "@/lib/gantt";
import type { Zoom } from "@/lib/gantt";
import type { Rollup } from "@/lib/task-rollup";
import { ChevronDown, ChevronRight, Layers, Pencil } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";


export function TimelineHeader({
  from,
  totalDays,
  zoom,
  pxPerDay,
  off,
  hidden,
  shadow,
  canAddMark,
  onAddMark,
  onHoverDay,
  hoverDay,
  todayOffset,
}: {
  from: Date;
  totalDays: number;
  zoom: Zoom;
  pxPerDay: number;
  off: Set<string>;
  hidden: Set<string>;
  shadow: { x: boolean; y: boolean };
  canAddMark: boolean;
  /** day offset from `from` — the caller turns it into a date */
  onAddMark: (dayOffset: number) => void;
  /** which day the pointer is over, so the whole column can light up */
  onHoverDay: (dayOffset: number | null) => void;
  /** …and back down, so the tick under the pointer lights up with it */
  hoverDay: number | null;
  /** today, as a day offset from `from` — the ruler marks it */
  todayOffset: number;
}) {
  const { ticks } = ticksFor(from, totalDays, zoom, pxPerDay);
  const dayZoom = zoom === "day";
  const head = "shrink-0 text-[10px] font-medium uppercase tracking-wide text-faint";

  return (
    /*
      ONE row. There used to be a month band above this one — 25px of header, on
      every visit, to print six words. The months live in the tick row itself
      now: the first tick that falls inside a month prints the month's name in
      place of its date, in the emphasis weight, with a rule down its left edge
      that GridLayer continues through the rows. Nothing was lost and a row was.

      z-[22] over the rows' own sticky name block (z-20): scrolling down must not
      slide task names over the column titles — and BELOW the client page's own
      sticky header, which has to clear it. The scale is in client-view/index.tsx.
    */
    <div
      className={`sticky top-0 z-[22] border-b border-border bg-surface ${shadow.y ? SHADOW_Y : ""}`}
    >
      <div className="relative flex h-6 items-center">
        <span
          className="sticky left-0 z-10 flex h-full shrink-0 items-center bg-surface"
          style={{ width: STICKY_W }}
        >
          <span className={`${head} truncate pl-2`} style={{ width: STICKY_W }}>
            Task name
          </span>
        </span>
        {TL_COLS.filter((c) => !hidden.has(c.key)).map((c) => (
          <span
            key={c.key}
            className={`${head} truncate border-l border-border bg-surface px-1.5 ${
              c.key === "actual" || c.key === "budget" ? "text-right" : ""
            }`}
            style={{ width: c.w }}
            title={c.title}
          >
            {c.label}
          </span>
        ))}
        <span
          className={`relative h-full flex-1 border-l border-border ${
            canAddMark ? "cursor-copy" : ""
          }`}
          onMouseMove={(e) => {
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onHoverDay(Math.floor((e.clientX - box.left) / pxPerDay));
          }}
          onMouseLeave={() => onHoverDay(null)}
          onClick={(e) => {
            if (!canAddMark) return;
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
            // The exact day under the pointer, at any zoom — at week zoom a tick
            // covers seven days, so the tick's own start would be up to six days
            // out from where the click landed.
            onAddMark(Math.floor((e.clientX - box.left) / pxPerDay));
          }}
          title={canAddMark ? "Click to add a milestone on this day" : undefined}
        >
          {ticks.map((t) => {
            const date = shiftDays(from, Math.round(t.left / pxPerDay));
            const nonWork = dayZoom && !isWorkDay(date, off);
            // The tick the pointer is over — by RANGE, not by index, so it also
            // works at week and month zoom where one tick covers many days.
            const first = Math.round(t.left / pxPerDay);
            const last = Math.round((t.left + t.width) / pxPerDay);
            const hovered = hoverDay !== null && hoverDay >= first && hoverDay < last;
            const isToday = todayOffset >= first && todayOffset < last;
            return (
              <span
                key={t.left}
                className={`absolute top-0 flex h-full items-center px-1 ${
                  // The date itself answers the hover too, not just the column
                  // below it: the ruler is where you aim, so it is where the
                  // feedback has to be.
                  hovered ? "rounded-t-sm bg-brand/10 font-semibold text-brand-dark" : ""
                } ${
                  // `truncate` sets overflow:hidden, which would cut the tag's
                  // tail off at the ruler's edge. Today's tick lets it hang.
                  isToday ? "overflow-visible" : ""
                } ${
                  t.boundary
                    ? // NOT truncated, and its width is a MINIMUM rather than a
                      // cap: "SEP" needs about 30px and a day tick is 26, so
                      // clipping it to its own box cut the month name to "SE".
                      // It overflows into the next day's box, whose number is
                      // centred and so leaves room at its left.
                      "whitespace-nowrap border-l border-foreground/[0.18] text-[12px] font-semibold uppercase tracking-wide text-foreground"
                    : `truncate text-[10px] tabular-nums ${
                        // The number belongs to the whole day at day zoom, so it
                        // sits in the middle of it. At week and month zoom the
                        // label names the START of its span, and centring it
                        // would point at the wrong date.
                        dayZoom ? "justify-center" : ""
                      } ${nonWork ? "text-faint/60" : "text-muted"}`
                }`}
                style={
                  t.boundary
                    ? { left: t.left, minWidth: t.width }
                    : { left: t.left, width: t.width }
                }
              >
                {/* Today is ONE object: a tag holding the date, a tail
                    pointing down out of it, and the line continuing from the
                    tail into the chart. The tail is why this lives in the ruler
                    rather than the chart — the date and the pointer have to be
                    the same piece, or they are two markers for one day. */}
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
  );
}


/** A collapsible group, with the reference's thin summary bar spanning its range. */
export function SectionHeaderRow({
  group,
  collapsed,
  onToggle,
  from,
  pxPerDay,
  totalDays,
  color,
  canEdit,
  leftW,
  onRename,
  summary,
}: {
  group: Group;
  collapsed: boolean;
  onToggle: () => void;
  from: Date;
  pxPerDay: number;
  totalDays: number;
  color: string;
  canEdit: boolean;
  leftW: number;
  onRename: (name: string) => void;
  /** Rolled-up figures for the columns, when "Section totals" is on. */
  summary?: ReactNode;
}) {
  const left = daysBetween(from, group.start) * pxPerDay;
  const width = Math.max(8, (daysBetween(group.start, group.due) + 1) * pxPerDay);
  const [renaming, setRenaming] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  // "No section" is a bucket, not a row in `sections` — there is nothing to rename.
  const renameable = canEdit && !!group.section;

  return (
    <div
      className="relative flex border-b border-border bg-background/60"
      style={{ height: SECTION_H, width: leftW + totalDays * pxPerDay }}
    >
      {/*
        STICKY_W, not leftW — the same block the task rows pin.

        Pinning the section label across the whole left table meant that once you
        scrolled the chart sideways, an opaque 666px band sat on top of the first
        666px of the calendar and swallowed the summary bar whole: the bars were
        in the DOM, in the right place, and invisible for most of the scroll
        range. The rest of the table's width follows as a plain filler that
        scrolls away with the columns it belongs to.
      */}
      {/* Same `bg-surface` as a task row: the section used to be a darker band,
          which made the left table read as two alternating materials. The type
          hierarchy carries the distinction on its own now — the name is one step
          up in size and one step up in weight from a task's. */}
      <div
        className="group/sec sticky left-0 z-20 flex h-full shrink-0 items-center gap-1.5 bg-surface px-2"
        style={{ width: STICKY_W }}
      >
        <button
          onClick={onToggle}
          title={collapsed ? "Expand" : "Collapse"}
          className="shrink-0 text-muted hover:text-brand"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        {renaming ? (
          <span className="min-w-0 flex-1 text-sm font-semibold">
            <EditableTextCell
              startEditing
              value={group.section!.name}
              onCommit={(v) => {
                if (v && v !== group.section!.name) onRename(v);
              }}
              onExit={() => setRenaming(false)}
              inputClassName="text-sm font-semibold"
            />
          </span>
        ) : (
          <>
            {/* 14px/600 against a task's 12px/500 — two steps of hierarchy, both
                cheap, so the grouping survives losing the background tint. */}
            <button
              onClick={onToggle}
              className="bidi-auto min-w-0 truncate text-left text-sm font-semibold hover:text-brand"
            >
              {group.section?.name ?? "No section"}
            </button>
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[11px] tabular-nums text-faint">
              {group.rows.length}
            </span>
            {renameable && (
              <button
                onClick={() => setRenaming(true)}
                title="Rename section"
                aria-label="Rename section"
                className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-brand group-hover/sec:opacity-100"
              >
                <Pencil size={11} />
              </button>
            )}
          </>
        )}
      </div>
      {/* The summary's cells add up to exactly this filler's width — see
          `SummaryCells`, which takes both from `TL_COLS`. */}
      {summary ?? (
        <div className="h-full shrink-0 bg-surface" style={{ width: leftW - STICKY_W }} />
      )}
      <div className="relative h-full shrink-0" style={{ width: totalDays * pxPerDay }}>
        {/*
          The group's whole span, drawn as the reference's bracket rather than as
          a bar: a thin rule at 30% of a task bar's height with a point dropping
          off each end. The tips are what stop it being mistaken for work — they
          say "everything under here falls between these two dates", which is a
          claim about the rows, not a thing anyone is assigned to.

          Each tip is the CSS border triangle: a 0×0 box whose coloured top
          border mitres into a transparent side border, so the hypotenuse runs
          from the outer edge down to the point. Left tip mitres right, right tip
          mitres left, and both sit flush with the bar's ends.
        */}
        {/* NOT `pointer-events-none`: it carries the group's dates, and with
            events off it could never be hovered to show them. Nothing sits under
            a section row to intercept, so there is nothing to get in the way of. */}
        {tip && (
          <HoverTip x={tip.x} y={tip.y}>
            <TipHead title={group.section?.name ?? "No section"} subtitle="Section" color={color} />
            <div className="flex flex-col gap-1 px-3 py-2.5">
              <TipRow label="Runs" value={dateRangeLabel(group.start, group.due, true)} />
              <TipRow label="Tasks" value={String(group.rows.length)} />
            </div>
          </HoverTip>
        )}
        {/* Folded, the bracket is the ONLY thing left of a section in the chart —
            and the name that explains it is off in the pinned column, which may
            well be scrolled away. Expanded it needs no caption: the rows under
            it are the caption. */}
        {collapsed && !group.undated && (
          <span
            // `leading-none` so the box is the glyphs and nothing else — with
            // default leading the caption carried 6px of invisible padding and
            // sat adrift of the bracket it names. Placed FROM the bracket, two
            // pixels above it, rather than from the top of the row.
            className="pointer-events-none absolute whitespace-nowrap text-[12px] font-semibold leading-none"
            style={{
              left: left + 1,
              top: SECTION_BAR_TOP - 14,
              color: SECTION_BAR_COLOR,
            }}
          >
            {group.section?.name ?? "No section"}
          </span>
        )}
        <span
          className="absolute z-10"
          style={{ left, width, top: SECTION_BAR_TOP }}
          onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTip(null)}
        >
          <span
            className="absolute inset-x-0 top-0 rounded-[1px]"
            style={{ height: SECTION_BAR_H, backgroundColor: SECTION_BAR_COLOR }}
          />
          {width >= TIP_MIN_W && (
            <>
              <span
                className="absolute left-0 top-0"
                style={{
                  borderTop: `${TIP_H}px solid ${SECTION_BAR_COLOR}`,
                  borderRight: `${TIP_W}px solid transparent`,
                }}
              />
              <span
                className="absolute top-0"
                style={{
                  left: width - TIP_W,
                  borderTop: `${TIP_H}px solid ${SECTION_BAR_COLOR}`,
                  borderLeft: `${TIP_W}px solid transparent`,
                }}
              />
            </>
          )}
        </span>
      </div>
    </div>
  );
}


/**
 * The rolled-up figures for a section or a group, in the left table's own
 * columns — so a container and the tasks under it read down the SAME columns and
 * the arithmetic can be checked by eye.
 *
 * `Who` and `Type` stay blank: a container has no assignee and no kind of work,
 * and inventing "mixed" there would be a label pretending to be data.
 *
 * When summaries are off, the caller renders a plain filler instead and these
 * cells never mount — which is why the widths are taken from `TL_COLS` rather
 * than hard-coded: a hidden column has to disappear from both shapes identically
 * or the header stops lining up with its rows.
 */
export function SummaryCells({
  hidden,
  rolled,
  budget,
  bg,
}: {
  hidden: Set<string>;
  rolled: Rollup;
  /** Sections may override with their own recovered figure — see sectionBudgetHours. */
  budget: number | null;
  bg: string;
}) {
  const value = (key: TlCol): string => {
    switch (key) {
      case "dates":
        return rolled.start && rolled.due
          ? dateRangeLabel(rolled.start, rolled.due, true)
          : "—";
      case "duration":
        return rolled.workDays && rolled.start ? `${rolled.workDays}d` : "—";
      case "actual":
        return rolled.doneMinutes ? formatHoursDecimal(rolled.doneMinutes) : "—";
      case "budget":
        return budget != null ? formatHoursDecimal(budget * 60) : "—";
      default:
        return "";
    }
  };

  return (
    <>
      {TL_COLS.filter((c) => !hidden.has(c.key)).map((c) => (
        <div
          key={c.key}
          className={`flex h-full shrink-0 items-center border-l border-border px-2 text-[11px] tabular-nums text-muted ${bg}`}
          style={{ width: c.w }}
        >
          <span className="truncate">{value(c.key)}</span>
        </div>
      ))}
    </>
  );
}


/**
 * A subject group's row (0027).
 *
 * ⚠️ It draws a BAR, not a section's bracket, and that difference is the whole
 * design: a bracket says "everything under here falls between these dates", which
 * is a claim about rows; a group is a thing in its own right — the several tasks
 * that make up one webpage — so it gets a bar across its span, drawn as a STACK
 * to say it is more than one.
 *
 * ⚠️ **Read-only.** No drag handles, no resize handles, no `cursor-grab`, and the
 * bar is `pointer-events-none` so a marquee begun over it still reaches the rows
 * beneath and a click falls through to nothing rather than half-opening
 * something. Nitsan's call: a group's span is derived from its children, and its
 * children are individually draggable (and movable together by marquee
 * multi-drag), so a draggable container would be a second way to do the same
 * thing with a less obvious result.
 */
export function GroupHeaderRow({
  block,
  collapsed,
  onToggle,
  from,
  pxPerDay,
  totalDays,
  canEdit,
  leftW,
  onRename,
  summary,
}: {
  block: Block;
  collapsed: boolean;
  onToggle: () => void;
  from: Date;
  pxPerDay: number;
  totalDays: number;
  canEdit: boolean;
  leftW: number;
  onRename: (name: string) => void;
  /** Rolled-up figures for the columns, when "summaries" is on. */
  summary?: ReactNode;
}) {
  const left = daysBetween(from, block.start) * pxPerDay;
  const width = Math.max(8, (daysBetween(block.start, block.due) + 1) * pxPerDay);
  const [renaming, setRenaming] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const top = Math.round((GROUP_H - GROUP_BAR_H) / 2);

  return (
    <div
      className="relative flex border-b border-border"
      style={{ height: GROUP_H, width: leftW + totalDays * pxPerDay }}
    >
      {/* ⚠️ STICKY_W, not leftW — the block the task rows pin. Pinning the whole
          left table put an opaque 666px band on top of the first 666px of
          calendar as soon as you scrolled sideways, swallowing the bar whole:
          present in the DOM, correctly placed, invisible. Same trap
          `SectionHeaderRow` hit. */}
      <div
        className="group/grp sticky left-0 z-20 flex h-full shrink-0 items-center gap-1.5 bg-surface pl-5 pr-2"
        style={{ width: STICKY_W }}
      >
        <button
          onClick={onToggle}
          title={collapsed ? "Expand" : "Collapse"}
          className="shrink-0 text-muted hover:text-brand"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        {renaming ? (
          <span className="min-w-0 flex-1 text-[13px] font-semibold">
            <EditableTextCell
              startEditing
              value={block.group.name}
              onCommit={(v) => {
                if (v && v !== block.group.name) onRename(v);
              }}
              onExit={() => setRenaming(false)}
              inputClassName="text-[13px] font-semibold"
            />
          </span>
        ) : (
          <>
            {/* 13px against a section's 14 and a task's 12 — and the icon, since
                globals.css collapses medium/semibold/bold onto one weight (570),
                so one step of size is all the type can say on its own. */}
            <Layers size={12} className="shrink-0 text-muted" aria-hidden />
            <button
              onClick={onToggle}
              className="bidi-auto min-w-0 truncate text-left text-[13px] font-semibold hover:text-brand"
            >
              {block.group.name}
            </button>
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[11px] tabular-nums text-faint">
              {block.rows.length}
            </span>
            {canEdit && (
              <button
                onClick={() => setRenaming(true)}
                title="Rename group"
                aria-label="Rename group"
                className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-brand group-hover/grp:opacity-100"
              >
                <Pencil size={11} />
              </button>
            )}
          </>
        )}
      </div>
      {summary ?? <div className="h-full shrink-0 bg-surface" style={{ width: leftW - STICKY_W }} />}
      <div className="relative h-full shrink-0" style={{ width: totalDays * pxPerDay }}>
        {tip && (
          <HoverTip x={tip.x} y={tip.y}>
            <TipHead title={block.group.name} subtitle="Group" color={GROUP_BAR_COLOR} />
            <div className="flex flex-col gap-1 px-3 py-2.5">
              <TipRow
                label="Runs"
                value={
                  block.undated ? "no dates yet" : dateRangeLabel(block.start, block.due, true)
                }
              />
              <TipRow label="Tasks" value={String(block.rows.length)} />
            </div>
          </HoverTip>
        )}
        {/* Nothing dated under it, so there is no span to claim. */}
        {!block.undated && (
          <span
            className="absolute"
            style={{ left, width, top: collapsed ? top : GROUP_LINE_TOP }}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setTip(null)}
          >
            {/*
              TWO shapes for the two states, at Nitsan's direction, and the switch
              is the point: what a group needs to say changes when you fold it.

              OPEN — a thin brand-blue RULE with the name above it, and no end
              tips. The rows are right there underneath, so the group only has to
              bracket them; tips are the section's device and repeating them one
              level down made two brackets of the same shape in different sizes.

              FOLDED — the rows are gone, so the group has to stand in for them:
              a real bar, with OPAQUE shims stacked behind its top edge to say it
              is more than one task, and the name on it.

              ⚠️ Elements, not `box-shadow`: CSS allows exactly ONE box-shadow
              declaration per rule, which is why `barShadow` had to be composed.
            */}
            {collapsed ? (
              <>
                {Array.from({ length: GROUP_LAYERS }, (_, i) => {
                  const step = GROUP_LAYERS - i; // furthest shim first
                  const inset = GROUP_LAYER_INSET * step;
                  // No room to taper on a narrow bar; drawing one anyway leaves
                  // the shims wider than the bar they sit behind.
                  if (width - inset * 2 < 8) return null;
                  return (
                    <span
                      key={i}
                      className="absolute rounded-[3px]"
                      style={{
                        left: inset,
                        width: width - inset * 2,
                        top: -GROUP_LAYER_STEP * step,
                        height: GROUP_BAR_H,
                        // Solid, NOT a faded copy of the bar — at 45%/35% opacity
                        // these read as a rendering artefact rather than as more
                        // bars. See GROUP_LAYER_COLORS.
                        backgroundColor: GROUP_LAYER_COLORS[i],
                      }}
                    />
                  );
                })}
                <span
                  className="absolute inset-x-0 flex items-center overflow-hidden rounded-[3px] px-1.5"
                  style={{ top: 0, height: GROUP_BAR_H, backgroundColor: GROUP_BAR_COLOR }}
                >
                  {/* ⚠️ Ink is `--surface`, NOT white — the label is punched OUT
                      of the bar, showing the row's own background through it.
                      `--group-bar` is DARK blue in the three light themes and
                      LIGHT blue under `night` (see globals.css), so a fixed white
                      would fall to 3.5:1 there. Punching it out means the pair
                      inverts together: 6.9:1 light, 5.3:1 night. */}
                  {width >= BAR_LABEL_MIN_PX && (
                    <span
                      className="truncate text-[11px] font-semibold leading-none"
                      style={{ color: "var(--surface)" }}
                    >
                      {block.group.name}
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                {/* `leading-none` so the box is the glyphs and nothing else —
                    with default leading the caption carries ~6px of invisible
                    padding and sits adrift of the rule it names. */}
                <span
                  className="pointer-events-none absolute whitespace-nowrap text-[11px] font-semibold leading-none"
                  style={{ left: 1, top: -13, color: GROUP_BAR_COLOR }}
                >
                  {block.group.name}
                </span>
                <span
                  className="absolute inset-x-0 top-0 rounded-[1px]"
                  style={{ height: SECTION_BAR_H, backgroundColor: GROUP_BAR_COLOR }}
                />
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
