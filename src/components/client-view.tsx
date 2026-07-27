"use client";

import { useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  GripVertical,
  Maximize2,
  Plus,
  Trash2,
} from "lucide-react";
import { useData } from "@/lib/store";
import { formatDate, formatHoursShort } from "@/lib/format";
import { Avatar, BudgetBar, CollapseChevron, TagBadge } from "./ui";
import {
  EditableDateCell,
  EditableNumberCell,
  EditableSelectCell,
  EditableTextCell,
} from "./editable-cell";
import { ClientReportButtons } from "./client-report-buttons";
import { HBar, LineChart } from "./charts";
import type { Profile, Section, Task } from "@/lib/types";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Right-hand client stats: totals, hours per month, hours per user. */
function ClientStats({ clientId }: { clientId: string }) {
  const { tasks, profiles, entrySums, currentUserId } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";

  const stats = useMemo(() => {
    const clientTaskIds = new Set(tasks.filter((t) => t.clientId === clientId).map((t) => t.id));
    const open = tasks.filter((t) => t.clientId === clientId && t.status !== "done").length;
    const billableTaskIds = new Set(
      tasks.filter((t) => t.clientId === clientId && t.billable).map((t) => t.id),
    );

    let total = 0;
    let billable = 0;
    const byMonth = new Map<string, number>();
    const byUser = new Map<string, number>();
    for (const e of entrySums) {
      if (!clientTaskIds.has(e.taskId)) continue;
      total += e.minutes;
      if (billableTaskIds.has(e.taskId)) billable += e.minutes;
      const month = e.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + e.minutes);
      byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.minutes);
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

    return { total, billable, open, months, users };
  }, [tasks, profiles, entrySums, clientId]);

  const maxUser = stats.users[0]?.minutes ?? 0;

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-4 self-start xl:flex">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Total logged</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatHoursShort(stats.total)}
          </div>
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

// pl-9 clears the 28px drag-handle gutter (the handle is absolutely positioned, so
// appearing on hover never shifts the row). The complete/name pair is then pulled
// tight with -mr-1.5 on the first cell, keeping the tick beside the task title
// rather than stranded between the grip and the name.
const COLS = "flex items-center gap-3 pl-9 pr-4";
/** Applied to the leading cell (the tick, and the header's spacer) so both stay aligned. */
const LEAD_TIGHT = "-mr-1.5";

/** Custom MIME so unrelated drop targets (weekly plan, report table) ignore these
 *  drags — and so `dragover` can tell whether to accept, since getData() is only
 *  readable on drop. */
const TASK_DRAG_TYPE = "application/x-studio-task-id";

/** The id of the row being dragged, mirrored outside the DataTransfer because
 *  `getData()` is unreadable during `dragover` — and a row needs to know, while the
 *  pointer is still moving, whether this drag is a reorder within its own section
 *  (it handles it) or a move from another section (it lets the group handle it). */
let draggedTaskId: string | null = null;

type SortKey = "title" | "assignee" | "due" | "tag" | "budget" | "billable";
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
): (a: Task, b: Task) => number {
  const name = (t: Task) => profiles.find((p) => p.id === t.assigneeId)?.name ?? null;
  const budget = (t: Task) =>
    t.estimateHours ? taskMinutes(t.id) / 60 / t.estimateHours : null;
  const str = (x: string, y: string) => x.localeCompare(y);
  const num = (x: number, y: number) => x - y;
  switch (sort.key) {
    case "title":
      return (a, b) => str(a.title, b.title) * sort.dir;
    case "assignee":
      return (a, b) => cmpNullable(name(a), name(b), str, sort.dir);
    case "due":
      return (a, b) => cmpNullable(a.dueDate, b.dueDate, str, sort.dir);
    case "tag":
      return (a, b) => cmpNullable(a.tag, b.tag, str, sort.dir);
    case "budget":
      return (a, b) => cmpNullable(budget(a), budget(b), num, sort.dir);
    case "billable":
      return (a, b) => (Number(b.billable) - Number(a.billable)) * sort.dir;
  }
}

const SORT_HINTS: Record<SortKey, string> = {
  title: "Task title — click a cell to rename. Click to sort",
  assignee: "Who the task is assigned to — click a cell to change. Click to sort",
  due: "Due date — click a cell to change. Click to sort",
  tag: "Task tag — click a cell to change. Click to sort",
  budget: "Hours logged vs the estimate — click a cell to edit the budget. Click to sort",
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
    tasks: allTasks,
    openTask,
    updateTask,
    deleteTask,
    reorderTask,
    taskMinutes,
    openTaskId,
    currentUserId,
  } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";
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
        active ? "bg-brand-soft/50" : "hover:bg-background"
      } ${task.pending ? "opacity-50" : ""} ${
        dropBefore ? "shadow-[inset_0_2px_0_0_var(--brand)]" : ""
      }`}
      onClick={() => openTask(task.id)}
    >
      {/* Full-height gutter, not just the 14px icon: only a mousedown here arms the
          drag, so a small miss silently cancelled it — which felt like the drag
          working only sometimes. The icon fades in on hover; the hit area is always
          present and spans the row's full height. */}
      {isAdmin && (
        <span
          title="Drag to reorder, or onto another section to move it"
          onMouseDown={() => {
            armedRef.current = true;
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-0 flex h-full w-7 cursor-grab items-center justify-center text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
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
      <span className={`flex min-w-0 flex-1 items-center font-medium ${done ? "text-faint line-through" : ""}`}>
        {isAdmin ? (
          <EditableTextCell
            value={task.title}
            onCommit={(v) => v && updateTask(task.id, { title: v })}
          />
        ) : (
          <span className="bidi-auto truncate px-1.5 py-0.5">{task.title}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            openTask(task.id);
          }}
          title="Open details"
          className="invisible ml-1 shrink-0 rounded p-0.5 text-faint hover:bg-background hover:text-brand group-hover:visible"
        >
          <Maximize2 size={13} />
        </button>
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
      <span className="hidden w-40 shrink-0 text-xs text-muted sm:block">
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
      <span className="w-16 shrink-0 text-xs text-muted">
        {isAdmin ? (
          <EditableDateCell
            value={task.dueDate}
            onCommit={(v) => updateTask(task.id, { dueDate: v })}
            format={formatDate}
            placeholder=""
          />
        ) : (
          <span className="px-1.5 py-0.5">{task.dueDate ? formatDate(task.dueDate) : ""}</span>
        )}
      </span>
      <span className="hidden w-28 shrink-0 lg:block">
        <EditableSelectCell
          value={task.tag ?? ""}
          options={tags.map((t) => ({ value: t.name, label: t.name }))}
          onCommit={(v) => updateTask(task.id, { tag: v || null })}
          emptyLabel="No tag"
          display={task.tag ? <TagBadge tag={task.tag} /> : null}
        />
      </span>
      <span className="hidden w-36 shrink-0 md:block">
        {isAdmin ? (
          <EditableNumberCell
            value={task.estimateHours}
            onCommit={(v) => updateTask(task.id, { estimateHours: v })}
            display={<BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />}
          />
        ) : (
          <BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />
        )}
      </span>
      {isAdmin && (
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
        className="bidi-auto min-w-0 flex-1 bg-transparent text-sm outline-none"
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
    profiles,
    currentUserId,
  } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";
  const [dragOver, setDragOver] = useState(false);

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

  return (
    <div
      {...dropProps}
      className={dragOver ? "rounded-lg ring-2 ring-brand ring-inset" : undefined}
    >
      {/* A div, not a button: the name is inline-editable and there's a delete
          control, and neither can legally nest inside a button. */}
      <div
        className={`${COLS} w-full border-b border-border bg-background/60 py-1.5 text-left text-sm font-bold hover:bg-background ${
          sectionIsEmpty ? "opacity-50" : ""
        }`}
      >
        <button
          onClick={onToggle}
          title={open ? "Collapse" : "Expand"}
          className={`flex w-[17px] shrink-0 items-center justify-center ${LEAD_TIGHT}`}
        >
          <CollapseChevron open={open} />
        </button>
        {isAdmin && section ? (
          <span className="min-w-0 flex-1">
            <EditableTextCell
              value={section.name}
              onCommit={(v) => v && v !== section.name && updateSection(section.id, { name: v })}
            />
          </span>
        ) : (
          <button
            onClick={onToggle}
            className="bidi-auto min-w-0 flex-1 truncate text-left"
          >
            {section?.name ?? "No section"}
          </button>
        )}
        <span className="shrink-0 text-xs font-normal text-faint">{tasks.length}</span>
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

export function ClientView({ clientId }: { clientId: string }) {
  const { clients, sections, tasks, profiles, taskMinutes, addSection, updateClient, currentUserId } =
    useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";
  const [showDone, setShowDone] = useState(false);
  const [draggingTask, setDraggingTask] = useState(false);
  // Collapsed-by-exception: sections are open unless their key is in here, so new
  // sections appear expanded. "" stands for the null "No section" group.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "board">("list");
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sort, setSort] = useState<Sort>(null);

  const client = clients.find((c) => c.id === clientId);

  // click = asc, again = desc, third = clear
  const cycleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null,
    );

  const clientSections = useMemo(
    () =>
      sections
        .filter((s) => s.clientId === clientId)
        .sort((a, b) => a.position - b.position),
    [sections, clientId],
  );

  const clientTasks = useMemo(() => {
    const list = tasks
      .filter((t) => t.clientId === clientId && (showDone || t.status !== "done"))
      .sort((a, b) => a.position - b.position);
    if (sort) list.sort(makeComparator(sort, profiles, taskMinutes));
    return list;
  }, [tasks, clientId, showDone, sort, profiles, taskMinutes]);

  if (!client) return <div className="text-muted">Client not found.</div>;

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

      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <ClientReportButtons clientId={client.id} />
          {isAdmin && (
            <button
              onClick={() => updateClient(client.id, { archived: !client.archived })}
              title={
                client.archived
                  ? "Restore this client everywhere"
                  : "Hide this client from pickers, reports and search — hours are kept"
              }
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium ${
                client.archived
                  ? "border-border bg-surface text-brand hover:border-brand"
                  : "border-border bg-surface text-muted hover:border-danger hover:text-danger"
              }`}
            >
              {client.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              {client.archived ? "Restore" : "Archive"}
            </button>
          )}
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            Show completed
          </label>
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {(["list", "board"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${view === v ? "bg-brand-soft text-brand-dark" : "text-muted"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="min-w-0 max-w-[850px] flex-1">
      {view === "list" ? (
        // dragstart/dragend bubble, so the whole table can know a drag is running
        // without threading state through every row.
        <div
          className="overflow-x-auto rounded-xl border border-border bg-surface"
          onDragStart={() => setDraggingTask(true)}
          onDragEnd={() => {
            setDraggingTask(false);
            draggedTaskId = null; // belt-and-braces: a stale id would make targets accept
          }}
          onDrop={() => {
            setDraggingTask(false);
            draggedTaskId = null;
          }}
        >
          <div className="min-w-[720px]">
            <div className={`${COLS} h-8 border-b border-border bg-background text-xs font-medium`}>
              <button
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groupKeys))}
                title={allCollapsed ? "Expand all sections" : "Collapse all sections"}
                aria-label={allCollapsed ? "Expand all sections" : "Collapse all sections"}
                className={`flex w-[17px] shrink-0 items-center justify-center text-muted hover:text-brand ${LEAD_TIGHT}`}
              >
                <CollapseChevron open={!allCollapsed} />
              </button>
              <span className="min-w-0 flex-1">
                <SortHeader label="Name" k="title" sort={sort} onSort={cycleSort} />
              </span>
              <span className="hidden w-40 shrink-0 sm:block">
                <SortHeader label="Assignee" k="assignee" sort={sort} onSort={cycleSort} />
              </span>
              <span className="w-16 shrink-0">
                <SortHeader label="Due" k="due" sort={sort} onSort={cycleSort} />
              </span>
              <span className="hidden w-28 shrink-0 lg:block">
                <SortHeader label="Tag" k="tag" sort={sort} onSort={cycleSort} />
              </span>
              <span className="hidden w-36 shrink-0 md:block">
                <SortHeader label="Hrs/budget" k="budget" sort={sort} onSort={cycleSort} />
              </span>
              {isAdmin && (
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
        <ClientStats clientId={clientId} />
      </div>
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
