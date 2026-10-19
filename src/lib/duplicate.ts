// Duplicating sections, groups and tasks on a client page — the PLAN only.
//
// Pure: given the store's current rows and what was picked, it returns the rows
// to insert and the existing rows whose position has to change. The store
// (`duplicateItems` in store/tasks.ts) does the writing. Kept apart so the
// ordering rules can be tested without a database.
//
// What a copy is:
//   - A SECTION copy carries every group and every task inside it — done ones
//     too, since duplicating a finished phase to start the next is the point.
//   - A GROUP copy carries every task inside it.
//   - A TASK copy is the task alone.
//   - Every copy keeps its original's name (no "(copy)" suffix — Nitsan's call:
//     a duplicate is usually renamed, and the suffix was one more edit) and
//     lands directly after it; what it carries keeps its relative order.
//   - A picked item already inside a picked section (or group) is NOT copied a
//     second time — the outer copy already has it.
//
// What a copy is NOT: history. No time entries, comments or attachments, no
// progress (`status` back to todo, Status tag cleared), no Timeline placement
// (it sorts by date among the unplaced rows), and none of the legacy import
// fields. A copy is new work that happens to look like the old.

import type { Link, Section, Task, TaskGroup } from "./types";

export interface DuplicatePick {
  sectionIds?: string[];
  groupIds?: string[];
  taskIds?: string[];
}

/** The task fields a copy takes, in the shape `taskPatchToRow` writes. */
export type TaskCopy = Pick<
  Task,
  | "id"
  | "clientId"
  | "sectionId"
  | "groupId"
  | "title"
  | "brief"
  | "figmaUrl"
  | "status"
  | "tag"
  | "typeId"
  | "assigneeId"
  | "dueDate"
  | "startDate"
  | "billable"
  | "estimateHours"
  | "position"
  | "timelinePosition"
>;

export interface DuplicatePlan {
  sections: Pick<Section, "id" | "clientId" | "name" | "position">[];
  groups: TaskGroup[];
  tasks: TaskCopy[];
  links: Omit<Link, "clientId">[];
  /** Existing rows renumbered to make room — dense 1..n, only the ones that move. */
  moves: {
    sections: { id: string; position: number }[];
    groups: { id: string; position: number }[];
    tasks: { id: string; position: number }[];
  };
}

/**
 * Dense 1..n order for one container with each picked original followed by its
 * copy. Returns the copies' positions and the originals that have to move.
 */
function interleave<T extends { id: string; position: number }>(
  siblings: T[],
  copyOf: Map<string, string>,
) {
  const ordered = [...siblings].sort((a, b) => a.position - b.position);
  const copyPos = new Map<string, number>();
  const moves: { id: string; position: number }[] = [];
  let n = 0;
  for (const s of ordered) {
    n += 1;
    if (s.position !== n) moves.push({ id: s.id, position: n });
    const copy = copyOf.get(s.id);
    if (copy) copyPos.set(copy, ++n);
  }
  return { copyPos, moves };
}

const groupBy = <T>(items: T[], key: (t: T) => string) => {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
};

/** How a task's container is named for grouping: client, section, group. */
const containerKey = (t: Pick<Task, "clientId" | "sectionId" | "groupId">) =>
  `${t.clientId}|${t.sectionId ?? ""}|${t.groupId ?? ""}`;

export function planDuplicate(
  pick: DuplicatePick,
  state: { sections: Section[]; taskGroups: TaskGroup[]; tasks: Task[]; links: Link[] },
  newId: () => string = () => crypto.randomUUID(),
): DuplicatePlan {
  const { sections, taskGroups, tasks, links } = state;

  const pickedSections = sections.filter((s) => pick.sectionIds?.includes(s.id));
  const inPickedSection = new Set(pickedSections.map((s) => s.id));
  // A group already travelling with its section is not copied again.
  const pickedGroups = taskGroups.filter(
    (g) => pick.groupIds?.includes(g.id) && !(g.sectionId && inPickedSection.has(g.sectionId)),
  );
  const inPickedGroup = new Set(pickedGroups.map((g) => g.id));
  const pickedTasks = tasks.filter(
    (t) =>
      pick.taskIds?.includes(t.id) &&
      !(t.sectionId && inPickedSection.has(t.sectionId)) &&
      !(t.groupId && inPickedGroup.has(t.groupId)),
  );

  const plan: DuplicatePlan = {
    sections: [],
    groups: [],
    tasks: [],
    links: [],
    moves: { sections: [], groups: [], tasks: [] },
  };

  /** A task's copy, placed wherever the caller says. */
  const copyTask = (
    t: Task,
    at: { id: string; sectionId: string | null; groupId: string | null; position: number },
  ) => {
    plan.tasks.push({
      id: at.id,
      clientId: t.clientId,
      sectionId: at.sectionId,
      groupId: at.groupId,
      title: t.title,
      brief: t.brief,
      figmaUrl: t.figmaUrl,
      status: "todo",
      tag: null,
      typeId: t.typeId,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate,
      startDate: t.startDate,
      billable: t.billable,
      estimateHours: t.estimateHours,
      position: at.position,
      timelinePosition: null,
    });
    for (const l of links.filter((l) => l.taskId === t.id)) {
      plan.links.push({ id: newId(), taskId: at.id, title: l.title, url: l.url, position: l.position });
    }
  };

  /** Every task of one container, copied in order into a new container. */
  const copyRun = (run: Task[], sectionId: string | null, groupId: string | null) =>
    [...run]
      .sort((a, b) => a.position - b.position)
      .forEach((t, i) => copyTask(t, { id: newId(), sectionId, groupId, position: i + 1 }));

  /** A group's copy and its tasks, at a position the caller worked out. */
  const copyGroup = (g: TaskGroup, sectionId: string | null, position: number) => {
    const id = newId();
    plan.groups.push({ id, clientId: g.clientId, sectionId, name: g.name, position });
    copyRun(
      tasks.filter((t) => t.groupId === g.id),
      sectionId,
      id,
    );
  };

  // ── sections ──────────────────────────────────────────────────────────
  const sectionCopy = new Map(pickedSections.map((s) => [s.id, newId()]));
  for (const [clientId] of groupBy(pickedSections, (s) => s.clientId)) {
    const { copyPos, moves } = interleave(
      sections.filter((s) => s.clientId === clientId),
      sectionCopy,
    );
    plan.moves.sections.push(...moves);
    for (const s of pickedSections.filter((s) => s.clientId === clientId)) {
      const id = sectionCopy.get(s.id)!;
      plan.sections.push({ id, clientId, name: s.name, position: copyPos.get(id)! });
      // Its groups keep their names and order; each brings its own tasks.
      for (const g of taskGroups.filter((g) => g.sectionId === s.id)) {
        copyGroup(g, id, g.position);
      }
      // ⚠️ "Not in one of this section's groups", not "groupId === null" — a task
      // pointing at another section's group renders loose here, so it copies loose.
      const own = new Set(taskGroups.filter((g) => g.sectionId === s.id).map((g) => g.id));
      copyRun(
        tasks.filter((t) => t.sectionId === s.id && !(t.groupId && own.has(t.groupId))),
        id,
        null,
      );
    }
  }

  // ── groups ────────────────────────────────────────────────────────────
  const groupCopy = new Map(pickedGroups.map((g) => [g.id, newId()]));
  for (const [, run] of groupBy(pickedGroups, (g) => `${g.clientId}|${g.sectionId ?? ""}`)) {
    const { clientId, sectionId } = run[0];
    const { copyPos, moves } = interleave(
      taskGroups.filter((g) => g.clientId === clientId && g.sectionId === sectionId),
      groupCopy,
    );
    plan.moves.groups.push(...moves);
    for (const g of run) {
      const id = groupCopy.get(g.id)!;
      plan.groups.push({ id, clientId, sectionId, name: g.name, position: copyPos.get(id)! });
      copyRun(
        tasks.filter((t) => t.groupId === g.id),
        sectionId,
        id,
      );
    }
  }

  // ── tasks ─────────────────────────────────────────────────────────────
  const taskCopy = new Map(pickedTasks.map((t) => [t.id, newId()]));
  for (const [key, run] of groupBy(pickedTasks, containerKey)) {
    const { copyPos, moves } = interleave(
      tasks.filter((t) => containerKey(t) === key),
      taskCopy,
    );
    plan.moves.tasks.push(...moves);
    for (const t of run) {
      const id = taskCopy.get(t.id)!;
      copyTask(t, { id, sectionId: t.sectionId, groupId: t.groupId, position: copyPos.get(id)! });
    }
  }

  return plan;
}
