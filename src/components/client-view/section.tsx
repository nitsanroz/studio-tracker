"use client";

// A section: the header row that holds a client's phase, everything nested
// under it, and the rolled-up figures it shows.
//
// ⚠️ An EMPTY section stays visible even when its tasks are all hidden — a
// section you just created must not vanish as you fill it.

import { EditableTextCell } from "../editable-cell";
import { CollapseChevron } from "../ui";
import { AddGroupRow, GroupRow } from "./groups";
import { AddTaskRow, TaskRunRows } from "./row";
import { SelectAllBox } from "./selection";
import { COLS, LEAD_TIGHT, SECTION_DRAG_TYPE, TASK_DRAG_TYPE, drag, useSelection } from "./shared";
import { formatDate, formatDayMonth, formatHoursDecimal } from "@/lib/format";
import { toISO } from "@/lib/gantt";
import { useData, useIsAdmin } from "@/lib/store";
import type { Rollup } from "@/lib/task-rollup";
import type { Section, Task, TaskGroup } from "@/lib/types";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";


export function SectionGroup({
  section,
  tasks,
  groups,
  clientId,
  reorderable,
  open,
  isGroupOpen,
  onToggle,
  onToggleGroup,
  onOpen,
  onOpenGroup,
  onNewGroup,
  onNewSection,
  summary,
  groupSummary,
}: {
  section: Section | null;
  /** Every task in this section, groups' children included. */
  tasks: Task[];
  /** This section's groups, in position order (0027). */
  groups: TaskGroup[];
  clientId: string;
  reorderable: boolean;
  /** Lifted to ClientView so the header chevron can collapse/expand every section. */
  open: boolean;
  /** ClientView owns the namespacing of collapse keys, so it answers this. */
  isGroupOpen: (groupId: string) => boolean;
  onToggle: () => void;
  onToggleGroup: (groupId: string) => void;
  onOpen: () => void;
  onOpenGroup: (groupId: string) => void;
  /** Right-click → "New group…" in this section. */
  onNewGroup: () => void;
  /** Right-click → "New section…" on this client. */
  onNewSection: () => void;
  /** Rolled-up figures for the section, when "summaries" is on. */
  summary?: ReactNode;
  /** Same, per group — a render prop so the arithmetic stays in one place. */
  groupSummary?: (group: TaskGroup, groupTasks: Task[]) => ReactNode;
}) {
  const {
    tasks: allTasks,
    taskGroups: allGroups,
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
  // Groups count too — `deleteSection` refuses while any remain, and an enabled
  // trash that then fails with a write error is worse than a disabled one.
  const sectionIsEmpty =
    section != null &&
    !allTasks.some((t) => t.sectionId === section.id) &&
    !allGroups.some((g) => g.sectionId === section.id);

  // The whole group is the drop zone — header, rows and the add-row — so there's a
  // generous target rather than a thin line between sections.
  const dropProps = isAdmin
    ? {
        onDragOver: (e: React.DragEvent) => {
          // drag.taskId, not dataTransfer.types: custom MIME types aren't reliably
          // listed during dragover across browsers, which silently prevented the
          // drop target from ever accepting.
          if (!drag.taskId) return;
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
          const id = e.dataTransfer.getData(TASK_DRAG_TYPE) || drag.taskId;
          if (!id) return;
          const dragged = allTasks.find((t) => t.id === id);
          // No-op when it's already here: saves a pointless write and a junk undo step.
          // ⚠️ "Here" means loose in this section — a task dragged OUT of one of
          // this section's groups has the same `sectionId` already, and testing
          // that alone made dragging out of a group do nothing at all.
          if (!dragged || (dragged.sectionId === sectionId && dragged.groupId === null)) return;
          // `groupId: null` explicitly: dropping on the section is how a task
          // leaves a group, and the store would otherwise only clear the group
          // when the section actually changed.
          updateTask(id, { sectionId, groupId: null });
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
            drag.sectionId = section.id;
            e.dataTransfer.setData(SECTION_DRAG_TYPE, section.id);
            e.dataTransfer.setData("text/plain", section.id);
            e.dataTransfer.effectAllowed = "move";
          },
          onDragEnd: () => {
            drag.sectionId = null;
            setSectionOver(false);
          },
          onDragOver: (e: React.DragEvent) => {
            if (drag.taskId || !drag.sectionId || drag.sectionId === section.id) return;
            e.preventDefault();
            e.stopPropagation(); // don't also light up the group's task drop ring
            e.dataTransfer.dropEffect = "move" as const;
            setSectionOver(true);
          },
          onDragLeave: () => setSectionOver(false),
          onDrop: (e: React.DragEvent) => {
            if (drag.taskId || !drag.sectionId) return;
            e.preventDefault();
            e.stopPropagation();
            setSectionOver(false);
            const moved = drag.sectionId;
            drag.sectionId = null;
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
        {summary}
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
                : "Move or delete its tasks and groups first — only an empty section can be removed"
            }
            className="shrink-0 rounded p-0.5 text-faint hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-faint"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {open && (
        <>
          {/* Groups first, then the section's loose tasks. Interleaving the two
              would mean one shared position space across two tables, and a
              reorder inside either would renumber rows it doesn't own. */}
          {groups.map((g) => {
            const own = tasks.filter((t) => t.groupId === g.id);
            return (
              <GroupRow
                key={g.id}
                group={g}
                tasks={own}
                clientId={clientId}
                reorderable={reorderable}
                open={isGroupOpen(g.id)}
                onToggle={() => onToggleGroup(g.id)}
                onOpen={() => onOpenGroup(g.id)}
                summary={groupSummary?.(g, own)}
              />
            );
          })}
          {/* ⚠️ "Not in one of THIS section's groups", not "groupId === null".
              A task pointing at a group that lives in another section breaks the
              0027 invariant, and the rule everywhere is that such a task renders
              LOOSE rather than disappearing — testing for null alone would drop
              it from the table entirely. */}
          <TaskRunRows
            tasks={tasks.filter((t) => !t.groupId || !groups.some((g) => g.id === t.groupId))}
            reorderable={reorderable}
            onNewGroup={onNewGroup}
            onNewSection={onNewSection}
          />
          {/* ⚠️ NOT wrapped in `isAdmin` — "Add task…" has never been admin-gated
              (a designer may add work to a client), unlike creating a group,
              which is structure and follows the section rules. */}
          <AddTaskRow clientId={clientId} sectionId={section?.id ?? null} />
          {isAdmin && <AddGroupRow clientId={clientId} sectionId={section?.id ?? null} />}
        </>
      )}
    </div>
  );
}


/**
 * A container's rolled-up figures, as a compact strip: dates · working days ·
 * hours against budget.
 *
 * ⚠️ A STRIP here, not cells aligned to the columns — which is what the Timeline
 * does. The difference is the two tables: the Timeline's left table IS these four
 * figures, one per column, so they drop straight in. This header row has a
 * `flex-1` name and no column grid of its own, so aligning would mean pinning
 * every section name to a fixed width to make room for numbers that read
 * perfectly well as a line. It sits where the recovered-hours note already sits.
 */
export function SummaryStrip({
  rolled,
  budget,
}: {
  rolled: Rollup;
  /** Sections may override with their own recovered figure — see sectionBudgetHours. */
  budget: number | null;
}) {
  if (rolled.taskCount === 0) return null;
  const parts: string[] = [];
  if (rolled.start && rolled.due) {
    parts.push(
      `${formatDayMonth(toISO(rolled.start))} – ${formatDayMonth(toISO(rolled.due))}`,
      `${rolled.workDays}d`,
    );
  }
  const hours = formatHoursDecimal(rolled.doneMinutes);
  parts.push(budget != null ? `${hours}/${budget}h` : `${hours}h`);

  return (
    <span
      className="shrink-0 text-xs font-normal tabular-nums text-faint"
      title={`${rolled.taskCount} task${rolled.taskCount === 1 ? "" : "s"}, ${rolled.doneCount} done · hours logged against budget${
        rolled.datedCount < rolled.taskCount
          ? ` · dates cover the ${rolled.datedCount} dated task${rolled.datedCount === 1 ? "" : "s"}`
          : ""
      }`}
    >
      {parts.join(" · ")}
    </span>
  );
}
