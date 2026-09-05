"use client";

// The client Timeline: the order tasks appear in, and the milestone marks on it.
//
// `reorderTimelineTasks` takes the FULL ordered list the component renders —
// the component owns the sort (date fallback for never-dragged rows), so the
// store does not reproduce it and the two cannot disagree.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTimelineMark } from "../db";
import { inversePatch } from "./helpers";
import type { HistoryAction, Store } from "./types";
import type { Task, TimelineMark } from "../types";

export interface TimelineDeps {
  supabase: SupabaseClient;
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  timelineMarks: TimelineMark[];
  setTimelineMarks: Dispatch<SetStateAction<TimelineMark[]>>;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useTimelineActions(deps: TimelineDeps) {
  const {
    supabase,
    tasks,
    setTasks,
    timelineMarks,
    setTimelineMarks,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;

  /**
   * Row order on the client Timeline (0023). Mirrors `reorderSection`: dense
   * `1..n` renumbering over the tasks the caller is showing, only changed rows
   * written, one undo step recording the prior numbers.
   *
   * `orderedIds` is the FULL list the Timeline renders, already in its new
   * order — the component owns the sort (date fallback for never-dragged rows),
   * so the store doesn't need to reproduce it and the two can't disagree.
   */
  const reorderTimelineTasks = useCallback(
    (orderedIds: string[]) => {
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const changed = orderedIds
        .map((id, i) => ({ id, position: i + 1, was: byId.get(id)?.timelinePosition ?? null }))
        .filter((r) => byId.has(r.id) && r.position !== r.was);
      if (changed.length === 0) return;

      const prevById = new Map(changed.map((r) => [r.id, r.was]));
      const applyLocal = (m: Map<string, number | null>) =>
        setTasks((prev) =>
          prev.map((t) => (m.has(t.id) ? { ...t, timelinePosition: m.get(t.id)! } : t)),
        );

      record({
        undo: () => {
          applyLocal(prevById);
          for (const [id, timeline_position] of prevById) {
            supabase
              .from("tasks")
              .update({ timeline_position })
              .eq("id", id)
              .then(wrote("reorderTimelineTasks undo"));
          }
        },
        redo: () => methodsRef.current?.reorderTimelineTasks(orderedIds),
      });

      applyLocal(new Map(changed.map((r) => [r.id, r.position as number | null])));
      for (const { id, position } of changed) {
        supabase
          .from("tasks")
          .update({ timeline_position: position })
          .eq("id", id)
          .then(wrote("reorderTimelineTasks"));
      }
    },
    [supabase, tasks, record, wrote, methodsRef, setTasks],
  );

  // ── reference links (0022) ────────────────────────────────────────────
  // `owner` is exactly one of taskId / clientId — the DB has a CHECK saying so,
  // and the two RLS policies differ (task links are member-writable like the
  // brief they sit under; client links are admin-only).
  /**
   * Timeline milestones. Creating one is NOT undoable, like everything else that
   * creates a row here; renaming, moving and deleting are.
   */
  const addTimelineMark = useCallback(
    (clientId: string, onDate: string, title: string) => {
      counting(
        supabase
          .from("timeline_marks")
          .insert({ client_id: clientId, on_date: onDate, title })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addTimelineMark", error);
            return;
          }
          setTimelineMarks((prev) => [...prev, mapTimelineMark(data)]);
        });
    },
    [supabase, noteWriteError, counting, setTimelineMarks],
  );

  const updateTimelineMark = useCallback(
    (id: string, patch: { title?: string; onDate?: string }) => {
      const before = timelineMarks.find((m) => m.id === id);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateTimelineMark(id, prev),
          redo: () => methodsRef.current?.updateTimelineMark(id, patch),
        });
      }
      setTimelineMarks((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
      const row: Record<string, unknown> = {};
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.onDate !== undefined) row.on_date = patch.onDate;
      supabase.from("timeline_marks").update(row).eq("id", id).then(wrote("updateTimelineMark"));
    },
    [supabase, timelineMarks, record, wrote, methodsRef, setTimelineMarks],
  );

  const deleteTimelineMark = useCallback(
    (id: string) => {
      const gone = timelineMarks.find((m) => m.id === id);
      // Re-inserted WITH ITS ORIGINAL ID, or the undo would create a different
      // mark and a redo of the delete would miss it. Same rule as links.
      if (gone) {
        record({
          undo: () => {
            setTimelineMarks((prev) =>
              prev.some((m) => m.id === gone.id) ? prev : [...prev, gone],
            );
            supabase
              .from("timeline_marks")
              .insert({
                id: gone.id,
                client_id: gone.clientId,
                on_date: gone.onDate,
                title: gone.title,
              })
              .then(wrote("restoreTimelineMark"));
          },
          redo: () => methodsRef.current?.deleteTimelineMark(id),
        });
      }
      setTimelineMarks((prev) => prev.filter((m) => m.id !== id));
      supabase.from("timeline_marks").delete().eq("id", id).then(wrote("deleteTimelineMark"));
    },
    [supabase, timelineMarks, record, wrote, methodsRef, setTimelineMarks],
  );

  return useMemo(
    () => ({
      reorderTimelineTasks,
      addTimelineMark,
      updateTimelineMark,
      deleteTimelineMark,
    }),
    [
      reorderTimelineTasks,
      addTimelineMark,
      updateTimelineMark,
      deleteTimelineMark,
    ],
  );
}
