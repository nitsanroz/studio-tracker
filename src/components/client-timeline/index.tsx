"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import {
  addWorkDays,
  DIAMOND,
  GROUP_H,
  daysBetween,
  chartWindow,
  parseISO,
  PX_PER_DAY,
  ROW_H,
  SECTION_H,
  shiftDays,
  toISO,
  type Zoom,
} from "@/lib/gantt";
import { taskMinutesDone } from "@/lib/task-hours";
import { rollupTasks, sectionBudgetHours } from "@/lib/task-rollup";
import { ContextMenu } from "../ui";
import { TaskBulkControls } from "../task-bulk-controls";
import { NO_TYPE } from "../show-menu";
import { TimelineInsertRow, plannedPatch } from "./cells";
import { TimelineColumnsMenu } from "./columns-menu";
import { GroupHeaderRow, SectionHeaderRow, SummaryCells, TimelineHeader } from "./headers";
import { GridLayer, MarkLayer, TodayLine } from "./layers";
import { TimelineRow } from "./row";
import { CARD_BOTTOM_GAP, CARD_MIN_H, STICKY_W, TL_COL_KEYS, TL_INDENT, allRowsOf, beginRowDrag, blockKey, containerKey, dragRow, endRowDrag, leftWidth } from "./shared";
import type { Block, DragState, Group, Row, TlCol } from "./shared";


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


export function ClientTimeline({
  clientId,
  zoom,
  showDone,
  showUndated,
  hiddenTypes,
  plainBars,
  showSummaries,
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
  /** draw every bar plain, rather than in its type's colour */
  plainBars: boolean;
  /** roll dates and hours up onto section and group header rows (0027) */
  showSummaries: boolean;
  /** where to render the legend + Columns button — the tab strip's right end */
  toolbarSlot: HTMLElement | null;
}) {
  const {
    tasks,
    sections,
    taskGroups,
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
    addSection,
    updateSection,
    addTaskGroup,
    updateTaskGroup,
    groupTasksIntoNew,
    showNotice,
    openTask,
    reorderTimelineTasks,
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
  /**
   * 200ms after a drag commits, the bars that moved ease into place (Nitsan's
   * variant 5C). See the ⚠️ at the call site for why it is armed there only.
   */
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setSettling(true);
    // 240, a little past the 200ms transition: cleared too early and the bar jumps
    // the last few pixels.
    settleTimer.current = setTimeout(() => setSettling(false), 240);
  }, []);
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
          doneMinutes: taskMinutesDone(t, taskMinutes),
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

    // Hand-placed rows first, in their placed order; never-dragged rows fall to
    // the bottom by date rather than jumping into someone's ordering. Hoisted so
    // a group's children and a section's loose rows sort by exactly one rule —
    // two copies of this comparator would drift and the two depths would order
    // differently for no visible reason.
    const byPlacement = (a: Row, b: Row) =>
      (a.task.timelinePosition ?? Number.MAX_SAFE_INTEGER) -
        (b.task.timelinePosition ?? Number.MAX_SAFE_INTEGER) ||
      a.start.getTime() - b.start.getTime() ||
      a.task.title.localeCompare(b.task.title);

    /** Min start / max due across dated rows; null when none of them is dated. */
    const span = (list: Row[]): { start: Date; due: Date } | null => {
      let start: Date | null = null;
      let due: Date | null = null;
      for (const r of list) {
        if (r.undated) continue; // borrowed dates: nothing may be drawn from them
        if (!start || r.start < start) start = r.start;
        if (!due || r.due > due) due = r.due;
      }
      return start && due ? { start, due } : null;
    };

    const ordered = [...byId.values()].sort((a, b) => a.position - b.position);
    const out: Group[] = [];
    for (const key of [...ordered.map((s) => s.id), ""]) {
      const list = bucket.get(key);
      const sectionGroups = taskGroups
        .filter((g) => g.clientId === clientId && (g.sectionId ?? "") === key)
        .sort((a, b) => a.position - b.position);
      // A section with groups but no visible tasks still has to render — the
      // groups are its structure, and an empty one you just made must not vanish.
      if (!list?.length && !sectionGroups.length) continue;

      const inThisSection = list ?? [];
      const blocks: Block[] = sectionGroups.map((g) => {
        const own = inThisSection.filter((r) => r.task.groupId === g.id).sort(byPlacement);
        const s = span(own);
        return {
          group: g,
          rows: own,
          start: s?.start ?? today,
          due: s?.due ?? today,
          undated: !s,
        };
      });
      // ⚠️ "not in one of THIS section's groups", not "groupId == null": a task
      // pointing at a group that lives elsewhere breaks the 0027 invariant, and
      // the rule everywhere is that it renders LOOSE rather than disappearing.
      const loose = inThisSection
        .filter((r) => !r.task.groupId || !sectionGroups.some((g) => g.id === r.task.groupId))
        .sort(byPlacement);

      const whole = span(inThisSection);
      out.push({
        section: key ? (byId.get(key) ?? null) : null,
        rows: loose,
        blocks,
        start: whole?.start ?? today,
        due: whole?.due ?? today,
        undated: !whole,
      });
    }
    return out;
  }, [clientTasks, sections, taskGroups, clientId, profiles, taskTypes, taskMinutes, showDone, showUndated, hiddenTypes, today]);

  const allRows = useMemo(() => groups.flatMap(allRowsOf), [groups]);
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
  const { from, totalDays } = useMemo(
    () =>
      chartWindow(
        [
          ...allRows.flatMap((r) => [r.start, r.due]),
          // ⚠️ Milestones widen the window too — see `chartWindow`. Omitted here
          // until v1.28.2, so a mark outside the tasks' span was unreachable.
          ...marks.map((m) => parseISO(m.onDate)),
        ],
        today,
        zoom,
      ),
    [allRows, marks, today, zoom],
  );

  const pxPerDay = PX_PER_DAY[zoom];
  const chartW = totalDays * pxPerDay;

  const assignableProfiles = useMemo(
    () => profiles.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );

  /**
   * Display order across every open section — the range a shift-click covers.
   *
   * ⚠️ It must match the RENDER order exactly, groups first then loose rows, or a
   * shift-click range picks up rows the user didn't drag across. Same walk as
   * `bodyH` and `rowBands`, which is why all three read alike.
   */
  const orderedIds = useMemo(
    () =>
      groups.flatMap((g) => {
        if (collapsed.has(g.section?.id ?? "")) return [];
        return [
          ...g.blocks.flatMap((b) =>
            collapsed.has(blockKey(b.group.id)) ? [] : b.rows.map((r) => r.task.id),
          ),
          ...g.rows.map((r) => r.task.id),
        ];
      }),
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
  const bodyH = groups.reduce((h, g) => {
    let out = h + SECTION_H;
    if (collapsed.has(g.section?.id ?? "")) return out;
    for (const b of g.blocks) {
      // A group's own row always counts; its children only when unfolded.
      out += GROUP_H + (collapsed.has(blockKey(b.group.id)) ? 0 : b.rows.length * ROW_H);
    }
    return out + g.rows.length * ROW_H;
  }, 0);

  /**
   * Where every visible row sits in the body's coordinate space, and how far its
   * bar runs. Derived from the SAME walk that produces `bodyH`, so a collapsed
   * section counts for its header and nothing else — hit-testing against rows
   * that aren't on screen would select things you can't see.
   */
  function rowBands() {
    const bands: { id: string; top: number; bottom: number; left: number; right: number }[] = [];
    let y = 0;
    const band = (r: Row) => {
      /**
       * ⚠️ THE DIAMOND'S BOX MUST MATCH WHERE IT IS DRAWN, and it did not. A
       * deadline marker is rendered CENTRED in its day column
       * (`left + max(0, pxPerDay/2 - DIAMOND/2)`, see TimelineRow) while this
       * band started at the column's left edge. At day zoom that is 26px per day
       * against an 11px diamond — a 7.5px offset, so the two overlapped by 3.5px
       * of 11: a marquee drawn tightly around a visible diamond selected
       * nothing, and one drawn through the empty cell beside it selected the
       * task. Day zoom has been the default since v1.11.0, so it was the case
       * people met first. Spanning bars were always right — they share their
       * formula with the render.
       */
      const shift = r.hasStart ? 0 : Math.max(0, pxPerDay / 2 - DIAMOND / 2);
      const left = leftW + daysBetween(from, r.start) * pxPerDay + shift;
      const width = r.hasStart
        ? Math.max(10, (daysBetween(r.start, r.due) + 1) * pxPerDay)
        : DIAMOND;
      bands.push({ id: r.task.id, top: y, bottom: y + ROW_H, left, right: left + width });
      y += ROW_H;
    };
    for (const g of groups) {
      y += SECTION_H;
      if (collapsed.has(g.section?.id ?? "")) continue;
      // ⚠️ Same walk, same order as `bodyH` and the render. A group's header row
      // advances y but contributes NO band — the marquee must not select a
      // container, and a folded group's children are off screen, so hit-testing
      // them would select tasks the user cannot see.
      for (const b of g.blocks) {
        y += GROUP_H;
        if (collapsed.has(blockKey(b.group.id))) continue;
        for (const r of b.rows) band(r);
      }
      for (const r of g.rows) band(r);
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
      if (d) {
        // ⚠️⚠️ 5C: THE SETTLE IS ARMED HERE AND NOWHERE ELSE, and the narrowness is
        // the whole design. The bars are positioned with `left`/`width`, which ARE
        // layout properties — so a standing transition on them would animate every
        // bar on the chart whenever anything moved them, including a zoom switch,
        // which on Anchor's 108 rows means 108 elements re-flowing per frame. Armed
        // only on a real commit, it animates the one or two bars that actually
        // changed, once, for 200ms.
        //
        // ⚠️ And it is armed AFTER `setDrag(null)`: while the pointer is down the
        // bar must track the cursor exactly, so a transition there would make it
        // lag behind the hand. That was the one real risk flagged in the preview.
        if (d.moved && d.deltaDays !== 0) armSettle();
        commit(d);
      }
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
  /**
   * Reorder within ONE container — one section, and one group inside it.
   *
   * ⚠️ `rows` is the container's own run, not the section's whole list. Passing
   * the section's rows for a drop inside a group would hand
   * `reorderTimelineTasks` a list the moved row isn't in.
   */
  function dropRow(container: string, rows: Row[], targetId: string | null) {
    const { id: movedId, fromContainer } = endRowDrag();
    setDropBefore(null);
    if (!movedId || movedId === targetId || fromContainer !== container) return;
    const ids = rows.map((r) => r.task.id);
    const without = ids.filter((id) => id !== movedId);
    const at = targetId ? without.indexOf(targetId) : without.length;
    if (at === -1) return;
    reorderTimelineTasks([...without.slice(0, at), movedId, ...without.slice(at)]);
  }

  /**
   * One task row, wherever it sits — loose in a section or inside a group.
   *
   * A function rather than duplicated JSX at both depths: it carries eighteen
   * handlers, and two copies would drift the first time one of them changed.
   * `container` and `containerRows` are the only things that vary with depth, and
   * both exist so a reorder can only ever renumber the run the row belongs to.
   */
  function timelineRow(row: Row, container: string, containerRows: Row[], indent = 0) {
    return (
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
          indent={indent}
          off={offDates}
          settling={settling}
          // Every bar in the selection previews the same shift — dragging five
          // tasks while four sit still would read as a failed gesture, not a
          // pending one.
          drag={
            drag &&
            (drag.taskId === row.task.id || (drag.group?.includes(row.task.id) ?? false))
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
          plain={plainBars}
          taskTypes={taskTypes}
          onSetType={(typeId) => updateTask(row.task.id, { typeId })}
          onSetBudget={(estimateHours) => updateTask(row.task.id, { estimateHours })}
          onSetDuration={(days) =>
            updateTask(row.task.id, {
              // n working days INCLUSIVE of the start, so the last day is
              // start + (n-1) working days.
              dueDate: toISO(addWorkDays(row.start, days - 1, offDates)),
            })
          }
          onDragStart={(mode, clientX) => {
            // Grabbing a bar that is IN the selection moves the whole selection;
            // grabbing one outside it moves that bar alone and leaves the
            // selection untouched — the same rule every file manager uses for
            // dragging out of a multi-selection.
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
            beginRowDrag(row.task.id, container);
          }}
          onRowDragOver={() => setDropBefore(row.task.id)}
          onRowDrop={() => dropRow(container, containerRows, row.task.id)}
          onRowDragEnd={() => {
            endRowDrag();
            setDropBefore(null);
          }}
          onOpen={() => openTask(row.task.id)}
          onSetDates={(startDate, dueDate) => updateTask(row.task.id, { startDate, dueDate })}
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
    );
  }

  /**
   * The figures for a run of rows. Thin wrapper so every call site passes the
   * same `taskMinutes` and the same non-working-day set — "12 working days" on a
   * section header has to mean what it means on a bar's tooltip.
   */
  const rollupOf = (rows: Row[]) =>
    rollupTasks(
      rows.map((r) => r.task),
      taskMinutes,
      offDates,
    );

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
                  const sectionId = g.section?.id ?? null;
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
                        summary={
                          showSummaries ? (
                            <SummaryCells
                              hidden={hiddenCols}
                              rolled={rollupOf(allRowsOf(g))}
                              // ⚠️ The section's OWN recovered budget wins over
                              // the sum of its tasks — see sectionBudgetHours.
                              budget={sectionBudgetHours(
                                g.section,
                                rollupOf(allRowsOf(g)),
                              )}
                              bg="bg-surface"
                            />
                          ) : undefined
                        }
                      />
                      {/* Groups first, then the section's loose rows — the same
                          order as the Tasks tab, and the order `orderedIds`,
                          `bodyH` and `rowBands` all walk in. */}
                      {!isCollapsed &&
                        g.blocks.map((b) => {
                          const bKey = blockKey(b.group.id);
                          const bCollapsed = collapsed.has(bKey);
                          return (
                            <div key={b.group.id}>
                              <GroupHeaderRow
                                block={b}
                                collapsed={bCollapsed}
                                onToggle={() => toggleSection(bKey)}
                                from={from}
                                pxPerDay={pxPerDay}
                                totalDays={totalDays}
                                canEdit={isAdmin}
                                leftW={leftW}
                                onRename={(name) => updateTaskGroup(b.group.id, { name })}
                                summary={
                                  showSummaries ? (
                                    <SummaryCells
                                      hidden={hiddenCols}
                                      rolled={rollupOf(b.rows)}
                                      // A group has no budget of its own; it is
                                      // always the sum of its tasks.
                                      budget={rollupOf(b.rows).estimateHours}
                                      bg="bg-surface"
                                    />
                                  ) : undefined
                                }
                              />
                              {!bCollapsed &&
                                b.rows.map((row) =>
                                  timelineRow(
                                    row,
                                    containerKey(sectionId, b.group.id),
                                    b.rows,
                                    TL_INDENT,
                                  ),
                                )}
                              {/* dropping below the last row appends to this group */}
                              {!bCollapsed && (
                                <div
                                  className="h-0"
                                  onDragOver={(e) => dragRow.id && e.preventDefault()}
                                  onDrop={() =>
                                    dropRow(containerKey(sectionId, b.group.id), b.rows, null)
                                  }
                                  style={{ marginTop: -1, height: 1 }}
                                />
                              )}
                            </div>
                          );
                        })}
                      {!isCollapsed &&
                        g.rows.map((row) =>
                          timelineRow(row, containerKey(sectionId, null), g.rows),
                        )}
                      {/* dropping below the last row appends to this section */}
                      {!isCollapsed && (
                        <div
                          className="h-0"
                          onDragOver={(e) => dragRow.id && e.preventDefault()}
                          onDrop={() => dropRow(containerKey(sectionId, null), g.rows, null)}
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
          &ldquo;Undated&rdquo; in the Show menu to list {undated === 1 ? "it" : "them"} and set
          dates here.
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
            // Same rule as the Tasks tab: gather what is selected when the
            // right-clicked bar is part of a selection, otherwise offer an empty
            // group in that bar's own section.
            ...(selected.size > 1 && selected.has(rowMenu.taskId)
              ? [
                  {
                    label: `Group the ${selected.size} selected tasks…`,
                    onClick: () => {
                      const ids = [...selected];
                      const name = prompt("Name for the new group")?.trim();
                      if (!name) return;
                      void groupTasksIntoNew(ids, name).then((err) => {
                        if (err) showNotice(err);
                        else setSelected(new Set());
                      });
                    },
                  },
                ]
              : [
                  {
                    label: "New group…",
                    onClick: () => {
                      const task = tasks.find((t) => t.id === rowMenu.taskId);
                      if (!task) return;
                      const name = prompt("Name for the new group")?.trim();
                      if (!name) return;
                      void addTaskGroup(clientId, task.sectionId ?? null, name);
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        next.delete(task.sectionId ?? "");
                        return next;
                      });
                    },
                  },
                ]),
            {
              label: "New section…",
              onClick: () => {
                const name = prompt("Name for the new section")?.trim();
                if (name) addSection(clientId, name);
              },
            },
          ]}
          onClose={() => setRowMenu(null)}
        />
      )}
    </div>
  );
}
