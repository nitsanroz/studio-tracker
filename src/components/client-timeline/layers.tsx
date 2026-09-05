"use client";

// The three things drawn BEHIND and THROUGH the bars: the calendar grid, the
// today marker and the client's milestones.
//
// ⚠️ A milestone needs its line UNDER the bars (a mark locates the work, it does
// not cross it out) and its label ABOVE everything. That is why they are two
// layers rather than one — a single wrapper with a z-index makes a stacking
// context the label can never escape.

import { RULER_H } from "./shared";
import { SHADE_MIN_PX_PER_DAY, daysBetween, isWorkDay, parseISO, shiftDays, ticksFor, toISO } from "@/lib/gantt";
import type { Zoom } from "@/lib/gantt";
import type { TimelineMark } from "@/lib/types";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";


/** The blue plumb-line with a dot on the header, as in the reference. */
export function TodayLine({ left, height }: { left: number; height: number }) {
  return (
    // ⚠️ z-5 is a LAYER BETWEEN, and it has to be: above the rows (whose bottom
    // borders would otherwise chop the line into 34px dashes, as they did to the
    // milestones) but below the bars, which carry z-10 so the work reads over
    // the date rather than under it.
    <div className="pointer-events-none absolute top-0 z-[5]" style={{ left }} title="Today">
      {/* No cap here: the marker's head is the dated tag in the ruler, and its
          tail is the point. Two heads for one day was one too many. */}
      {/* BLACK, not brand. Today is the one vertical you look for first, and it
          was competing with the milestones for the same blue — telling the two
          apart meant reading their caps. Now they differ by HUE: today is the
          fact, the milestones are the plan. */}
      <div className="w-0.5 bg-foreground" style={{ height }} />
    </div>
  );
}



/**
 * A milestone: a vertical line across the whole chart with its name at the top.
 *
 * Drawn UNDER the bars (z-0 against their z-10) so it marks the work without
 * cutting through it, and the label sits above everything so it stays readable
 * where a bar happens to cross the line.
 */
export function MarkLayer({
  marks,
  from,
  pxPerDay,
  height,
  leftW,
  canEdit,
  editingId,
  onEdit,
  onRename,
  onMove,
  onDelete,
}: {
  marks: TimelineMark[];
  from: Date;
  pxPerDay: number;
  height: number;
  leftW: number;
  canEdit: boolean;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, days: number) => void;
  onDelete: (id: string) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; startX: number; days: number } | null>(null);
  /**
   * Set when a drag actually moved, and read by the rename button's click.
   *
   * ⚠️ The drag deliberately does NOT `preventDefault` on pointerdown: that
   * suppresses the click that follows, which is how the trash button came to do
   * nothing at all. Letting the click through and suppressing it HERE keeps both
   * gestures on the same element.
   */
  const movedRef = useRef(false);

  function startDrag(id: string, clientX: number) {
    let live = { id, startX: clientX, days: 0 };
    movedRef.current = false;
    setDrag(live);
    const move = (e: PointerEvent) => {
      const days = Math.round((e.clientX - live.startX) / pxPerDay);
      if (days === live.days) return;
      movedRef.current = true;
      live = { ...live, days };
      setDrag(live);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (live.days !== 0) onMove(live.id, live.days);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const positioned = marks.map((m) => ({
    m,
    left: (daysBetween(from, parseISO(m.onDate)) + (drag?.id === m.id ? drag.days : 0)) * pxPerDay,
  }));

  return (
    /*
      TWO layers, because the line and its label want opposite depths.
      ⚠️ The root carries no z-index of its own: a positioned element WITH one
      creates a stacking context, and the label could then never rise above the
      bars no matter what it asked for — which is why the name field was being
      covered by the section bar it sat on.
    */
    <div className="pointer-events-none absolute top-0" style={{ left: leftW, width: 1, height }}>
      {/*
        ONE line each, ABOVE the rows.
        ⚠️ Under them it came out as a dashed column: every row carries
        `border-b border-border`, and each of those borders painted across the
        line, leaving a 1px gap every 34px. Nothing was wrong with the line — it
        was being interrupted 40 times. Above the rows it crosses the bars, which
        is the trade for a milestone reading as one continuous mark.
      */}
      <div className="absolute top-0 z-20" style={{ width: 1, height }}>
        {positioned.map(({ m, left }) => (
          <div key={m.id} className="absolute top-0 w-0.5 bg-brand/50" style={{ left, height }} />
        ))}
      </div>

      {/* The labels, ABOVE everything: they carry the name, the rename and the
          delete, and a control you cannot see is not a control. */}
      <div className="absolute top-0 z-[23]" style={{ width: 1, height }}>
      {positioned.map(({ m, left }) => {
        const editing = editingId === m.id;
        return (
          // The wrapper is full height so the label has somewhere to travel:
          // `sticky` needs a containing block taller than itself or it never
          // moves. It rides down the chart under the ruler as you scroll, so a
          // milestone 40 rows down still says what it is.
          <div key={m.id} className="absolute top-0" style={{ left, height }}>
            <div
              // A FLAG: square where it meets its pole, rounded away from it,
              // and offset by the line's own width so the line runs beside it
              // rather than under it.
              className={`group/mark pointer-events-auto sticky flex max-w-[220px] items-center gap-1 whitespace-nowrap rounded-r-md border border-l-0 border-brand bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-brand-dark shadow-sm ${
                canEdit && !editing ? "cursor-grab active:cursor-grabbing" : ""
              }`}
              style={{ top: RULER_H, marginLeft: 2 }}
              onPointerDown={(e) => {
                if (!canEdit || editing) return;
                // NOT the trash: a pointerdown that starts a drag there would
                // eat the click that deletes.
                if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
                startDrag(m.id, e.clientX);
              }}
            >
              {editing ? (
                <input
                  autoFocus
                  defaultValue={m.title}
                  placeholder="Name this milestone…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      // An empty name means the mark was never really made — a
                      // nameless line on a client's plan is worse than no line.
                      if (!m.title) onDelete(m.id);
                      onEdit(null);
                    }
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (!v && !m.title) onDelete(m.id);
                    else if (v !== m.title) onRename(m.id, v);
                    onEdit(null);
                  }}
                  className="w-40 min-w-0 rounded border border-brand bg-surface px-1 py-0 text-[11px] font-semibold text-foreground outline-none"
                />
              ) : (
                <>
                  <button
                    onClick={() => {
                      // A drag ends in a click on the thing you dragged. Renaming
                      // on it would open the editor every time you moved a mark.
                      if (movedRef.current) {
                        movedRef.current = false;
                        return;
                      }
                      if (canEdit) onEdit(m.id);
                    }}
                    title={canEdit ? "Rename" : m.title}
                    className="min-w-0 truncate"
                  >
                    {m.title || "Untitled"}
                  </button>
                  {canEdit && (
                    <button
                      data-no-drag=""
                      onClick={() => onDelete(m.id)}
                      title="Delete milestone"
                      aria-label={`Delete ${m.title || "milestone"}`}
                      className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover/mark:opacity-100"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}


export function GridLayer({
  from,
  totalDays,
  zoom,
  pxPerDay,
  off,
  offLabel,
  height,
  leftW,
}: {
  from: Date;
  totalDays: number;
  zoom: Zoom;
  pxPerDay: number;
  off: Set<string>;
  offLabel: Map<string, string>;
  height: number;
  leftW: number;
}) {
  const { ticks } = ticksFor(from, totalDays, zoom, pxPerDay);
  // At 3px a day the stripes would be denser than the data sitting on them.
  const shade = pxPerDay >= SHADE_MIN_PX_PER_DAY;
  const offDays: { left: number; title: string }[] = [];
  if (shade) {
    for (let d = 0; d < totalDays; d++) {
      const date = shiftDays(from, d);
      if (isWorkDay(date, off)) continue;
      const iso = toISO(date);
      offDays.push({
        left: d * pxPerDay,
        title: offLabel.get(iso) ?? (date.getDay() === 5 ? "Friday — weekend" : "Saturday — weekend"),
      });
    }
  }

  return (
    <div
      className="pointer-events-none absolute top-0"
      style={{ left: leftW, width: totalDays * pxPerDay, height }}
      aria-hidden
    >
      {offDays.map((d) => (
        <div
          key={d.left}
          className="absolute top-0 h-full bg-foreground/[0.045]"
          style={{ left: d.left, width: pxPerDay }}
          title={d.title}
        />
      ))}
      {ticks.map((t) => (
        // Weak on purpose: the grid lets you read a date off a bar, it isn't a
        // table. Anything stronger competes with the bars. A MONTH boundary is
        // the exception — it is the one line worth finding at a glance, and it
        // continues the rule under that month's name in the header, so the two
        // read as one divider running the height of the chart.
        //
        // `foreground/15`, not `border-strong`: that token computes to oklab
        // lightness 0.87, which next to the weekly rules at 0.93/40% was a
        // difference you had to be told about to see.
        <div
          key={t.left}
          className={`absolute top-0 h-full border-l ${
            t.boundary
              ? "border-foreground/[0.18]"
              : t.weekStart
                ? "border-foreground/10"
                : "border-border/40"
          }`}
          style={{ left: t.left }}
        />
      ))}
    </div>
  );
}
