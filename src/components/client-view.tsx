"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  GripVertical,
  Columns3,
  Info,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { formatDate, formatDayMonth, formatHoursDecimal, formatHoursShort } from "@/lib/format";
import { taskHoursDone } from "@/lib/task-hours";
import { Avatar, BudgetBar, CollapseChevron, Tabs, TagBadge } from "./ui";
import { ClientAvatar } from "./client-avatar";
import { ClientInfoModal } from "./client-info-modal";
import { ClientNotes } from "./client-notes";
import { ClientTimeline, timelineHint, type Zoom } from "./client-timeline";
import {
  EditableDateCell,
  EditableNumberCell,
  EditableSelectCell,
  EditableTextCell,
} from "./editable-cell";
import { ClientReportButtons } from "./client-report-buttons";
import { ShareGanttButton } from "./share-gantt-button";
import { TaskBulkControls } from "./task-bulk-controls";
import { useColWidths, ResizeHandle } from "./resizable";
import { HBar, LineChart } from "./charts";
import type { Profile, Section, Task } from "@/lib/types";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Client stats: totals, hours per month, hours per user.
 *
 * `inTab` drops the fixed 300px column and the `xl:` gate — it lives on the
 * Overview tab now, where it is finally reachable on a laptop.
 */
function ClientStats({ clientId, inTab = false }: { clientId: string; inTab?: boolean }) {
  const { tasks, profiles, entrySumsAll } = useData();
  const isAdmin = useIsAdmin();

  const stats = useMemo(() => {
    const clientTaskIds = new Set(tasks.filter((t) => t.clientId === clientId).map((t) => t.id));
    const open = tasks.filter((t) => t.clientId === clientId && t.status !== "done").length;
    const billableTaskIds = new Set(
      tasks.filter((t) => t.clientId === clientId && t.billable).map((t) => t.id),
    );

    // Recovered hours we could not pin to a person or a date. They are NOT in
    // entrySumsAll (they never became entries), so they are added to the total
    // separately and deliberately kept out of byMonth/byUser.
    let unattributed = 0;
    for (const t of tasks) {
      if (t.clientId === clientId) unattributed += (t.legacyHours ?? 0) * 60;
    }

    let total = 0;
    let billable = 0;
    const byMonth = new Map<string, number>();
    const byUser = new Map<string, number>();
    for (const e of entrySumsAll) {
      if (!clientTaskIds.has(e.taskId)) continue;
      total += e.minutes;
      if (billableTaskIds.has(e.taskId)) billable += e.minutes;
      const month = e.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + e.minutes);
      // A recovered pre-Everhour entry can name an author who has no profile
      // (they left before the current roster). Those hours still belong in the
      // client total and in byMonth — they have a real date — but there is no
      // person to attribute them to in the "hours per user" breakdown.
      if (e.userId) byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.minutes);
    }

    const months = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([key, minutes]) => {
        const [y, m] = key.split("-").map(Number);
        return { label: `${MONTH_SHORT[m - 1]}${m === 1 ? ` ${String(y).slice(2)}` : ""}`, minutes };
      });

    const users = [...byUser.entries()]
      .map(([id, minutes]) => ({ profile: profiles.find((p) => p.id === id), minutes }))
      .filter((u) => u.profile)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);

    return { total: total + unattributed, unattributed, billable, open, months, users };
  }, [tasks, profiles, entrySumsAll, clientId]);

  const maxUser = stats.users[0]?.minutes ?? 0;

  return (
    <aside
      className={
        inTab
          ? "flex flex-col gap-4"
          : "hidden w-[300px] shrink-0 flex-col gap-4 self-start xl:flex"
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Total logged</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatHoursShort(stats.total)}
          </div>
          {stats.unattributed > 0 && (
            <div
              className="mt-0.5 text-[11px] text-faint"
              title="Hours recovered from the pre-Everhour Asana history that couldn't be attributed to a person or a date. Included in the total above, but not in the charts below."
            >
              incl. {formatHoursShort(stats.unattributed)} pre-Everhour
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Open tasks</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">{stats.open}</div>
        </div>
        {isAdmin && (
          <div className="col-span-2 rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] font-medium text-muted">Billable share</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
              {stats.total > 0 ? `${Math.round((stats.billable / stats.total) * 100)}%` : "–"}
            </div>
          </div>
        )}
      </div>

      {stats.months.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-2 text-[11px] font-medium text-muted">Hours per month</div>
          <LineChart points={stats.months} />
        </div>
      )}

      {stats.users.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Hours per user</div>
          {stats.users.map(({ profile, minutes }) => (
            <HBar
              key={profile!.id}
              label={
                <>
                  <Avatar profile={profile!} size={16} />
                  <span className="truncate">{profile!.name}</span>
                </>
              }
              right={formatHoursShort(minutes)}
              minutes={minutes}
              maxMinutes={maxUser}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

// pl-9 clears the 36px left gutter, which holds BOTH the select checkbox (left-1)
// and the drag handle (left-[18px]) — absolutely positioned, so appearing on hover
// never shifts the row. The gutter was NOT widened to fit the checkbox: the fixed
// columns leave the name cell little room, so every pixel spent here is taken
// straight off the task name. The grip keeps its full row height (the v0.99.27 fix
// for intermittent dragging — the height was what mattered) at half the width.
// The name cell has a min-w-32 floor and the table wrapper is min-w-fit (as on My
// Tasks): widening a resizable column scrolls the table sideways instead of
// crushing the name to a single character.
const COLS = "flex items-center gap-3 pl-9 pr-4";
/** Applied to the leading cell (the tick, and the header's spacer) so both stay aligned. */
const LEAD_TIGHT = "-mr-1.5";

/**
 * Multi-select state, shared down to the rows. A context rather than props: the
 * checkbox lives on TaskRow, the select-all on SectionGroup and the table header,
 * and threading four callbacks through both would bury the drag/drop logic that
 * already fills those signatures.
 */
type SelectionCtx = {
  selected: Set<string>;
  /** Display order of every visible task, for shift-click ranges. */
  ordered: string[];
  toggle: (taskId: string, shiftKey: boolean) => void;
  setMany: (taskIds: string[], on: boolean) => void;
};
const SelectionContext = createContext<SelectionCtx | null>(null);
const useSelection = () => useContext(SelectionContext);

/**
 * Drag-resizable column widths, same mechanism as the My Tasks table. A context
 * for the same reason as the selection above: the header owns the drag handles
 * but the widths have to reach TaskRow, which is rendered two levels down
 * through SectionGroup. Defaults are the px equivalents of the Tailwind widths
 * these cells used to carry (w-40 / w-16 / w-28 / w-36); the "$" column stays
 * fixed — it holds one glyph and there is nothing to reveal by widening it.
 */
const COL_DEFAULTS: Record<string, number> = {
  /**
   * A REAL width, not a floor.
   *
   * The name cell used to be `flex-1` with this as its `minWidth`, and that made
   * both column-resize complaints true at once. Dragging any OTHER column's
   * handle right grew that column out of the name cell's width — total row width
   * was fixed, so the handle stayed under your cursor while the column silently
   * grew to the LEFT: the drag read as backwards. And dragging the name handle
   * did nothing at all, because it moved a minimum that sat far below the width
   * flex had already given the cell.
   *
   * Fixed-width like every other column, the row grows and the wrapper
   * (`min-w-fit`) scrolls sideways instead. Every handle now moves the edge it
   * is sitting on, in the direction you drag it.
   */
  name: 320,
  assignee: 160,
  start: 72,
  due: 72,
  type: 104,
  tag: 112,
  hours: 64,
  // trimmed from 144 now that the logged hours have their own column and this one
  // prints just the budget beside the bar. NOTE: `useColWidths` merges the stored
  // blob OVER these, so anyone with a saved width keeps their old 144.
  budget: 112,
};
const ColWidthsContext = createContext<Record<string, number>>(COL_DEFAULTS);
/** Width + no-shrink for one column cell, for `style={…}`. */
function useColCell() {
  const widths = useContext(ColWidthsContext);
  return (key: string) => ({ width: widths[key] ?? COL_DEFAULTS[key], flexShrink: 0 }) as const;
}
/**
 * The name cell. The 160px clamp is for anyone who dragged this handle while it
 * was still a `minWidth`: the drag looked like it did nothing but it DID store a
 * width, so a saved 40 or 128 would suddenly apply the first time they load this
 * version and the column would arrive crushed.
 */
const NAME_MIN = 160;
function useNameCell() {
  const widths = useContext(ColWidthsContext);
  return {
    width: Math.max(NAME_MIN, widths.name ?? COL_DEFAULTS.name),
    flexShrink: 0,
  } as const;
}

/**
 * Which optional columns are shown. Eight columns is more than any one person
 * needs at once — someone scheduling wants Start/Due/Type, someone invoicing
 * wants Hours/Budget/$ — so the set is per-user and persisted, like the widths.
 * The task NAME is not in here: a table of tasks with no titles is not a view
 * anyone wants, and leaving it out means the menu can never empty the table.
 */
const OPTIONAL_COLS = [
  { key: "assignee", label: "Assignee" },
  { key: "start", label: "Start" },
  { key: "due", label: "Due" },
  { key: "type", label: "Type" },
  { key: "tag", label: "Status" },
  { key: "hours", label: "Hours" },
  { key: "budget", label: "Budget" },
  { key: "billable", label: "$ (billable)" },
] as const;
type ColKey = (typeof OPTIONAL_COLS)[number]["key"];
const ALL_COLS = OPTIONAL_COLS.map((c) => c.key) as ColKey[];

const HiddenColsContext = createContext<Set<string>>(new Set());
/** `show("due")` — false when the user has hidden that column. */
function useShowCol() {
  const hidden = useContext(HiddenColsContext);
  return (key: ColKey) => !hidden.has(key);
}

function ColumnsMenu({
  hidden,
  onToggle,
}: {
  hidden: Set<string>;
  onToggle: (key: ColKey, on: boolean) => void;
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
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-muted hover:border-brand hover:text-brand"
      >
        <Columns3 size={14} />
        {hidden.size > 0 && <span className="text-xs tabular-nums">{ALL_COLS.length - hidden.size}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex w-44 flex-col rounded-xl border border-border bg-surface p-1 shadow-xl">
          {OPTIONAL_COLS.map((c) => (
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

/** Tri-state select-all: checked when every id is selected, dash when only some are. */
function SelectAllBox({ ids, title }: { ids: string[]; title: string }) {
  const sel = useSelection();
  if (!sel || ids.length === 0) return <span className="w-3.5" />;
  const on = ids.filter((id) => sel.selected.has(id)).length;
  const all = on === ids.length;
  return (
    <input
      // `indeterminate` has no HTML attribute — it can only be set on the node.
      ref={(el) => {
        if (el) el.indeterminate = on > 0 && !all;
      }}
      type="checkbox"
      checked={all}
      title={title}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      onChange={() => sel.setMany(ids, !all)}
      className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand)]"
    />
  );
}

/** Custom MIME so unrelated drop targets (weekly plan, report table) ignore these
 *  drags — and so `dragover` can tell whether to accept, since getData() is only
 *  readable on drop. */
const TASK_DRAG_TYPE = "application/x-studio-task-id";

/** The id of the row being dragged, mirrored outside the DataTransfer because
 *  `getData()` is unreadable during `dragover` — and a row needs to know, while the
 *  pointer is still moving, whether this drag is a reorder within its own section
 *  (it handles it) or a move from another section (it lets the group handle it). */
let draggedTaskId: string | null = null;

/** Distinct from TASK_DRAG_TYPE so the two drag systems in this table never
 *  mistake one another's payloads. */
const SECTION_DRAG_TYPE = "application/x-studio-section-id";
let draggedSectionId: string | null = null;

type SortKey =
  | "title"
  | "assignee"
  | "start"
  | "due"
  | "type"
  | "tag"
  | "hours"
  | "budget"
  | "billable";
type Sort = { key: SortKey; dir: 1 | -1 } | null;

/** Nulls/empties always sort last regardless of direction. */
function cmpNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return cmp(a, b) * dir;
}

function makeComparator(
  sort: NonNullable<Sort>,
  profiles: Profile[],
  taskMinutes: (id: string) => number,
  typeName: (id: string | null) => string | null,
): (a: Task, b: Task) => number {
  const name = (t: Task) => profiles.find((p) => p.id === t.assigneeId)?.name ?? null;
  const str = (x: string, y: string) => x.localeCompare(y);
  const num = (x: number, y: number) => x - y;
  switch (sort.key) {
    case "title":
      return (a, b) => str(a.title, b.title) * sort.dir;
    case "assignee":
      return (a, b) => cmpNullable(name(a), name(b), str, sort.dir);
    case "start":
      return (a, b) => cmpNullable(a.startDate, b.startDate, str, sort.dir);
    case "due":
      return (a, b) => cmpNullable(a.dueDate, b.dueDate, str, sort.dir);
    case "type":
      // by NAME, not by id — the id is a uuid and would sort at random
      return (a, b) => cmpNullable(typeName(a.typeId), typeName(b.typeId), str, sort.dir);
    case "tag":
      return (a, b) => cmpNullable(a.tag, b.tag, str, sort.dir);
    case "hours":
      // must include the legacy remainder, exactly like the cell — sorting by a
      // number the user can't see is worse than not sorting at all
      return (a, b) => num(taskHoursDone(a, taskMinutes), taskHoursDone(b, taskMinutes)) * sort.dir;
    case "budget":
      // Was utilisation (logged ÷ estimate). The column now shows the budget
      // number itself, so sorting it by a hidden ratio is indefensible.
      return (a, b) => cmpNullable(a.estimateHours, b.estimateHours, num, sort.dir);
    case "billable":
      return (a, b) => (Number(b.billable) - Number(a.billable)) * sort.dir;
  }
}

const SORT_HINTS: Record<SortKey, string> = {
  title: "Task title — click to open the task. Click the header to sort",
  assignee: "Who the task is assigned to — click a cell to change. Click to sort",
  start: "When work is planned to start — drives the Timeline bar. Click to sort",
  due: "Due date — click a cell to change. Click to sort",
  type: "The kind of work — colours the task's bar on the Timeline. Click to sort",
  tag: "Where the task is in the process — click a cell to change. Click to sort",
  hours: "Hours logged so far. Click to sort",
  budget: "Budget in hours — click a cell to edit it. Click to sort",
  billable: "Billable task? Non-billable hours don't appear on client reports. Click to sort",
};

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === k;
  const Icon = active ? (sort!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      onClick={() => onSort(k)}
      className={`group/sort flex items-center gap-1 text-left uppercase tracking-wide ${
        active ? "text-brand" : "text-faint hover:text-muted"
      } ${className}`}
      title={SORT_HINTS[k] ?? `Sort by ${label.toLowerCase()}`}
    >
      {label}
      <Icon
        size={12}
        className={active ? "" : "opacity-0 transition-opacity group-hover/sort:opacity-100"}
      />
    </button>
  );
}

function TaskRow({ task, reorderable = true }: { task: Task; reorderable?: boolean }) {
  const {
    profiles,
    tags,
    taskTypes,
    tasks: allTasks,
    openTask,
    updateTask,
    deleteTask,
    reorderTask,
    taskMinutes,
    openTaskId,
  } = useData();
  const isAdmin = useIsAdmin();
  const sel = useSelection();
  const colCell = useColCell();
  const nameCell = useNameCell();
  const show = useShowCol();
  const checked = sel?.selected.has(task.id) ?? false;
  const [dropBefore, setDropBefore] = useState(false);
  // Only a mousedown on the grip may start a drag. With the whole row draggable, any
  // press-and-move began a drag — fighting click-to-open, making text selection in
  // the title cell impossible, and letting a short drag be delivered as a click,
  // which opened the task panel whose full-screen overlay then blocked the next drag
  // entirely. That is why dragging appeared to "work once, then stop".
  //
  // A ref, not state: toggling a `draggable` attribute from a mousedown handler races
  // with React's batching, so the attribute can still be false when the browser
  // decides whether this gesture is a drag. The row stays draggable and unwanted
  // drags are cancelled in onDragStart instead.
  const armedRef = useRef(false);

  /** True when the in-flight drag is a sibling of this row, i.e. a reorder.
   *  Disabled while a column sort is on: position changes wouldn't be visible, so
   *  the drop would look like it did nothing. Cross-section moves still work. */
  function isSiblingDrag() {
    if (!reorderable) return false;
    if (!draggedTaskId || draggedTaskId === task.id) return false;
    const d = allTasks.find((t) => t.id === draggedTaskId);
    return !!d && d.sectionId === task.sectionId && d.clientId === task.clientId;
  }
  const assignee = profiles.find((p) => p.id === task.assigneeId) ?? null;
  const taskType = taskTypes.find((t) => t.id === task.typeId) ?? null;
  const hoursDone = taskHoursDone(task, taskMinutes);
  const overBudget = task.estimateHours != null && hoursDone / 60 > task.estimateHours;
  const done = task.status === "done";
  const active = openTaskId === task.id;

  return (
    <div
      draggable={isAdmin}
      onDragStart={(e) => {
        if (!armedRef.current) {
          e.preventDefault(); // not started from the grip — don't drag
          return;
        }
        draggedTaskId = task.id;
        e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
        // text/plain fallback: some browsers refuse to start a drag, or report no
        // types, when only a custom MIME is set.
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        draggedTaskId = null;
        armedRef.current = false;
        setDropBefore(false);
      }}
      onMouseUp={() => {
        armedRef.current = false;
      }}
      // Reorder only. A drag from another section is left unhandled so it bubbles
      // to the SectionGroup, which moves it in. Acceptance is decided from
      // draggedTaskId rather than dataTransfer.types — the latter isn't reliably
      // populated for custom MIME types during dragover.
      onDragOver={(e) => {
        if (!isAdmin || !isSiblingDrag()) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setDropBefore(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropBefore(false);
      }}
      onDrop={(e) => {
        if (!isAdmin || !isSiblingDrag()) return;
        e.preventDefault();
        e.stopPropagation();
        setDropBefore(false);
        const id = e.dataTransfer.getData(TASK_DRAG_TYPE) || draggedTaskId;
        if (id) reorderTask(id, task.id);
      }}
      // inset shadow rather than a border: a real border-top would shift the row 2px
      className={`${COLS} group relative h-10 cursor-pointer border-b border-border text-sm transition-colors ${
        checked ? "bg-brand-soft" : active ? "bg-brand-soft/50" : "hover:bg-background"
      } ${task.pending ? "opacity-50" : ""} ${
        dropBefore ? "shadow-[inset_0_2px_0_0_var(--brand)]" : ""
      }`}
      onClick={() => openTask(task.id)}
    >
      {/* Full-height gutter, not just the 14px icon: only a mousedown here arms the
          drag, so a small miss silently cancelled it — which felt like the drag
          working only sometimes. The icon fades in on hover; the hit area is always
          present and spans the row's full height. */}
      {isAdmin && sel && (
        // Stays visible once anything is selected, so the selection is legible at a
        // glance instead of only under the cursor.
        <span
          onClick={(e) => e.stopPropagation()}
          className={`absolute left-1 top-0 flex h-full items-center transition-opacity ${
            checked || sel.selected.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <input
            type="checkbox"
            checked={checked}
            aria-label={`Select ${task.title}`}
            title="Select — shift-click to select a range"
            onChange={(e) =>
              sel.toggle(task.id, (e.nativeEvent as MouseEvent).shiftKey === true)
            }
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand)]"
          />
        </span>
      )}
      {isAdmin && (
        <span
          title="Drag to reorder, or onto another section to move it"
          onMouseDown={() => {
            armedRef.current = true;
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-[18px] top-0 flex h-full w-[18px] cursor-grab items-center justify-center text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </span>
      )}
      {isAdmin ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            updateTask(task.id, { status: done ? "todo" : "done" });
          }}
          className={`${LEAD_TIGHT} shrink-0 transition-colors ${done ? "text-success" : "text-border-strong hover:text-success"}`}
          title={done ? "Reopen" : "Mark complete"}
        >
          <CheckCircle2 size={17} strokeWidth={1.75} fill={done ? "currentColor" : "none"} className={done ? "[&>path]:stroke-white" : ""} />
        </button>
      ) : (
        <span className={`${LEAD_TIGHT} shrink-0 ${done ? "text-success" : "text-border-strong"}`} title={done ? "Completed" : "In progress"}>
          <CheckCircle2 size={17} strokeWidth={1.75} fill={done ? "currentColor" : "none"} className={done ? "[&>path]:stroke-white" : ""} />
        </span>
      )}
      <span
        // `pl-3.5` is the indent, and it lives INSIDE the name cell so only the
        // text moves — every column to the right stays where it was. That gives
        // the Timeline's relationship: the section title sits to the left of the
        // task names that belong to it, rather than starting at the same x.
        className={`flex min-w-0 items-center pl-3.5 ${done ? "text-faint line-through" : ""}`}
        style={nameCell}
      >
        {/* A span, not a button, and no inline editor: the row already opens the
            pane on click, and a button would kill drag-selecting the title text.
            Renaming happens in the pane's own title. The dedicated "open details"
            icon button is gone with it — a third target for the same action, on a
            row whose width has been fought over pixel by pixel. */}
        <span
          className="bidi-auto truncate px-1.5 py-0.5 group-hover:underline group-hover:decoration-border-strong group-hover:underline-offset-2"
          title="Open details"
        >
          {task.title}
        </span>
        {isAdmin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Spell out the cost: time_entries cascade, so the hours go with it.
              const mins = taskMinutes(task.id);
              const warning = mins > 0 ? `\n\nThis also deletes ${formatHoursShort(mins)} of logged time.` : "";
              if (confirm(`Delete “${task.title}”?${warning}\n\nThis cannot be undone.`)) {
                deleteTask(task.id);
              }
            }}
            title="Delete this task"
            className="invisible ml-0.5 shrink-0 rounded p-0.5 text-faint hover:bg-background hover:text-danger group-hover:visible"
          >
            <Trash2 size={13} />
          </button>
        )}
        {task.pending && (
          <span className="ml-2 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            pending approval
          </span>
        )}
      </span>
      {show("assignee") && (
      <span className="hidden text-xs text-muted sm:block" style={colCell("assignee")}>
        <EditableSelectCell
          value={task.assigneeId ?? ""}
          options={profiles.filter((p) => p.active || p.id === task.assigneeId).map((p) => ({ value: p.id, label: p.name }))}
          onCommit={(v) => updateTask(task.id, { assigneeId: v || null })}
          emptyLabel="Unassigned"
          display={
            assignee ? (
              <span className="flex items-center gap-1.5">
                <Avatar profile={assignee} size={22} />
                <span className="truncate">{assignee.name}</span>
              </span>
            ) : (
              <span className="text-faint">—</span>
            )
          }
        />
      </span>
      )}
      {/* Start and Due sit together and hide together — a start date with no due
          date beside it is half a sentence. Both are admin-only to WRITE because
          0022 put `start_date` in migration 0011's protected column list. */}
      {show("start") && (
      <span className="hidden text-xs text-muted lg:block" style={colCell("start")}>
        {isAdmin ? (
          <EditableDateCell
            value={task.startDate}
            onCommit={(v) => updateTask(task.id, { startDate: v })}
            format={formatDayMonth}
            fallback={task.dueDate}
          />
        ) : (
          <span className="px-1.5 py-0.5">{task.startDate ? formatDayMonth(task.startDate) : "–"}</span>
        )}
      </span>
      )}
      {show("due") && (
      <span className="text-xs text-muted" style={colCell("due")}>
        {isAdmin ? (
          <EditableDateCell
            value={task.dueDate}
            onCommit={(v) => updateTask(task.id, { dueDate: v })}
            format={formatDayMonth}
            fallback={task.startDate}
          />
        ) : (
          <span className="px-1.5 py-0.5">{task.dueDate ? formatDayMonth(task.dueDate) : "–"}</span>
        )}
      </span>
      )}
      {/* Type = the kind of work, Status = where it is in the process. Both are
          member-writable (0024 deliberately left `type_id` out of the trigger —
          describing the work is collaborative). */}
      {show("type") && (
      <span className="hidden xl:block" style={colCell("type")}>
        <EditableSelectCell
          value={task.typeId ?? ""}
          options={taskTypes.map((t) => ({ value: t.id, label: t.name }))}
          onCommit={(v) => updateTask(task.id, { typeId: v || null })}
          emptyLabel="No type"
          display={
            taskType ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: taskType.color }}
                  aria-hidden
                />
                <span className="truncate">{taskType.name}</span>
              </span>
            ) : null
          }
        />
      </span>
      )}
      {show("tag") && (
      <span className="hidden lg:block" style={colCell("tag")}>
        <EditableSelectCell
          value={task.tag ?? ""}
          options={tags.map((t) => ({ value: t.name, label: t.name }))}
          onCommit={(v) => updateTask(task.id, { tag: v || null })}
          emptyLabel="No status"
          display={task.tag ? <TagBadge tag={task.tag} /> : null}
        />
      </span>
      )}
      {show("hours") && (
      <span
        className="hidden text-xs tabular-nums md:block"
        style={colCell("hours")}
        title={`${formatHoursShort(hoursDone)} logged`}
      >
        {hoursDone > 0 ? (
          <span className={overBudget ? "font-semibold text-danger" : "text-muted"}>
            {formatHoursDecimal(hoursDone)}h
          </span>
        ) : (
          <span className="text-faint">–</span>
        )}
      </span>
      )}
      {show("budget") && (
      <span className="hidden md:block" style={colCell("budget")}>
        {isAdmin ? (
          <EditableNumberCell
            value={task.estimateHours}
            onCommit={(v) => updateTask(task.id, { estimateHours: v })}
            display={
              <BudgetBar doneMinutes={hoursDone} estimateHours={task.estimateHours} label="budget" />
            }
          />
        ) : (
          <BudgetBar doneMinutes={hoursDone} estimateHours={task.estimateHours} label="budget" />
        )}
      </span>
      )}
      {isAdmin && show("billable") && (
        <span
          className={`w-4 shrink-0 text-center text-xs ${task.billable ? "text-success" : "text-faint"}`}
          title={task.billable ? "Billable" : "Non-billable"}
        >
          {task.billable ? "$" : "–"}
        </span>
      )}
    </div>
  );
}

function AddTaskRow({ clientId, sectionId }: { clientId: string; sectionId: string | null }) {
  const { addTask } = useData();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`${COLS} h-9 w-full border-b border-border text-left text-sm text-faint hover:bg-background hover:text-muted`}
      >
        <span className="w-[17px]" />
        Add task…
      </button>
    );
  }
  return (
    <form
      className={`${COLS} h-10 border-b border-border`}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) addTask(clientId, sectionId, title.trim());
        setTitle("");
      }}
    >
      <span className="w-[17px]" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim()) addTask(clientId, sectionId, title.trim());
          setTitle("");
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            setEditing(false);
          }
        }}
        placeholder="Task name — Enter to add"
        className="bidi-auto min-w-32 flex-1 bg-transparent text-sm outline-none"
      />
    </form>
  );
}

function SectionGroup({
  section,
  tasks,
  clientId,
  reorderable,
  open,
  onToggle,
  onOpen,
}: {
  section: Section | null;
  tasks: Task[];
  clientId: string;
  reorderable: boolean;
  /** Lifted to ClientView so the header chevron can collapse/expand every section. */
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const {
    tasks: allTasks,
    updateTask,
    updateSection,
    deleteSection,
    reorderSection,
  } = useData();
  const isAdmin = useIsAdmin();
  const sel = useSelection();
  const [dragOver, setDragOver] = useState(false);
  /** Insert line while another section is being dragged over this header. */
  const [sectionOver, setSectionOver] = useState(false);
  /** The name is a plain heading until the pencil says otherwise. */
  const [renaming, setRenaming] = useState(false);
  /**
   * Only a mousedown on the grip may start a section drag — a ref, not state,
   * because toggling `draggable` from mousedown races React's batching and the
   * attribute can still be false when the browser decides the gesture. Same
   * pattern as TaskRow, and it is what keeps the inline name editor usable.
   */
  const armedRef = useRef(false);

  const sectionId = section?.id ?? null;
  // Against ALL tasks, not the `tasks` prop: that one is filtered by "Show
  // completed", so a section holding only done tasks would look safe to delete.
  const sectionIsEmpty = section != null && !allTasks.some((t) => t.sectionId === section.id);

  // The whole group is the drop zone — header, rows and the add-row — so there's a
  // generous target rather than a thin line between sections.
  const dropProps = isAdmin
    ? {
        onDragOver: (e: React.DragEvent) => {
          // draggedTaskId, not dataTransfer.types: custom MIME types aren't reliably
          // listed during dragover across browsers, which silently prevented the
          // drop target from ever accepting.
          if (!draggedTaskId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move" as const;
          setDragOver(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          // Ignore the leave events fired when crossing between child rows.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          const id = e.dataTransfer.getData(TASK_DRAG_TYPE) || draggedTaskId;
          if (!id) return;
          const dragged = allTasks.find((t) => t.id === id);
          // No-op when it's already here: saves a pointless write and a junk undo step.
          if (!dragged || dragged.sectionId === sectionId) return;
          updateTask(id, { sectionId });
          onOpen(); // reveal the task that just landed here
        },
      }
    : {};

  /**
   * Section reordering, kept strictly apart from the task drags that share this
   * table: every handler bails while a TASK drag is running, and the group's own
   * onDragOver already ignores anything that isn't a task — so a task dropped on a
   * section header still bubbles up and becomes a move-into-section.
   *
   * The "No section" group is never draggable and never moves; since it always
   * renders first, the first real section's header is the "insert at the top" target.
   */
  const sectionDragProps =
    isAdmin && section
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            if (!armedRef.current) {
              e.preventDefault();
              return;
            }
            armedRef.current = false;
            draggedSectionId = section.id;
            e.dataTransfer.setData(SECTION_DRAG_TYPE, section.id);
            e.dataTransfer.setData("text/plain", section.id);
            e.dataTransfer.effectAllowed = "move";
          },
          onDragEnd: () => {
            draggedSectionId = null;
            setSectionOver(false);
          },
          onDragOver: (e: React.DragEvent) => {
            if (draggedTaskId || !draggedSectionId || draggedSectionId === section.id) return;
            e.preventDefault();
            e.stopPropagation(); // don't also light up the group's task drop ring
            e.dataTransfer.dropEffect = "move" as const;
            setSectionOver(true);
          },
          onDragLeave: () => setSectionOver(false),
          onDrop: (e: React.DragEvent) => {
            if (draggedTaskId || !draggedSectionId) return;
            e.preventDefault();
            e.stopPropagation();
            setSectionOver(false);
            const moved = draggedSectionId;
            draggedSectionId = null;
            if (moved !== section.id) reorderSection(moved, section.id);
          },
        }
      : {};

  return (
    <div
      {...dropProps}
      className={dragOver ? "rounded-lg ring-2 ring-brand ring-inset" : undefined}
    >
      {/* A div, not a button: the name is inline-editable and there's a delete
          control, and neither can legally nest inside a button. */}
      <div
        {...sectionDragProps}
        // Same treatment as the Timeline's section rows, for the same reason.
        // `text-sm font-bold` on a tinted band was IDENTICAL to a task row in
        // both size and weight — globals.css collapses medium/semibold/bold onto
        // one weight (570), so the only thing separating a section from its tasks
        // was the grey. One step up in size and one down for the rows carries it
        // properly, and the band can go: two materials in one table was noise.
        className={`${COLS} group relative w-full border-b border-border py-1.5 text-left text-base font-semibold hover:bg-background ${
          sectionIsEmpty ? "opacity-50" : ""
        } ${sectionOver ? "shadow-[inset_0_2px_0_0_var(--brand)]" : ""}`}
      >
        {isAdmin && (
          // hidden until you hover THIS header (not its rows — that's why the
          // `group` sits on this div rather than the wrapper), and stays visible
          // while anything is selected. Same rule as the task rows.
          <span
            className={`absolute left-1 top-0 flex h-full items-center transition-opacity ${
              (sel?.selected.size ?? 0) > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <SelectAllBox
              ids={tasks.map((t) => t.id)}
              title={`Select all in ${section?.name ?? "No section"}`}
            />
          </span>
        )}
        {isAdmin && section && (
          <span
            onMouseDown={() => (armedRef.current = true)}
            className="absolute left-[18px] top-0 flex h-full w-[18px] cursor-grab items-center justify-center text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
            title="Drag to reorder this section"
          >
            <GripVertical size={14} />
          </span>
        )}
        <button
          onClick={onToggle}
          title={open ? "Collapse" : "Expand"}
          className={`flex w-[17px] shrink-0 items-center justify-center ${LEAD_TIGHT}`}
        >
          <CollapseChevron open={open} />
        </button>
        {/* Renaming is the PENCIL's job, as on the Timeline. As a click-to-edit
            cell the section title was the one heading in the app that couldn't
            be clicked to collapse its own group — and it advertised "Click to
            edit" on a row whose obvious action is open/close. One target each. */}
        {renaming && section ? (
          <span className="min-w-32 flex-1">
            <EditableTextCell
              startEditing
              value={section.name}
              onCommit={(v) => {
                if (v && v !== section.name) updateSection(section.id, { name: v });
              }}
              onExit={() => setRenaming(false)}
            />
          </span>
        ) : (
          // The name TRUNCATES rather than flexing, and the count and pencil sit
          // inside the same flex-1 box — so both land immediately after the
          // title, as on the Timeline, instead of being flung to the far right
          // by a name cell that had taken the whole row's spare width.
          <span className="flex min-w-32 flex-1 items-center gap-1.5">
            <button onClick={onToggle} className="bidi-auto min-w-0 truncate text-left">
              {section?.name ?? "No section"}
            </button>
            <span className="shrink-0 text-xs font-normal text-faint">{tasks.length}</span>
            {isAdmin && section && (
              <button
                onClick={() => setRenaming(true)}
                title="Rename section"
                aria-label={`Rename ${section.name}`}
                className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-brand group-hover:opacity-100"
              >
                <Pencil size={13} />
              </button>
            )}
          </span>
        )}
        {section && (section.legacyHours != null || section.estimateHours != null) && (
          <span
            className="shrink-0 text-xs font-normal text-faint"
            title={
              (section.legacyName ? `Originally: ${section.legacyName}\n` : "") +
              "Hours and budget recovered from the old section name." +
              (section.closedOn ? `\nClosed ${formatDate(section.closedOn)}.` : "")
            }
          >
            {section.legacyHours != null && `${section.legacyHours}h`}
            {section.estimateHours != null && ` / ${section.estimateHours}h budget`}
          </span>
        )}
        {isAdmin && section && (
          <button
            onClick={() => {
              if (!sectionIsEmpty) return;
              if (confirm(`Delete the section “${section.name}”?`)) deleteSection(section.id);
            }}
            disabled={!sectionIsEmpty}
            title={
              sectionIsEmpty
                ? "Delete this section"
                : "Move or delete its tasks first — only an empty section can be removed"
            }
            className="shrink-0 rounded p-0.5 text-faint hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-faint"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {open && (
        <>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} reorderable={reorderable} />
          ))}
          <AddTaskRow clientId={clientId} sectionId={section?.id ?? null} />
        </>
      )}
    </div>
  );
}

/**
 * Sticky action bar for the current multi-selection. Admin-only; the caller
 * renders it only when something is selected.
 */
function SelectionBar({
  ids,
  clientId,
  onClear,
}: {
  ids: string[];
  clientId: string;
  onClear: () => void;
}) {
  const { clients, sections, tasks, taskMinutes, updateTasksBulk, deleteTasksBulk } = useData();
  const [moveTo, setMoveTo] = useState("");

  const targetSections = useMemo(
    () => sections.filter((s) => s.clientId === (moveTo || clientId)).sort((a, b) => a.position - b.position),
    [sections, moveTo, clientId],
  );
  const selectedTasks = tasks.filter((t) => ids.includes(t.id));
  const minutes = selectedTasks.reduce((sum, t) => sum + taskMinutes(t.id), 0);

  const done = () => {
    setMoveTo("");
    onClear();
  };

  return (
    <div className="sticky bottom-4 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand bg-surface px-3 py-2 text-sm shadow-card">
      <span className="font-medium">
        {ids.length} selected
        {minutes > 0 && <span className="ml-1.5 text-muted">· {formatHoursShort(minutes)}</span>}
      </span>

      <span className="mx-1 h-4 w-px bg-border" />

      <label className="flex items-center gap-1.5 text-muted">
        Move to
        <select
          value={moveTo}
          onChange={(e) => setMoveTo(e.target.value)}
          className="rounded-md border border-border bg-surface px-1.5 py-1 text-sm text-foreground outline-none focus:border-brand"
        >
          <option value="">this client</option>
          {clients
            .filter((c) => c.id !== clientId)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? " (archived)" : ""}
              </option>
            ))}
        </select>
      </label>

      <select
        defaultValue=""
        onChange={(e) => {
          const sectionId = e.target.value === "__none" ? null : e.target.value;
          // A section belongs to exactly one client, so a cross-client move MUST
          // carry a section for the target — keeping the old id would strand these
          // tasks inside another client's section.
          updateTasksBulk(ids, moveTo ? { clientId: moveTo, sectionId } : { sectionId });
          done();
        }}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-sm outline-none focus:border-brand"
      >
        <option value="" disabled>
          section…
        </option>
        <option value="__none">No section</option>
        {targetSections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <span className="mx-1 h-4 w-px bg-border" />

      <TaskBulkControls ids={ids} onDone={done} />

      <span className="mx-1 h-4 w-px bg-border" />

      <button
        onClick={() => {
          updateTasksBulk(ids, { status: "done" });
          done();
        }}
        className="rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-success hover:text-success"
      >
        Mark done
      </button>
      <button
        onClick={() => {
          updateTasksBulk(ids, { billable: true });
          done();
        }}
        className="rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-success hover:text-success"
      >
        Billable
      </button>
      <button
        onClick={() => {
          updateTasksBulk(ids, { billable: false });
          done();
        }}
        className="rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-brand hover:text-brand"
      >
        Non-billable
      </button>
      <button
        onClick={() => {
          // Hours cascade away with the task and cannot be restored, so a selection
          // holding any logged time is refused outright rather than warned about.
          if (minutes > 0) {
            alert(
              `${formatHoursShort(minutes)} of logged time sits on these tasks.\n\n` +
                `Deleting would destroy those hours permanently. Move the time off them first, ` +
                `or delete those tasks one at a time.`,
            );
            return;
          }
          if (confirm(`Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?\n\nThis cannot be undone.`)) {
            deleteTasksBulk(ids);
            done();
          }
        }}
        className="rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-danger hover:text-danger"
      >
        Delete
      </button>

      <button
        onClick={done}
        title="Clear selection"
        className="ml-auto rounded-md p-1 text-faint hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ClientView({ clientId }: { clientId: string }) {
  const { clients, sections, tasks, profiles, taskTypes, taskMinutes, addSection } =
    useData();
  const isAdmin = useIsAdmin();
  const [showDone, setShowDone] = useState(false);
  const [draggingTask, setDraggingTask] = useState(false);
  // Collapsed-by-exception: sections are open unless their key is in here, so new
  // sections appear expanded. "" stands for the null "No section" group.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "board">("list");
  // Lifted out of ClientTimeline so the zoom control can live on the tab strip.
  // Day by default: at week zoom a one-day task is a 9px sliver and the weekend
  // shading is dropped entirely, so the calendar you land on says least about
  // the days you actually plan in.
  const [zoom, setZoom] = useState<Zoom>("day");
  /** The tab strip's right end, which ClientTimeline portals its toolbar into.
   *  State rather than a ref: the portal has to re-render once the node exists. */
  const [tlToolbar, setTlToolbar] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<"tasks" | "timeline" | "overview">("tasks");
  const [showInfo, setShowInfo] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const { widths, startResize } = useColWidths("client-tasks", COL_DEFAULTS);
  const colCell = (key: string) => ({ width: widths[key], flexShrink: 0 }) as const;

  // Hidden columns, per user. Read in an effect, never in the initialiser —
  // localStorage on the server is a hydration mismatch.
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("client-tasks.hiddenCols");
      if (!raw) return;
      const list = JSON.parse(raw);
      // validate against the current column list: a stored key we no longer
      // have would hide nothing and quietly linger
      if (Array.isArray(list)) {
        setHiddenCols(new Set(list.filter((k: string) => (ALL_COLS as string[]).includes(k))));
      }
    } catch {
      /* a corrupt blob just means "show everything" */
    }
  }, []);
  const toggleCol = useCallback((key: ColKey, on: boolean) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      localStorage.setItem("client-tasks.hiddenCols", JSON.stringify([...next]));
      return next;
    });
  }, []);
  const showCol = (key: ColKey) => !hiddenCols.has(key);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Anchor for shift-click ranges — the last row toggled without shift. */
  const lastPickedRef = useRef<string | null>(null);

  const client = clients.find((c) => c.id === clientId);

  // click = asc, again = desc, third = clear
  const cycleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null,
    );

  const { clientSections, hiddenSections } = useMemo(() => {
    const all = sections
      .filter((s) => s.clientId === clientId)
      .sort((a, b) => a.position - b.position);
    if (showDone) return { clientSections: all, hiddenSections: 0 };
    // A section whose tasks are ALL done folds away with them — an old finished
    // section is exactly as much noise as the finished tasks inside it, and it
    // comes back with them when "Show completed" is ticked.
    //
    // Measured against ALL tasks, and an EMPTY section stays visible: it has
    // nothing finished to hide behind, and a section you just created must not
    // disappear the moment you make it.
    const open = all.filter((sec) => {
      const own = tasks.filter((t) => t.sectionId === sec.id);
      return own.length === 0 || own.some((t) => t.status !== "done");
    });
    return { clientSections: open, hiddenSections: all.length - open.length };
  }, [sections, clientId, tasks, showDone]);

  const typeName = useCallback(
    (id: string | null) => (id ? (taskTypes.find((t) => t.id === id)?.name ?? null) : null),
    [taskTypes],
  );

  const clientTasks = useMemo(() => {
    const list = tasks
      .filter((t) => t.clientId === clientId && (showDone || t.status !== "done"))
      .sort((a, b) => a.position - b.position);
    if (sort) list.sort(makeComparator(sort, profiles, taskMinutes, typeName));
    return list;
  }, [tasks, clientId, showDone, sort, profiles, taskMinutes, typeName]);

  if (!client) return <div className="text-muted">Client not found.</div>;

  // the billing note is xl-only inline, so the full text always lives on the title
  const titleTooltip = client.billingPeriodNote
    ? `${client.name} — billing: ${client.billingPeriodNote}`
    : client.name;

  const noSection = clientTasks.filter((t) => t.sectionId === null);

  // Keys of the groups actually on screen, so "expand/collapse all" only reasons
  // about what's visible (the empty "No section" group appears only mid-drag).
  const showNoSection = noSection.length > 0 || (isAdmin && draggingTask);
  const groupKeys = [...(showNoSection ? [""] : []), ...clientSections.map((s) => s.id)];
  const allCollapsed = groupKeys.length > 0 && groupKeys.every((k) => collapsed.has(k));
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Display order across every group, so a shift-click range spans sections the
  // same way it reads on screen.
  const orderedIds = [
    ...noSection.map((t) => t.id),
    ...clientSections.flatMap((s) =>
      clientTasks.filter((t) => t.sectionId === s.id).map((t) => t.id),
    ),
  ];

  const selectionValue: SelectionCtx = {
    selected,
    ordered: orderedIds,
    toggle: (taskId, shiftKey) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const anchor = lastPickedRef.current;
        if (shiftKey && anchor && anchor !== taskId) {
          const a = orderedIds.indexOf(anchor);
          const b = orderedIds.indexOf(taskId);
          if (a !== -1 && b !== -1) {
            // A range always SELECTS — never deselects. Extending a selection and
            // silently clearing part of it is the classic shift-click surprise.
            for (const id of orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(id);
            return next;
          }
        }
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
      // Only a plain click moves the anchor, so repeated shift-clicks keep
      // extending from the same origin.
      if (!shiftKey) lastPickedRef.current = taskId;
    },
    setMany: (taskIds, on) =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of taskIds) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
  };

  const statuses: { key: Task["status"]; label: string }[] = [
    { key: "todo", label: "To do" },
    { key: "in_progress", label: "In progress" },
    { key: "done", label: "Done" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {client.archived && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted shadow-card">
          <Archive size={14} />
          <span>
            <span className="font-medium text-foreground">{client.name}</span> is archived — it stays
            out of task pickers, reports and search until it&apos;s restored.
          </span>
        </div>
      )}

      {/*
        Name + actions on ONE line, pinned under the app header while you scroll a
        long board. top-14 because the header is exactly h-14; z-10 keeps it under
        the header (z-30) and over the table, which carries no z-index; -mx-6/px-6
        covers main's 24px padding so card corners don't peek out from beneath it.
        It must stay OUTSIDE the overflow-x-auto table wrapper below, or sticky dies.
      */}
      <div className="sticky top-14 z-10 -mx-6 flex flex-col gap-2 bg-background px-6 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* 40px against a 24px title: the mark is the client's identity on
              their own page, so it leads rather than annotates. */}
          <ClientAvatar client={client} size={40} />
          {/* Billing sits UNDER the name rather than beside it: as a sibling of
              the title it competed with it for the same line and was dropped
              below xl, so on a laptop the terms of the engagement were invisible.
              Stacked, it reads as a subtitle of the client and always shows. */}
          <span className="flex min-w-0 flex-col">
            <h1 className="truncate text-2xl font-bold leading-tight tracking-tight" title={titleTooltip}>
              {client.name}
            </h1>
            {client.billingPeriodNote && (
              <span className="truncate text-xs text-muted" title={client.billingPeriodNote}>
                {client.billingPeriodNote}
              </span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* A toggle BUTTON, not a checkbox. Both tabs list tasks, so it
                belongs to both, and it leads the cluster — but a bare checkbox
                floating among pill buttons read as a form control that had
                wandered into a toolbar. The pressed state carries the answer
                now, which the checkbox needed its label to do. */}
            {tab !== "overview" && (
              <button
                onClick={() => setShowDone(!showDone)}
                aria-pressed={showDone}
                title={showDone ? "Hide completed tasks" : "Show completed tasks"}
                className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${
                  showDone
                    ? "border-brand bg-brand-soft text-brand-dark"
                    : "border-border bg-surface text-muted hover:border-brand hover:text-brand"
                }`}
              >
                <CheckCircle2 size={14} />
                Show completed
              </button>
            )}
            {/* The report is about HOURS and money; the Timeline is about dates.
                On the Timeline tab its two buttons were the wrong offer next to
                the wrong view, so that tab swaps them for "Share" (below) — the
                thing you actually want to hand a client from a schedule. */}
            {tab !== "timeline" && <ClientReportButtons clientId={client.id} />}
            {/* Icon only, and admin only: this edits the client RECORD (mark,
                name, billing note, archive). Notes and links live on Overview,
                where members can read them too. Archive lives in here rather
                than beside it — two archive buttons on one screen is one too
                many, and it belongs with renaming. */}
            {isAdmin && (
              <button
                onClick={() => setShowInfo(true)}
                title="Edit client"
                aria-label="Edit client"
                className="rounded-lg border border-border bg-surface p-1.5 text-muted hover:border-brand hover:text-brand"
              >
                <Pencil size={14} />
              </button>
            )}
            {/* To the RIGHT of the pencil, and only on the Timeline: it shares
                the schedule, so it belongs to that view — the same swap the
                report buttons make in the other direction. */}
            {tab === "timeline" && <ShareGanttButton clientId={client.id} />}
            {tab === "tasks" && (
              <>
                <ColumnsMenu hidden={hiddenCols} onToggle={toggleCol} />
                {/* list/board is a view mode OF the tasks, not a peer of them, so it
                    stays a segmented control rather than becoming a third tab */}
                <Tabs
                  value={view}
                  onChange={setView}
                  items={["list", "board"] as const}
                  variant="segmented"
                  ariaLabel="Layout"
                />
              </>
            )}
          </div>
        </div>
        {/* The tab strip, with the Timeline's own zoom control CENTRED on the
            same line — it's a property of the view being shown, so it reads as
            part of this row rather than as the first thing inside the panel. */}
        {/*
          A GRID, not a flex row with an absolutely-centred child.

          The zoom control was `absolute left-1/2`, which takes it out of flow —
          so once the legend moved onto this line it had no idea the control was
          there and slid straight under it, at every width I tried. Three tracks
          with `auto` in the middle keeps the control exactly on the row's centre
          (the side tracks are equal `1fr`s) AND gives the legend a box of its
          own to be clipped by instead of a neighbour to overlap.
        */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 items-center">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "tasks" as const, label: "Tasks" },
                {
                  value: "timeline" as const,
                  label: "Timeline",
                  /* The Timeline's how-to, on demand, ON ITS OWN TAB — next to
                     the client name it was help floating beside something it
                     wasn't about, appearing and vanishing as you changed tabs,
                     which read as a glitch in the title rather than as part of
                     the view. `after` puts it on the tab's own line.

                     A button, not a decorated span: it is the only place this
                     help now lives, so it has to be reachable by keyboard —
                     hence opening on focus as well as hover. And a custom panel
                     rather than `title`, because the browser's own tooltip waits
                     about a second and this is a paragraph you want the instant
                     you go looking for it. */
                  after:
                    tab === "timeline" ? (
                      <button
                        type="button"
                        aria-label={`How the Timeline works: ${timelineHint(isAdmin)}`}
                        className="group/hint relative flex shrink-0 cursor-help text-faint hover:text-brand focus-visible:text-brand"
                      >
                        <Info size={15} aria-hidden />
                        <span className="pointer-events-none absolute left-0 top-full z-40 mt-1.5 hidden w-72 rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs leading-relaxed text-muted shadow-xl group-hover/hint:block group-focus-visible/hint:block">
                          {timelineHint(isAdmin)}
                        </span>
                      </button>
                    ) : undefined,
                },
                { value: "overview" as const, label: "Overview" },
              ]}
              ariaLabel="Client sections"
            />
          </div>
          <div className="flex justify-center">
            {tab === "timeline" && (
              <Tabs
                value={zoom}
                onChange={setZoom}
                items={["day", "week", "month"] as const}
                variant="segmented"
                size="sm"
                ariaLabel="Timeline zoom"
              />
            )}
          </div>
          {/* The Timeline's legend and Columns button land here, by portal. They
              used to have a row of their own between the tabs and the chart;
              on the tab strip they cost nothing, because this line was already
              half empty. */}
          <div ref={setTlToolbar} className="flex min-w-0 items-center justify-end gap-3" />
        </div>
      </div>

      {tab === "timeline" && (
        <ClientTimeline
          clientId={clientId}
          zoom={zoom}
          showDone={showDone}
          toolbarSlot={tlToolbar}
        />
      )}

      {/* Overview holds the stats that used to be an xl-only aside — below 1280px
          the total logged, open-task count, billable share and per-user hours were
          simply invisible. */}
      {tab === "overview" && (
        // Notes and links are the reading surface and take the width; the
        // figures are a sidebar at ~30%. Stacked in one 3xl column they pushed
        // "Hours per month" below the fold on a laptop while half the screen sat
        // empty beside a 500px-wide notes box. Below lg it falls back to one
        // column, notes first — the figures are reference, not the point.
        <div className="grid gap-4 lg:grid-cols-[7fr_3fr]">
          {/* Notes and links live HERE rather than behind the edit button:
              they are for everyone to read, and the edit button is admin-only.
              Admins edit them in place; members see the same panes read-only. */}
          <div className="min-w-0">
            <ClientNotes client={client} />
          </div>
          <div className="min-w-0">
            <ClientStats clientId={clientId} inTab />
          </div>
        </div>
      )}

      <div className={`flex gap-4 ${tab === "tasks" ? "" : "hidden"}`}>
        <div className="min-w-0 flex-1">
      {view === "list" ? (
        <ColWidthsContext.Provider value={widths}>
        <HiddenColsContext.Provider value={hiddenCols}>
        <SelectionContext.Provider value={isAdmin ? selectionValue : null}>
        {/* dragstart/dragend bubble, so the whole table can know a drag is running
            without threading state through every row. */}
        <div
          className="overflow-x-auto rounded-xl border border-border bg-surface"
          // dragstart bubbles AFTER the row handler has set draggedTaskId, so this
          // can tell a task drag from a section drag — without the check, dragging a
          // section would reveal the empty "No section" group.
          onDragStart={() => {
            if (draggedTaskId) setDraggingTask(true);
          }}
          onDragEnd={() => {
            setDraggingTask(false);
            draggedTaskId = null; // belt-and-braces: a stale id would make targets accept
            draggedSectionId = null;
          }}
          onDrop={() => {
            setDraggingTask(false);
            draggedTaskId = null;
            draggedSectionId = null;
          }}
        >
          <div className="min-w-fit">
            <div
              className={`${COLS} group/thead relative h-8 border-b border-border bg-background text-xs font-medium`}
            >
              {isAdmin && (
                <span className="absolute left-1 top-0 flex h-full items-center">
                  <SelectAllBox ids={orderedIds} title="Select every task shown" />
                </span>
              )}
              <button
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groupKeys))}
                title={allCollapsed ? "Expand all sections" : "Collapse all sections"}
                aria-label={allCollapsed ? "Expand all sections" : "Collapse all sections"}
                className={`flex w-[17px] shrink-0 items-center justify-center text-muted hover:text-brand ${LEAD_TIGHT}`}
              >
                <CollapseChevron open={!allCollapsed} />
              </button>
              <span
                className="relative"
                style={{ width: Math.max(NAME_MIN, widths.name ?? COL_DEFAULTS.name), flexShrink: 0 }}
              >
                <SortHeader label="Name" k="title" sort={sort} onSort={cycleSort} />
                <ResizeHandle onMouseDown={startResize("name")} />
              </span>
              {showCol("assignee") && (
                <span className="relative hidden sm:block" style={colCell("assignee")}>
                  <SortHeader label="Assignee" k="assignee" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("assignee")} />
                </span>
              )}
              {showCol("start") && (
                <span className="relative hidden lg:block" style={colCell("start")}>
                  <SortHeader label="Start" k="start" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("start")} />
                </span>
              )}
              {showCol("due") && (
                <span className="relative" style={colCell("due")}>
                  <SortHeader label="Due" k="due" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("due")} />
                </span>
              )}
              {showCol("type") && (
                <span className="relative hidden xl:block" style={colCell("type")}>
                  <SortHeader label="Type" k="type" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("type")} />
                </span>
              )}
              {showCol("tag") && (
                <span className="relative hidden lg:block" style={colCell("tag")}>
                  <SortHeader label="Status" k="tag" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("tag")} />
                </span>
              )}
              {/* Hours and Budget appear and disappear together — a Budget column
                  with no Hours beside it would read worse than today's merged one */}
              {showCol("hours") && (
                <span className="relative hidden md:block" style={colCell("hours")}>
                  <SortHeader label="Hours" k="hours" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("hours")} />
                </span>
              )}
              {showCol("budget") && (
                <span className="relative hidden md:block" style={colCell("budget")}>
                  <SortHeader label="Budget" k="budget" sort={sort} onSort={cycleSort} />
                  <ResizeHandle onMouseDown={startResize("budget")} />
                </span>
              )}
              {isAdmin && showCol("billable") && (
                <span className="w-4 shrink-0">
                  <SortHeader label="$" k="billable" sort={sort} onSort={cycleSort} />
                </span>
              )}
            </div>
            {/* Normally hidden when empty, but an admin mid-drag needs somewhere to
                drop a task to take it OUT of a section. */}
            {showNoSection && (
              <SectionGroup
                section={null}
                tasks={noSection}
                clientId={clientId}
                reorderable={sort === null}
                open={!collapsed.has("")}
                onToggle={() => toggleGroup("")}
                onOpen={() => setCollapsed((p) => { const n = new Set(p); n.delete(""); return n; })}
              />
            )}
            {clientSections.map((section) => (
              <SectionGroup
                key={section.id}
                section={section}
                tasks={clientTasks.filter((t) => t.sectionId === section.id)}
                clientId={clientId}
                reorderable={sort === null}
                open={!collapsed.has(section.id)}
                onToggle={() => toggleGroup(section.id)}
                onOpen={() =>
                  setCollapsed((p) => {
                    const n = new Set(p);
                    n.delete(section.id);
                    return n;
                  })
                }
              />
            ))}
            {hiddenSections > 0 && (
              // Folding a finished section away silently would read as data loss.
              <button
                onClick={() => setShowDone(true)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-faint hover:text-brand"
                title="Sections whose tasks are all done are folded away with them"
              >
                {hiddenSections} finished section{hiddenSections === 1 ? "" : "s"} hidden — show
                completed
              </button>
            )}
            {addingSection ? (
              <form
                className="flex items-center gap-2 px-3 py-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sectionName.trim()) addSection(clientId, sectionName.trim());
                  setSectionName("");
                  setAddingSection(false);
                }}
              >
                <input
                  autoFocus
                  value={sectionName}
                  onChange={(e) => setSectionName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setAddingSection(false)}
                  placeholder="Section name — Enter to add"
                  className="bidi-auto rounded-md border border-border px-2 py-1 text-sm outline-none focus:border-brand"
                />
              </form>
            ) : (
              <button
                onClick={() => setAddingSection(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-muted hover:text-brand"
              >
                <Plus size={14} /> Add section
              </button>
            )}
          </div>
        </div>
        {isAdmin && selected.size > 0 && (
          <SelectionBar
            // Only ids still on screen: a task filtered out by "Show completed"
            // or moved away must not be acted on invisibly.
            ids={orderedIds.filter((id) => selected.has(id))}
            clientId={clientId}
            onClear={() => setSelected(new Set())}
          />
        )}
        </SelectionContext.Provider>
        </HiddenColsContext.Provider>
        </ColWidthsContext.Provider>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {statuses.map(({ key, label }) => {
            const columnTasks = tasks.filter(
              (t) => t.clientId === clientId && t.status === key,
            );
            return (
              <div key={key} className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-2 text-sm font-semibold">
                  {label}
                  <span className="ml-2 text-xs font-normal text-faint">{columnTasks.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {columnTasks.map((t) => (
                    <BoardCard key={t.id} task={t} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
        </div>
      </div>

      {showInfo && <ClientInfoModal client={client} onClose={() => setShowInfo(false)} />}
    </div>
  );
}

function BoardCard({ task }: { task: Task }) {
  const { profiles, openTask, taskMinutes } = useData();
  const assignee = profiles.find((p) => p.id === task.assigneeId) ?? null;
  return (
    <button
      onClick={() => openTask(task.id)}
      className={`flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-left hover:border-brand ${task.pending ? "opacity-50" : ""}`}
    >
      <span className="bidi-auto text-sm font-medium">{task.title}</span>
      {task.tag && <TagBadge tag={task.tag} />}
      <div className="flex items-center justify-between">
        <BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />
        <Avatar profile={assignee} size={22} />
      </div>
    </button>
  );
}
