"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, GripVertical } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { formatHoursDecimal, MONTH_NAMES_SHORT } from "@/lib/format";
import { taskHoursDone } from "@/lib/task-hours";
import { Avatar, Tabs } from "./ui";
import type { Profile, Section, Task, TaskType } from "@/lib/types";

/**
 * A Gantt of the client's dated work, laid out like a real project timeline:
 * a table on the left (name · dates · duration · hours) and the chart on the
 * right, grouped by the client's sections with a summary bar per group.
 *
 * Three things it says that a plain bar chart doesn't:
 *
 *  · **A task with no start date is a DEADLINE, not a one-day job.** It draws as
 *    a diamond on its due date with "—" for duration, because "we owe this on
 *    the 20th" and "this takes one day" are different claims and the old
 *    single-day sliver made them look identical. Dragging its left edge gives it
 *    a real span.
 *  · **Planned vs done.** A thin rule along the top spans the scheduled dates —
 *    faint on a task nobody has started, solid on one that's used its budget —
 *    and the band beneath it fills with hours logged against that budget. So a
 *    column of rules reads as "which of these is actually moving" at a glance.
 *  · **Non-working days are excluded from planning, not just shaded.** Fri/Sat
 *    and any weekly-plan holiday are drawn darker AND skipped by the arithmetic:
 *    a dragged date always lands on a working day, and moving a bar preserves
 *    its length in WORKING days.
 *
 * Colour comes from the task's TYPE (0024). Admins drag; everyone else reads —
 * a UI gate over a real one, since 0022/0023 put `start_date` and
 * `timeline_position` in the 0011 trigger's protected list.
 */

type Zoom = "day" | "week" | "month";

/** Pixels per DAY at each zoom — every position here is computed in days. */
const PX_PER_DAY: Record<Zoom, number> = { day: 26, week: 9, month: 3 };
const ROW_H = 34;
const SECTION_H = 30;

/* Left table geometry. The columns are fixed rather than resizable: this panel
   is half of a two-panel layout and a drag here would desynchronise it from the
   chart's own horizontal scroll. */
const GRIP_W = 16;
const NAME_W = 230;
const DATES_W = 104;
const DURATION_W = 68;
const HOURS_W = 56;
const LEFT_W = GRIP_W + NAME_W + DATES_W + DURATION_W + HOURS_W * 2;

/** Below this the "12/24h" label doesn't fit and is dropped rather than clipped. */
const LABEL_MIN_PX = 64;
/**
 * Resize handles are 8px a side. Below this the two cover the whole bar and
 * there is nothing left to grab for a move — at week zoom a one-day bar is 9px.
 * Narrower bars are move-only.
 */
const HANDLE_MIN_PX = 30;
/** Per-day weekend/holiday shading is drawn up to this zoom; at 3px/day it's noise. */
const SHADE_MIN_PX_PER_DAY = 6;
/** A deadline diamond is a fixed size — it marks a point, so it can't scale with a span. */
const DIAMOND = 11;

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** DST-safe: builds the date by parts rather than adding 86,400,000 ms. */
function shiftDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function daysBetween(a: Date, b: Date): number {
  // Math.round absorbs the ±1h a DST boundary puts into the difference.
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "18 Aug", and for a range "18 – 24 Aug" / "28 Aug – 2 Sep". */
function dateRangeLabel(start: Date, due: Date, hasStart: boolean): string {
  const day = (d: Date) => d.getDate();
  const mon = (d: Date) => MONTH_NAMES_SHORT[d.getMonth()];
  if (!hasStart) return `${day(due)} ${mon(due)}`;
  if (daysBetween(start, due) === 0) return `${day(start)} ${mon(start)}`;
  // Repeating the month twice inside one cell is noise when it's the same month.
  if (start.getMonth() === due.getMonth() && start.getFullYear() === due.getFullYear()) {
    return `${day(start)} – ${day(due)} ${mon(due)}`;
  }
  return `${day(start)} ${mon(start)} – ${day(due)} ${mon(due)}`;
}

/* ── working-day calendar ─────────────────────────────────────────────────
   `off` holds every yyyy-mm-dd the weekly plan marks as a whole-studio day
   off. Fri/Sat are the studio's weekend — restated here rather than imported
   from format.ts because this also has to answer for holidays. */

function isWorkDay(d: Date, off: Set<string>): boolean {
  const day = d.getDay();
  if (day === 5 || day === 6) return false; // Friday, Saturday
  return !off.has(toISO(d));
}

/** Nearest working day at or after (dir=1) / at or before (dir=-1) `d`. */
function snapToWorkDay(d: Date, dir: 1 | -1, off: Set<string>): Date {
  let out = d;
  // 30 is far more than any run of non-working days; it stops a bad `off` set
  // from spinning forever.
  for (let i = 0; i < 30 && !isWorkDay(out, off); i++) out = shiftDays(out, dir);
  return out;
}

/** `n` working days after `from` (n=0 → `from` itself, snapped forward). */
function addWorkDays(from: Date, n: number, off: Set<string>): Date {
  let out = snapToWorkDay(from, 1, off);
  for (let i = 0; i < n; i++) out = snapToWorkDay(shiftDays(out, 1), 1, off);
  return out;
}

/** Working days from `a` to `b` inclusive; 1 when they're the same working day. */
function workDaysBetween(a: Date, b: Date, off: Set<string>): number {
  let count = 0;
  const span = daysBetween(a, b);
  for (let i = 0; i <= span; i++) {
    if (isWorkDay(shiftDays(a, i), off)) count++;
  }
  return Math.max(1, count);
}

/** What's being dragged and by how much — held locally so a drag is one write, not sixty. */
interface DragState {
  taskId: string;
  mode: "move" | "start" | "end";
  startX: number;
  deltaDays: number;
  /** distinguishes a click (open the task) from a drag (re-schedule it) */
  moved: boolean;
}

interface Row {
  task: Task;
  start: Date;
  due: Date;
  /** false = a deadline with no span; drawn as a diamond, not a bar */
  hasStart: boolean;
  doneMinutes: number;
  assignee: Profile | null;
  type: TaskType | null;
}

interface Group {
  /** null = the tasks with no section */
  section: Section | null;
  rows: Row[];
  start: Date;
  due: Date;
}

/** Module-scoped like the client table's drag: a ref would not survive the drop. */
let draggedRowId: string | null = null;
let draggedFromSection: string | null = null;

export function ClientTimeline({ clientId }: { clientId: string }) {
  const {
    tasks,
    sections,
    clients,
    profiles,
    dayStates,
    taskTypes,
    taskMinutes,
    updateTask,
    openTask,
    reorderTimelineTasks,
  } = useData();
  const isAdmin = useIsAdmin();
  const [zoom, setZoom] = useState<Zoom>("week");
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragging = drag !== null;
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);

  const client = clients.find((c) => c.id === clientId);
  const clientTasks = useMemo(() => tasks.filter((t) => t.clientId === clientId), [tasks, clientId]);

  /**
   * Whole-studio days off from the weekly plan (`plan_day_states`: holidays and
   * custom closures, stored as inclusive ranges). Expanded to a set of dates so
   * the scheduling helpers can ask a plain question per day.
   *
   * NOTE this is the studio-wide row, not per-person absence chips — one
   * designer's holiday isn't a day the studio is shut.
   */
  const { offDates, offLabel } = useMemo(() => {
    const dates = new Set<string>();
    const labels = new Map<string, string>();
    for (const d of dayStates) {
      const from = parseISO(d.dateFrom);
      const span = daysBetween(from, parseISO(d.dateTo));
      // a malformed range must not hang the render
      for (let i = 0; i <= Math.min(span, 400); i++) {
        const iso = toISO(shiftDays(from, i));
        dates.add(iso);
        labels.set(iso, d.label);
      }
    }
    return { offDates: dates, offLabel: labels };
  }, [dayStates]);

  /** Rows grouped by section, in the client's section order, "No section" last. */
  const groups = useMemo<Group[]>(() => {
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const typeById = new Map(taskTypes.map((t) => [t.id, t]));

    const rows: Row[] = clientTasks
      .filter((t) => t.dueDate && (showDone || t.status !== "done"))
      .map((t) => {
        const due = parseISO(t.dueDate!);
        // A start after the due date would draw a bar backwards. Clamp rather
        // than refuse to render it — the data stays visible and draggable.
        const rawStart = t.startDate ? parseISO(t.startDate) : due;
        return {
          task: t,
          start: rawStart > due ? due : rawStart,
          due,
          hasStart: !!t.startDate,
          doneMinutes: taskHoursDone(t, taskMinutes),
          assignee: t.assigneeId ? (profileById.get(t.assigneeId) ?? null) : null,
          type: t.typeId ? (typeById.get(t.typeId) ?? null) : null,
        };
      });

    const byId = new Map(sections.filter((s) => s.clientId === clientId).map((s) => [s.id, s]));
    const bucket = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.task.sectionId && byId.has(r.task.sectionId) ? r.task.sectionId : "";
      const list = bucket.get(key);
      if (list) list.push(r);
      else bucket.set(key, [r]);
    }

    const ordered = [...byId.values()].sort((a, b) => a.position - b.position);
    const out: Group[] = [];
    for (const key of [...ordered.map((s) => s.id), ""]) {
      const list = bucket.get(key);
      if (!list?.length) continue;
      // Hand-placed rows first, in their placed order; never-dragged rows fall
      // to the bottom by date rather than jumping into someone's ordering.
      list.sort(
        (a, b) =>
          (a.task.timelinePosition ?? Number.MAX_SAFE_INTEGER) -
            (b.task.timelinePosition ?? Number.MAX_SAFE_INTEGER) ||
          a.start.getTime() - b.start.getTime() ||
          a.task.title.localeCompare(b.task.title),
      );
      let start = list[0].start;
      let due = list[0].due;
      for (const r of list) {
        if (r.start < start) start = r.start;
        if (r.due > due) due = r.due;
      }
      out.push({ section: key ? (byId.get(key) ?? null) : null, rows: list, start, due });
    }
    return out;
  }, [clientTasks, sections, clientId, profiles, taskTypes, taskMinutes, showDone]);

  const allRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const undated = clientTasks.filter((t) => !t.dueDate && (showDone || t.status !== "done")).length;

  const usedTypes = useMemo(() => {
    const ids = new Set(allRows.map((r) => r.type?.id).filter(Boolean));
    return taskTypes.filter((t) => ids.has(t.id));
  }, [allRows, taskTypes]);

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  /**
   * The window the chart spans. Padded a week either side so a bar never starts
   * flush against the left edge, and floored at ~13 weeks so a client with two
   * tasks three days apart doesn't get a chart four columns wide.
   */
  const { from, totalDays } = useMemo(() => {
    const marks: Date[] = [today];
    for (const r of allRows) marks.push(r.start, r.due);
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
    const span = Math.max(daysBetween(start, end), zoom === "month" ? 365 : 91);
    return { from: start, totalDays: span };
  }, [allRows, today, zoom]);

  const pxPerDay = PX_PER_DAY[zoom];
  const chartW = totalDays * pxPerDay;

  /** Total content height, so the grid and the today line can span every row. */
  const bodyH = groups.reduce(
    (h, g) => h + SECTION_H + (collapsed.has(g.section?.id ?? "") ? 0 : g.rows.length * ROW_H),
    0,
  );

  // Open on today rather than on the far past — a client with 2019 history would
  // otherwise render scrolled to work that finished years ago.
  useEffect(() => {
    if (scrolledOnce.current || !scroller.current || allRows.length === 0) return;
    scrolledOnce.current = true;
    const x = daysBetween(from, today) * pxPerDay;
    scroller.current.scrollLeft = Math.max(0, x - scroller.current.clientWidth / 3);
  }, [from, today, pxPerDay, allRows.length]);

  // Pointer move/up live on the window: a fast drag leaves the 8px handle behind
  // long before the pointer stops, and a listener on the handle would miss it.
  //
  // ⚠️ The live drag is mirrored in a ref and the commit happens OUTSIDE any
  // setState updater. Updaters run during render, so committing from inside one
  // called the store's setTasks mid-render — React's "Cannot update a component
  // while rendering a different component".
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const delta = Math.round((e.clientX - d.startX) / pxPerDay);
      if (delta === d.deltaDays) return;
      const next = { ...d, deltaDays: delta, moved: true };
      dragRef.current = next;
      setDrag(next);
    }
    function onUp() {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (d) commit(d);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // `commit` closes over rows/offDates, both recomputed on store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, pxPerDay, allRows, offDates]);

  function commit(d: DragState) {
    const row = allRows.find((r) => r.task.id === d.taskId);
    if (!row) return;
    if (!d.moved || d.deltaDays === 0) {
      if (!d.moved) openTask(d.taskId);
      return;
    }
    const patch = plannedPatch(row, d.mode, d.deltaDays, offDates);
    // One updateTask call, so re-scheduling is ONE undo step and not two.
    if (patch) updateTask(d.taskId, patch);
  }

  /**
   * Reorder within ONE section only. Dropping across a boundary is refused
   * rather than silently re-sectioning the task: `timeline_position` exists
   * precisely so the Timeline's order can't reach into the Tasks tab's
   * grouping. Move a task between sections from the task pane.
   */
  function dropRow(sectionKey: string, targetId: string | null) {
    const movedId = draggedRowId;
    const fromSection = draggedFromSection;
    draggedRowId = null;
    draggedFromSection = null;
    setDropBefore(null);
    if (!movedId || movedId === targetId || fromSection !== sectionKey) return;
    const group = groups.find((g) => (g.section?.id ?? "") === sectionKey);
    if (!group) return;
    const ids = group.rows.map((r) => r.task.id);
    const without = ids.filter((id) => id !== movedId);
    const at = targetId ? without.indexOf(targetId) : without.length;
    if (at === -1) return;
    reorderTimelineTasks([...without.slice(0, at), movedId, ...without.slice(at)]);
  }

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={zoom}
          onChange={setZoom}
          items={["day", "week", "month"] as const}
          variant="segmented"
          size="sm"
          ariaLabel="Timeline zoom"
        />
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show completed
        </label>
        <span className="text-xs text-faint">
          {isAdmin
            ? "Drag a bar to move it · an edge to resize · the grip to reorder within its section."
            : "Read-only — only admins can re-schedule"}
        </span>
      </div>

      {(usedTypes.length > 0 || allRows.some((r) => !r.hasStart)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          {usedTypes.map((t) => (
            <span key={t.id} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: t.color }} aria-hidden />
              {t.name}
            </span>
          ))}
          {allRows.some((r) => !r.type) && (
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-brand" aria-hidden />
              No type
            </span>
          )}
          {allRows.some((r) => !r.hasStart) && (
            <span className="flex items-center gap-1.5 text-faint">
              <span className="size-2 rotate-45 border border-current" aria-hidden />
              Deadline — no start date set
            </span>
          )}
        </div>
      )}

      {allRows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-faint">
          No {showDone ? "" : "open "}tasks with a due date yet. Give a task a due date and it
          appears here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div ref={scroller} className="overflow-x-auto">
            <div style={{ width: LEFT_W + chartW }}>
              <TimelineHeader
                from={from}
                totalDays={totalDays}
                zoom={zoom}
                pxPerDay={pxPerDay}
                off={offDates}
              />
              <div className="relative">
                {/* One layer for the whole grid — weak vertical rules on every
                    tick plus a wash over non-working days — drawn once behind
                    the rows rather than per row. */}
                <GridLayer
                  from={from}
                  totalDays={totalDays}
                  zoom={zoom}
                  pxPerDay={pxPerDay}
                  off={offDates}
                  offLabel={offLabel}
                  height={bodyH}
                />
                <TodayLine left={LEFT_W + daysBetween(from, today) * pxPerDay} height={bodyH} />

                {groups.map((g) => {
                  const key = g.section?.id ?? "";
                  const isCollapsed = collapsed.has(key);
                  return (
                    <div key={key || "none"}>
                      <SectionHeaderRow
                        group={g}
                        collapsed={isCollapsed}
                        onToggle={() => toggleSection(key)}
                        from={from}
                        pxPerDay={pxPerDay}
                        totalDays={totalDays}
                        color={client?.color ?? "#0b43ed"}
                      />
                      {!isCollapsed &&
                        g.rows.map((row) => (
                          <TimelineRow
                            key={row.task.id}
                            row={row}
                            from={from}
                            pxPerDay={pxPerDay}
                            totalDays={totalDays}
                            canEdit={isAdmin}
                            off={offDates}
                            drag={drag?.taskId === row.task.id ? drag : null}
                            dropTarget={dropBefore === row.task.id}
                            onDragStart={(mode, clientX) => {
                              const next: DragState = {
                                taskId: row.task.id,
                                mode,
                                startX: clientX,
                                deltaDays: 0,
                                moved: false,
                              };
                              dragRef.current = next;
                              setDrag(next);
                            }}
                            onRowDragStart={() => {
                              draggedRowId = row.task.id;
                              draggedFromSection = key;
                            }}
                            onRowDragOver={() => setDropBefore(row.task.id)}
                            onRowDrop={() => dropRow(key, row.task.id)}
                            onRowDragEnd={() => {
                              draggedRowId = null;
                              draggedFromSection = null;
                              setDropBefore(null);
                            }}
                            onOpen={() => openTask(row.task.id)}
                            onSetDates={(startDate, dueDate) =>
                              updateTask(row.task.id, { startDate, dueDate })
                            }
                          />
                        ))}
                      {/* dropping below the last row appends to this section */}
                      {!isCollapsed && (
                        <div
                          className="h-0"
                          onDragOver={(e) => draggedRowId && e.preventDefault()}
                          onDrop={() => dropRow(key, null)}
                          style={{ marginTop: -1, height: 1 }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {undated > 0 && (
        <p className="text-xs text-faint">
          {undated} {showDone ? "" : "open "}task{undated === 1 ? "" : "s"} with no due date
          {undated === 1 ? " isn't" : " aren't"} shown — a bar needs an end date.
        </p>
      )}
    </div>
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
function plannedPatch(
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

/** Ticks and their month/year grouping — shared by the header and the grid. */
function ticksFor(from: Date, totalDays: number, zoom: Zoom, pxPerDay: number) {
  const ticks: { left: number; width: number; label: string }[] = [];
  const groups: { left: number; width: number; label: string }[] = [];
  const step = zoom === "day" ? 1 : zoom === "week" ? 7 : 0; // 0 = calendar months

  if (step > 0) {
    for (let d = 0; d < totalDays; d += step) {
      const date = shiftDays(from, d);
      ticks.push({
        left: d * pxPerDay,
        width: Math.min(step, totalDays - d) * pxPerDay,
        label: zoom === "day" ? String(date.getDate()) : `${date.getDate()}/${date.getMonth() + 1}`,
      });
    }
    let cursor = 0;
    while (cursor < totalDays) {
      const date = shiftDays(from, cursor);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const len = Math.min(daysBetween(date, monthEnd), totalDays - cursor);
      groups.push({
        left: cursor * pxPerDay,
        width: len * pxPerDay,
        label: `${MONTH_NAMES_SHORT[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`,
      });
      cursor += len;
    }
  } else {
    let cursor = 0;
    while (cursor < totalDays) {
      const date = shiftDays(from, cursor);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const len = Math.min(daysBetween(date, monthEnd), totalDays - cursor);
      ticks.push({
        left: cursor * pxPerDay,
        width: len * pxPerDay,
        label: MONTH_NAMES_SHORT[date.getMonth()],
      });
      cursor += len;
    }
    let year = -1;
    let runStart = 0;
    for (let d = 0; d <= totalDays; d++) {
      const y = d < totalDays ? shiftDays(from, d).getFullYear() : -2;
      if (y !== year) {
        if (year !== -1) {
          groups.push({
            left: runStart * pxPerDay,
            width: (d - runStart) * pxPerDay,
            label: String(year),
          });
        }
        year = y;
        runStart = d;
      }
    }
  }
  return { ticks, groups };
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
function DatesCell({
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

  const startISO = row.hasStart ? toISO(row.start) : "";
  const dueISO = toISO(row.due);
  const label = dateRangeLabel(row.start, row.due, row.hasStart);

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
          setPos({ left: r.left, top: r.bottom + 4 });
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
            className="fixed z-50 w-60 rounded-xl border border-border bg-surface p-3 shadow-xl"
            style={{ left: Math.min(pos.left, window.innerWidth - 250), top: pos.top }}
          >
            <div className="mb-2 truncate text-xs font-semibold" title={row.task.title}>
              {row.task.title}
            </div>
            <label className="mb-2 flex items-center gap-2 text-xs">
              <span className="w-10 shrink-0 text-muted">Start</span>
              <input
                type="date"
                value={startISO}
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

/** The blue plumb-line with a dot on the header, as in the reference. */
function TodayLine({ left, height }: { left: number; height: number }) {
  return (
    <div className="pointer-events-none absolute top-0 z-10" style={{ left }} title="Today">
      <div className="absolute -left-[3px] -top-[3px] size-1.5 rounded-full bg-brand" />
      <div className="w-px bg-brand/50" style={{ height }} />
    </div>
  );
}

function GridLayer({
  from,
  totalDays,
  zoom,
  pxPerDay,
  off,
  offLabel,
  height,
}: {
  from: Date;
  totalDays: number;
  zoom: Zoom;
  pxPerDay: number;
  off: Set<string>;
  offLabel: Map<string, string>;
  height: number;
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
      style={{ left: LEFT_W, width: totalDays * pxPerDay, height }}
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
        // table. Anything stronger competes with the bars.
        <div
          key={t.left}
          className="absolute top-0 h-full border-l border-border/40"
          style={{ left: t.left }}
        />
      ))}
    </div>
  );
}

function TimelineHeader({
  from,
  totalDays,
  zoom,
  pxPerDay,
  off,
}: {
  from: Date;
  totalDays: number;
  zoom: Zoom;
  pxPerDay: number;
  off: Set<string>;
}) {
  const { ticks, groups } = ticksFor(from, totalDays, zoom, pxPerDay);
  const dayZoom = zoom === "day";
  const head = "shrink-0 text-[10px] font-medium uppercase tracking-wide text-faint";

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="relative flex h-6 items-end">
        <span style={{ width: LEFT_W }} className="shrink-0" />
        <span className="relative flex-1">
          {groups.map((g) => (
            <span
              key={g.left}
              className="absolute bottom-0 truncate px-1.5 text-[11px] font-semibold text-foreground"
              style={{ left: g.left, width: g.width }}
            >
              {g.label}
            </span>
          ))}
        </span>
      </div>
      <div className="relative flex h-6 items-center border-t border-border">
        <span className={`${head} truncate pl-6`} style={{ width: GRIP_W + NAME_W }}>
          Task name
        </span>
        <span className={`${head} truncate border-l border-border px-2`} style={{ width: DATES_W }}>
          Dates
        </span>
        <span
          className={`${head} truncate border-l border-border px-2`}
          style={{ width: DURATION_W }}
          title="Working days — Fri/Sat and studio holidays don't count"
        >
          Duration
        </span>
        <span
          className={`${head} truncate border-l border-border px-1.5 text-right`}
          style={{ width: HOURS_W }}
          title="Hours logged so far"
        >
          Actual
        </span>
        <span
          className={`${head} truncate border-l border-border px-1.5 text-right`}
          style={{ width: HOURS_W }}
          title="Budgeted hours"
        >
          Budget
        </span>
        <span className="relative h-full flex-1 border-l border-border">
          {ticks.map((t) => {
            const date = shiftDays(from, Math.round(t.left / pxPerDay));
            const nonWork = dayZoom && !isWorkDay(date, off);
            return (
              <span
                key={t.left}
                className={`absolute top-0 flex h-full items-center truncate px-1 text-[10px] tabular-nums ${
                  nonWork ? "text-faint/60" : "text-muted"
                }`}
                style={{ left: t.left, width: t.width }}
              >
                {t.label}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}

/** A collapsible group, with the reference's thin summary bar spanning its range. */
function SectionHeaderRow({
  group,
  collapsed,
  onToggle,
  from,
  pxPerDay,
  totalDays,
  color,
}: {
  group: Group;
  collapsed: boolean;
  onToggle: () => void;
  from: Date;
  pxPerDay: number;
  totalDays: number;
  color: string;
}) {
  const left = daysBetween(from, group.start) * pxPerDay;
  const width = Math.max(8, (daysBetween(group.start, group.due) + 1) * pxPerDay);

  return (
    <div
      className="relative border-b border-border bg-background/60"
      style={{ height: SECTION_H, width: LEFT_W + totalDays * pxPerDay }}
    >
      <button
        onClick={onToggle}
        className="absolute left-0 top-0 flex h-full items-center gap-1.5 px-2 text-left hover:text-brand"
        style={{ width: LEFT_W }}
      >
        {collapsed ? (
          <ChevronRight size={13} className="shrink-0 text-muted" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-muted" />
        )}
        <span className="bidi-auto truncate text-xs font-semibold">
          {group.section?.name ?? "No section"}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-faint">{group.rows.length}</span>
      </button>
      {/* The group's whole span as one slim bar — the reference's device for
          "this workstream runs from here to here" without reading every row. */}
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
        style={{ left: LEFT_W + left, width, backgroundColor: color, opacity: 0.85 }}
        title={`${group.section?.name ?? "No section"} — ${dateRangeLabel(group.start, group.due, true)}`}
      />
    </div>
  );
}

function TimelineRow({
  row,
  from,
  pxPerDay,
  totalDays,
  canEdit,
  off,
  drag,
  dropTarget,
  onDragStart,
  onRowDragStart,
  onRowDragOver,
  onRowDrop,
  onRowDragEnd,
  onOpen,
  onSetDates,
}: {
  row: Row;
  from: Date;
  pxPerDay: number;
  totalDays: number;
  canEdit: boolean;
  off: Set<string>;
  drag: DragState | null;
  dropTarget: boolean;
  onDragStart: (mode: DragState["mode"], clientX: number) => void;
  onRowDragStart: () => void;
  onRowDragOver: () => void;
  onRowDrop: () => void;
  onRowDragEnd: () => void;
  onOpen: () => void;
  onSetDates: (startDate: string | null, dueDate: string) => void;
}) {
  const { task } = row;
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
   * Never fully transparent: the top rule is what tells you where the span ENDS
   * when almost nothing is logged, so a 0% task still has to draw its full
   * extent. 0.28 → 1 across the budget.
   */
  const lineStrength = 0.28 + 0.72 * Math.min(1, pct / 100);

  const hoursLabel =
    estimate != null
      ? `${formatHoursDecimal(row.doneMinutes)}/${estimate}h`
      : `${formatHoursDecimal(row.doneMinutes)}h`;

  const title = [
    task.title,
    row.type ? `Type: ${row.type.name}` : undefined,
    hasSpan
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
      className={`group/trow relative border-b border-border last:border-b-0 hover:bg-background/40 ${
        dropTarget ? "shadow-[inset_0_2px_0_0_var(--brand)]" : ""
      }`}
      style={{ height: ROW_H, width: LEFT_W + totalDays * pxPerDay }}
      onDragOver={(e) => {
        if (!draggedRowId) return;
        e.preventDefault();
        onRowDragOver();
      }}
      onDrop={onRowDrop}
    >
      <div
        className="absolute left-0 top-0 flex h-full items-center bg-surface group-hover/trow:bg-background/40"
        style={{ width: LEFT_W }}
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
        <button
          onClick={onOpen}
          title={task.title}
          className="flex h-full min-w-0 items-center gap-2 pr-2 text-left"
          style={{ width: NAME_W }}
        >
          {done ? (
            <CheckCircle2 size={14} className="shrink-0 text-success" />
          ) : (
            <Circle size={14} className="shrink-0 text-faint" />
          )}
          <span
            className={`bidi-auto min-w-0 flex-1 truncate text-xs ${
              done ? "text-muted line-through" : "font-medium"
            }`}
          >
            {task.title}
          </span>
          {/* Just the face — who it's on is the one person-fact a Gantt row
              needs, and a name would halve the room for the title. */}
          <Avatar profile={row.assignee} size={20} />
        </button>
        <DatesCell row={row} canEdit={canEdit} width={DATES_W} off={off} onSet={onSetDates} />
        <span
          className={`${cell} tabular-nums ${row.hasStart ? "text-muted" : "text-faint"}`}
          style={{ width: DURATION_W }}
          title={row.hasStart ? "Working days" : "No start date — this is a deadline, not a span"}
        >
          {row.hasStart ? `${workLen} day${workLen === 1 ? "" : "s"}` : "—"}
        </span>
        <span
          className={`${cell} text-right tabular-nums ${over ? "font-semibold text-danger" : "text-foreground"}`}
          style={{ width: HOURS_W }}
        >
          {row.doneMinutes > 0 ? `${formatHoursDecimal(row.doneMinutes)}h` : "–"}
        </span>
        <span
          className={`${cell} text-right tabular-nums text-muted`}
          style={{ width: HOURS_W }}
        >
          {estimate != null ? `${estimate}h` : "–"}
        </span>
      </div>

      {hasSpan ? (
        <div
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          title={title}
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
          className={`absolute top-1/2 -translate-y-1/2 overflow-hidden rounded ${
            done ? "opacity-55" : ""
          } ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
            drag ? "ring-2 ring-brand" : ""
          }`}
          style={{ left: LEFT_W + left, width: barWidth, height: 20 }}
        >
          {/* The PLAN is a thin rule along the top, spanning the whole span;
              the band beneath it is hours logged against budget. The rule's
              strength tracks completion — faint on a task nobody has started,
              solid on one that's used its budget — so a glance down a column
              reads as "which of these is actually moving" without comparing
              fill widths. (A diagonal hatch did the same job far more loudly.) */}
          <div
            className="absolute inset-x-0 top-0 h-[2px] rounded-full"
            style={{ backgroundColor: over ? "var(--danger)" : color, opacity: lineStrength }}
          />
          <div
            className="absolute inset-x-0 bottom-0 h-[11px] rounded"
            style={{ backgroundColor: `${color}1f` }}
          >
            <div
              className="h-full rounded"
              style={{ width: `${pct}%`, backgroundColor: over ? "var(--danger)" : color }}
            />
          </div>
          {barWidth >= LABEL_MIN_PX && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-end px-1.5 text-[10px] font-medium tabular-nums text-foreground/75">
              {hoursLabel}
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
      ) : (
        /* No start date: a deadline, drawn as a diamond on the due date. Its
           LEFT edge is still a resize handle — that's how a deadline becomes a
           scheduled span in the first place. */
        <div
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          title={title}
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
          className={`absolute top-1/2 -translate-y-1/2 rotate-45 rounded-[2px] ${
            done ? "opacity-55" : ""
          } ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
            drag ? "ring-2 ring-brand" : ""
          }`}
          style={{
            left: LEFT_W + left + Math.max(0, pxPerDay / 2 - DIAMOND / 2),
            width: DIAMOND,
            height: DIAMOND,
            backgroundColor: over ? "var(--danger)" : color,
          }}
        />
      )}
    </div>
  );
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}
function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}
