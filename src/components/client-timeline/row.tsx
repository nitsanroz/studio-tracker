"use client";

// One task's row: the left table's cells, and the bar (or diamond) it draws.
//
// ⚠️ The biggest single piece of this view, and it takes EVERYTHING as props —
// no store reads, no context. That is what lets the chart own the drag state and
// the writes while this file stays about what a row looks like.

import { EditableNumberCell, EditableSelectCell, EditableTextCell } from "../editable-cell";
import { AssigneeCell, DatesCell } from "./cells";
import { ASSIGNEE_W, BAR_SHADOW, CHECK_W, DATES_W, DURATION_W, GRIP_W, HANDLE_MIN_PX, HOURS_W, LABEL_MIN_PX, LABEL_ON_FILL_PCT, NAME_W, ROW_HOVER_SHEER, ROW_HOVER_SOLID, ROW_SELECTED_SHEER, STICKY_W, TYPE_W, dragRow, maxDate, minDate } from "./shared";
import type { DragState, Row, TlCol } from "./shared";
import { HoverTip, TipHead, TipRow } from "./tooltip";
import { formatHoursDecimal } from "@/lib/format";
import { BAR_H, BAR_LABEL_MIN_PX, BAR_R, DIAMOND, ROW_H, dateRangeLabel, daysBetween, shiftDays, workDaysBetween } from "@/lib/gantt";
import type { Profile, TaskType } from "@/lib/types";
import { CheckCircle2, Circle, GripVertical, Maximize2, Pencil } from "lucide-react";
import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";


export function TimelineRow({
  row,
  from,
  pxPerDay,
  totalDays,
  leftW,
  hidden,
  canEdit,
  indent = 0,
  off,
  drag,
  /** 5C: true for ~240ms after a drag commits — see the ⚠️ where it is armed. */
  settling,
  dropTarget,
  selected,
  anySelected,
  assignableProfiles,
  onSelect,
  onDragStart,
  onRowDragStart,
  onRowDragOver,
  onRowDrop,
  onRowDragEnd,
  onOpen,
  onSetDates,
  onRename,
  onAssign,
  onSetBudget,
  onSetDuration,
  taskTypes,
  onSetType,
  onContextMenu,
  plain,
}: {
  row: Row;
  from: Date;
  pxPerDay: number;
  totalDays: number;
  leftW: number;
  hidden: Set<string>;
  canEdit: boolean;
  /** Left padding for a row nested inside a group (0027). */
  indent?: number;
  off: Set<string>;
  drag: DragState | null;
  settling: boolean;
  dropTarget: boolean;
  selected: boolean;
  /** keeps every checkbox visible once one is ticked, so the set is legible */
  anySelected: boolean;
  assignableProfiles: Profile[];
  onSelect: (shiftKey: boolean, on: boolean) => void;
  onDragStart: (mode: DragState["mode"], clientX: number) => void;
  onRowDragStart: () => void;
  onRowDragOver: () => void;
  onRowDrop: () => void;
  onRowDragEnd: () => void;
  onOpen: () => void;
  onSetDates: (startDate: string | null, dueDate: string) => void;
  onRename: (title: string) => void;
  onAssign: (assigneeId: string | null) => void;
  onSetBudget: (hours: number | null) => void;
  /** working days → a new DUE date; the start never moves */
  onSetDuration: (workDays: number) => void;
  /** every type in the studio, not just the ones this client already uses */
  taskTypes: TaskType[];
  onSetType: (typeId: string | null) => void;
  /** right-click → "Add task above/below"; the chart owns the menu and the composer */
  onContextMenu?: (e: ReactMouseEvent, taskId: string) => void;
  /** draw this bar plain — no type colour */
  plain: boolean;
}) {
  const { task } = row;
  const [renaming, setRenaming] = useState(false);
  /** Pointer position of the last mouseenter on this row's bar, or null. */
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const show = (key: TlCol) => !hidden.has(key);
  // While dragging, the bar follows the pointer without a single write; the
  // dates only reach the store on pointerup.
  const delta = drag?.deltaDays ?? 0;
  const previewStart =
    drag?.mode === "move"
      ? shiftDays(row.start, delta)
      : drag?.mode === "start"
        ? minDate(shiftDays(row.start, delta), row.due)
        : row.start;
  const previewDue =
    drag?.mode === "move"
      ? shiftDays(row.due, delta)
      : drag?.mode === "end"
        ? maxDate(shiftDays(row.due, delta), row.start)
        : row.due;

  // A live left-edge drag turns a deadline into a span before it's committed.
  const hasSpan = row.hasStart || (drag?.mode === "start" && delta !== 0);
  const offsetDays = daysBetween(from, previewStart);
  const spanDays = Math.max(1, daysBetween(previewStart, previewDue) + 1);
  const left = offsetDays * pxPerDay;
  // 10px floor: at month zoom (3px/day) a three-day task would be a 9px sliver.
  const barWidth = Math.max(10, spanDays * pxPerDay);

  const estimate = task.estimateHours;
  const doneH = row.doneMinutes / 60;
  const pct = estimate && estimate > 0 ? Math.min(100, (doneH / estimate) * 100) : 0;
  const over = estimate != null && doneH > estimate;
  const done = task.status === "done";
  const workLen = workDaysBetween(previewStart, previewDue, off);
  // A task with no type keeps the brand blue — untyped is normal, not degraded.
  const color = row.type?.color ?? "#0b43ed";

  /**
   * A bar's rings and lift, in ONE declaration — CSS allows only one
   * `box-shadow`, so selection, the plain-mode outline and the drop shadow have
   * to be composed rather than layered from different places.
   *
   * Selection REPLACES the plain outline rather than stacking with it — two
   * inset rings on a 27px bar is a bullseye — and matches its weight, so the
   * only thing that changes when you select a bar is the colour of its edge.
   */
  const barShadow = [
    // 1px, matching the plain-mode outline it replaces: at 2px the ring was
    // heavier than the bar it was drawn on, and a row of selected bars read as
    // a row of buttons.
    selected
      ? "inset 0 0 0 1px var(--brand)"
      : plain
        ? "inset 0 0 0 1px var(--color-border-strong)"
        : null,
    BAR_SHADOW,
  ]
    .filter(Boolean)
    .join(", ");

  const typeDisplay = row.type ? (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: row.type.color }}
        aria-hidden
      />
      <span className="truncate">{row.type.name}</span>
    </span>
  ) : null;

  const hoursLabel =
    estimate != null
      ? `${formatHoursDecimal(row.doneMinutes)}/${estimate}h`
      : `${formatHoursDecimal(row.doneMinutes)}h`;

  const title = [
    task.title,
    row.type ? `Type: ${row.type.name}` : undefined,
    row.undated
      ? "No dates yet — set them to place this on the chart"
      : hasSpan
        ? `${dateRangeLabel(previewStart, previewDue, true)} · ${workLen} working day${workLen === 1 ? "" : "s"}`
        : `Due ${dateRangeLabel(previewStart, previewDue, false)} — no start date, so no duration`,
    estimate != null ? `${hoursLabel} logged` : `${hoursLabel} logged, no budget`,
    canEdit ? "Drag to move · drag an edge to resize" : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const cell = "shrink-0 border-l border-border px-2 text-xs";

  return (
    <div
      className={`group/trow relative flex border-b border-border last:border-b-0 ${
        dropTarget ? "shadow-[inset_0_2px_0_0_var(--brand)]" : ""
      }`}
      style={{ height: ROW_H, width: leftW + totalDays * pxPerDay }}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, task.id) : undefined}
      onDragOver={(e) => {
        if (!dragRow.id) return;
        e.preventDefault();
        onRowDragOver();
      }}
      onDrop={onRowDrop}
    >
      {/* Only this block is sticky — see STICKY_W. */}
      <div
        className={`sticky left-0 z-20 flex h-full shrink-0 items-center ${
          selected ? "bg-brand-soft" : `bg-surface ${ROW_HOVER_SOLID}`
        }`}
        // ⚠️ Padding, not a margin: this block is `STICKY_W` wide and the width
        // must not change, or the row stops lining up with the columns beside it.
        // The grip and checkbox come with it, unlike the client table's rows,
        // because here they sit INSIDE this block rather than in a gutter.
        style={{ width: STICKY_W, paddingLeft: indent }}
      >
        <span
          draggable={canEdit}
          onDragStart={onRowDragStart}
          onDragEnd={onRowDragEnd}
          title={canEdit ? "Drag to reorder within this section" : undefined}
          className={`flex h-full shrink-0 items-center justify-center text-faint ${
            canEdit ? "cursor-grab opacity-0 group-hover/trow:opacity-100" : ""
          }`}
          style={{ width: GRIP_W }}
        >
          {canEdit && <GripVertical size={12} />}
        </span>
        {/* Was the completion circle. It duplicated the strikethrough and the
            dimming that already say "done", and cost the row the one control a
            Gantt actually wants: a way to pick several tasks and set a date, a
            type or a status on all of them at once. */}
        <span
          className="flex h-full shrink-0 items-center justify-center"
          style={{ width: CHECK_W }}
        >
          {canEdit ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect((e.nativeEvent as MouseEvent).shiftKey === true, e.target.checked)}
              title="Select — shift-click for a range"
              aria-label={`Select ${task.title}`}
              className={`size-3.5 cursor-pointer accent-[var(--brand)] ${
                selected || anySelected ? "" : "opacity-0 group-hover/trow:opacity-100"
              }`}
            />
          ) : done ? (
            <CheckCircle2 size={14} className="text-success" />
          ) : (
            <Circle size={14} className="text-faint" />
          )}
        </span>
        {/*
          Body weight, not `font-medium`.

          globals.css collapses `.font-medium`, `.font-semibold` and `.font-bold`
          onto ONE weight — Saans is used at 380 and 570 and nothing else, per the
          Figma round-trip. So a task name at `font-medium` and a section name at
          `font-semibold` were rendering at the SAME 570, and no amount of class
          juggling would separate them. Putting the task at the body weight and
          leaving the section at 570 is the one step of contrast this type system
          actually has — and it's the right way round, since the section is the
          heading and the task is the content.
        */}
        <span
          className={`group/name flex h-full min-w-0 items-center pr-1 ${
            done ? "text-muted line-through" : ""
          }`}
          style={{ width: NAME_W }}
        >
          {renaming ? (
            <span className="min-w-0 flex-1 text-xs">
              <EditableTextCell
                startEditing
                value={task.title}
                onCommit={(v) => {
                  if (v && v !== task.title) onRename(v);
                }}
                onExit={() => setRenaming(false)}
                inputClassName="text-xs"
              />
            </span>
          ) : (
            <>
              <button
                onClick={onOpen}
                title={task.title}
                className="bidi-auto min-w-0 flex-1 truncate text-left text-xs hover:underline"
              >
                {task.title}
              </button>
              {/* The name opens the task too, but nothing SAID so — a plain
                  underline on hover is the weakest signal in the app, and on a
                  Gantt where every other click drags something, "this one opens
                  a panel" needs an icon. Hover-only, like the pencil: at rest
                  the column is names, not a row of controls. */}
              <button
                onClick={onOpen}
                title="Open details"
                aria-label={`Open ${task.title}`}
                className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-brand group-hover/name:opacity-100"
              >
                <Maximize2 size={11} />
              </button>
              {canEdit && (
                // Click opens the task, the pencil renames it. One target each:
                // making the name itself an editor would take away the only way
                // to open a task from this table.
                <button
                  onClick={() => setRenaming(true)}
                  title="Rename"
                  aria-label="Rename"
                  className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-brand group-hover/name:opacity-100"
                >
                  <Pencil size={11} />
                </button>
              )}
            </>
          )}
        </span>
      </div>

      {/* The rest of the table scrolls away with the chart. */}
      <div
        className={`flex h-full shrink-0 items-center ${
          selected ? "bg-brand-soft" : `bg-surface ${ROW_HOVER_SOLID}`
        }`}
        style={{ width: leftW - STICKY_W }}
      >
        {show("who") && (
          <span
            className="flex h-full shrink-0 items-center justify-center border-l border-border"
            style={{ width: ASSIGNEE_W }}
          >
            <AssigneeCell
              assignee={row.assignee}
              canEdit={canEdit}
              profiles={assignableProfiles}
              onAssign={onAssign}
            />
          </span>
        )}
        {/* The type is what colours this row's bar, so a legend on the right and
            no per-row answer meant counting swatches to find out what a bar was.
            Admin-only here, like every other editor in this table — members can
            still set a task's type from the client table, where 0024 allows it. */}
        {show("type") && (
          <span
            className="flex h-full shrink-0 items-center border-l border-border px-0.5"
            style={{ width: TYPE_W }}
          >
            <span className="min-w-0 flex-1">
              {canEdit ? (
                <EditableSelectCell
                  value={task.typeId ?? ""}
                  options={taskTypes.map((t) => ({ value: t.id, label: t.name }))}
                  onCommit={(v) => onSetType(v || null)}
                  emptyLabel="No type"
                  display={typeDisplay}
                />
              ) : (
                <span className="block truncate px-1.5 py-0.5 text-xs">
                  {typeDisplay ?? <span className="text-faint">–</span>}
                </span>
              )}
            </span>
          </span>
        )}
        {show("dates") && (
          <DatesCell row={row} canEdit={canEdit} width={DATES_W} off={off} onSet={onSetDates} />
        )}
        {show("duration") && (
          <span
            className={`${cell} tabular-nums ${row.hasStart && !row.undated ? "text-muted" : "text-faint"}`}
            style={{ width: DURATION_W }}
            title={
              row.hasStart
                ? canEdit
                  ? "Working days — type a number to move the DUE date; the start stays put"
                  : "Working days"
                : "No start date — this is a deadline, not a span"
            }
          >
            {/* Editable only when the task HAS a span. A deadline has no
                duration to change, and typing one would have to invent a start
                date — which is a different decision, made by dragging the
                diamond's left edge or by the Dates cell. */}
            {row.hasStart && !row.undated && canEdit ? (
              <EditableNumberCell
                value={workLen}
                onCommit={(v) => v != null && v >= 1 && onSetDuration(Math.round(v))}
                format={(v) => `${v} day${v === 1 ? "" : "s"}`}
              />
            ) : row.hasStart && !row.undated ? (
              `${workLen} day${workLen === 1 ? "" : "s"}`
            ) : (
              "—"
            )}
          </span>
        )}
        {show("actual") && (
          <span
            className={`${cell} text-right tabular-nums ${over ? "font-semibold text-danger" : "text-foreground"}`}
            style={{ width: HOURS_W }}
            title={`${formatHoursDecimal(row.doneMinutes)}h logged`}
          >
            {row.doneMinutes > 0 ? `${formatHoursDecimal(row.doneMinutes)}h` : "–"}
          </span>
        )}
        {show("budget") && (
          <span className={`${cell} text-right tabular-nums text-muted`} style={{ width: HOURS_W }}>
            {canEdit ? (
              <EditableNumberCell
                value={estimate}
                onCommit={(v) => onSetBudget(v)}
                className="text-right"
              />
            ) : estimate != null ? (
              `${estimate}h`
            ) : (
              "–"
            )}
          </span>
        )}
      </div>

      {/* The hover tint runs the FULL width of the row — it stopped where the
          pinned columns ended, so following a row out to its bar meant tracking
          an untinted gap. Translucent on purpose: the rows paint over the grid
          layer, and an opaque tint would blank that row's weekend shading and
          month rules. */}
      <div
        // The marquee starts from THIS element and no other: bars are its
        // children, so a pointerdown that lands on one arrives with the bar as
        // its target and is left to the bar's own drag.
        data-chart-bg=""
        className={`relative h-full shrink-0 ${
          selected ? ROW_SELECTED_SHEER : ROW_HOVER_SHEER
        }`}
        style={{ width: totalDays * pxPerDay }}
      >
      {/* Suppressed while dragging: the drag chip is already saying where this
          bar is going, and two panels following one pointer is one too many. */}
      {tip && !drag && (
        <HoverTip x={tip.x} y={tip.y}>
          <TipHead title={task.title} subtitle={row.type?.name ?? "No type"} color={color} />
          <div className="flex flex-col gap-1 px-3 py-2.5">
            {hasSpan ? (
              <>
                <TipRow label="Dates" value={dateRangeLabel(previewStart, previewDue, true)} />
                <TipRow
                  label="Duration"
                  value={`${workLen} working day${workLen === 1 ? "" : "s"}`}
                />
              </>
            ) : (
              <TipRow label="Due" value={dateRangeLabel(previewDue, previewDue, false)} />
            )}
            <TipRow
              label="Logged"
              value={estimate != null ? hoursLabel : `${hoursLabel} · no budget`}
              danger={over}
            />
          </div>
          {/* The instructions are the only line here that is the same on every
              bar, so they sit apart and smaller — read once, then ignorable. */}
          {canEdit && (
            <div className="px-3 pb-2.5 text-[10px] text-faint">
              {hasSpan ? "Drag to move · drag an edge to resize" : "Drag to move · alt-drag to give it a start"}
            </div>
          )}
        </HoverTip>
      )}
      {/*
        Live readout while dragging. Dragging a bar used to be blind — you were
        aiming a rectangle at a column of week ticks and only learned the date
        you'd chosen after you let go. It sits BESIDE the edge being dragged,
        inside the row: the chart is in a scroller that clips both axes, so a
        chip floating above the bar would be cut off on the top row.
      */}
      {/* ONE chip, on the bar under the pointer. Five chips following a single
          gesture is five times the readout and none of the clarity. */}
      {drag?.taskId === task.id && !row.undated && (
        <span
          className="pointer-events-none absolute top-1/2 z-[23] -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white shadow-lg"
          style={
            drag.mode === "start"
              ? { left: left - 6, transform: "translate(-100%, -50%)" }
              : { left: left + (hasSpan ? barWidth : DIAMOND) + 6 }
          }
        >
          {drag.mode === "move"
            ? dateRangeLabel(previewStart, previewDue, hasSpan)
            : dateRangeLabel(
                drag.mode === "start" ? previewStart : previewDue,
                drag.mode === "start" ? previewStart : previewDue,
                false,
              )}
        </span>
      )}
      {row.undated ? null : hasSpan ? (
        <div
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          aria-label={title}
          onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTip(null)}
          onPointerDown={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            onDragStart("move", e.clientX);
          }}
          onClick={() => {
            if (!canEdit) onOpen();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen();
            }
          }}
          className={`absolute top-1/2 z-10 -translate-y-1/2 overflow-hidden ${
            done ? "opacity-55" : ""
          } ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
            drag ? "ring-2 ring-brand" : ""
          }`}
          style={{
            left,
            width: barWidth,
            height: BAR_H,
            // ⚠️⚠️ 5C, AND THE GATE IS LOAD-BEARING. `left`/`width` are LAYOUT
            // properties, so this transition exists for exactly the ~240ms after a
            // drag commits and at no other time: a standing one would animate every
            // bar on a zoom switch (108 of them on Anchor) and re-flow each frame.
            // `drag &&` excludes the bar under the pointer, which must track the
            // cursor exactly.
            transition:
              settling && !drag
                ? "left 200ms cubic-bezier(0.2, 0, 0, 1), width 200ms cubic-bezier(0.2, 0, 0, 1)"
                : undefined,
            // ~1/4 of the height, matching the reference's proportion. A full
            // pill (radius = half the height) rounded the ends so hard that a
            // short bar stopped reading as a span at all.
            borderRadius: BAR_R,
            // The whole span, tinted: this is the track. `overflow-hidden` plus
            // the pill radius is what squares off the fill's right edge while
            // keeping the bar's own ends round — the shape in the reference.
            //
            // 0x52 (32%), up from 0x3d (24%): the track now carries the task's
            // name, and at 24% a pale tint under dark text made the bar itself
            // disappear and left the name floating on the row background.
            // Plain mode: white with an outline, so the chart can be read (or
            // printed, or handed to someone) without its colour axis. An inset
            // ring rather than a border — a border would eat 2px of a 27px bar
            // and shift the label inside it.
            //
            // ⚠️ Both shadows go in ONE declaration. The drop shadow can't be a
            // class while the ring is inline: the inline `boxShadow` would win
            // and silently drop the class's.
            boxShadow: barShadow,
            backgroundColor: plain ? "var(--color-surface)" : `${color}52`,
          }}
        >
          {/*
            ONE bar: a tinted track for the plan, a solid fill for the hours
            logged against budget. The old design put a 2px rule along the top
            whose opacity tracked completion — it read as a stray hairline
            floating above the bar rather than as part of it, and it said the
            same thing the fill already says.
          */}
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${pct}%`,
              backgroundColor: plain
                ? "color-mix(in srgb, var(--foreground) 18%, transparent)"
                : over
                  ? "var(--danger)"
                  : color,
            }}
          />
          {/*
            The name, in the bar. Reading this chart used to mean holding a row's
            name in your head while your eye travelled 600px to its bar; with 28
            rows that is the whole cost of the view. Truncated by the bar's own
            width — the full name is in the bar's `title`, along with the dates
            and hours it already carried.

            Dark on the tint, white once the hours fill has grown past the label:
            both ends of that range are legible, and the switch is at a fixed
            percentage rather than something measured, so it can't flicker.
          */}
          {barWidth >= BAR_LABEL_MIN_PX && (
            <span
              className={`pointer-events-none absolute inset-y-0 left-0 flex items-center truncate px-1.5 text-[11px] font-medium leading-none ${
                done ? "line-through" : ""
              } ${pct >= LABEL_ON_FILL_PCT ? "text-white" : "text-foreground"}`}
              style={{ maxWidth: barWidth }}
            >
              {task.title}
            </span>
          )}
          {canEdit && barWidth >= HANDLE_MIN_PX && (
            <>
              <span
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDragStart("start", e.clientX);
                }}
                title="Drag to set the start date"
                className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-foreground/10"
              />
              <span
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDragStart("end", e.clientX);
                }}
                title="Drag to set the due date"
                className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-foreground/10"
              />
            </>
          )}
        </div>
      ) : null}
      {/* The hours sit OUTSIDE the bar now. Inside, they had to be legible over
          both the solid fill and the pale track, and were dropped entirely on
          bars under 64px — which is most of them at week zoom. */}
      {hasSpan && !row.undated && barWidth >= LABEL_MIN_PX && !drag && (
        <span
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-faint"
          style={{ left: left + barWidth + 6 }}
        >
          {hoursLabel}
        </span>
      )}
      {!hasSpan && !row.undated && (
        /* No start date: a deadline, drawn as a diamond on the due date. Its
           LEFT edge is still a resize handle — that's how a deadline becomes a
           scheduled span in the first place. */
        <div
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          aria-label={title}
          onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTip(null)}
          onPointerDown={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            onDragStart(e.altKey ? "start" : "move", e.clientX);
          }}
          onClick={() => {
            if (!canEdit) onOpen();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen();
            }
          }}
          className={`absolute top-1/2 z-10 -translate-y-1/2 rotate-45 rounded-[2px] ${
            done ? "opacity-55" : ""
          } ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
            drag ? "ring-2 ring-brand" : ""
          }`}
          style={{
            left: left + Math.max(0, pxPerDay / 2 - DIAMOND / 2),
            width: DIAMOND,
            height: DIAMOND,
            backgroundColor: plain ? "var(--color-surface)" : over ? "var(--danger)" : color,
            boxShadow: barShadow,
          }}
        />
      )}
      </div>
    </div>
  );
}
