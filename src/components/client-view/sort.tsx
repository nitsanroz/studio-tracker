"use client";

// Sorting the task table: the comparator, and the clickable column header.
//
// ⚠️ Sorting and drag-reorder are mutually exclusive — a row's position would
// change invisibly under an active sort and the drop would look like it did
// nothing. The row module enforces that; the hint text lives here.

import { taskMinutesDone } from "@/lib/task-hours";
import type { Profile, Task } from "@/lib/types";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";


export type SortKey =
  | "title"
  | "assignee"
  | "start"
  | "due"
  | "type"
  | "tag"
  | "hours"
  | "budget"
  | "billable";

export type Sort = { key: SortKey; dir: 1 | -1 } | null;


/** Nulls/empties always sort last regardless of direction. */
export function cmpNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return cmp(a, b) * dir;
}


export function makeComparator(
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
      return (a, b) => num(taskMinutesDone(a, taskMinutes), taskMinutesDone(b, taskMinutes)) * sort.dir;
    case "budget":
      // Was utilisation (logged ÷ estimate). The column now shows the budget
      // number itself, so sorting it by a hidden ratio is indefensible.
      return (a, b) => cmpNullable(a.estimateHours, b.estimateHours, num, sort.dir);
    case "billable":
      return (a, b) => (Number(b.billable) - Number(a.billable)) * sort.dir;
  }
}


export const SORT_HINTS: Record<SortKey, string> = {
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


export function SortHeader({
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
