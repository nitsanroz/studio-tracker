"use client";

// Tasks, sections and task groups — the studio's structure, and the last domain
// to leave the provider.
//
// ⚠️ It went last because it is the one every other domain reaches INTO: the plan
// reassigns a task on a cross-column drag, the taxonomy sweeps a deleted tag out
// of every task, the client actions re-home a whole client's work. All of that
// still goes through `methodsRef`, which is exactly why those files do not have
// to import this one.
//
// ⚠️ DELETING CASCADES. `tasks.id` is the FK target for time entries, so
// `deleteTask` and `deleteTasksBulk` also drop the local entry rows — the DB
// does it server-side and the UI would otherwise keep showing hours belonging to
// a task that no longer exists. That is why this module holds `setTimeEntries`
// and `setEntrySums` despite not being about time.
//
// ⚠️ The group↔section invariant is normalised in ONE place, `withGroupInvariant`
// inside `updateTask`, so no caller has to remember that a group decides its
// task's section.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapSection, mapTask, mapTaskGroup, taskPatchToRow } from "../db";
import { inversePatch, withGroupInvariant } from "./helpers";
import type { HistoryAction, Store } from "./types";
import type { Client, EntrySum, Section, Task, TaskGroup, TimeEntry } from "../types";

export interface TaskDeps {
  supabase: SupabaseClient;
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  sections: Section[];
  setSections: Dispatch<SetStateAction<Section[]>>;
  taskGroups: TaskGroup[];
  setTaskGroups: Dispatch<SetStateAction<TaskGroup[]>>;
  clients: Client[];
  /** tag NAME → id and back; tasks carry names, the DB carries ids */
  tagIdByName: Map<string, string>;
  tagNameById: Map<string, string>;
  /** deleting a task cascades to its hours — see the header */
  setTimeEntries: Dispatch<SetStateAction<TimeEntry[]>>;
  setEntrySums: Dispatch<SetStateAction<EntrySum[]>>;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useTaskActions(deps: TaskDeps) {
  const {
    supabase,
    tasks,
    setTasks,
    sections,
    setSections,
    taskGroups,
    setTaskGroups,
    clients,
    tagIdByName,
    tagNameById,
    setTimeEntries,
    setEntrySums,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;

  // ── mutations ─────────────────────────────────────────────────────────
  const updateTask = useCallback(
    (taskId: string, rawPatch: Partial<Task>) => {
      const before = tasks.find((t) => t.id === taskId);
      // The group↔section invariant is normalised in ONE place, here, so no
      // caller has to remember it — see `withGroupInvariant`.
      const patch = before ? withGroupInvariant(before, rawPatch, taskGroups) : rawPatch;
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateTask(taskId, prev),
          redo: () => methodsRef.current?.updateTask(taskId, patch),
        });
      }
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
      supabase
        .from("tasks")
        .update(taskPatchToRow(patch, tagIdByName))
        .eq("id", taskId)
        .then(wrote("updateTask"));
    },
    [supabase, tagIdByName, tasks, taskGroups, record, wrote, methodsRef, setTasks],
  );

  /**
   * Restores per-task prior values after a bulk update. Tasks that shared the
   * same prior value are grouped into one write, so undoing "move 40 tasks from
   * one client" costs a single round-trip rather than 40.
   */
  const restoreTasksBulk = useCallback(
    (items: { id: string; patch: Partial<Task> }[]) => {
      if (items.length === 0) return;
      const byPatch = new Map<string, { patch: Partial<Task>; ids: string[] }>();
      for (const it of items) {
        const key = JSON.stringify(it.patch);
        const group = byPatch.get(key);
        if (group) group.ids.push(it.id);
        else byPatch.set(key, { patch: it.patch, ids: [it.id] });
      }
      const patchById = new Map(items.map((it) => [it.id, it.patch]));
      setTasks((prev) =>
        prev.map((t) => {
          const p = patchById.get(t.id);
          return p ? { ...t, ...p } : t;
        }),
      );
      for (const { patch, ids } of byPatch.values()) {
        supabase
          .from("tasks")
          .update(taskPatchToRow(patch, tagIdByName))
          .in("id", ids)
          .then(wrote("restoreTasksBulk"));
      }
    },
    [supabase, tagIdByName, wrote, setTasks],
  );

  const updateTasksBulk = useCallback(
    (taskIds: string[], rawPatch: Partial<Task>) => {
      const ids = [...new Set(taskIds)];
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      // The group↔section invariant, in the one shape a UNIFORM patch can carry
      // it: a batch moved to another section (or another client, which forces a
      // section) cannot keep any of its groups, whatever they were, so clearing
      // `groupId` for all of them is correct rather than merely conservative.
      // Per-task normalisation would need `updateTasksVaried`, and there is no
      // case where a bulk section move should preserve a group.
      // ⚠️ The `groupId` the caller named is checked too, rather than trusted:
      // skipping this whenever the patch happened to mention `groupId` let a
      // cross-section move keep a group belonging to the section it left.
      const movesSection = "sectionId" in rawPatch || "clientId" in rawPatch;
      const namedGroupFits =
        "groupId" in rawPatch &&
        (rawPatch.groupId == null ||
          taskGroups.some(
            (g) =>
              g.id === rawPatch.groupId &&
              g.sectionId === ("sectionId" in rawPatch ? (rawPatch.sectionId ?? null) : g.sectionId),
          ));
      const patch: Partial<Task> =
        movesSection && !namedGroupFits ? { ...rawPatch, groupId: null } : rawPatch;

      // Each task can hold a different prior value, so the inverse is a list of
      // per-task patches rather than one shared patch — but it is recorded as a
      // SINGLE history entry, so one ⌘Z reverses the whole selection.
      const before = tasks
        .filter((t) => idSet.has(t.id))
        .map((t) => ({ id: t.id, patch: inversePatch(t, patch) }));
      record({
        undo: () => methodsRef.current?.restoreTasksBulk(before),
        redo: () => methodsRef.current?.updateTasksBulk(ids, patch),
      });

      setTasks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, ...patch } : t)));
      supabase
        .from("tasks")
        .update(taskPatchToRow(patch, tagIdByName))
        .in("id", ids)
        .then(wrote("updateTasksBulk"));
    },
    [supabase, tagIdByName, tasks, taskGroups, record, wrote, methodsRef, setTasks],
  );

  /**
   * Per-task patches, ONE history entry — the varied sibling of
   * `updateTasksBulk`, which applies the same patch to every id.
   *
   * Dragging a multi-selection across the Timeline needs this: each task keeps
   * its own dates and is shifted by the same number of working days, so no two
   * patches are alike. Looping `updateTask` would have written the same rows but
   * left ten undo steps behind, and a gesture the user made once must come back
   * with one ⌘Z. Writes are grouped by identical patch so a shift that happens
   * to produce the same dates for several tasks is still one round trip.
   */
  const updateTasksVaried = useCallback(
    (items: { id: string; patch: Partial<Task> }[]) => {
      if (items.length === 0) return;
      const byId = new Map(items.map((it) => [it.id, it.patch]));
      const before = tasks
        .filter((t) => byId.has(t.id))
        .map((t) => ({ id: t.id, patch: inversePatch(t, byId.get(t.id)!) }));
      record({
        undo: () => methodsRef.current?.restoreTasksBulk(before),
        redo: () => methodsRef.current?.updateTasksVaried(items),
      });

      setTasks((prev) => {
        const next = prev.map((t) => {
          const p = byId.get(t.id);
          return p ? { ...t, ...p } : t;
        });
        return next;
      });

      const byPatch = new Map<string, { patch: Partial<Task>; ids: string[] }>();
      for (const it of items) {
        const key = JSON.stringify(it.patch);
        const group = byPatch.get(key);
        if (group) group.ids.push(it.id);
        else byPatch.set(key, { patch: it.patch, ids: [it.id] });
      }
      for (const { patch, ids } of byPatch.values()) {
        supabase
          .from("tasks")
          .update(taskPatchToRow(patch, tagIdByName))
          .in("id", ids)
          .then(wrote("updateTasksVaried"));
      }
    },
    [supabase, tagIdByName, tasks, record, wrote, methodsRef, setTasks],
  );

  const addTask = useCallback(
    (clientId: string, sectionId: string | null, title: string, groupId?: string | null) => {
      const position =
        Math.max(0, ...tasks.filter((t) => t.clientId === clientId).map((t) => t.position)) + 1;
      // The group decides the section, as everywhere else (see
      // `withGroupInvariant`) — so an "Add task" row inside a group can pass the
      // group alone and cannot file the task into the wrong section.
      const group = groupId ? taskGroups.find((g) => g.id === groupId) : null;
      counting(
        supabase
          .from("tasks")
          .insert({
            client_id: clientId,
            section_id: group ? group.sectionId : sectionId,
            group_id: groupId ?? null,
            title,
            billable: clients.find((c) => c.id === clientId)?.billable ?? true,
            position,
          })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addTask", error);
            return;
          }
          setTasks((prev) => [...prev, mapTask(data, tagNameById)]);
        });
    },
    [supabase, tasks, taskGroups, tagNameById, clients, noteWriteError, counting, setTasks],
  );

  /**
   * Create a task immediately before or after an existing one, in the same
   * CONTAINER — the same section and the same group — for the right-click "Add
   * task above/below" in the client table and the Timeline. `addTask` always
   * appends, which is the whole reason this exists.
   *
   * It slots into BOTH orderings — `position` (client table, per section) and
   * `timeline_position` (Timeline, per client; see 0023) — so the new row lands
   * beside its anchor whichever view you created it from, instead of appearing
   * adjacent in one and at the bottom of the other.
   *
   * ⚠️ It DENSIFIES the section rather than shifting one gap. Every task the
   * imports created has `position = 0`, so a section can be entirely zeros and
   * "insert after X" has no gap to open — renumbering the whole run 1..n is what
   * makes the placement mean anything there. Same reason `reorderTask` does it.
   *
   * `copyDates` seeds the new task from the anchor's start/due. The Timeline
   * passes it because that view only renders tasks that HAVE a due date — a
   * dateless insert would vanish the instant it was created, which reads as the
   * command having failed.
   *
   * Like `addTask`, deliberately NOT in the undo history: nothing that creates a
   * task is undoable in this app, and an inverse would have to unpick the
   * renumbering too. Delete the row instead.
   */
  const addTaskNear = useCallback(
    (
      anchorTaskId: string,
      where: "before" | "after",
      title: string,
      opts?: { copyDates?: boolean },
    ) => {
      const anchor = tasks.find((t) => t.id === anchorTaskId);
      if (!anchor) return;

      // Same comparator the client table renders with, so "after" means after
      // the row the user actually right-clicked. Scoped to the anchor's GROUP as
      // well as its section (0027) — a group's children densify among
      // themselves, so an insert inside a group must not renumber the section's
      // loose tasks and land in the wrong run.
      const siblings = tasks
        .filter(
          (t) =>
            t.clientId === anchor.clientId &&
            t.sectionId === anchor.sectionId &&
            t.groupId === anchor.groupId,
        )
        .sort((a, b) => a.position - b.position);
      const listAt = siblings.findIndex((t) => t.id === anchorTaskId) + (where === "after" ? 1 : 0);

      // The Timeline's own axis. Only rows that have been placed carry a
      // position; if the anchor is unplaced there is nothing to slot between,
      // so the new task stays unplaced too and sorts by date like its neighbour.
      const placed = tasks
        .filter((t) => t.clientId === anchor.clientId && t.timelinePosition != null)
        .sort((a, b) => (a.timelinePosition ?? 0) - (b.timelinePosition ?? 0));
      const tlIndex = placed.findIndex((t) => t.id === anchorTaskId);
      const tlAt = tlIndex === -1 ? -1 : tlIndex + (where === "after" ? 1 : 0);

      counting(
        supabase
          .from("tasks")
          .insert({
            client_id: anchor.clientId,
            section_id: anchor.sectionId,
            group_id: anchor.groupId,
            title,
            billable: clients.find((c) => c.id === anchor.clientId)?.billable ?? true,
            position: listAt + 1,
            ...(tlAt === -1 ? {} : { timeline_position: tlAt + 1 }),
            ...(opts?.copyDates
              ? { start_date: anchor.startDate ?? null, due_date: anchor.dueDate ?? null }
              : {}),
          })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addTaskNear", error);
            return;
          }
          const created = mapTask(data, tagNameById);
          setTasks((prev) => [...prev, created]);

          // Renumber around it. Everything from the insertion point on shifts by
          // one; anything already correct is left alone so we don't write rows
          // that didn't move.
          const listOrder = [...siblings.slice(0, listAt), created, ...siblings.slice(listAt)];
          const listChanged = listOrder
            .map((t, i) => ({ id: t.id, position: i + 1, was: t.position }))
            .filter((r) => r.id !== created.id && r.position !== r.was);

          const tlChanged =
            tlAt === -1
              ? []
              : [...placed.slice(0, tlAt), created, ...placed.slice(tlAt)]
                  .map((t, i) => ({ id: t.id, position: i + 1, was: t.timelinePosition ?? null }))
                  .filter((r) => r.id !== created.id && r.position !== r.was);

          if (listChanged.length || tlChanged.length) {
            const listPos = new Map(listChanged.map((r) => [r.id, r.position]));
            const tlPos = new Map(tlChanged.map((r) => [r.id, r.position]));
            setTasks((prev) =>
              prev.map((t) =>
                listPos.has(t.id) || tlPos.has(t.id)
                  ? {
                      ...t,
                      position: listPos.get(t.id) ?? t.position,
                      timelinePosition: tlPos.get(t.id) ?? t.timelinePosition,
                    }
                  : t,
              ),
            );
            for (const { id, position } of listChanged) {
              supabase
                .from("tasks")
                .update({ position })
                .eq("id", id)
                .then(wrote("addTaskNear list order"));
            }
            for (const { id, position } of tlChanged) {
              supabase
                .from("tasks")
                .update({ timeline_position: position })
                .eq("id", id)
                .then(wrote("addTaskNear timeline order"));
            }
          }
        });
    },
    [supabase, tasks, clients, tagNameById, noteWriteError, wrote, counting, setTasks],
  );

  const addSection = useCallback(
    (clientId: string, name: string) => {
      const position =
        Math.max(0, ...sections.filter((s) => s.clientId === clientId).map((s) => s.position)) + 1;
      counting(
        supabase
          .from("sections")
          .insert({ client_id: clientId, name, position })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addSection", error);
            return;
          }
          setSections((prev) => [...prev, mapSection(data)]);
        });
    },
    [supabase, sections, noteWriteError, counting, setSections],
  );

  /**
   * Hard-delete a task. `time_entries`, comments and attachments all reference it
   * with ON DELETE CASCADE, so this destroys its logged hours too — callers must
   * confirm with the user first and say how much time is going.
   *
   * Deliberately NOT added to the undo history: the cascaded rows can't be brought
   * back, so an "undo" would restore the task and silently lose its hours, which is
   * worse than no undo at all. Published client reports are unaffected — they ship
   * frozen snapshots.
   */
  const deleteTask = useCallback(
    (taskId: string) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setTimeEntries((prev) => prev.filter((e) => e.taskId !== taskId));
      setEntrySums((prev) => prev.filter((e) => e.taskId !== taskId));
      supabase
        .from("tasks")
        .delete()
        .eq("id", taskId)
        .then(wrote("deleteTask"));
    },
    [supabase, wrote, setEntrySums, setTasks, setTimeEntries],
  );

  // Deliberately NOT in the undo history, for the same reason as deleteTask:
  // time entries, comments and attachments are ON DELETE CASCADE, so an "undo"
  // would restore the tasks without their hours — worse than no undo at all.
  const deleteTasksBulk = useCallback(
    (taskIds: string[]) => {
      const ids = [...new Set(taskIds)];
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setTasks((prev) => prev.filter((t) => !idSet.has(t.id)));
      setTimeEntries((prev) => prev.filter((e) => !idSet.has(e.taskId)));
      setEntrySums((prev) => prev.filter((e) => !idSet.has(e.taskId)));
      supabase
        .from("tasks")
        .delete()
        .in("id", ids)
        .then(wrote("deleteTasksBulk"));
    },
    [supabase, wrote, setEntrySums, setTasks, setTimeEntries],
  );

  const updateSection = useCallback(
    (sectionId: string, patch: Partial<Pick<Section, "name">>) => {
      const before = sections.find((s) => s.id === sectionId);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateSection(sectionId, prev),
          redo: () => methodsRef.current?.updateSection(sectionId, patch),
        });
      }
      setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)));
      supabase
        .from("sections")
        .update(patch)
        .eq("id", sectionId)
        .then(wrote("updateSection"));
    },
    [supabase, sections, record, wrote, methodsRef, setSections],
  );

  /** Refuses if any task or GROUP still points at the section — deleting one with
   *  contents would orphan them (the FK is ON DELETE SET NULL, so they'd silently
   *  reappear under "No section" with no way to tell where they came from). An
   *  empty group counts: it is a named thing somebody made, and 0027's FK would
   *  quietly relocate it. */
  const deleteSection = useCallback(
    (sectionId: string) => {
      if (tasks.some((t) => t.sectionId === sectionId)) {
        noteWriteError("deleteSection", { message: "Section still has tasks" });
        return;
      }
      if (taskGroups.some((g) => g.sectionId === sectionId)) {
        noteWriteError("deleteSection", { message: "Section still has groups" });
        return;
      }
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
      supabase
        .from("sections")
        .delete()
        .eq("id", sectionId)
        .then(wrote("deleteSection"));
    },
    [supabase, tasks, taskGroups, wrote, noteWriteError, setSections],
  );

  /**
   * Reorder tasks inside one container: `movedId` is placed before `beforeId`
   * (or last when null). Positions are rewritten as a dense 1..n sequence for the
   * container, which keeps them stable instead of drifting toward collisions the way
   * midpoint/fractional schemes do after enough moves.
   *
   * ⚠️ The container is the section AND the group (0027), not the section alone.
   * A group's children have their own dense run, so reordering inside a group
   * must not renumber the section's loose tasks — they are a separate run and
   * rewriting both would shuffle rows the user never touched.
   */
  const reorderTask = useCallback(
    (movedId: string, beforeId: string | null) => {
      const moved = tasks.find((t) => t.id === movedId);
      if (!moved) return;

      const siblings = tasks
        .filter(
          (t) =>
            t.clientId === moved.clientId &&
            t.sectionId === moved.sectionId &&
            t.groupId === moved.groupId,
        )
        .sort((a, b) => a.position - b.position);

      const without = siblings.filter((t) => t.id !== movedId);
      const at = beforeId ? without.findIndex((t) => t.id === beforeId) : without.length;
      if (at === -1) return;
      const ordered = [...without.slice(0, at), moved, ...without.slice(at)];

      const changed = ordered
        .map((t, i) => ({ id: t.id, position: i + 1, was: t.position }))
        .filter((r) => r.position !== r.was);
      if (changed.length === 0) return;

      const prevById = new Map(changed.map((r) => [r.id, r.was]));
      record({
        undo: () => {
          setTasks((prev) =>
            prev.map((t) => (prevById.has(t.id) ? { ...t, position: prevById.get(t.id)! } : t)),
          );
          for (const [id, position] of prevById) {
            supabase
              .from("tasks")
              .update({ position })
              .eq("id", id)
              .then(wrote("reorderTask undo"));
          }
        },
        redo: () => methodsRef.current?.reorderTask(movedId, beforeId),
      });

      const posById = new Map(changed.map((r) => [r.id, r.position]));
      setTasks((prev) =>
        prev.map((t) => (posById.has(t.id) ? { ...t, position: posById.get(t.id)! } : t)),
      );
      for (const { id, position } of changed) {
        supabase
          .from("tasks")
          .update({ position })
          .eq("id", id)
          .then(wrote("reorderTask"));
      }
    },
    [supabase, tasks, record, wrote, methodsRef, setTasks],
  );

  /**
   * Reorder sections inside one client, exactly as `reorderTask` does for tasks:
   * dense 1..n, only changed rows written, one undo step.
   *
   * NOTE on existing data: the imports never set `sections.position`, so many
   * clients have every section at 0 and their display order is incidental — the
   * first drag in such a client assigns real positions to all of its sections.
   */
  const reorderSection = useCallback(
    (movedId: string, beforeId: string | null) => {
      const moved = sections.find((s) => s.id === movedId);
      if (!moved || movedId === beforeId) return;

      const siblings = sections
        .filter((s) => s.clientId === moved.clientId)
        .sort((a, b) => a.position - b.position);
      const without = siblings.filter((s) => s.id !== movedId);
      const at = beforeId ? without.findIndex((s) => s.id === beforeId) : without.length;
      if (at === -1) return;
      const ordered = [...without.slice(0, at), moved, ...without.slice(at)];

      const changed = ordered
        .map((s, i) => ({ id: s.id, position: i + 1, was: s.position }))
        .filter((r) => r.position !== r.was);
      if (changed.length === 0) return;

      const prevById = new Map(changed.map((r) => [r.id, r.was]));
      record({
        undo: () => {
          setSections((prev) =>
            prev.map((s) => (prevById.has(s.id) ? { ...s, position: prevById.get(s.id)! } : s)),
          );
          for (const [id, position] of prevById) {
            supabase
              .from("sections")
              .update({ position })
              .eq("id", id)
              .then(wrote("reorderSection undo"));
          }
        },
        redo: () => methodsRef.current?.reorderSection(movedId, beforeId),
      });

      const posById = new Map(changed.map((r) => [r.id, r.position]));
      setSections((prev) =>
        prev.map((s) => (posById.has(s.id) ? { ...s, position: posById.get(s.id)! } : s)),
      );
      for (const { id, position } of changed) {
        supabase
          .from("sections")
          .update({ position })
          .eq("id", id)
          .then(wrote("reorderSection"));
      }
    },
    [supabase, sections, record, wrote, methodsRef, setSections],
  );

  // ── task groups (0027) ────────────────────────────────────────────────
  // The same four methods as sections, deliberately in the same shapes: dense
  // 1..n positions, one undo step per gesture, a `wrote()` tail on every write.
  // A group differs from a section in exactly two places, both noted below —
  // its position is scoped to a SECTION rather than a client, and deleting one
  // dissolves it instead of refusing.

  const addTaskGroup = useCallback(
    async (clientId: string, sectionId: string | null, name: string) => {
      const position =
        Math.max(
          0,
          ...taskGroups
            .filter((g) => g.clientId === clientId && g.sectionId === sectionId)
            .map((g) => g.position),
        ) + 1;
      const { data, error } = await counting(
        supabase
          .from("task_groups")
          .insert({ client_id: clientId, section_id: sectionId, name, position })
          .select()
          .single(),
      );
      if (error) {
        noteWriteError("addTaskGroup", error);
        return null;
      }
      const created = mapTaskGroup(data);
      setTaskGroups((prev) => [...prev, created]);
      return created;
    },
    [supabase, taskGroups, noteWriteError, counting, setTaskGroups],
  );

  /**
   * Gather an existing selection into a brand-new group.
   *
   * Two steps on purpose, and they are undoable differently: creating the group
   * is NOT in the history (nothing that creates is, by this app's convention),
   * while the move is ONE `updateTasksBulk` step — so ⌘Z takes the tasks back out
   * and leaves an empty group behind, which is visible and one click to remove.
   * The alternative — folding both into one step — would have to un-create a row
   * that other people may already be looking at.
   */
  const groupTasksIntoNew = useCallback(
    async (taskIds: string[], name: string) => {
      const ids = [...new Set(taskIds)];
      const picked = tasks.filter((t) => ids.includes(t.id));
      if (picked.length === 0) return "Nothing is selected.";

      // ⚠️ A group belongs to exactly ONE section, so the selection must already
      // agree on one. Silently re-sectioning the odd task out would be a second
      // change nobody asked for, and on a client page it would move work between
      // phases — so this refuses and says which axis disagrees.
      const clientIds = new Set(picked.map((t) => t.clientId));
      if (clientIds.size > 1) return "Those tasks belong to different clients.";
      const sectionIds = new Set(picked.map((t) => t.sectionId ?? ""));
      if (sectionIds.size > 1)
        return "Those tasks are in different sections — a group lives inside one section. Move them into the same section first.";

      const created = await methodsRef.current?.addTaskGroup(
        picked[0].clientId,
        picked[0].sectionId ?? null,
        name,
      );
      if (!created) return "The group could not be created.";
      methodsRef.current?.updateTasksBulk(ids, { groupId: created.id });
      return null;
    },
    [tasks, methodsRef],
  );

  const updateTaskGroup = useCallback(
    (groupId: string, patch: Partial<Pick<TaskGroup, "name">>) => {
      const before = taskGroups.find((g) => g.id === groupId);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateTaskGroup(groupId, prev),
          redo: () => methodsRef.current?.updateTaskGroup(groupId, patch),
        });
      }
      setTaskGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));
      supabase
        .from("task_groups")
        .update(patch)
        .eq("id", groupId)
        .then(wrote("updateTaskGroup"));
    },
    [supabase, taskGroups, record, wrote, methodsRef, setTaskGroups],
  );

  /**
   * Dissolve a group. Its tasks move up to the section and the row goes.
   *
   * ⚠️ Deliberately NOT `deleteSection`'s refuse-while-occupied rule. A section
   * is where work lives and losing one strands its tasks under "No section" with
   * nothing to say where they came from; a group is one level down, so its tasks
   * have an obvious home and the FK would put them there anyway. Making the user
   * empty a group by hand before removing it would be ceremony.
   *
   * NOT undoable, for the same reason `addTask` isn't: the inverse would have to
   * re-create the row with its original id and re-file every task, and a group
   * carries no data of its own worth that machinery. The tasks are all still
   * there — re-create the group and drag them back.
   */
  const deleteTaskGroup = useCallback(
    (groupId: string, opts?: { withTasks?: boolean }) => {
      const members = tasks.filter((t) => t.groupId === groupId).map((t) => t.id);
      setTaskGroups((prev) => prev.filter((g) => g.id !== groupId));
      if (opts?.withTasks && members.length) {
        // ⚠️ CASCADES to time entries, comments and attachments, and is NOT
        // undoable — the same reason `deleteTask` isn't. The dialog that offers
        // this is where the confirmation and the logged-hours refusal live.
        methodsRef.current?.deleteTasksBulk(members);
      } else if (members.length) {
        // Dissolve: local state first, because the FK is ON DELETE SET NULL and
        // the DB will clear `group_id` itself — but not until the delete lands,
        // and until then every reader points at a group that has left the list.
        const memberSet = new Set(members);
        setTasks((prev) => prev.map((t) => (memberSet.has(t.id) ? { ...t, groupId: null } : t)));
      }
      supabase
        .from("task_groups")
        .delete()
        .eq("id", groupId)
        .then(wrote("deleteTaskGroup"));
    },
    [supabase, tasks, wrote, methodsRef, setTaskGroups, setTasks],
  );

  /** Reorder groups inside one section, exactly as `reorderSection` does for a client. */
  const reorderTaskGroup = useCallback(
    (movedId: string, beforeId: string | null) => {
      const moved = taskGroups.find((g) => g.id === movedId);
      if (!moved || movedId === beforeId) return;

      // Scoped to the SECTION, not the client: two sections' groups are two
      // independent runs, and renumbering across them would reshuffle a section
      // the user wasn't looking at.
      const siblings = taskGroups
        .filter((g) => g.clientId === moved.clientId && g.sectionId === moved.sectionId)
        .sort((a, b) => a.position - b.position);
      const without = siblings.filter((g) => g.id !== movedId);
      const at = beforeId ? without.findIndex((g) => g.id === beforeId) : without.length;
      if (at === -1) return;
      const ordered = [...without.slice(0, at), moved, ...without.slice(at)];

      const changed = ordered
        .map((g, i) => ({ id: g.id, position: i + 1, was: g.position }))
        .filter((r) => r.position !== r.was);
      if (changed.length === 0) return;

      const prevById = new Map(changed.map((r) => [r.id, r.was]));
      record({
        undo: () => {
          setTaskGroups((prev) =>
            prev.map((g) => (prevById.has(g.id) ? { ...g, position: prevById.get(g.id)! } : g)),
          );
          for (const [id, position] of prevById) {
            supabase
              .from("task_groups")
              .update({ position })
              .eq("id", id)
              .then(wrote("reorderTaskGroup undo"));
          }
        },
        redo: () => methodsRef.current?.reorderTaskGroup(movedId, beforeId),
      });

      const posById = new Map(changed.map((r) => [r.id, r.position]));
      setTaskGroups((prev) =>
        prev.map((g) => (posById.has(g.id) ? { ...g, position: posById.get(g.id)! } : g)),
      );
      for (const { id, position } of changed) {
        supabase
          .from("task_groups")
          .update({ position })
          .eq("id", id)
          .then(wrote("reorderTaskGroup"));
      }
    },
    [supabase, taskGroups, record, wrote, methodsRef, setTaskGroups],
  );

  return useMemo(
    () => ({
      updateTask,
      restoreTasksBulk,
      updateTasksBulk,
      updateTasksVaried,
      addTask,
      addTaskNear,
      addSection,
      deleteTask,
      deleteTasksBulk,
      updateSection,
      deleteSection,
      reorderTask,
      reorderSection,
      addTaskGroup,
      groupTasksIntoNew,
      updateTaskGroup,
      deleteTaskGroup,
      reorderTaskGroup,
    }),
    [
      updateTask,
      restoreTasksBulk,
      updateTasksBulk,
      updateTasksVaried,
      addTask,
      addTaskNear,
      addSection,
      deleteTask,
      deleteTasksBulk,
      updateSection,
      deleteSection,
      reorderTask,
      reorderSection,
      addTaskGroup,
      groupTasksIntoNew,
      updateTaskGroup,
      deleteTaskGroup,
      reorderTaskGroup,
    ],
  );
}
