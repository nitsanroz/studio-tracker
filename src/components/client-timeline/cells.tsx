"use client";

// The editable cells of the left table, and the row composer.
//
// Each one is a control that writes a task field, kept apart from the row that
// lays them out so the row reads as a layout and these read as behaviour.

import { Avatar } from "../ui";
import { PANEL_H } from "./shared";
import type { DragState, Row } from "./shared";
import { ROW_H, addWorkDays, dateRangeLabel, daysBetween, isWorkDay, parseISO, shiftDays, snapToWorkDay, toISO, workDaysBetween } from "@/lib/gantt";
import { useData } from "@/lib/store";
import type { Profile } from "@/lib/types";
import { useEffect, useRef, useState } from "react";


/**
 * The inline name field for a task being inserted at a chosen place on the chart.
 *
 * It occupies a real row so the bars below it move down as you type — the point
 * of the command is placement, and an editor floating somewhere else would not
 * show you where the task is about to land.
 *
 * ⚠️ It creates the task with `copyDates`, seeding start and due from the anchor.
 * The Timeline only draws tasks that HAVE a due date, so a dateless insert would
 * disappear the instant it was created and read as a failed command. Landing on
 * the anchor's dates puts the bar exactly where the row is, ready to drag.
 */
export function TimelineInsertRow({
  anchorId,
  where,
  leftW,
  width,
  onDone,
}: {
  anchorId: string;
  where: "before" | "after";
  leftW: number;
  width: number;
  onDone: () => void;
}) {
  const { addTaskNear } = useData();
  const [title, setTitle] = useState("");

  const commit = () => {
    if (title.trim()) addTaskNear(anchorId, where, title.trim(), { copyDates: true });
    onDone();
  };

  return (
    <form
      className="relative flex border-b border-border bg-brand-soft/40"
      style={{ height: ROW_H, width }}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <div
        className="sticky left-0 z-20 flex h-full shrink-0 items-center bg-brand-soft px-2"
        style={{ width: leftW }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone();
            // Explicit, not implicit form submission: the input sits inside a
            // wrapper div and a form with no submit button can't be relied on to
            // submit on Enter — it silently did nothing.
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={`New task ${where} this one — Enter to add`}
          className="bidi-auto w-full bg-transparent text-xs outline-none"
        />
      </div>
    </form>
  );
}


/**
 * The dates a drag implies, in WORKING days.
 *
 *  · every date lands on a working day (`snapToWorkDay`, in the drag's own
 *    direction, so pushing a bar right never snaps it backwards);
 *  · a MOVE preserves the bar's length in working days, so the same amount of
 *    work is booked and the bar simply spans the weekend it now crosses.
 */
export function plannedPatch(
  row: Row,
  mode: DragState["mode"],
  deltaDays: number,
  off: Set<string>,
): { startDate?: string | null; dueDate?: string } | null {
  const dir: 1 | -1 = deltaDays >= 0 ? 1 : -1;

  if (mode === "move") {
    if (!row.hasStart) {
      // A deadline marker has no duration to preserve — it just moves.
      return { dueDate: toISO(snapToWorkDay(shiftDays(row.due, deltaDays), dir, off)) };
    }
    const workLen = workDaysBetween(row.start, row.due, off);
    const start = snapToWorkDay(shiftDays(row.start, deltaDays), dir, off);
    return { startDate: toISO(start), dueDate: toISO(addWorkDays(start, workLen - 1, off)) };
  }

  if (mode === "start") {
    const next = snapToWorkDay(shiftDays(row.start, deltaDays), dir, off);
    const clamped = next > row.due ? snapToWorkDay(row.due, -1, off) : next;
    // Dragging the left edge back onto the due date means "a deadline again".
    return { startDate: daysBetween(clamped, row.due) === 0 ? null : toISO(clamped) };
  }

  const next = snapToWorkDay(shiftDays(row.due, deltaDays), dir, off);
  return { dueDate: toISO(next < row.start ? snapToWorkDay(row.start, 1, off) : next) };
}


/**
 * The Dates cell, click-to-edit for admins.
 *
 * Dragging is good for "a bit later, a bit longer" and hopeless for "the 14th".
 * This is the exact-date path: both ends in one popover, committed as ONE
 * `updateTask` so it stays one undo step alongside the drags.
 *
 * ⚠️ Rendered `fixed`, positioned from the cell's own rect. The chart lives in
 * an `overflow-x-auto` scroller, and a scroll container clips BOTH axes — an
 * absolutely-positioned popover would be cut off at the row's bottom edge.
 *
 * Unlike a drag, a typed date is NOT snapped to a working day: naming the 14th
 * is explicit in a way that nudging a bar isn't. A non-working choice is
 * accepted and labelled rather than silently moved.
 */
export function DatesCell({
  row,
  canEdit,
  width,
  off,
  onSet,
}: {
  row: Row;
  canEdit: boolean;
  width: number;
  off: Set<string>;
  onSet: (startDate: string | null, dueDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  // ⚠️ An undated row borrows today's date so the row shape stays valid, so the
  // cell must NOT read `row.due` — it would state a due date the task does not
  // have. It shows an invitation instead, and the editor opens empty.
  const startISO = row.undated || !row.hasStart ? "" : toISO(row.start);
  const dueISO = row.undated ? "" : toISO(row.due);
  const label = row.undated ? "Set dates" : dateRangeLabel(row.start, row.due, row.hasStart);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!canEdit) {
    return (
      <span
        className="shrink-0 border-l border-border px-2 text-xs tabular-nums text-muted"
        style={{ width }}
      >
        {label}
      </span>
    );
  }

  function commit(nextStart: string, nextDue: string) {
    if (!nextDue) return; // a bar has to end somewhere
    // A start after the due date would draw backwards; treat it as the new due.
    const s = nextStart && nextStart > nextDue ? nextDue : nextStart;
    onSet(s || null, nextDue);
  }

  const nonWorking = [
    startISO && !isWorkDay(parseISO(startISO), off) ? "start" : null,
    !isWorkDay(parseISO(dueISO), off) ? "due" : null,
  ].filter(Boolean);

  return (
    <>
      <button
        ref={btn}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          // FLIP UP when there isn't room below. On the last rows of a long
          // timeline the panel opened downwards and its Done button landed
          // past the bottom of the window, where nothing could reach it.
          const below = window.innerHeight - r.bottom;
          const top =
            below < PANEL_H + 12 ? Math.max(8, r.top - PANEL_H - 4) : r.bottom + 4;
          setPos({ left: r.left, top });
          setOpen(true);
        }}
        title="Click to set exact dates"
        className="shrink-0 border-l border-border px-2 text-left text-xs tabular-nums text-muted hover:text-brand"
        style={{ width, height: "100%" }}
      >
        {label}
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-60 rounded-xl border border-border bg-surface p-3 shadow-xl pop-in"
            style={{ left: Math.min(pos.left, window.innerWidth - 250), top: pos.top }}
          >
            <div className="mb-2 truncate text-xs font-semibold" title={row.task.title}>
              {row.task.title}
            </div>
            <label className="mb-2 flex items-center gap-2 text-xs">
              <span className="w-10 shrink-0 text-muted">Start</span>
              {/* An empty start opens on the DUE date's month rather than on
                  today — a task due in October shouldn't make you page back
                  two months to give it a start. Uncontrolled so the seed is a
                  starting point, not a saved value; the key re-seeds it when
                  the due date moves. */}
              <input
                key={`start-${startISO || dueISO}`}
                type="date"
                defaultValue={startISO || dueISO}
                max={dueISO}
                onChange={(e) => commit(e.target.value, dueISO)}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 outline-none focus:border-brand"
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <span className="w-10 shrink-0 text-muted">Due</span>
              <input
                type="date"
                value={dueISO}
                onChange={(e) => commit(startISO, e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 outline-none focus:border-brand"
              />
            </label>
            {nonWorking.length > 0 && (
              <p className="mt-2 text-[11px] text-warning">
                The {nonWorking.join(" and ")} date {nonWorking.length > 1 ? "are" : "is"} not a
                working day. Kept as typed.
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              {row.hasStart && (
                <button
                  onClick={() => onSet(null, dueISO)}
                  title="Back to a deadline with no scheduled span"
                  className="rounded-md px-2 py-1 text-[11px] text-muted hover:bg-background hover:text-danger"
                >
                  Clear start
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="ml-auto rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-dark"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}


/**
 * The face, and a real list of people behind it.
 *
 * A `<select>` in a 44px cell was technically an editor and practically
 * unusable — the control was 30px wide with a 20px avatar on top of it, and
 * picking anyone meant hitting a native menu you couldn't see. This is a
 * plain button that opens a list with faces and names in it.
 */
export function AssigneeCell({
  assignee,
  canEdit,
  profiles,
  onAssign,
}: {
  assignee: Profile | null;
  canEdit: boolean;
  profiles: Profile[];
  onAssign: (id: string | null) => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pos]);

  if (!canEdit) return <Avatar profile={assignee} size={20} />;

  const listH = Math.min(240, 40 + profiles.length * 30);

  return (
    <>
      <button
        ref={btn}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          // `fixed` from the measured rect, and flipped when the window runs
          // out below: this cell lives inside a scroller that clips BOTH axes,
          // so an absolutely-positioned list would be cut off on the last rows.
          const below = window.innerHeight - r.bottom;
          setPos({
            left: r.left,
            top: below < listH + 12 ? Math.max(8, r.top - listH - 4) : r.bottom + 4,
          });
        }}
        title={assignee ? `${assignee.name} — click to reassign` : "Unassigned — click to assign"}
        className="rounded-full outline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-brand"
      >
        <Avatar profile={assignee} size={20} />
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div
            className="fixed z-50 flex w-44 flex-col overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl pop-in"
            style={{ left: Math.min(pos.left, window.innerWidth - 190), top: pos.top, maxHeight: listH }}
          >
            <button
              onClick={() => {
                onAssign(null);
                setPos(null);
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted hover:bg-background"
            >
              <Avatar profile={null} size={18} />
              Unassigned
            </button>
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onAssign(p.id);
                  setPos(null);
                }}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-background ${
                  p.id === assignee?.id ? "font-semibold text-brand" : ""
                }`}
              >
                <Avatar profile={p} size={18} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
