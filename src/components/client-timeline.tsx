"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Columns3,
  GripVertical,
  Maximize2,
  Pencil,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { formatHoursDecimal, MONTH_NAMES_SHORT } from "@/lib/format";
import { taskHoursDone } from "@/lib/task-hours";
import { Avatar, Tabs } from "./ui";
import { EditableNumberCell, EditableSelectCell, EditableTextCell } from "./editable-cell";
import { TaskBulkControls } from "./task-bulk-controls";
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

export type Zoom = "day" | "week" | "month";

/**
 * How this view works, in one sentence per verb.
 *
 * It used to sit above the chart as a permanent line of grey text — read once,
 * then a row of height paid for on every visit. ClientView shows it from an (i)
 * beside the client name instead, which is why it lives here as a string.
 */
export function timelineHint(isAdmin: boolean): string {
  return isAdmin
    ? "Click a name to open it, the pencil to rename · drag a bar to move it, an edge to resize, the grip to reorder · tick rows to change several at once."
    : "Read-only — only admins can re-schedule.";
}

/** Pixels per DAY at each zoom — every position here is computed in days. */
const PX_PER_DAY: Record<Zoom, number> = { day: 26, week: 9, month: 3 };
const ROW_H = 34;
const SECTION_H = 30;

/* Left table geometry. The columns are fixed rather than resizable: this panel
   is half of a two-panel layout and a drag here would desynchronise it from the
   chart's own horizontal scroll. */
const GRIP_W = 16;
const CHECK_W = 22;
const NAME_W = 200;
/** Just the face, but its own column now that clicking it reassigns the task. */
const ASSIGNEE_W = 44;
/** Dot + name. 96 fits "Presentation" — the longest type the studio uses. */
const TYPE_W = 96;
const DATES_W = 104;
/** 72, not 68: at 68 the word "Duration" in the header clipped by exactly 1px. */
const DURATION_W = 72;
const HOURS_W = 56;

/**
 * ONLY this block sticks while the chart scrolls sideways.
 *
 * Pinning the whole left table (566px) meant that on a laptop half the visible
 * width was permanently spent on columns you weren't reading. The task name is
 * the one thing a row is useless without, so grip + checkbox + name hold their
 * place and everything else scrolls away with the calendar.
 */
const STICKY_W = GRIP_W + CHECK_W + NAME_W;

/**
 * The pinned header's shadow, applied only when rows are hidden above it. The
 * negative spread confines it to the bottom edge; without it the shadow would
 * also smear sideways across the column titles.
 *
 * The horizontal counterpart is NOT a class: it is one full-height gradient in
 * the scroller (see the `shadow.x` layer), because a per-row box-shadow came out
 * broken by every row border it crossed.
 */
const SHADOW_Y = "shadow-[0_5px_8px_-6px_rgba(0,0,0,0.14)]";

/** Rough tooltip box, used only to decide which way it flips near an edge.
 *  Named apart from the section bar's TIP_W/TIP_H, which are its end points. */
const TOOLTIP_W = 244;
/** Measured at its tallest — a typed task with a span, hours and the hint: 176. */
const TOOLTIP_H = 180;

/**
 * The bars' tooltip, on the spot.
 *
 * These were `title` attributes, and the browser sits on one for about a second
 * before showing it — long enough that you give up and click the bar instead,
 * which is a write. It is `fixed` and portalled to `document.body` for the usual
 * reason in this file: the chart is in a scroller that clips BOTH axes, so
 * anything anchored inside a row is cut off on the first and last of them.
 *
 * It takes NODES, not a string. As five `\n`-joined lines everything in it —
 * the task's name, its type, its dates, its hours, and a line of instructions
 * that never changes — arrived at the same size, weight and colour, so there was
 * nothing to read first. See `TipRow` and the callers for the three bands.
 */
function HoverTip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(8, x + 12), window.innerWidth - TOOLTIP_W - 8);
  const below = y + 18;
  const flip = below + TOOLTIP_H > window.innerHeight;
  return createPortal(
    <div
      role="tooltip"
      // `overflow-hidden`, and no padding of its own: the heading band is a
      // full-bleed tint that has to reach the rounded corners.
      className="pointer-events-none fixed z-[70] w-[244px] overflow-hidden rounded-xl border border-border bg-surface text-[11px] leading-normal shadow-xl"
      style={{ left, top: flip ? y - 12 : below, transform: flip ? "translateY(-100%)" : undefined }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Weak tint for the heading band — enough to read as the type's colour. */
const TIP_TINT = "29";

/**
 * The heading band: what this is, on a wash of its own colour.
 *
 * The colour used to be a dot beside the type's name, which spent a line on
 * saying what the band now says by being that colour. Dividers went with it —
 * the tint already ends where the facts begin, so a rule on top of that was one
 * boundary drawn twice.
 */
function TipHead({
  title,
  subtitle,
  color,
}: {
  title: string;
  subtitle?: string | null;
  color: string;
}) {
  return (
    // Tight: `py-1.5` and `leading-tight` on both lines. The band is an
    // identifier, not a paragraph — at py-2.5 with default leading it was
    // taller than the four fact rows underneath it put together.
    <div className="px-3 py-1.5" style={{ backgroundColor: `${color}${TIP_TINT}` }}>
      {/* 13/570 against the type's 11/380: two steps clear of it, and the same
          rule the section headers follow — +2px and the heavier of the two
          weights this type system has. */}
      <div className="text-[13px] font-semibold leading-tight text-foreground">{title}</div>
      {subtitle && <div className="leading-tight text-muted">{subtitle}</div>}
    </div>
  );
}

/** One fact: a faint label on the left, the value right-aligned against it. */
function TipRow({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-faint">{label}</span>
      <span
        className={`truncate tabular-nums ${danger ? "font-semibold text-danger" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}

/** "Jan 2027" at 10px semibold plus the tick's px-1. A week tick is 63px. */
const YEAR_LABEL_MIN_PX = 56;

/** Longest legend label. Past this the chips start pushing each other around. */
const LEGEND_MAX = 10;
/** Cut to `LEGEND_MAX`, ellipsis included in the count so the width is fixed. */
function short(name: string): string {
  return name.length > LEGEND_MAX ? `${name.slice(0, LEGEND_MAX - 1)}…` : name;
}

/** The optional left-table columns, in order, with their widths. */
const TL_COLS = [
  { key: "who", label: "Who", w: ASSIGNEE_W, title: "Assignee" },
  { key: "type", label: "Type", w: TYPE_W, title: "Kind of work — this is what colours the bar" },
  { key: "dates", label: "Dates", w: DATES_W, title: "Start and due dates" },
  {
    key: "duration",
    label: "Duration",
    w: DURATION_W,
    title: "Working days — Fri/Sat and studio holidays don't count",
  },
  { key: "actual", label: "Actual", w: HOURS_W, title: "Hours logged so far" },
  { key: "budget", label: "Budget", w: HOURS_W, title: "Budgeted hours" },
] as const;
type TlCol = (typeof TL_COLS)[number]["key"];
const TL_COL_KEYS = TL_COLS.map((c) => c.key) as TlCol[];

/** Left-table width for a given hidden set. The name block is never optional. */
function leftWidth(hidden: Set<string>): number {
  return TL_COLS.reduce((w, c) => w + (hidden.has(c.key) ? 0 : c.w), STICKY_W);
}

function TimelineColumnsMenu({
  hidden,
  onToggle,
}: {
  hidden: Set<string>;
  onToggle: (key: TlCol, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Show or hide columns"
        aria-label="Show or hide columns"
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-muted hover:border-brand hover:text-brand"
      >
        <Columns3 size={13} />
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex w-40 flex-col rounded-xl border border-border bg-surface p-1 shadow-xl">
          {TL_COLS.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background"
            >
              <input
                type="checkbox"
                checked={!hidden.has(c.key)}
                onChange={(e) => onToggle(c.key, e.target.checked)}
                className="size-3.5 accent-[var(--brand)]"
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

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
/** Bar height. 20, not 16: the task's name now sits INSIDE the bar and 16px
 *  left an 11px line with 2px of air above and below, which read as cramped. */
const BAR_H = 20;
/**
 * Below this a name is one truncated letter and an ellipsis — noise, not a
 * label. The bar's `title` still carries the full name at any width.
 */
const BAR_LABEL_MIN_PX = 34;
/**
 * Where the label switches from dark to white. The label starts at the bar's
 * left edge and so does the hours fill, so past roughly half the bar the label
 * is sitting on solid colour rather than on the tinted track.
 */
const LABEL_ON_FILL_PCT = 55;
/** Corner radius, in the reference's proportion to the height (~1:4). */
const BAR_R = 4;
/**
 * A section's summary bar is deliberately NOT a task bar: 30% of the height, so
 * a group reads as a bracket over its rows rather than as one more piece of
 * work. `Math.round(16 * 0.3)` = 5.
 */
const SECTION_BAR_H = Math.round(BAR_H * 0.3);
/** The tips: a downward point at each end, the width and depth of one. */
const TIP_W = 6;
/** Measured from the TOP of the bar, so the point drops 4px below it. */
const TIP_H = SECTION_BAR_H + 4;
/** Below this the two tips would meet and the span would read as a chevron. */
const TIP_MIN_W = TIP_W * 2 + 2;
/**
 * Measured height of the Dates popover (title + two fields + the button row).
 * Used to decide whether it opens downwards or flips above the cell — it is
 * `fixed`, so nothing else stops it running off the bottom of the window.
 */
const PANEL_H = 200;

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

export function ClientTimeline({
  clientId,
  zoom,
  showDone,
  toolbarSlot,
}: {
  clientId: string;
  /** owned by ClientView: its control sits on the tab strip, not in here */
  zoom: Zoom;
  showDone: boolean;
  /** where to render the legend + Columns button — the tab strip's right end */
  toolbarSlot: HTMLElement | null;
}) {
  const {
    tasks,
    sections,
    clients,
    profiles,
    dayStates,
    taskTypes,
    taskMinutes,
    updateTask,
    updateSection,
    openTask,
    reorderTimelineTasks,
  } = useData();
  const isAdmin = useIsAdmin();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragging = drag !== null;
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("timeline.hiddenCols");
      const list = raw ? JSON.parse(raw) : null;
      if (Array.isArray(list)) {
        setHiddenCols(new Set(list.filter((k: string) => (TL_COL_KEYS as string[]).includes(k))));
      }
    } catch {
      /* a corrupt blob just means "show everything" */
    }
  }, []);
  const toggleCol = (key: TlCol, on: boolean) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      localStorage.setItem("timeline.hiddenCols", JSON.stringify([...next]));
      return next;
    });
  };
  const leftW = leftWidth(hiddenCols);
  /** anchor for shift-click ranges, same rule as the client table */
  const lastPicked = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);
  /**
   * Whether anything is hidden behind the pinned header / pinned name column.
   *
   * Both edges are silent otherwise: the panel is a fixed-height pocket, so a
   * client with 30 tasks and a client with 5 look the same until you happen to
   * spin the wheel, and the calendar scrolls sideways UNDER the name column with
   * no seam to say so. A shadow appears on each edge only once there is
   * something behind it, which makes it information rather than decoration.
   */
  const [shadow, setShadow] = useState({ x: false, y: false });
  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const x = el.scrollLeft > 0;
    const y = el.scrollTop > 0;
    // Only a boundary crossing re-renders; scrolling within a state is free.
    setShadow((s) => (s.x === x && s.y === y ? s : { x, y }));
  }

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

  const assignableProfiles = useMemo(
    () => profiles.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );

  /** Display order across every open group — the range a shift-click covers. */
  const orderedIds = useMemo(
    () =>
      groups.flatMap((g) =>
        collapsed.has(g.section?.id ?? "") ? [] : g.rows.map((r) => r.task.id),
      ),
    [groups, collapsed],
  );

  function toggleSelected(taskId: string, shiftKey: boolean, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const anchor = lastPicked.current;
      if (shiftKey && anchor && anchor !== taskId) {
        const a = orderedIds.indexOf(anchor);
        const b = orderedIds.indexOf(taskId);
        if (a >= 0 && b >= 0) {
          for (const id of orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }
      }
      if (on) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
    lastPicked.current = taskId;
  }

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

  /*
    The legend and the Columns button are rendered INTO the tab strip, through a
    slot ClientView hands down. They belong to this panel and read its state, so
    lifting them would mean lifting `hiddenCols` and the used-type set with them;
    a portal keeps the state here and only moves the pixels. Together with the
    how-to moving onto an (i) beside the client name, that is a whole row of
    chrome removed from above a chart that is already fighting for height.
  */
  /** One flat list, so the stack can animate them with a single rule. */
  const legendItems = [
    ...usedTypes.map((t) => ({ key: t.id, label: short(t.name), color: t.color, faint: false, diamond: false })),
    ...(allRows.some((r) => !r.type)
      ? [{ key: "__none", label: "No type", color: "#0b43ed", faint: false, diamond: false }]
      : []),
    ...(allRows.some((r) => !r.hasStart)
      ? [{ key: "__deadline", label: "Deadline", color: "", faint: true, diamond: true }]
      : []),
  ];

  const toolbar = (
    <>
      {/*
        A STACK that unfolds.

        At rest this is a row of overlapping swatches — the colours, and nothing
        else. Hover and each one slides apart and grows its label. That keeps the
        toolbar honest at every width (the folded stack is ~40px, so it can never
        reach the centred zoom control) while the names are still one gesture
        away, and it means the legend costs almost nothing on a row whose whole
        purpose was to stop costing a row.

        Widths animate through `max-w`, the usual trick for a value CSS can't
        transition from `auto`; the 24 (96px) just has to exceed the widest
        label, which `short()` already caps at 10 characters.
      */}
      {(usedTypes.length > 0 || allRows.some((r) => !r.hasStart)) && (
        <div
          className="group/legend hidden min-w-0 flex-nowrap items-center justify-end overflow-hidden whitespace-nowrap text-[11px] text-muted lg:flex"
          title="Task types — hover to read"
        >
          {legendItems.map((it) => (
            <span
              key={it.key}
              // `ring-2 ring-background` is what makes the overlap read as a
              // stack rather than as swatches run together — and it is
              // `background`, not `surface`: this toolbar sits on the page, so a
              // #fff ring was a brighter stroke against the page's #f0f1fa
              // rather than the invisible gap it is supposed to be.
              className={`-ml-1 flex items-center transition-all duration-200 ease-out first:ml-0 group-hover/legend:ml-0 group-hover/legend:mr-3 ${
                it.faint ? "text-faint" : ""
              }`}
            >
              {it.diamond ? (
                <span
                  className="size-2 rotate-45 border border-current ring-2 ring-background"
                  aria-hidden
                />
              ) : (
                <span
                  className="size-2.5 rounded-sm ring-2 ring-background"
                  style={{ backgroundColor: it.color }}
                  aria-hidden
                />
              )}
              <span className="max-w-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover/legend:ml-1.5 group-hover/legend:max-w-24 group-hover/legend:opacity-100">
                {it.label}
              </span>
            </span>
          ))}
        </div>
      )}
      <TimelineColumnsMenu hidden={hiddenCols} onToggle={toggleCol} />
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {toolbarSlot && createPortal(toolbar, toolbarSlot)}

      {allRows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-faint">
          No {showDone ? "" : "open "}tasks with a due date yet. Give a task a due date and it
          appears here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {/*
            A BOUNDED height is what makes the column titles stick. `sticky top-0`
            resolves against the nearest scrolling ancestor, and an
            `overflow-x-auto` box with no height limit never scrolls vertically —
            so the header had nothing to stick to and slid away with the page.
            Capping the height moves both axes inside this box: the titles hold at
            the top, the left rail holds at the left.
          */}
          <div
            ref={scroller}
            onScroll={onScroll}
            className="max-h-[min(70vh,640px)] overflow-auto"
          >
            <div className="relative" style={{ width: leftW + chartW }}>
              {/*
                ONE shadow for the whole pinned column, not one per row.

                Row-by-row, every block cast its own — and each row's bottom
                border cut across it, so what should have been a single soft edge
                came out as a column of separate smudges with ticks between them.
                This is a full-height gradient that sticks at the column's right
                edge and runs unbroken from the top of the header to the last row,
                over the borders instead of between them.
              */}
              {shadow.x && (
                <div className="pointer-events-none absolute inset-y-0 left-0 z-40 w-full">
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
              <TimelineHeader
                from={from}
                totalDays={totalDays}
                zoom={zoom}
                pxPerDay={pxPerDay}
                off={offDates}
                hidden={hiddenCols}
                shadow={shadow}
              />
              {/* The chart canvas is `bg-background` while every cell and title
                  on the left is `bg-surface`: the two tones are what separate
                  "the table" from "the calendar" now that the left rail is
                  pinned over the chart while you scroll. */}
              <div className="relative bg-background">
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
                  leftW={leftW}
                />
                <TodayLine left={leftW + daysBetween(from, today) * pxPerDay} height={bodyH} />

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
                        canEdit={isAdmin}
                        leftW={leftW}
                        onRename={(name) =>
                          g.section && updateSection(g.section.id, { name })
                        }
                      />
                      {!isCollapsed &&
                        g.rows.map((row) => (
                          <TimelineRow
                            key={row.task.id}
                            row={row}
                            from={from}
                            pxPerDay={pxPerDay}
                            totalDays={totalDays}
                            leftW={leftW}
                            hidden={hiddenCols}
                            canEdit={isAdmin}
                            off={offDates}
                            drag={drag?.taskId === row.task.id ? drag : null}
                            dropTarget={dropBefore === row.task.id}
                            selected={selected.has(row.task.id)}
                            anySelected={selected.size > 0}
                            assignableProfiles={assignableProfiles}
                            onSelect={(shiftKey, on) => toggleSelected(row.task.id, shiftKey, on)}
                            onRename={(title) => updateTask(row.task.id, { title })}
                            onAssign={(assigneeId) => updateTask(row.task.id, { assigneeId })}
                            taskTypes={taskTypes}
                            onSetType={(typeId) => updateTask(row.task.id, { typeId })}
                                onSetBudget={(estimateHours) =>
                              updateTask(row.task.id, { estimateHours })
                            }
                            onSetDuration={(days) =>
                              updateTask(row.task.id, {
                                // n working days INCLUSIVE of the start, so the
                                // last day is start + (n-1) working days.
                                dueDate: toISO(addWorkDays(row.start, days - 1, offDates)),
                              })
                            }
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

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand bg-surface px-3 py-2 text-sm shadow-card">
          <span className="font-medium">{selected.size} selected</span>
          <span className="mx-1 h-4 w-px bg-border" />
          <TaskBulkControls ids={[...selected]} onDone={() => setSelected(new Set())} />
          <button
            onClick={() => setSelected(new Set())}
            title="Clear selection"
            className="ml-auto rounded-md p-1 text-faint hover:text-foreground"
          >
            <X size={14} />
          </button>
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
  /**
   * `boundary` = the first tick of a new month (of a new YEAR at month zoom).
   * `weekStart` = a Sunday, at day zoom only — the studio's week starts there,
   * Fri+Sat being the weekend, so the divider falls between Sat and Sun.
   */
  const ticks: {
    left: number;
    width: number;
    label: string;
    boundary: boolean;
    weekStart?: boolean;
  }[] = [];
  const step = zoom === "day" ? 1 : zoom === "week" ? 7 : 0; // 0 = calendar months

  if (step > 0) {
    let lastMonth = -1;
    let lastYear = -1;
    for (let d = 0; d < totalDays; d += step) {
      const date = shiftDays(from, d);
      const month = date.getMonth();
      const year = date.getFullYear();
      // The month is announced by the first tick that falls INSIDE it, not by
      // the 1st: at week zoom the ticks are Sundays and almost never land on it.
      const boundary = month !== lastMonth;
      // The year is stated once, where it CHANGES. Nothing else on this chart
      // carries it now that the month band is gone — the ticks are d/m and the
      // Dates column drops the year too — so a plan running into next January
      // would otherwise never say which January. Only where it fits: at day
      // zoom a tick is 26px and "Jan 2027" would be cut to "Jan 2…".
      const newYear = boundary && lastYear !== -1 && year !== lastYear;
      const width = Math.min(step, totalDays - d) * pxPerDay;
      lastMonth = month;
      lastYear = year;
      ticks.push({
        left: d * pxPerDay,
        width,
        label: boundary
          ? newYear && width >= YEAR_LABEL_MIN_PX
            ? `${MONTH_NAMES_SHORT[month]} ${year}`
            : MONTH_NAMES_SHORT[month]
          : zoom === "day"
            ? String(date.getDate())
            : `${date.getDate()}/${month + 1}`,
        boundary,
        weekStart: zoom === "day" && date.getDay() === 0,
      });
    }
  } else {
    let cursor = 0;
    let lastYear = -1;
    while (cursor < totalDays) {
      const date = shiftDays(from, cursor);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const len = Math.min(daysBetween(date, monthEnd), totalDays - cursor);
      const year = date.getFullYear();
      // At this zoom every tick is already a month, so the boundary worth
      // marking is the YEAR — and the tick that opens one carries it.
      const boundary = year !== lastYear;
      lastYear = year;
      ticks.push({
        left: cursor * pxPerDay,
        width: len * pxPerDay,
        label: boundary
          ? `${MONTH_NAMES_SHORT[date.getMonth()]} ${year}`
          : MONTH_NAMES_SHORT[date.getMonth()],
        boundary,
      });
      cursor += len;
    }
  }
  return { ticks };
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
            className="fixed z-50 w-60 rounded-xl border border-border bg-surface p-3 shadow-xl"
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
              ? "border-foreground/15"
              : t.weekStart
                ? "border-foreground/[0.07]"
                : "border-border/40"
          }`}
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
  hidden,
  shadow,
}: {
  from: Date;
  totalDays: number;
  zoom: Zoom;
  pxPerDay: number;
  off: Set<string>;
  hidden: Set<string>;
  shadow: { x: boolean; y: boolean };
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

      z-30 over the rows' own sticky name block (z-20): scrolling down must not
      slide task names over the column titles.
    */
    <div
      className={`sticky top-0 z-30 border-b border-border bg-surface ${shadow.y ? SHADOW_Y : ""}`}
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
        <span className="relative h-full flex-1 border-l border-border">
          {ticks.map((t) => {
            const date = shiftDays(from, Math.round(t.left / pxPerDay));
            const nonWork = dayZoom && !isWorkDay(date, off);
            return (
              <span
                key={t.left}
                className={`absolute top-0 flex h-full items-center truncate px-1 text-[10px] ${
                  t.boundary
                    ? "border-l border-foreground/15 font-semibold text-foreground"
                    : `tabular-nums ${nonWork ? "text-faint/60" : "text-muted"}`
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
  canEdit,
  leftW,
  onRename,
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
            <span className="shrink-0 text-[11px] tabular-nums text-faint">
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
      <div className="h-full shrink-0 bg-surface" style={{ width: leftW - STICKY_W }} />
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
        <span
          className="absolute"
          style={{ left, width, top: `calc(50% - ${SECTION_BAR_H / 2}px)` }}
          onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTip(null)}
        >
          <span
            className="absolute inset-x-0 top-0 rounded-[1px]"
            style={{ height: SECTION_BAR_H, backgroundColor: color, opacity: 0.85 }}
          />
          {width >= TIP_MIN_W && (
            <>
              <span
                className="absolute left-0 top-0"
                style={{
                  borderTop: `${TIP_H}px solid ${color}`,
                  borderRight: `${TIP_W}px solid transparent`,
                  opacity: 0.85,
                }}
              />
              <span
                className="absolute top-0"
                style={{
                  left: width - TIP_W,
                  borderTop: `${TIP_H}px solid ${color}`,
                  borderLeft: `${TIP_W}px solid transparent`,
                  opacity: 0.85,
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
 * The face, and a real list of people behind it.
 *
 * A `<select>` in a 44px cell was technically an editor and practically
 * unusable — the control was 30px wide with a 20px avatar on top of it, and
 * picking anyone meant hitting a native menu you couldn't see. This is a
 * plain button that opens a list with faces and names in it.
 */
function AssigneeCell({
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
            className="fixed z-50 flex w-44 flex-col overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl"
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

function TimelineRow({
  row,
  from,
  pxPerDay,
  totalDays,
  leftW,
  hidden,
  canEdit,
  off,
  drag,
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
}: {
  row: Row;
  from: Date;
  pxPerDay: number;
  totalDays: number;
  leftW: number;
  hidden: Set<string>;
  canEdit: boolean;
  off: Set<string>;
  drag: DragState | null;
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
      className={`group/trow relative flex border-b border-border last:border-b-0 ${
        dropTarget ? "shadow-[inset_0_2px_0_0_var(--brand)]" : ""
      }`}
      style={{ height: ROW_H, width: leftW + totalDays * pxPerDay }}
      onDragOver={(e) => {
        if (!draggedRowId) return;
        e.preventDefault();
        onRowDragOver();
      }}
      onDrop={onRowDrop}
    >
      {/* Only this block is sticky — see STICKY_W. */}
      <div
        className={`sticky left-0 z-20 flex h-full shrink-0 items-center ${
          selected ? "bg-brand-soft" : "bg-surface group-hover/trow:bg-background/40"
        }`}
        style={{ width: STICKY_W }}
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
          selected ? "bg-brand-soft" : "bg-surface group-hover/trow:bg-background/40"
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
            className={`${cell} tabular-nums ${row.hasStart ? "text-muted" : "text-faint"}`}
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
            {row.hasStart && canEdit ? (
              <EditableNumberCell
                value={workLen}
                onCommit={(v) => v != null && v >= 1 && onSetDuration(Math.round(v))}
                format={(v) => `${v} day${v === 1 ? "" : "s"}`}
              />
            ) : row.hasStart ? (
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

      <div className="relative h-full shrink-0" style={{ width: totalDays * pxPerDay }}>
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
      {drag && (
        <span
          className="pointer-events-none absolute top-1/2 z-30 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white shadow-lg"
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
      {hasSpan ? (
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
          className={`absolute top-1/2 -translate-y-1/2 overflow-hidden ${
            done ? "opacity-55" : ""
          } ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
            drag ? "ring-2 ring-brand" : ""
          }`}
          style={{
            left,
            width: barWidth,
            height: BAR_H,
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
            backgroundColor: `${color}52`,
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
            style={{ width: `${pct}%`, backgroundColor: over ? "var(--danger)" : color }}
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
      {hasSpan && barWidth >= LABEL_MIN_PX && !drag && (
        <span
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-faint"
          style={{ left: left + barWidth + 6 }}
        >
          {hoursLabel}
        </span>
      )}
      {!hasSpan && (
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
          className={`absolute top-1/2 -translate-y-1/2 rotate-45 rounded-[2px] ${
            done ? "opacity-55" : ""
          } ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
            drag ? "ring-2 ring-brand" : ""
          }`}
          style={{
            left: left + Math.max(0, pxPerDay / 2 - DIAMOND / 2),
            width: DIAMOND,
            height: DIAMOND,
            backgroundColor: over ? "var(--danger)" : color,
          }}
        />
      )}
      </div>
    </div>
  );
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}
function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}
