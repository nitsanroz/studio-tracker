"use client";

// Task comments, and the attachment list they sit beside.
//
// Attachments are ADDED and REMOVED here but uploaded by /api/task-attachments —
// the file itself never passes through the store, only the row describing it.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapComment } from "../db";
import type { HistoryAction, Store } from "./types";
import type { Attachment, TaskComment } from "../types";

export interface CommentDeps {
  supabase: SupabaseClient;
  comments: TaskComment[];
  setComments: Dispatch<SetStateAction<TaskComment[]>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  currentUserId: string | null;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useCommentActions(deps: CommentDeps) {
  const {
    supabase,
    comments,
    setComments,
    setAttachments,
    currentUserId,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;


  const addComment = useCallback(
    (taskId: string, body: string) => {
      const optimistic: TaskComment = {
        id: `tmp-${Date.now()}`,
        taskId,
        userId: currentUserId,
        body,
        createdAt: new Date().toISOString(),
      };
      setComments((prev) => [...prev, optimistic]);
      counting(
        supabase
          .from("task_comments")
          .insert({ task_id: taskId, user_id: currentUserId, body })
          .select()
          .single(),
      )
        .then(({ data, error }) => {
          if (error) {
            noteWriteError("addComment", error);
            return;
          }
          setComments((prev) => prev.map((c) => (c.id === optimistic.id ? mapComment(data) : c)));
        });
    },
    [supabase, currentUserId, noteWriteError, counting, setComments],
  );

  /**
   * Admin-only in the UI. Undo re-inserts the row WITH ITS ORIGINAL ID and its
   * original `created_at`, so a restored comment lands back in its place in the
   * thread rather than jumping to the bottom — the thread is ordered by time,
   * and an imported 2019 comment reappearing under today's would be a lie about
   * when it was said. `author_name` is carried too: 2,175 of the 2,397 imported
   * comments have no profile, and it's the only record of who wrote them.
   */
  const deleteComment = useCallback(
    (id: string) => {
      const gone = comments.find((c) => c.id === id);
      if (gone) {
        record({
          undo: () => {
            setComments((prev) =>
              prev.some((c) => c.id === gone.id) ? prev : [...prev, gone],
            );
            supabase
              .from("task_comments")
              .insert({
                id: gone.id,
                task_id: gone.taskId,
                user_id: gone.userId,
                body: gone.body,
                created_at: gone.createdAt,
                author_name: gone.authorName ?? null,
              })
              .then(wrote("restoreComment"));
          },
          redo: () => methodsRef.current?.deleteComment(id),
        });
      }
      setComments((prev) => prev.filter((c) => c.id !== id));
      supabase.from("task_comments").delete().eq("id", id).then(wrote("deleteComment"));
    },
    [supabase, comments, record, wrote, methodsRef, setComments],
  );

  const addAttachment = useCallback(
    (attachment: Attachment) => {
      setAttachments((prev) => [...prev, attachment]);
    },
    [setAttachments],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    },
    [setAttachments],
  );

  return useMemo(
    () => ({
      addComment,
      deleteComment,
      addAttachment,
      removeAttachment,
    }),
    [
      addComment,
      deleteComment,
      addAttachment,
      removeAttachment,
    ],
  );
}
