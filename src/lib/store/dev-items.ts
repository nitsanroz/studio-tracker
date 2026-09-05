"use client";

// The "In development" list on the weekly plan's side panel.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDevItem } from "../db";
import { inversePatch } from "./helpers";
import type { HistoryAction, Store } from "./types";
import type { DevItem, DevStatus } from "../types";

export interface DevItemDeps {
  supabase: SupabaseClient;
  devItems: DevItem[];
  setDevItems: Dispatch<SetStateAction<DevItem[]>>;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useDevItemActions(deps: DevItemDeps) {
  const {
    supabase,
    devItems,
    setDevItems,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;


  const addDevItem = useCallback(
    (text: string) => {
      const position = Math.max(0, ...devItems.map((d) => d.position)) + 1;
      counting(
        supabase
          .from("dev_items")
          .insert({ text, position })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addDevItem", error);
            return;
          }
          setDevItems((prev) => [...prev, mapDevItem(data)]);
        });
    },
    [supabase, devItems, noteWriteError, counting, setDevItems],
  );

  const updateDevItem = useCallback(
    (id: string, patch: { text?: string; status?: DevStatus }) => {
      const before = devItems.find((d) => d.id === id);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateDevItem(id, prev),
          redo: () => methodsRef.current?.updateDevItem(id, patch),
        });
      }
      setDevItems((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
      supabase
        .from("dev_items")
        .update(patch)
        .eq("id", id)
        .then(wrote("updateDevItem"));
    },
    [supabase, devItems, record, wrote, methodsRef, setDevItems],
  );

  const deleteDevItem = useCallback(
    (id: string) => {
      setDevItems((prev) => prev.filter((d) => d.id !== id));
      supabase
        .from("dev_items")
        .delete()
        .eq("id", id)
        .then(wrote("deleteDevItem"));
    },
    [supabase, wrote, setDevItems],
  );

  return useMemo(
    () => ({
      addDevItem,
      updateDevItem,
      deleteDevItem,
    }),
    [
      addDevItem,
      updateDevItem,
      deleteDevItem,
    ],
  );
}
