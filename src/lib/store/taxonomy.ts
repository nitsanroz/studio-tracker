"use client";

// Tags and task types — the two small vocabularies a task is labelled with.
//
// Together in one file because they are the same shape of thing and the same
// shape of code: a short list an admin edits in Settings, where a rename has to
// reach every task already carrying it.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTag, mapTaskType } from "../db";
import { inversePatch } from "./helpers";
import type { HistoryAction, Store } from "./types";
import type { Tag, Task, TaskType } from "../types";

export interface TaxonomyDeps {
  supabase: SupabaseClient;
  tagRows: Tag[];
  setTagRows: Dispatch<SetStateAction<Tag[]>>;
  taskTypes: TaskType[];
  setTaskTypes: Dispatch<SetStateAction<TaskType[]>>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useTaxonomyActions(deps: TaxonomyDeps) {
  const {
    supabase,
    tagRows,
    setTagRows,
    taskTypes,
    setTaskTypes,
    setTasks,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;

  // ── task types (0024) ─────────────────────────────────────────────────
  // Simpler than tags in one respect: tasks reference a type by ID, so a rename
  // needs no cascade. `deleteTaskType` relies on the FK's ON DELETE SET NULL
  // rather than clearing tasks itself — but local state has to be swept too, or
  // the pane keeps showing a type that no longer exists until the next refresh.
  const addTaskType = useCallback(
    (name: string, color: string) => {
      const position = Math.max(0, ...taskTypes.map((t) => t.position)) + 1;
      counting(
        supabase
          .from("task_types")
          .insert({ name, color, position })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addTaskType", error);
            return;
          }
          setTaskTypes((prev) => [...prev, mapTaskType(data)]);
        });
    },
    [supabase, taskTypes, noteWriteError, counting, setTaskTypes],
  );

  const updateTaskType = useCallback(
    (typeId: string, patch: Partial<Pick<TaskType, "name" | "color">>) => {
      const before = taskTypes.find((t) => t.id === typeId);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateTaskType(typeId, prev),
          redo: () => methodsRef.current?.updateTaskType(typeId, patch),
        });
      }
      setTaskTypes((prev) => prev.map((t) => (t.id === typeId ? { ...t, ...patch } : t)));
      supabase.from("task_types").update(patch).eq("id", typeId).then(wrote("updateTaskType"));
    },
    [supabase, taskTypes, record, wrote, methodsRef, setTaskTypes],
  );

  const deleteTaskType = useCallback(
    (typeId: string) => {
      setTaskTypes((prev) => prev.filter((t) => t.id !== typeId));
      setTasks((prev) => prev.map((t) => (t.typeId === typeId ? { ...t, typeId: null } : t)));
      supabase.from("task_types").delete().eq("id", typeId).then(wrote("deleteTaskType"));
    },
    [supabase, wrote, setTaskTypes, setTasks],
  );

  const addTag = useCallback(
    (name: string, color: string) => {
      const position = Math.max(0, ...tagRows.map((_, i) => i + 1)) + 1;
      counting(
        supabase
          .from("tags")
          .insert({ name, color, position })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addTag", error);
            return;
          }
          setTagRows((prev) => [...prev, mapTag(data)]);
        });
    },
    [supabase, tagRows, noteWriteError, counting, setTagRows],
  );

  const updateTag = useCallback(
    (tagId: string, patch: Partial<Pick<Tag, "name" | "color">>) => {
      const beforeTag = tagRows.find((t) => t.id === tagId);
      if (beforeTag) {
        const prev = inversePatch(beforeTag, patch);
        record({
          undo: () => methodsRef.current?.updateTag(tagId, prev),
          redo: () => methodsRef.current?.updateTag(tagId, patch),
        });
      }
      const oldName = tagRows.find((t) => t.id === tagId)?.name;
      setTagRows((prev) => prev.map((t) => (t.id === tagId ? { ...t, ...patch } : t)));
      // tasks carry tag NAMES — keep them in sync on rename
      if (patch.name && oldName && patch.name !== oldName) {
        setTasks((prev) => prev.map((t) => (t.tag === oldName ? { ...t, tag: patch.name! } : t)));
      }
      supabase
        .from("tags")
        .update(patch)
        .eq("id", tagId)
        .then(wrote("updateTag"));
    },
    [supabase, tagRows, record, wrote, methodsRef, setTagRows, setTasks],
  );

  const deleteTag = useCallback(
    (tagId: string) => {
      const name = tagRows.find((t) => t.id === tagId)?.name;
      setTagRows((prev) => prev.filter((t) => t.id !== tagId));
      if (name) setTasks((prev) => prev.map((t) => (t.tag === name ? { ...t, tag: null } : t)));
      supabase
        .from("tags")
        .delete()
        .eq("id", tagId)
        .then(wrote("deleteTag"));
    },
    [supabase, tagRows, wrote, setTagRows, setTasks],
  );

  return useMemo(
    () => ({
      addTaskType,
      updateTaskType,
      deleteTaskType,
      addTag,
      updateTag,
      deleteTag,
    }),
    [
      addTaskType,
      updateTaskType,
      deleteTaskType,
      addTag,
      updateTag,
      deleteTag,
    ],
  );
}
