"use client";

// One task's row in the table, and the two composers that create a task beside
// it — the right-click insert and the trailing "Add task…".
//
// ⚠️ `TaskRow` takes everything as props and reads the store only for the
// writes it performs itself; the arrangement of rows is the section module's
// job. That separation is what lets this file be about what a row looks like.

import { EditableDateCell, EditableNumberCell, EditableSelectCell } from "../editable-cell";
import { Avatar, BudgetBar, ContextMenu, TagBadge } from "../ui";
import { BASE_PL, COLS, LEAD_TIGHT, TASK_DRAG_TYPE, drag, useColCell, useNameCell, useSelection, useShowCol } from "./shared";
import { formatDayMonth, formatHoursDecimal, formatHoursShort } from "@/lib/format";
import { useData, useIsAdmin } from "@/lib/store";
import { taskMinutesDone } from "@/lib/task-hours";
import type { Task } from "@/lib/types";
import { CheckCircle2, GripVertical, Trash2 } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";


export function TaskRow({
  task,
  reorderable = true,
  indent = 0,
  onContextMenu,
}: {
  task: Task;
  reorderable?: boolean;
  /**
   * Extra left padding, in px, for a row nested inside a group (0027).
   *
   * ⚠️ It shifts the CONTENT only — the checkbox and grip are absolutely
   * positioned and stay where they are, so the selection column reads straight
   * down the table whatever depth a row sits at.
   */
  indent?: number;
  /** right-click → "Add task above/below"; the section owns the menu and the composer */
  onContextMenu?: (e: ReactMouseEvent, task: Task) => void;
}) {
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
   *  the drop would look like it did nothing. Cross-container moves still work.
   *
   *  ⚠️ Sibling means the same GROUP as well as the same section (0027): a task
   *  dragged out of a group onto a loose row is changing container, not
   *  reordering, so this must decline and let the drop bubble to the group or
   *  section that owns the destination. `reorderTask` densifies one container's
   *  run, and treating a cross-container drop as a reorder would renumber the
   *  wrong run. */
  function isSiblingDrag() {
    if (!reorderable) return false;
    if (!drag.taskId || drag.taskId === task.id) return false;
    const d = allTasks.find((t) => t.id === drag.taskId);
    return (
      !!d &&
      d.sectionId === task.sectionId &&
      d.groupId === task.groupId &&
      d.clientId === task.clientId
    );
  }
  const assignee = profiles.find((p) => p.id === task.assigneeId) ?? null;
  const taskType = taskTypes.find((t) => t.id === task.typeId) ?? null;
  // ⚠️ MINUTES, hence the `/ 60` below. This was `doneMinutes`, which read as the
  // mistake it was one line away from being.
  const doneMinutes = taskMinutesDone(task, taskMinutes);
  const overBudget = task.estimateHours != null && doneMinutes / 60 > task.estimateHours;
  const done = task.status === "done";
  const active = openTaskId === task.id;

  return (
    <div
      draggable={isAdmin}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, task) : undefined}
      onDragStart={(e) => {
        if (!armedRef.current) {
          e.preventDefault(); // not started from the grip — don't drag
          return;
        }
        drag.taskId = task.id;
        e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
        // text/plain fallback: some browsers refuse to start a drag, or report no
        // types, when only a custom MIME is set.
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        drag.taskId = null;
        armedRef.current = false;
        setDropBefore(false);
      }}
      onMouseUp={() => {
        armedRef.current = false;
      }}
      // Reorder only. A drag from another section is left unhandled so it bubbles
      // to the SectionGroup, which moves it in. Acceptance is decided from
      // drag.taskId rather than dataTransfer.types — the latter isn't reliably
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
        const id = e.dataTransfer.getData(TASK_DRAG_TYPE) || drag.taskId;
        if (id) reorderTask(id, task.id);
      }}
      // Inline, not an arbitrary-value class: `pl-9` lives in COLS and an inline
      // style is the one thing guaranteed to win, whatever order Tailwind emits.
      style={indent ? { paddingLeft: BASE_PL + indent } : undefined}
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
        title={`${formatHoursShort(doneMinutes)} logged`}
      >
        {doneMinutes > 0 ? (
          <span className={overBudget ? "font-semibold text-danger" : "text-muted"}>
            {formatHoursDecimal(doneMinutes)}h
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
              <BudgetBar doneMinutes={doneMinutes} estimateHours={task.estimateHours} label="budget" />
            }
          />
        ) : (
          <BudgetBar doneMinutes={doneMinutes} estimateHours={task.estimateHours} label="budget" />
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


/**
 * The inline name field for a task being inserted at a chosen position.
 *
 * Deliberately the same shape as `AddTaskRow`'s editing state: right-click "Add
 * task below" opens an empty row you type into, rather than creating a row named
 * "New task" and asking you to rename it. Changing your mind then costs an
 * Escape instead of a delete — and a delete here cascades to time entries.
 */
export function InsertTaskRow({
  anchorId,
  where,
  copyDates,
  indent = 0,
  onDone,
}: {
  anchorId: string;
  where: "before" | "after";
  copyDates?: boolean;
  indent?: number;
  onDone: () => void;
}) {
  const { addTaskNear } = useData();
  const [title, setTitle] = useState("");

  const commit = () => {
    if (title.trim()) addTaskNear(anchorId, where, title.trim(), { copyDates });
    onDone();
  };

  return (
    <form
      style={indent ? { paddingLeft: BASE_PL + indent } : undefined}
      className={`${COLS} h-10 border-b border-border bg-brand-soft/40`}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <span className="w-[17px]" />
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
        className="bidi-auto min-w-32 flex-1 bg-transparent text-sm outline-none"
      />
    </form>
  );
}


export function AddTaskRow({
  clientId,
  sectionId,
  groupId = null,
  indent = 0,
}: {
  clientId: string;
  sectionId: string | null;
  /** Set inside a group, so the new task lands in it (and in its section). */
  groupId?: string | null;
  indent?: number;
}) {
  const { addTask } = useData();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const pad = indent ? { paddingLeft: BASE_PL + indent } : undefined;

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={pad}
        className={`${COLS} h-9 w-full border-b border-border text-left text-sm text-faint hover:bg-background hover:text-muted`}
      >
        <span className="w-[17px]" />
        Add task…
      </button>
    );
  }
  return (
    <form
      style={pad}
      className={`${COLS} h-10 border-b border-border`}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) addTask(clientId, sectionId, title.trim(), groupId);
        setTitle("");
      }}
    >
      <span className="w-[17px]" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim()) addTask(clientId, sectionId, title.trim(), groupId);
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


/**
 * One CONTAINER's run of task rows, plus the right-click "Add task above/below"
 * composer that belongs to it.
 *
 * Shared by a section's loose tasks and by every group's children (0027), because
 * they are the same list at two depths — a second copy would drift the moment one
 * of them gained a menu item. It owns the menu and composer state so each run
 * opens its own, rather than one section-wide composer appearing in whichever
 * container the user last right-clicked.
 */
export function TaskRunRows({
  tasks,
  reorderable,
  indent = 0,
  onNewGroup,
  onNewSection,
}: {
  tasks: Task[];
  reorderable: boolean;
  indent?: number;
  /** Right-click → "New group…". Absent inside a group: no groups in groups. */
  onNewGroup?: (seedTaskId: string) => void;
  /** Right-click → "New section…". Absent inside a group, for the same reason. */
  onNewSection?: () => void;
}) {
  const { groupTasksIntoNew, showNotice } = useData();
  const sel = useSelection();
  const [menu, setMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [insert, setInsert] = useState<{ anchorId: string; where: "before" | "after" } | null>(
    null,
  );

  /** The multi-selection, but only when the right-clicked row is part of it. */
  const gatherable = (taskId: string) => {
    const picked = sel?.selected;
    if (!picked || picked.size < 2 || !picked.has(taskId)) return null;
    return [...picked];
  };

  return (
    <>
      {tasks.map((t) => (
        <Fragment key={t.id}>
          {insert?.anchorId === t.id && insert.where === "before" && (
            <InsertTaskRow
              anchorId={t.id}
              where="before"
              indent={indent}
              onDone={() => setInsert(null)}
            />
          )}
          <TaskRow
            task={t}
            reorderable={reorderable}
            indent={indent}
            onContextMenu={(e, task) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, taskId: task.id });
            }}
          />
          {insert?.anchorId === t.id && insert.where === "after" && (
            <InsertTaskRow
              anchorId={t.id}
              where="after"
              indent={indent}
              onDone={() => setInsert(null)}
            />
          )}
        </Fragment>
      ))}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              label: "Add task above",
              onClick: () => setInsert({ anchorId: menu.taskId, where: "before" }),
            },
            {
              label: "Add task below",
              onClick: () => setInsert({ anchorId: menu.taskId, where: "after" }),
            },
            // Whichever of these two is offered depends on what is selected: with
            // a multi-selection under the pointer the useful command is "gather
            // THESE", and with a single row it is "make me an empty one". Showing
            // both every time would make the common case pick from four items.
            ...(gatherable(menu.taskId)
              ? [
                  {
                    label: `Group the ${gatherable(menu.taskId)!.length} selected tasks…`,
                    onClick: () => {
                      const ids = gatherable(menu.taskId)!;
                      const name = prompt("Name for the new group")?.trim();
                      if (!name) return;
                      void groupTasksIntoNew(ids, name).then((err) => {
                        if (err) showNotice(err);
                        else sel?.setMany(ids, false);
                      });
                    },
                  },
                ]
              : onNewGroup
                ? [{ label: "New group…", onClick: () => onNewGroup(menu.taskId) }]
                : []),
            ...(onNewSection ? [{ label: "New section…", onClick: onNewSection }] : []),
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
