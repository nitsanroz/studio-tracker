"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  Trash2,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import {
  addWorkDays,
  BAR_H,
  BAR_LABEL_MIN_PX,
  BAR_R,
  DIAMOND,
  dateRangeLabel,
  daysBetween,
  isWorkDay,
  parseISO,
  PX_PER_DAY,
  ROW_H,
  SECTION_BAR_H,
  SECTION_H,
  SHADE_MIN_PX_PER_DAY,
  shiftDays,
  snapToWorkDay,
  ticksFor,
  TIP_H,
  TIP_MIN_W,
  TIP_W,
  toISO,
  workDaysBetween,
  type Zoom,
} from "@/lib/gantt";
import { formatHoursDecimal, MONTH_NAMES_SHORT } from "@/lib/format";
import { taskHoursDone } from "@/lib/task-hours";
import { Avatar, ContextMenu, Tabs } from "./ui";
import { EditableNumberCell, EditableSelectCell, EditableTextCell } from "./editable-cell";
import { TaskBulkControls } from "./task-bulk-controls";
import { NO_TYPE } from "./show-menu";
import type { Profile, Section, Task, TaskType, TimelineMark } from "@/lib/types";

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

/** Re-exported so `client-view` keeps importing the view's own type from here. */
export type { Zoom };

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

/**
 * The row hover tint, in two forms.
 *
 * ⚠️ The pinned blocks need an OPAQUE one. `bg-background/40` replaces
 * `bg-surface` rather than layering over it — they are both background-colour
 * utilities — so on hover the sticky column turned 40% transparent and the
 * calendar scrolling underneath showed through the task's own name: grid lines
 * struck through the text and weekend shading appeared behind it. `color-mix`
 * gives the same colour as a solid.
 *
 * The chart area keeps the translucent one on purpose: it paints OVER the grid
 * layer, and an opaque tint there would blank that row's shading and rules.
 */
const ROW_HOVER_SOLID =
  "group-hover/trow:bg-[color-mix(in_srgb,var(--color-background)_40%,var(--color-surface))]";
/**
 * ⚠️ The chart side needs a DARK wash, not the pinned side's light one.
 * `bg-background/40` over the chart canvas — which is itself `bg-background` —
 * is the same colour, so the hover tint was invisible from the moment it
 * reached the calendar. A wash of the foreground reads on both.
 *
 * Both of these are translucent on purpose: the rows paint OVER the grid layer,
 * so an opaque tint blanks that row's day rules, week seams and weekend
 * shading. Selecting five tasks used to erase the calendar underneath them.
 */
const ROW_HOVER_SHEER = "group-hover/trow:bg-foreground/[0.06]";
const ROW_SELECTED_SHEER = "bg-brand/[0.12]";

/**
 * The section bracket's colour.
 *
 * The client's own colour made every section on a client's chart the same
 * bright hue — Anchor's magenta ran across the whole plan — competing with the
 * type colours that actually distinguish one bar from another. A section is
 * structure, not a category, so it is drawn as ink.
 */
const SECTION_BAR_COLOR = "color-mix(in srgb, var(--foreground) 72%, transparent)";

/** The today marker's cap: a downward pennant, wide enough to spot at a glance. */
const TODAY_CAP_W = 12;
const TODAY_CAP_H = 9;

/**
 * The pinned ruler's height — one `h-6` row plus its bottom border. Milestone
 * labels stick just below it, so scrolling down never leaves a line unnamed.
 */
const RULER_H = 25;

/** Never shrink the chart below this, however little room the page leaves. */
const CARD_MIN_H = 320;
/** `main`'s own bottom padding (p-6), so the card stops clear of the edge. */
const CARD_BOTTOM_GAP = 24;

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
        // Identical to the Tasks tab's Columns button, down to the padding and
        // the count: two buttons that do the same thing on two tabs of one page
        // had no business looking like different controls.
        className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
      >
        <Columns3 size={14} />
        Columns
        {hidden.size > 0 && (
          <span className="text-xs tabular-nums text-faint">{TL_COLS.length - hidden.size}</span>
        )}
        <ChevronDown size={13} className="text-faint" />
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
/**
 * Where the label switches from dark to white. The label starts at the bar's
 * left edge and so does the hours fill, so past roughly half the bar the label
 * is sitting on solid colour rather than on the tinted track.
 */
const LABEL_ON_FILL_PCT = 55;
/**
 * Measured height of the Dates popover (title + two fields + the button row).
 * Used to decide whether it opens downwards or flips above the cell — it is
 * `fixed`, so nothing else stops it running off the bottom of the window.
 */
const PANEL_H = 200;

/** What's being dragged and by how much — held locally so a drag is one write, not sixty. */
interface DragState {
  taskId: string;
  mode: "move" | "start" | "end";
  startX: number;
  deltaDays: number;
  /** distinguishes a click (open the task) from a drag (re-schedule it) */
  moved: boolean;
  /**
   * Every task this drag moves, when it started on a bar that was part of a
   * multi-selection. `null` for an ordinary one-bar drag.
   *
   * MOVE only. Dragging an edge stays single: resizing ten tasks by the same
   * number of days is a different intent from moving them, and one nobody asked
   * for — a 2-day task and a 3-week task do not want the same edge nudge.
   */
  group: string[] | null;
}

interface Row {
  task: Task;
  start: Date;
  due: Date;
  /** false = a deadline with no span; drawn as a diamond, not a bar */
  hasStart: boolean;
  /** no dates at all — listed so it can be scheduled, but nothing is drawn */
  undated: boolean;
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
  showUndated,
  hiddenTypes,
  toolbarSlot,
}: {
  clientId: string;
  /** owned by ClientView: its control sits on the tab strip, not in here */
  zoom: Zoom;
  showDone: boolean;
  /** also list tasks with no dates at all, as rows with no bar */
  showUndated: boolean;
  /** type ids the Show menu is holding back; `NO_TYPE` for the untyped ones */
  hiddenTypes: Set<string>;
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
    updateTasksVaried,
    timelineMarks,
    addTimelineMark,
    updateTimelineMark,
    deleteTimelineMark,
    updateSection,
    openTask,
    reorderTimelineTasks,
    addTaskNear,
  } = useData();
  const isAdmin = useIsAdmin();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Right-click menu on a bar row, and the row it was opened from. */
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  /** Where the inline "new task" field is currently open, if anywhere. */
  const [insert, setInsert] = useState<{ anchorId: string; where: "before" | "after" } | null>(
    null,
  );
  /**
   * Rubber-band selection. `null` when idle; otherwise the two corners, in the
   * chart body's own coordinates (x measured from the left table's left edge,
   * so a bar at `left` sits at `leftW + left`).
   */
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    add: boolean;
  } | null>(null);
  const marqueeRef = useRef<typeof marquee>(null);
  const body = useRef<HTMLDivElement>(null);
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
   * The height the page actually leaves this card, measured — not `70vh`.
   *
   * `max-h-[min(70vh,640px)]` meant that on a 1000px window the chart sat in a
   * 640px box with 1679px of rows inside it and 175px of empty window
   * underneath, and on a 27" screen the waste was far worse. This is the same
   * complaint v1.9.2 fixed on the public Gantt, and the same answer: a chart
   * should take the room it is given.
   *
   * MEASURED rather than `h-dvh` + `flex-1` as on that page, because this card
   * is one tab of three inside the app shell's `main`; making the shell a fixed
   * height would change how Tasks and Overview scroll. Reading the card's own
   * top offset costs one layout read and leaves every other page alone.
   */
  const root = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = scroller.current;
      if (!el) return;
      // Viewport-relative top + the page's own bottom padding. Only correct at
      // scrollTop 0, which is exactly when it matters: the point is that the
      // card FITS, and a card that fits is one the document never scrolls past.
      const top = el.getBoundingClientRect().top + window.scrollY;
      // …and whatever sits BELOW the card inside this panel — the "N tasks with
      // no due date aren't shown" note. Subtracting only the page padding left
      // the document 29px too tall, which is a scrollbar on a layout whose
      // whole point is not to have one.
      const trailing = root.current
        ? root.current.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom
        : 0;
      setMaxH(
        Math.max(CARD_MIN_H, window.innerHeight - top - trailing - CARD_BOTTOM_GAP),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // `leftW` and `zoom` change the toolbar's height when the legend wraps.
  }, [zoom, leftW]);
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
  const marks = useMemo(
    () =>
      timelineMarks
        .filter((m) => m.clientId === clientId)
        .sort((a, b) => a.onDate.localeCompare(b.onDate)),
    [timelineMarks, clientId],
  );
  /** The mark whose title is being typed — new ones start here, empty. */
  const [editingMark, setEditingMark] = useState<string | null>(null);
  /**
   * The day the pointer is over in the ruler, as an offset from `from`.
   *
   * Lifted to here rather than kept in the header because the highlight is a
   * COLUMN, not a tick: you are aiming at a day in the chart, and a band that
   * stopped at the bottom of the ruler would leave you guessing which row of
   * bars it lines up with.
   */
  const [hoverDay, setHoverDay] = useState<number | null>(null);

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

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  /** Rows grouped by section, in the client's section order, "No section" last. */
  const groups = useMemo<Group[]>(() => {
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const typeById = new Map(taskTypes.map((t) => [t.id, t]));

    const rows: Row[] = clientTasks
      .filter((t) => (t.dueDate || showUndated) && (showDone || t.status !== "done"))
      // The Show menu's type filter. `NO_TYPE` is how an untyped task is named
      // in the hidden set, so the two cases are one lookup.
      .filter((t) => !hiddenTypes.has(t.typeId ?? NO_TYPE))
      .map((t) => {
        // An undated task has no geometry. It still needs a start/due to satisfy
        // the row shape, so it borrows today's date — nothing is ever drawn from
        // them, and `undated` is what every drawing branch actually checks.
        const due = t.dueDate ? parseISO(t.dueDate) : today;
        // A start after the due date would draw a bar backwards. Clamp rather
        // than refuse to render it — the data stays visible and draggable.
        const rawStart = t.startDate ? parseISO(t.startDate) : due;
        return {
          task: t,
          start: rawStart > due ? due : rawStart,
          due,
          hasStart: !!t.startDate,
          undated: !t.dueDate,
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
  }, [clientTasks, sections, clientId, profiles, taskTypes, taskMinutes, showDone, showUndated, hiddenTypes, today]);

  const allRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const undated = clientTasks.filter((t) => !t.dueDate && (showDone || t.status !== "done")).length;
  /** Held back by the type filter — counted so the chart is never quietly partial. */
  const filteredOut = clientTasks.filter(
    (t) =>
      (t.dueDate || showUndated) &&
      (showDone || t.status !== "done") &&
      hiddenTypes.has(t.typeId ?? NO_TYPE),
  ).length;

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

  /**
   * Where every visible row sits in the body's coordinate space, and how far its
   * bar runs. Derived from the SAME walk that produces `bodyH`, so a collapsed
   * section counts for its header and nothing else — hit-testing against rows
   * that aren't on screen would select things you can't see.
   */
  function rowBands() {
    const bands: { id: string; top: number; bottom: number; left: number; right: number }[] = [];
    let y = 0;
    for (const g of groups) {
      y += SECTION_H;
      if (collapsed.has(g.section?.id ?? "")) continue;
      for (const r of g.rows) {
        const left = leftW + daysBetween(from, r.start) * pxPerDay;
        const width = r.hasStart
          ? Math.max(10, (daysBetween(r.start, r.due) + 1) * pxPerDay)
          : DIAMOND;
        bands.push({ id: r.task.id, top: y, bottom: y + ROW_H, left, right: left + width });
        y += ROW_H;
      }
    }
    return bands;
  }

  /**
   * Press on empty calendar and drag a rectangle over the bars you want.
   *
   * It selects on the BAR, not the row: a rectangle drawn over August should
   * take the tasks that run in August, not every task whose row it happens to
   * cross on the way. Plain drag replaces the selection, shift adds to it.
   */
  function onBodyPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isAdmin) return;
    if (!(e.target as HTMLElement).hasAttribute("data-chart-bg")) return;
    const host = body.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const start = {
      x0: e.clientX - r.left,
      y0: e.clientY - r.top,
      x1: e.clientX - r.left,
      y1: e.clientY - r.top,
      add: e.shiftKey,
    };
    marqueeRef.current = start;
    setMarquee(start);

    const move = (ev: PointerEvent) => {
      const m = marqueeRef.current;
      if (!m) return;
      const box = host.getBoundingClientRect();
      const next = { ...m, x1: ev.clientX - box.left, y1: ev.clientY - box.top };
      marqueeRef.current = next;
      setMarquee(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const m = marqueeRef.current;
      marqueeRef.current = null;
      setMarquee(null);
      if (!m) return;
      const x = [Math.min(m.x0, m.x1), Math.max(m.x0, m.x1)];
      const y = [Math.min(m.y0, m.y1), Math.max(m.y0, m.y1)];
      // A click with no drag clears the selection — the same gesture that means
      // "nothing" on a desktop. Anything smaller than this is a slip, not a box.
      const isClick = x[1] - x[0] < 4 && y[1] - y[0] < 4;
      const hits = isClick
        ? []
        : rowBands()
            .filter((b) => b.bottom > y[0] && b.top < y[1] && b.right > x[0] && b.left < x[1])
            .map((b) => b.id);
      setSelected((prev) => {
        if (m.add) return new Set([...prev, ...hits]);
        return new Set(hits);
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

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
    if (d.group && d.group.length > 1) {
      // Each task keeps its OWN dates and is shifted by the same number of
      // working days, so every patch differs — hence `updateTasksVaried` rather
      // than `updateTasksBulk`, and one ⌘Z for the whole gesture.
      const items = d.group
        .map((id) => allRows.find((r) => r.task.id === id))
        .filter((r): r is Row => !!r)
        .flatMap((r) => {
          const patch = plannedPatch(r, "move", d.deltaDays, offDates);
          return patch ? [{ id: r.task.id, patch }] : [];
        });
      if (items.length) updateTasksVaried(items);
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
    The Columns button is rendered INTO the tab strip, through a slot ClientView
    hands down. They belong to this panel and read its state, so
    lifting them would mean lifting `hiddenCols` and the used-type set with them;
    a portal keeps the state here and only moves the pixels. Together with the
    how-to moving onto an (i) beside the client name, that is a whole row of
    chrome removed from above a chart that is already fighting for height.
  */
  const toolbar = (
    <>
      <TimelineColumnsMenu hidden={hiddenCols} onToggle={toggleCol} />
    </>
  );

  return (
    <div ref={root} className="flex flex-col gap-3">
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
            // The class is the SERVER's answer, replaced by the measured one on
            // mount — without it the first paint would be an unbounded box, and
            // an unbounded box has nothing for the header to stick to.
            className="max-h-[min(70vh,640px)] overflow-auto"
            style={maxH ? { maxHeight: maxH } : undefined}
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
                canAddMark={isAdmin}
                onHoverDay={setHoverDay}
                hoverDay={hoverDay}
                todayOffset={daysBetween(from, today)}
                onAddMark={(dayOffset) => {
                  const date = toISO(shiftDays(from, dayOffset));
                  // Created empty and immediately put into its editor: the mark
                  // is the gesture's result, and asking for a name in a dialog
                  // first would make placing one a two-step negotiation.
                  addTimelineMark(clientId, date, "");
                  setEditingMark(date);
                }}
              />
              {/* The chart canvas is `bg-background` while every cell and title
                  on the left is `bg-surface`: the two tones are what separate
                  "the table" from "the calendar" now that the left rail is
                  pinned over the chart while you scroll. */}
              <div
                ref={body}
                onPointerDown={onBodyPointerDown}
                className={`relative bg-background ${marquee ? "select-none" : ""}`}
              >
                {marquee && (
                  <div
                    className="pointer-events-none absolute z-20 rounded-sm border border-brand bg-brand/10"
                    style={{
                      left: Math.min(marquee.x0, marquee.x1),
                      top: Math.min(marquee.y0, marquee.y1),
                      width: Math.abs(marquee.x1 - marquee.x0),
                      height: Math.abs(marquee.y1 - marquee.y0),
                    }}
                  />
                )}
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
                {/*
                  Time that has already gone. A wash from the start of the range
                  up to the today line, which is where it ends — so the line
                  reads as the edge of the past rather than as one more vertical
                  in a chart full of them.

                  Behind the rows and light — but not as light as it wants to
                  be. 5% reads at a glance without competing with a bar; the
                  weekend shading beneath it is 4.5%, so a past weekend simply
                  comes out a little darker still, which is true.
                */}
                {daysBetween(from, today) > 0 && (
                  <div
                    className="pointer-events-none absolute top-0 z-0 bg-foreground/[0.05]"
                    style={{
                      left: leftW,
                      // …and the past ends where the line is, so the two still
                      // read as one edge. Half of today shaded is simply true.
                      width:
                        Math.min(daysBetween(from, today) + 0.5, totalDays) * pxPerDay,
                      height: bodyH,
                    }}
                  />
                )}
                {hoverDay !== null && hoverDay >= 0 && hoverDay < totalDays && (
                  <div
                    className="pointer-events-none absolute top-0 z-0 bg-brand/[0.07]"
                    style={{
                      left: leftW + hoverDay * pxPerDay,
                      width: pxPerDay,
                      height: bodyH,
                    }}
                  />
                )}
                {/* The MIDDLE of today's column, not its left edge.
                    The date in the ruler is centred in its box, so a line at the
                    day's start sat half a column off the chip that names it —
                    and "we are inside this day" is truer than "this day begins
                    here" for a marker that means now. */}
                <TodayLine
                  left={leftW + (daysBetween(from, today) + 0.5) * pxPerDay - 1}
                  height={bodyH}
                />
                <MarkLayer
                  marks={marks}
                  from={from}
                  pxPerDay={pxPerDay}
                  height={bodyH}
                  leftW={leftW}
                  canEdit={isAdmin}
                  // A brand-new mark is keyed by its DATE, because it has no id
                  // until the insert comes back; once it does, the id takes over.
                  editingId={
                    editingMark && marks.find((m) => m.id === editingMark)
                      ? editingMark
                      : (marks.find((m) => m.onDate === editingMark && !m.title)?.id ?? null)
                  }
                  onEdit={setEditingMark}
                  onRename={(id, title) => updateTimelineMark(id, { title })}
                  onMove={(id, days) => {
                    const m = marks.find((x) => x.id === id);
                    if (!m) return;
                    // No working-day snapping: a launch can be a Friday.
                    updateTimelineMark(id, { onDate: toISO(shiftDays(parseISO(m.onDate), days)) });
                  }}
                  onDelete={(id) => {
                    deleteTimelineMark(id);
                    setEditingMark(null);
                  }}
                />

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
                          <Fragment key={row.task.id}>
                          {insert?.anchorId === row.task.id && insert.where === "before" && (
                            <TimelineInsertRow
                              anchorId={row.task.id}
                              where="before"
                              leftW={leftW}
                              width={leftW + totalDays * pxPerDay}
                              onDone={() => setInsert(null)}
                            />
                          )}
                          <TimelineRow
                            row={row}
                            from={from}
                            pxPerDay={pxPerDay}
                            totalDays={totalDays}
                            leftW={leftW}
                            hidden={hiddenCols}
                            canEdit={isAdmin}
                            off={offDates}
                            // Every bar in the group previews the same shift —
                            // dragging five tasks while four sit still would
                            // read as a failed gesture, not a pending one.
                            drag={
                              drag &&
                              (drag.taskId === row.task.id ||
                                (drag.group?.includes(row.task.id) ?? false))
                                ? drag
                                : null
                            }
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
                              // Grabbing a bar that is IN the selection moves
                              // the whole selection; grabbing one outside it
                              // moves that bar alone and leaves the selection
                              // untouched — the same rule every file manager
                              // uses for dragging out of a multi-selection.
                              const next: DragState = {
                                taskId: row.task.id,
                                mode,
                                startX: clientX,
                                deltaDays: 0,
                                moved: false,
                                group:
                                  mode === "move" && selected.size > 1 && selected.has(row.task.id)
                                    ? [...selected]
                                    : null,
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
                            onContextMenu={
                              isAdmin
                                ? (e, taskId) => {
                                    e.preventDefault();
                                    setRowMenu({ x: e.clientX, y: e.clientY, taskId });
                                  }
                                : undefined
                            }
                          />
                          {insert?.anchorId === row.task.id && insert.where === "after" && (
                            <TimelineInsertRow
                              anchorId={row.task.id}
                              where="after"
                              leftW={leftW}
                              width={leftW + totalDays * pxPerDay}
                              onDone={() => setInsert(null)}
                            />
                          )}
                          </Fragment>
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

      {undated > 0 && !showUndated && (
        <p className="text-xs text-faint">
          {undated} {showDone ? "" : "open "}task{undated === 1 ? "" : "s"} with no due date
          {undated === 1 ? " isn't" : " aren't"}{" "}shown — a bar needs an end date. Turn on
          &ldquo;Show undated&rdquo; to list {undated === 1 ? "it" : "them"} and set dates here.
        </p>
      )}
      {undated > 0 && showUndated && (
        <p className="text-xs text-faint">
          {undated} {showDone ? "" : "open "}task{undated === 1 ? "" : "s"} with no dates
          {undated === 1 ? " is" : " are"}{" "}listed with no bar — set dates to place
          {undated === 1 ? " it" : " them"} on the chart.
        </p>
      )}

      {filteredOut > 0 && (
        <p className="text-xs text-faint">
          {filteredOut} more {filteredOut === 1 ? "task is" : "tasks are"}{" "}hidden by the type
          filter — clear it from &ldquo;Show&rdquo;, or click a dimmed swatch in the legend.
        </p>
      )}

      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={[
            {
              label: "Add task above",
              onClick: () => setInsert({ anchorId: rowMenu.taskId, where: "before" }),
            },
            {
              label: "Add task below",
              onClick: () => setInsert({ anchorId: rowMenu.taskId, where: "after" }),
            },
          ]}
          onClose={() => setRowMenu(null)}
        />
      )}
    </div>
  );
}

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
function TimelineInsertRow({
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
      {/* A pennant pointing AT the day, rather than a dot sitting on it. The CSS
          border triangle: a 0×0 box whose coloured top border mitres into two
          transparent sides, so the shape narrows to a point below. Centred on
          the 2px line — half the triangle's width, less half the line's. */}
      <div
        className="absolute top-0"
        style={{
          left: -(TODAY_CAP_W / 2) + 1,
          borderLeft: `${TODAY_CAP_W / 2}px solid transparent`,
          borderRight: `${TODAY_CAP_W / 2}px solid transparent`,
          borderTop: `${TODAY_CAP_H}px solid var(--foreground)`,
        }}
      />
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
function MarkLayer({
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
      <div className="absolute top-0 z-30" style={{ width: 1, height }}>
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

function TimelineHeader({
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
                {/* Today wears its date in a blue chip — the head of the marker,
                    with the line below as its stem. A chip rather than the whole
                    tick: the tick runs the full height of the ruler and would
                    read as a bar rather than as a date. */}
                {isToday ? (
                  <span className="rounded-md bg-brand px-1.5 py-0.5 text-white">{t.label}</span>
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
        {/* Folded, the bracket is the ONLY thing left of a section in the chart —
            and the name that explains it is off in the pinned column, which may
            well be scrolled away. Expanded it needs no caption: the rows under
            it are the caption. */}
        {collapsed && (
          <span
            className="pointer-events-none absolute whitespace-nowrap text-[10px] font-semibold"
            style={{
              left: left + 1,
              top: `calc(50% - ${SECTION_BAR_H / 2}px - 12px)`,
              color: SECTION_BAR_COLOR,
            }}
          >
            {group.section?.name ?? "No section"}
          </span>
        )}
        <span
          className="absolute"
          style={{ left, width, top: `calc(50% - ${SECTION_BAR_H / 2}px)` }}
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
  onContextMenu,
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
  /** right-click → "Add task above/below"; the chart owns the menu and the composer */
  onContextMenu?: (e: ReactMouseEvent, taskId: string) => void;
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
        if (!draggedRowId) return;
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
