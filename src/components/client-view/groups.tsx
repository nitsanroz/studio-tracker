"use client";

// A subject group inside a section: its header row, the composer that creates
// one, and the dialog that removes one.
//
// ⚠️ Removing a group asks WHICH removal you meant, and the destructive option
// is disabled once any task in it carries hours — `confirm()` has two buttons
// and both would have to mean yes, while one of them cascades to time entries.

import { EditableTextCell } from "../editable-cell";
import { CollapseChevron, Modal } from "../ui";
import { AddTaskRow, TaskRunRows } from "./row";
import { SelectAllBox } from "./selection";
import { BASE_PL, COLS, GROUP_DRAG_TYPE, INDENT, LEAD_TIGHT, TASK_DRAG_TYPE, drag, useSelection } from "./shared";
import { formatHoursShort } from "@/lib/format";
import { useData, useIsAdmin } from "@/lib/store";
import { taskMinutesDone } from "@/lib/task-hours";
import type { Task, TaskGroup } from "@/lib/types";
import { GripVertical, Layers, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";


/**
 * A subject group inside a section (0027) — "Home page", holding the several
 * tasks that make up one webpage.
 *
 * Chrome is the section header's, one step down: same chevron, pencil, count,
 * grip and trash, at the task rows' size rather than the section's, indented one
 * level, and carrying a `Layers` icon. ⚠️ The size step is the whole hierarchy
 * here — globals.css collapses medium/semibold/bold onto one weight (570), so a
 * group cannot be told apart from a section or a task by weight.
 */
export function GroupRow({
  group,
  tasks,
  clientId,
  reorderable,
  open,
  onToggle,
  onOpen,
  summary,
}: {
  group: TaskGroup;
  /** Its own tasks, already filtered and sorted by the caller. */
  tasks: Task[];
  clientId: string;
  reorderable: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** The rolled-up figures, when "summaries" is on. */
  summary?: ReactNode;
}) {
  const { tasks: allTasks, updateTask, updateTaskGroup, reorderTaskGroup } = useData();
  const isAdmin = useIsAdmin();
  const sel = useSelection();
  const [dragOver, setDragOver] = useState(false);
  const [groupOver, setGroupOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** Same ref-not-state reason as TaskRow and SectionGroup. */
  const armedRef = useRef(false);

  // Tasks dropped anywhere on the group — header or rows — land in it.
  const dropProps = isAdmin
    ? {
        onDragOver: (e: React.DragEvent) => {
          // drag.taskId, never dataTransfer.types: custom MIME types aren't
          // reliably listed during dragover, which silently stopped drop targets
          // from ever accepting (v0.99.26).
          if (!drag.taskId) return;
          e.preventDefault();
          e.stopPropagation(); // the section must not also light up
          e.dataTransfer.dropEffect = "move" as const;
          setDragOver(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!drag.taskId) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const id = e.dataTransfer.getData(TASK_DRAG_TYPE) || drag.taskId;
          if (!id) return;
          const dragged = allTasks.find((t) => t.id === id);
          if (!dragged || dragged.groupId === group.id) return; // no-op, no junk undo step
          // `groupId` alone: the store sets the section from the group, so a task
          // dragged in from another section can't end up in two places at once.
          updateTask(id, { groupId: group.id });
          onOpen();
        },
      }
    : {};

  /** Group reordering, kept apart from the task drags sharing this table. */
  const groupDragProps = isAdmin
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          if (!armedRef.current) {
            e.preventDefault();
            return;
          }
          armedRef.current = false;
          drag.groupId = group.id;
          e.dataTransfer.setData(GROUP_DRAG_TYPE, group.id);
          e.dataTransfer.setData("text/plain", group.id);
          e.dataTransfer.effectAllowed = "move";
        },
        onDragEnd: () => {
          drag.groupId = null;
          setGroupOver(false);
        },
        onDragOver: (e: React.DragEvent) => {
          if (drag.taskId || !drag.groupId || drag.groupId === group.id) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move" as const;
          setGroupOver(true);
        },
        onDragLeave: () => setGroupOver(false),
        onDrop: (e: React.DragEvent) => {
          if (drag.taskId || !drag.groupId) return;
          e.preventDefault();
          e.stopPropagation();
          setGroupOver(false);
          const moved = drag.groupId;
          drag.groupId = null;
          if (moved !== group.id) reorderTaskGroup(moved, group.id);
        },
      }
    : {};

  return (
    <div {...dropProps} className={dragOver ? "rounded-lg ring-2 ring-brand ring-inset" : undefined}>
      <div
        {...groupDragProps}
        style={{ paddingLeft: BASE_PL + INDENT }}
        className={`${COLS} group relative border-b border-border py-1.5 text-left text-sm font-semibold hover:bg-background ${
          groupOver ? "shadow-[inset_0_2px_0_0_var(--brand)]" : ""
        }`}
      >
        {isAdmin && (
          <span
            className={`absolute left-1 top-0 flex h-full items-center transition-opacity ${
              (sel?.selected.size ?? 0) > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <SelectAllBox ids={tasks.map((t) => t.id)} title={`Select all in ${group.name}`} />
          </span>
        )}
        {isAdmin && (
          <span
            onMouseDown={() => (armedRef.current = true)}
            className="absolute left-[18px] top-0 flex h-full w-[18px] cursor-grab items-center justify-center text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
            title="Drag to reorder this group"
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
        {renaming ? (
          <span className="min-w-32 flex-1">
            <EditableTextCell
              startEditing
              value={group.name}
              onCommit={(v) => {
                if (v && v !== group.name) updateTaskGroup(group.id, { name: v });
              }}
              onExit={() => setRenaming(false)}
            />
          </span>
        ) : (
          <span className="flex min-w-32 flex-1 items-center gap-1.5">
            {/* 14px, matching the section header's pencil and trash rather than
                the app's 20px icon convention — at 20 it outweighs the name. */}
            <Layers size={14} className="shrink-0 text-muted" aria-hidden />
            <button onClick={onToggle} className="bidi-auto min-w-0 truncate text-left">
              {group.name}
            </button>
            <span className="shrink-0 text-xs font-normal text-faint">{tasks.length}</span>
            {isAdmin && (
              <button
                onClick={() => setRenaming(true)}
                title="Rename group"
                aria-label={`Rename ${group.name}`}
                className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-brand group-hover:opacity-100"
              >
                <Pencil size={13} />
              </button>
            )}
          </span>
        )}
        {summary}
        {isAdmin && (
          // Always enabled, unlike a section's trash: there is a safe answer here
          // (dissolve) whatever the group holds, so nothing has to be tidied up
          // first — the dialog is what makes the two answers distinguishable.
          <button
            onClick={() => setConfirmingDelete(true)}
            title="Remove this group"
            className="shrink-0 rounded p-0.5 text-faint hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {open && (
        <>
          <TaskRunRows tasks={tasks} reorderable={reorderable} indent={INDENT * 2} />
          <AddTaskRow
            clientId={clientId}
            sectionId={group.sectionId}
            groupId={group.id}
            indent={INDENT * 2}
          />
        </>
      )}
      {confirmingDelete && (
        <DeleteGroupModal group={group} onClose={() => setConfirmingDelete(false)} />
      )}
    </div>
  );
}


/**
 * Removing a group asks WHICH removal you meant, because the two are not close
 * to each other: dissolving keeps the work and drops the heading, deleting takes
 * the work with it.
 *
 * ⚠️ A `confirm()` cannot ask this. It has two buttons and both would have to be
 * "yes" — the destructive reading is one mis-click away, and that reading
 * CASCADES to time entries and is not undoable. Hence a real dialog where the
 * safe option is the default and the destructive one is separately worded.
 */
export function DeleteGroupModal({
  group,
  onClose,
}: {
  group: TaskGroup;
  onClose: () => void;
}) {
  const { tasks, taskMinutes, deleteTaskGroup } = useData();
  const members = tasks.filter((t) => t.groupId === group.id);
  const minutes = members.reduce((sum, t) => sum + taskMinutesDone(t, taskMinutes), 0);
  // The same rule `deleteTasksBulk` follows for a selection: hours that have been
  // logged cannot be got back, so deleting the work is simply not offered.
  const blocked = minutes > 0;

  return (
    <Modal onClose={onClose} width="md" align="center" labelledBy="delete-group-title">
      <div className="flex flex-col gap-4">
        <div>
          <h2 id="delete-group-title" className="text-lg font-semibold">
            Remove “{group.name}”?
          </h2>
          <p className="mt-1 text-sm text-muted">
            {members.length === 0
              ? "It has no tasks in it."
              : `It holds ${members.length} task${members.length === 1 ? "" : "s"}${
                  minutes > 0 ? ` with ${formatHoursShort(minutes)} logged against ${members.length === 1 ? "it" : "them"}` : ""
                }.`}
          </p>
        </div>

        <button
          onClick={() => {
            deleteTaskGroup(group.id);
            onClose();
          }}
          className="rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-brand hover:bg-brand-soft/40"
        >
          <span className="font-semibold">Remove the group only</span>
          <span className="mt-0.5 block text-xs text-muted">
            {members.length === 0
              ? "Nothing else changes."
              : `Its ${members.length === 1 ? "task moves" : "tasks move"} up into the section, keeping every hour and date.`}
          </span>
        </button>

        {members.length > 0 && (
          <button
            disabled={blocked}
            onClick={() => {
              deleteTaskGroup(group.id, { withTasks: true });
              onClose();
            }}
            className="rounded-lg border border-danger/40 px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/5 disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-transparent"
          >
            <span className="font-semibold">
              Delete the group and its {members.length} task
              {members.length === 1 ? "" : "s"}
            </span>
            <span className="mt-0.5 block text-xs">
              {blocked
                ? `Not possible — ${formatHoursShort(minutes)} has been logged against ${members.length === 1 ? "it" : "them"}, and deleting a task destroys its time entries for good. Move the work out first.`
                : "Permanent. This also removes their comments and attachments, and cannot be undone."}
            </span>
          </button>
        )}

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}


/** "+ Add group" at the foot of a section. Admin-only, like every section edit. */
export function AddGroupRow({
  clientId,
  sectionId,
}: {
  clientId: string;
  sectionId: string | null;
}) {
  const { addTaskGroup } = useData();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const pad = { paddingLeft: BASE_PL + INDENT };

  const commit = () => {
    if (name.trim()) addTaskGroup(clientId, sectionId, name.trim());
    setName("");
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={pad}
        className={`${COLS} h-9 w-full border-b border-border text-left text-sm text-faint hover:bg-background hover:text-muted`}
      >
        <span className="w-[17px]" />
        <Layers size={13} aria-hidden />
        Add group…
      </button>
    );
  }
  return (
    <form
      style={pad}
      className={`${COLS} h-10 border-b border-border`}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <span className="w-[17px]" />
      <Layers size={13} className="text-muted" aria-hidden />
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setName("");
            setEditing(false);
          }
          // Enter handled EXPLICITLY rather than left to implicit form
          // submission — this form has no submit button, which is the shape that
          // silently did nothing in `InsertTaskRow` (v1.9.1). Belt and braces:
          // `AddTaskRow` relies on the implicit path and appears to work, so this
          // may be redundant, but it costs a line and cannot be wrong.
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="Group name — Enter to add"
        className="bidi-auto min-w-32 flex-1 bg-transparent text-sm outline-none"
      />
    </form>
  );
}
