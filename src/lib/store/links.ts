"use client";

// Reference links — the URLs a client or a task carries (migration 0022).
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapLink } from "../db";
import { inversePatch } from "./helpers";
import type { HistoryAction, Store } from "./types";
import type { Link } from "../types";

export interface LinkDeps {
  supabase: SupabaseClient;
  links: Link[];
  setLinks: Dispatch<SetStateAction<Link[]>>;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useLinkActions(deps: LinkDeps) {
  const {
    supabase,
    links,
    setLinks,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;


  const addLink = useCallback(
    (owner: { taskId: string } | { clientId: string }, title: string, url: string) => {
      const scope =
        "taskId" in owner
          ? { task_id: owner.taskId, client_id: null }
          : { task_id: null, client_id: owner.clientId };
      const siblings = links.filter((l) =>
        "taskId" in owner ? l.taskId === owner.taskId : l.clientId === owner.clientId,
      );
      const position = Math.max(0, ...siblings.map((l) => l.position)) + 1;
      counting(
        supabase
          .from("links")
          .insert({ ...scope, title, url, position })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addLink", error);
            return;
          }
          setLinks((prev) => [...prev, mapLink(data)]);
        });
    },
    [supabase, links, noteWriteError, counting, setLinks],
  );

  const updateLink = useCallback(
    (id: string, patch: { title?: string; url?: string }) => {
      const before = links.find((l) => l.id === id);
      if (before) {
        const prev = inversePatch(before, patch);
        record({
          undo: () => methodsRef.current?.updateLink(id, prev),
          redo: () => methodsRef.current?.updateLink(id, patch),
        });
      }
      setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      supabase.from("links").update(patch).eq("id", id).then(wrote("updateLink"));
    },
    [supabase, links, record, wrote, methodsRef, setLinks],
  );

  const deleteLink = useCallback(
    (id: string) => {
      const gone = links.find((l) => l.id === id);
      // Undo re-inserts the row WITH ITS ORIGINAL ID. Without that, the row the
      // undo creates is a different link, and a redo of the delete would miss it.
      if (gone) {
        record({
          undo: () => {
            setLinks((prev) => (prev.some((l) => l.id === gone.id) ? prev : [...prev, gone]));
            supabase
              .from("links")
              .insert({
                id: gone.id,
                task_id: gone.taskId,
                client_id: gone.clientId,
                title: gone.title,
                url: gone.url,
                position: gone.position,
              })
              .then(wrote("restoreLink"));
          },
          redo: () => methodsRef.current?.deleteLink(id),
        });
      }
      setLinks((prev) => prev.filter((l) => l.id !== id));
      supabase.from("links").delete().eq("id", id).then(wrote("deleteLink"));
    },
    [supabase, links, record, wrote, methodsRef, setLinks],
  );

  return useMemo(
    () => ({
      addLink,
      updateLink,
      deleteLink,
    }),
    [
      addLink,
      updateLink,
      deleteLink,
    ],
  );
}
