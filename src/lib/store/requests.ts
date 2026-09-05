"use client";

// The intake queue: client-submitted briefs, and turning one into a real task.
//
// `approveRequest` is the only place a task is created from outside the studio,
// so it assembles the brief from the submission rather than trusting a field.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapLink, mapTask, updateWithOptional } from "../db";
import { assembleTaskBrief, readSubmission } from "../brief";
import { needsReview } from "../brief-diff";
import type { ApproveRequestInput, TaskRequest } from "./types";
import type { Client, Link, Task } from "../types";

export interface RequestDeps {
  supabase: SupabaseClient;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  clients: Client[];
  /** taskId-independent tag lookup, so an approved brief keeps its tag name. */
  tagNameById: Map<string, string>;
  setLinks: Dispatch<SetStateAction<Link[]>>;
  taskRequests: TaskRequest[];
  setTaskRequests: Dispatch<SetStateAction<TaskRequest[]>>;
  currentUserId: string | null;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
}

export function useRequestActions(deps: RequestDeps) {
  const {
    supabase,
    setTasks,
    clients,
    tagNameById,
    setLinks,
    taskRequests,
    setTaskRequests,
    currentUserId,
    wrote,
    noteWriteError,
    counting,
  } = deps;



  const approveRequest = useCallback(
    async (requestId: string, input: ApproveRequestInput): Promise<string | null> => {
      const request = taskRequests.find((r) => r.id === requestId);
      if (!request) return null;

      // What the client attached. Files and their own "+ Add link" rows become
      // real `links` on the task below, so the brief copied across is assembled
      // WITHOUT them — otherwise every Supabase storage URL lands in the text as
      // well, which is the noise migration 0022 exists to remove.
      const submission = readSubmission(request.answers);
      const attachments = submission ? [...submission.files.map((f) => ({ title: f.name, url: f.url })), ...submission.links] : [];
      const brief = submission ? assembleTaskBrief(submission.answers) : request.brief;

      const { data: task, error } = await counting(
        supabase
          .from("tasks")
          .insert({
            client_id: input.clientId,
            section_id: input.sectionId,
            title: input.title,
            brief,
            status: "todo",
            assignee_id: input.assigneeId,
            due_date: input.dueDate,
            billable: clients.find((c) => c.id === input.clientId)?.billable ?? true,
            estimate_hours: input.estimateHours,
          })
          .select()
          .single(),
      );
      if (error) {
        noteWriteError("approveRequest", error);
        throw new Error(error.message);
      }
      // ⚠️ `answers_ack`/`acked_at` ride along (0030): approving IS acknowledging,
      // and from here on the studio's own words live on the task — so a later
      // client revision has to be measured against what was approved, not
      // against the task text. Optional, so an unapplied migration cannot break
      // APPROVING, which is the queue's whole purpose.
      const { error: approveErr } = await updateWithOptional(
        supabase,
        "task_requests",
        { id: requestId },
        { status: "approved", created_task_id: task.id, client_id: input.clientId },
        { answers_ack: request.answers ?? {}, acked_at: new Date().toISOString() },
      );
      if (approveErr) noteWriteError("approveRequest", approveErr);
      // The attachments, as titled links on the new task — the same rows the
      // studio's own "+ Add link" writes, so they render and edit identically.
      // ⚠️ Best-effort ON PURPOSE: the task exists and the request is approved
      // by this point, and failing the whole approval because one link row
      // wouldn't insert would leave the queue and the task list disagreeing.
      // The URLs are still in the request's own brief if anything goes wrong.
      if (attachments.length) {
        const { data: rows, error: linkError } = await counting(
          supabase
            .from("links")
            .insert(
              attachments.map((a, i) => ({
                task_id: task.id,
                client_id: null,
                title: a.title,
                url: a.url,
                position: i + 1,
              })),
            )
            .select(),
        );
        if (linkError) noteWriteError("approveRequest links", linkError);
        else if (rows) setLinks((prev) => [...prev, ...rows.map(mapLink)]);
      }

      setTasks((prev) => [...prev, mapTask(task, tagNameById)]);
      setTaskRequests((prev) =>
        prev.map((r) =>
          r.id === requestId ? { ...r, status: "approved" as const, createdTaskId: task.id } : r,
        ),
      );
      return task.id as string;
    },
    [supabase, taskRequests, tagNameById, clients, noteWriteError, counting, setLinks, setTaskRequests, setTasks],
  );

  /**
   * Drop a submission for good. Admin-only by RLS (0001's "admin all"), and
   * there is no undo — it is one row plus whatever the client typed into it.
   *
   * ⚠️ The uploaded FILES are left in the `intake` bucket. An approved request
   * has already turned them into links on a live task, and deleting the request
   * must not break those. A few orphaned objects behind a deleted submission is
   * the cheaper mistake by a wide margin.
   */
  const deleteRequest = useCallback(
    (requestId: string) => {
      setTaskRequests((prev) => prev.filter((r) => r.id !== requestId));
      supabase
        .from("task_requests")
        .delete()
        .eq("id", requestId)
        .then(wrote("deleteRequest"));
    },
    [supabase, wrote, setTaskRequests],
  );

  /**
   * Tell the client a person has read their brief, and record that we did.
   *
   * Goes through an API route rather than writing here, for two reasons the
   * browser can't satisfy: the Resend key is server-only, and the route is what
   * enforces "mail the client at most once" by checking `client_notified_at`
   * inside the same request that sets it.
   */
  const markRequestSeen = useCallback(
    async (requestId: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch("/api/intake/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as
        | { seenAt?: string; clientNotifiedAt?: string | null; error?: string }
        | null;
      if (!res?.ok) return { ok: false, error: body?.error ?? "Couldn't send the confirmation." };
      setTaskRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                seenAt: body?.seenAt ?? new Date().toISOString(),
                seenBy: currentUserId,
                clientNotifiedAt: body?.clientNotifiedAt ?? r.clientNotifiedAt,
                // The route snapshots the answers it acknowledged (0030); mirror
                // it locally so the "updated" badge clears without a refetch.
                answersAck: r.answers,
                ackedAt: body?.seenAt ?? new Date().toISOString(),
              }
            : r,
        ),
      );
      return { ok: true };
    },
    [currentUserId, setTaskRequests],
  );

  /**
   * "I've read the client's changes" — snapshots the current answers as the new
   * baseline, so the UPDATED badge clears and the next revision is measured from
   * here.
   *
   * ⚠️ It writes NOTHING but the snapshot. It does not touch the task, the
   * status, or `seen_at`: reviewing a revision is not the same act as approving
   * the brief or telling the client anything, and folding those together is how
   * an admin would end up approving a change they had only glanced at.
   */
  const updatedRequests = useMemo(() => taskRequests.filter(needsReview), [taskRequests]);

  const markRevisionReviewed = useCallback(
    (requestId: string) => {
      const req = taskRequests.find((r) => r.id === requestId);
      if (!req) return;
      const now = new Date().toISOString();
      setTaskRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, answersAck: r.answers, ackedAt: now } : r)),
      );
      // ⚠️ Both columns are 0030's, so BOTH are optional here — this call had no
      // schema guard at all until the cleanup pass caught it, which would have
      // meant a red write-error banner on every click in the window before the
      // migration ran. With nothing required, a pending migration makes this a
      // no-op rather than a failure.
      void updateWithOptional(
        supabase,
        "task_requests",
        { id: requestId },
        {},
        { answers_ack: req.answers ?? {}, acked_at: now },
      ).then(({ error }) => {
        if (error) noteWriteError("markRevisionReviewed", error);
      });
    },
    // `wrote` is gone with the chained call it wrapped; `noteWriteError` replaces
    // it and belongs here in its place.
    [supabase, taskRequests, noteWriteError, setTaskRequests],
  );

  const rejectRequest = useCallback(
    (requestId: string) => {
      setTaskRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "rejected" as const } : r)),
      );
      supabase
        .from("task_requests")
        .update({ status: "rejected" })
        .eq("id", requestId)
        .then(wrote("rejectRequest"));
    },
    [supabase, wrote, setTaskRequests],
  );

  return useMemo(
    () => ({
      approveRequest,
      deleteRequest,
      markRequestSeen,
      markRevisionReviewed,
      rejectRequest,
      updatedRequests,
    }),
    [
      approveRequest,
      deleteRequest,
      markRequestSeen,
      markRevisionReviewed,
      rejectRequest,
      updatedRequests,
    ],
  );
}
