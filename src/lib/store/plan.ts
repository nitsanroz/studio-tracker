"use client";

// The weekly plan: entries and the columns they sit in.
//
// First domain lifted out of the old single-file store. The shape is the
// pattern the rest follow:
//
//   • `deps` is DESTRUCTURED immediately, so every `useCallback` dependency
//     array names the same values it named inside the provider. Referencing
//     `deps.x` instead would defeat memoization, because the caller builds a
//     fresh object each render.
//   • the return is `useMemo`'d, so the provider can list ONE dependency for
//     the whole domain instead of twenty-two.
//   • cross-domain calls go through `methodsRef`, exactly as before — a history
//     step must never close over a stale method, and that indirection is also
//     what lets these domains be separate files without importing each other.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapPlanColumn, mapPlanEntry } from "../db";
import { PLAN_ENTRY_FIELDS, type HistoryAction, type NewPlanEntry, type PlanEntryPatch, type Store } from "./types";
import type { PlanColumn, PlanEntry, Task } from "../types";

export interface PlanDeps {
  supabase: SupabaseClient;
  planEntries: PlanEntry[];
  planColumns: PlanColumn[];
  tasks: Task[];
  setPlanEntries: Dispatch<SetStateAction<PlanEntry[]>>;
  setPlanColumns: Dispatch<SetStateAction<PlanColumn[]>>;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  methodsRef: RefObject<Store | null>;
  /** Wraps a write so the background refresh waits for it to settle. */
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  /** Records ONE history step around several mutations that must undo together. */
  asOneStep: (action: Omit<HistoryAction, "epoch">, apply: () => void) => void;
}

export function usePlanActions(deps: PlanDeps) {
  const {
    supabase,
    planEntries,
    planColumns,
    tasks,
    setPlanEntries,
    setPlanColumns,
    record,
    wrote,
    noteWriteError,
    methodsRef,
    counting,
    asOneStep,
  } = deps;

  /** Re-insert a deleted plan entry with its original id (undo support). */
  const restorePlanEntry = useCallback(
    (entry: PlanEntry) => {
      setPlanEntries((prev) => [...prev.filter((e) => e.id !== entry.id), entry]);
      supabase
        .from("plan_entries")
        .insert({
          id: entry.id,
          date: entry.date,
          column_id: entry.columnId,
          position: entry.position,
          type: entry.type,
          task_id: entry.taskId,
          text: entry.text,
          client_id: entry.clientId,
          absence_type: entry.absenceType,
        })
        .then(wrote("restorePlanEntry"));
    },
    [supabase, wrote, setPlanEntries],
  );

  /**
   * Putting a task in the plan says someone is going to work on it, so a task
   * that was marked done is reopened when it is planned — the studio's rule, and
   * the reason the plan's search offers completed tasks at all. Returns the task
   * (with its previous status) when it needs reopening, so the caller can fold
   * that into ONE undo step with whatever put it in the plan; null otherwise.
   *
   * It lives here rather than in the modal because every route a task takes into
   * the plan goes through `addPlanEntry` or `updatePlanEntry` — including paste —
   * so the rule cannot be bypassed by adding a new caller.
   */
  const plannedTaskToReopen = useCallback(
    (taskId: string | null | undefined) => {
      if (!taskId) return null;
      const task = tasks.find((t) => t.id === taskId);
      return task && task.status === "done" ? task : null;
    },
    [tasks],
  );

  const addPlanEntry = useCallback(
    (input: NewPlanEntry) => {
      const position =
        Math.max(
          -1,
          ...planEntries
            .filter((e) => e.columnId === input.columnId && e.date === input.date)
            .map((e) => e.position),
        ) + 1;
      counting(
        supabase
          .from("plan_entries")
          .insert({
            date: input.date,
            column_id: input.columnId,
            position,
            type: input.type,
            task_id: input.taskId ?? null,
            text: input.text ?? "",
            client_id: input.clientId ?? null,
            absence_type: input.absenceType ?? null,
          })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addPlanEntry", error);
            return;
          }
          const entry = mapPlanEntry(data);
          setPlanEntries((prev) => [...prev, entry]);
          const reopen = plannedTaskToReopen(input.taskId);
          const action = {
            undo: () => {
              methodsRef.current?.deletePlanEntry(entry.id);
              if (reopen) methodsRef.current?.updateTask(reopen.id, { status: reopen.status });
            },
            redo: () => {
              restorePlanEntry(entry);
              // restorePlanEntry re-inserts the row verbatim and knows nothing
              // about the reopen rule, so redo has to reapply it
              if (reopen) methodsRef.current?.updateTask(reopen.id, { status: "todo" });
            },
          };
          if (!reopen) {
            record(action);
            return;
          }
          // the row is already in; only the reopen still has to run under the
          // same history step
          asOneStep(action, () => {
            methodsRef.current?.updateTask(reopen.id, { status: "todo" });
          });
        });
    },
    [supabase, planEntries, record, asOneStep, restorePlanEntry, noteWriteError, plannedTaskToReopen, counting, methodsRef, setPlanEntries],
  );

  const updatePlanEntry = useCallback(
    (entryId: string, patch: PlanEntryPatch) => {
      const before = planEntries.find((e) => e.id === entryId);
      if (!before) return;

      // One pass builds all three shapes from ONE field list: the DB row (the
      // camelCase/snake_case mapping lives here and nowhere else — the same trap
      // `updateTimeEntry` fell into), the local patch, and the inverse for undo.
      // Only fields the patch actually names are touched, so an undo can never
      // reset something the caller left alone.
      const prev: PlanEntryPatch = {};
      const local: PlanEntryPatch = {};
      const row: Record<string, unknown> = {};
      for (const f of PLAN_ENTRY_FIELDS) {
        const v = patch[f.key];
        if (v === undefined) continue;
        (prev as Record<string, unknown>)[f.key] = before[f.key];
        (local as Record<string, unknown>)[f.key] = v;
        row[f.col] = v;
      }
      if (Object.keys(row).length === 0) return;

      const apply = () => {
        setPlanEntries((p) => p.map((e) => (e.id === entryId ? { ...e, ...local } : e)));
        supabase.from("plan_entries").update(row).eq("id", entryId).then(wrote("updatePlanEntry"));
      };
      const reopen = plannedTaskToReopen(patch.taskId);
      const action = {
        undo: () => {
          methodsRef.current?.updatePlanEntry(entryId, prev);
          if (reopen) methodsRef.current?.updateTask(reopen.id, { status: reopen.status });
        },
        redo: () => methodsRef.current?.updatePlanEntry(entryId, patch),
      };
      if (!reopen) {
        record(action);
        apply();
        return;
      }
      asOneStep(action, () => {
        apply();
        methodsRef.current?.updateTask(reopen.id, { status: "todo" });
      });
    },
    [supabase, planEntries, record, asOneStep, wrote, plannedTaskToReopen, methodsRef, setPlanEntries],
  );

  /**
   * Move a plan entry to a cell, optionally to a PLACE in that cell.
   *
   * ⚠️⚠️ WITHOUT `place` THIS APPENDS, AND THAT USED TO BE THE ONLY BEHAVIOUR —
   * which is why dragging a chip within one day "only worked downwards". Every
   * in-cell drop set `position = max + 1`, so a chip dragged down landed last and
   * looked correct, while one dragged UP also landed last and looked broken.
   *
   * ⚠️ `place` IS AN OBJECT, and `{ beforeId: null }` is NOT the same as omitting
   * it: the object means "put it exactly here", with a null anchor meaning last in
   * the cell, and it takes the densifying path whose undo restores every position
   * it touched. Omitting it is the old plain append — which is right for a drop on
   * a cell's empty space or a paste, and whose undo only has a cell to restore.
   * Dropping on the LOWER half of the last chip is exactly the case that made this
   * distinction necessary: it means "last", not "append and forget".
   *
   * ⚠️ IT DENSIFIES THE WHOLE DESTINATION CELL 1..n, exactly as `reorderTask` and
   * `reorderSection` do, and for the same reason: the plan's entries were written
   * by the sheet importer and a cell can be entirely `position = 0`, so "insert
   * before X" has no gap to open. Renumbering is what makes the placement mean
   * anything.
   * ⚠️ Absences are renumbered along with the chips even though they render
   * absolutely and are never a drop target — leaving them out would let an absence
   * and a chip hold the same position, and then their order depends on the array.
   */
  const movePlanEntry = useCallback(
    (
      entryId: string,
      target: { date: string | null; columnId: string },
      place?: { beforeId: string | null },
    ) => {
      const before = planEntries.find((e) => e.id === entryId);
      if (!before) return;
      const inCell = planEntries
        .filter(
          (e) => e.columnId === target.columnId && e.date === target.date && e.id !== entryId,
        )
        .sort((a, b) => a.position - b.position);

      if (!place) {
        const prev = { date: before.date, columnId: before.columnId };
        record({
          undo: () => methodsRef.current?.movePlanEntry(entryId, prev),
          redo: () => methodsRef.current?.movePlanEntry(entryId, target),
        });
        const position = Math.max(-1, ...inCell.map((e) => e.position)) + 1;
        setPlanEntries((prev) =>
          prev.map((e) => (e.id === entryId ? { ...e, ...target, position } : e)),
        );
        supabase
          .from("plan_entries")
          .update({ date: target.date, column_id: target.columnId, position })
          .eq("id", entryId)
          .then(wrote("movePlanEntry"));
        return;
      }

      const at = place.beforeId ? inCell.findIndex((e) => e.id === place.beforeId) : -1;
      // a null anchor means last; an unknown one (a stale drop after a refresh)
      // also lands last rather than failing
      const idx = at < 0 ? inCell.length : at;
      const next = [...inCell.slice(0, idx), before, ...inCell.slice(idx)];
      const changed = next
        .map((e, i) => ({ id: e.id, position: i + 1, was: e.position }))
        .filter((r) => r.position !== r.was || r.id === entryId);
      if (changed.length === 0) return;

      const prevPos = new Map(changed.map((r) => [r.id, r.was]));
      const back = { date: before.date, columnId: before.columnId };
      record({
        undo: () => {
          setPlanEntries((prev) =>
            prev.map((e) =>
              prevPos.has(e.id)
                ? { ...e, position: prevPos.get(e.id)!, ...(e.id === entryId ? back : {}) }
                : e,
            ),
          );
          for (const [id, position] of prevPos) {
            supabase
              .from("plan_entries")
              .update(
                id === entryId
                  ? { position, date: back.date, column_id: back.columnId }
                  : { position },
              )
              .eq("id", id)
              .then(wrote("movePlanEntry undo"));
          }
        },
        redo: () => methodsRef.current?.movePlanEntry(entryId, target, place),
      });

      const posById = new Map(changed.map((r) => [r.id, r.position]));
      setPlanEntries((prev) =>
        prev.map((e) =>
          posById.has(e.id)
            ? { ...e, position: posById.get(e.id)!, ...(e.id === entryId ? target : {}) }
            : e,
        ),
      );
      for (const { id, position } of changed) {
        supabase
          .from("plan_entries")
          .update(
            id === entryId
              ? { position, date: target.date, column_id: target.columnId }
              : { position },
          )
          .eq("id", id)
          .then(wrote("movePlanEntry"));
      }
    },
    [supabase, planEntries, record, wrote, methodsRef, setPlanEntries],
  );

  /**
   * What the weekly plan's cells actually call. Reassigns the task ONLY when all
   * of these hold — otherwise it is a plain move:
   *  · the entry is task-linked (free text and absences carry no task)
   *  · the column actually changed (another day in the same column is not a
   *    reassignment)
   *  · the target column is a real person — `type: "member"` WITH a profileId, so
   *    "Studio", "Waiting list" and name-only columns like "Freelancers" are out
   *  · the task isn't already theirs
   *
   * Dragging OUT of someone into Studio or the waiting list deliberately does NOT
   * clear the assignee: unscheduled is not unassigned.
   */
  const movePlanEntryToCell = useCallback(
    (
      entryId: string,
      target: { date: string | null; columnId: string },
      /**
       * Where in the cell it goes: `{ beforeId }` names the chip it lands above,
       * or null for last. Omitted = appended, the plain cell-level drop.
       */
      place?: { beforeId: string | null },
    ) => {
      const entry = planEntries.find((e) => e.id === entryId);
      const col = planColumns.find((c) => c.id === target.columnId);
      const task = entry?.taskId ? tasks.find((t) => t.id === entry.taskId) : null;
      const to = col?.type === "member" ? col.profileId : null;

      if (!entry || !task || !to || entry.columnId === target.columnId || task.assigneeId === to) {
        movePlanEntry(entryId, target, place);
        return;
      }
      const back = { date: entry.date, columnId: entry.columnId };
      const wasAssignedTo = task.assigneeId;
      asOneStep(
        {
          undo: () => {
            methodsRef.current?.updateTask(task.id, { assigneeId: wasAssignedTo });
            methodsRef.current?.movePlanEntry(entryId, back);
          },
          redo: () => methodsRef.current?.movePlanEntryToCell(entryId, target, place),
        },
        () => {
          // Both read their own pre-call snapshots, so running them in one tick is
          // safe; the two setStates batch into a single commit.
          movePlanEntry(entryId, target, place);
          methodsRef.current?.updateTask(task.id, { assigneeId: to });
        },
      );
    },
    [planEntries, planColumns, tasks, movePlanEntry, asOneStep, methodsRef],
  );

  const deletePlanEntry = useCallback(
    (entryId: string) => {
      const before = planEntries.find((e) => e.id === entryId);
      if (before) {
        record({
          undo: () => restorePlanEntry(before),
          redo: () => methodsRef.current?.deletePlanEntry(entryId),
        });
      }
      setPlanEntries((prev) => prev.filter((e) => e.id !== entryId));
      supabase
        .from("plan_entries")
        .delete()
        .eq("id", entryId)
        .then(wrote("deletePlanEntry"));
    },
    [supabase, planEntries, record, restorePlanEntry, wrote, methodsRef, setPlanEntries],
  );

  const addPlanColumn = useCallback(
    (name: string) => {
      const memberCols = planColumns.filter((c) => c.type !== "waiting_list");
      const position = Math.max(0, ...memberCols.map((c) => c.position)) + 1;
      counting(
        supabase
          .from("plan_columns")
          .insert({ name, type: "member", position })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addPlanColumn", error);
            return;
          }
          setPlanColumns((prev) => [...prev, mapPlanColumn(data)]);
        });
    },
    [supabase, planColumns, noteWriteError, counting, setPlanColumns],
  );

  const updatePlanColumn = useCallback(
    (columnId: string, patch: Partial<Pick<PlanColumn, "name" | "hidden" | "position">>) => {
      const prev = planColumns;
      setPlanColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, ...patch } : c)));
      supabase
        .from("plan_columns")
        .update(patch)
        .eq("id", columnId)
        .then((res) => {
          wrote("updatePlanColumn")(res);
          if (res.error) setPlanColumns(prev); // e.g. `hidden` migration not applied yet
        });
    },
    [supabase, planColumns, wrote, setPlanColumns],
  );

  const movePlanColumn = useCallback(
    (columnId: string, direction: -1 | 1) => {
      const ordered = planColumns
        .filter((c) => c.type !== "waiting_list")
        .sort((a, b) => a.position - b.position);
      const idx = ordered.findIndex((c) => c.id === columnId);
      const swapWith = ordered[idx + direction];
      if (idx < 0 || !swapWith) return;
      const a = ordered[idx];
      setPlanColumns((cols) =>
        cols.map((c) =>
          c.id === a.id
            ? { ...c, position: swapWith.position }
            : c.id === swapWith.id
              ? { ...c, position: a.position }
              : c,
        ),
      );
      supabase
        .from("plan_columns")
        .update({ position: swapWith.position })
        .eq("id", a.id)
        .then(wrote("movePlanColumn"));
      supabase
        .from("plan_columns")
        .update({ position: a.position })
        .eq("id", swapWith.id)
        .then(wrote("movePlanColumn"));
    },
    [supabase, planColumns, wrote, setPlanColumns],
  );

  const deletePlanColumn = useCallback(
    (columnId: string) => {
      setPlanColumns((prev) => prev.filter((c) => c.id !== columnId));
      setPlanEntries((prev) => prev.filter((e) => e.columnId !== columnId));
      supabase
        .from("plan_columns")
        .delete()
        .eq("id", columnId)
        .then(wrote("deletePlanColumn"));
    },
    [supabase, wrote, setPlanColumns, setPlanEntries],
  );
  return useMemo(
    () => ({
      restorePlanEntry,
      plannedTaskToReopen,
      addPlanEntry,
      updatePlanEntry,
      movePlanEntry,
      movePlanEntryToCell,
      deletePlanEntry,
      addPlanColumn,
      updatePlanColumn,
      movePlanColumn,
      deletePlanColumn,
    }),
    [
      restorePlanEntry,
      plannedTaskToReopen,
      addPlanEntry,
      updatePlanEntry,
      movePlanEntry,
      movePlanEntryToCell,
      deletePlanEntry,
      addPlanColumn,
      updatePlanColumn,
      movePlanColumn,
      deletePlanColumn,
    ],
  );
}
