"use client";

// Moving logged hours between tasks — including the WRITE-DOWN, the one path in
// the app that reduces what a client is charged.
//
// ⚠️⚠️ ITS OWN FILE ON PURPOSE. This is not ordinary time logging: a write-down
// moves billable hours onto a client's non-billable "Keys" task, so it changes
// an invoice. It is built to keep the ledger honest rather than to be
// convenient — provenance rides along in `moved_from_task_id` / `moved_at` /
// `moved_by` so a reduced bill can always be traced back to who reduced it.
//
// ⚠️ Migration 0038 backs this with a DB trigger: `task_id` and the `moved_*`
// stamps are admin-only there too, because before it the rule lived ONLY in the
// component that renders the button.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, isMissingSchema, mapTimeEntry } from "../db";
import type { EntrySum, TimeEntry } from "../types";

export interface KeysWriteDownDeps {
  supabase: SupabaseClient;
  setTimeEntries: Dispatch<SetStateAction<TimeEntry[]>>;
  setEntrySums: Dispatch<SetStateAction<EntrySum[]>>;
  currentUserId: string | null;
  entries: { applyEntryLocally: (entry: TimeEntry) => void };
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
}

export function useKeysWriteDown(deps: KeysWriteDownDeps) {
  const {
    supabase,
    setTimeEntries,
    setEntrySums,
    currentUserId,
    entries,
    wrote,
    noteWriteError,
    counting,
  } = deps;



  const moveTimeEntries = useCallback(
    (entryIds: string[], fromTaskId: string, toTaskId: string) => {
      const idSet = new Set(entryIds);
      setTimeEntries((prev) =>
        prev.map((e) =>
          idSet.has(e.id) ? { ...e, taskId: toTaskId, movedFromTaskId: fromTaskId } : e,
        ),
      );
      setEntrySums((prev) =>
        prev.map((e) => (idSet.has(e.id) ? { ...e, taskId: toTaskId } : e)),
      );
      supabase
        .from("time_entries")
        .update({
          task_id: toTaskId,
          moved_from_task_id: fromTaskId,
          moved_at: new Date().toISOString(),
          moved_by: currentUserId,
        })
        .in("id", entryIds)
        .then(wrote("moveTimeEntries"));
    },
    [supabase, currentUserId, wrote, setEntrySums, setTimeEntries],
  );

  /**
   * Write hours down to the client's non-billable "Keys" task.
   *
   * ⚠️⚠️ THIS IS THE ONE PLACE THE STUDIO REDUCES WHAT A CLIENT IS CHARGED, so it
   * is built to keep the ledger honest rather than to be convenient. Nitsan:
   * *"basicly i reduce hours to be charged by clent for a certain task because for
   * example he worked slowly"* — and his ruling on the shape: SPLIT the entry, keep
   * the hours as the designer's own.
   *
   * ⚠️ THE HOURS ARE MOVED, NEVER DELETED, AND THE TOTAL NEVER CHANGES. `n === all`
   * re-points the whole entry; anything less splits it into a billable remainder and
   * a non-billable piece, so `before === after` for that person, that day and that
   * client. A write-down that quietly reduced somebody's logged time would make the
   * designer look slower than they were AND lose the record of the work.
   *
   * ⚠️ THE SPLIT INSERTS FIRST AND SHRINKS SECOND. In the other order a failure
   * between the two writes loses the hours outright; this way it duplicates them,
   * which is visible in the next report and recoverable by hand. Prefer the failure
   * you can see.
   *
   * ⚠️ Provenance rides along in `moved_from_task_id`/`moved_at`/`moved_by`, the
   * same three columns `moveTimeEntries` stamps — so a keys row can always be traced
   * back to the task it was billed against.
   *
   * ⚠️ NOT UNDOABLE, deliberately, and the precedent is `moveTimeEntries`: undoing a
   * split means re-merging two rows one of which may have been edited since, and a
   * ⌘Z that silently re-bills a client is worse than none. The reverse is one more
   * write-down in the other direction, which is why the caller shows both tasks.
   */
  const writeDownToKeys = useCallback(
    async (entryId: string, minutes: number, keysTaskId: string): Promise<boolean> => {
      const row = await supabase
        .from("time_entries")
        .select("id, task_id, user_id, date, minutes, description")
        .eq("id", entryId)
        .single();
      if (row.error || !row.data) {
        noteWriteError("writeDownToKeys read", row.error ?? { message: "entry not found" });
        return false;
      }
      const e = mapTimeEntry(row.data);
      // ⚠️ Re-checked against the row we just read, not against what the screen
      // showed: the card's rows come from a fetch that may be minutes old.
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > e.minutes) {
        noteWriteError("writeDownToKeys", {
          message: `that entry holds ${e.minutes} minutes, so ${minutes} cannot be moved`,
        });
        return false;
      }
      const stamp = { moved_from_task_id: e.taskId, moved_at: new Date().toISOString(), moved_by: currentUserId };

      if (minutes === e.minutes) {
        const { error } = await counting(
          supabase.from("time_entries").update({ task_id: keysTaskId, ...stamp }).eq("id", e.id),
        );
        if (error) {
          noteWriteError("writeDownToKeys move", error);
          return false;
        }
        setTimeEntries((prev) =>
          prev.map((x) => (x.id === e.id ? { ...x, taskId: keysTaskId, movedFromTaskId: e.taskId } : x)),
        );
        setEntrySums((prev) => prev.map((x) => (x.id === e.id ? { ...x, taskId: keysTaskId } : x)));
        return true;
      }

      const ins = await counting(
        supabase
          .from("time_entries")
          .insert({
            task_id: keysTaskId,
            user_id: e.userId,
            date: e.date,
            minutes,
            description: e.description,
            ...stamp,
          })
          .select()
          .single(),
      );
      if (ins.error || !ins.data) {
        noteWriteError("writeDownToKeys insert", ins.error ?? { message: "insert failed" });
        return false;
      }
      const { error } = await counting(
        supabase.from("time_entries").update({ minutes: e.minutes - minutes }).eq("id", e.id),
      );
      if (error) {
        // ⚠️ Say so loudly: the hours are now counted TWICE until somebody fixes it,
        // which is the failure direction chosen above — visible, not lost.
        noteWriteError("writeDownToKeys shrink", error);
        return false;
      }
      entries.applyEntryLocally(mapTimeEntry(ins.data));
      setTimeEntries((prev) =>
        prev.map((x) => (x.id === e.id ? { ...x, minutes: e.minutes - minutes } : x)),
      );
      setEntrySums((prev) =>
        prev.map((x) => (x.id === e.id ? { ...x, minutes: e.minutes - minutes } : x)),
      );
      return true;
    },
    [supabase, currentUserId, counting, noteWriteError, entries, setEntrySums, setTimeEntries],
  );

  /**
   * Write a number of hours down for ONE DESIGNER on a task, without naming a
   * particular log line.
   *
   * ⚠️ WHY THIS EXISTS BESIDE THE PER-ROW VERSION: the studio's own sentence is
   * "three of Nadav's hours on this task were slow", not "45 minutes off the entry
   * dated the 13th". Making somebody pick a row first means choosing whose
   * Tuesday to dock before they have decided anything, and a person's hours are
   * usually spread over several rows anyway.
   *
   * ⚠️ IT CONSUMES OLDEST FIRST, and the order is stated because it is arbitrary
   * in outcome and not in provenance: the client's bill drops by the same amount
   * whichever rows give it up, but the `moved_from_task_id` trail has to land
   * somewhere, and the earliest hours in the range are the ones a "this took
   * longer than it should have" judgement is usually about.
   *
   * ⚠️ IT REFUSES rather than moving what it can when the figure exceeds what that
   * person actually logged in range — a partial write-down that silently stopped
   * short would leave the report right and the studio's intention lost.
   *
   * ⚠️ Each row goes through `writeDownToKeys`, so every guard there applies per
   * row: whole minutes, re-read before writing, insert-then-shrink, provenance
   * stamped. This is a loop over that, not a second implementation of it.
   * ⚠️ NOT ATOMIC. A failure part way leaves the earlier rows moved, which is
   * visible in the next report and is the same "prefer the failure you can see"
   * trade `writeDownToKeys` itself makes.
   */
  const writeDownMemberToKeys = useCallback(
    async (
      taskId: string,
      userId: string,
      minutes: number,
      keysTaskId: string,
      range?: { from: string; to: string },
    ): Promise<boolean> => {
      const ask = (withLegacy: boolean) => {
        let q = supabase
          .from("time_entries")
          .select(withLegacy ? "id, minutes, legacy" : "id, minutes")
          .eq("task_id", taskId)
          .eq("user_id", userId)
          .gt("minutes", 0)
          .order("date")
          .order("id");
        if (range) q = q.gte("date", range.from).lte("date", range.to);
        return q;
      };
      // The ladder the whole app uses for this column: `legacy` predates 0016, and
      // a missing column must not take the query down with it.
      let res = await ask(true);
      if (res.error && isMissingSchema(new DbError("time_entries", res.error.message, res.error.code)))
        res = await ask(false);
      if (res.error || !res.data) {
        noteWriteError("writeDownMemberToKeys read", res.error ?? { message: "no entries found" });
        return false;
      }
      // ⚠️ Recovered history is skipped: its hours were reconstructed from a task
      // title rather than logged, so splitting one says nothing true about a day.
      const rows = (res.data as unknown as { id: string; minutes: number; legacy?: boolean }[]).filter(
        (r) => !r.legacy,
      );
      const available = rows.reduce((n, r) => n + r.minutes, 0);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > available) {
        noteWriteError("writeDownMemberToKeys", {
          message: `that person has ${available} minutes on this task, so ${minutes} cannot be moved`,
        });
        return false;
      }
      let left = minutes;
      for (const r of rows) {
        if (left <= 0) break;
        const take = Math.min(left, r.minutes);
        const ok = await writeDownToKeys(r.id, take, keysTaskId);
        if (!ok) return false;
        left -= take;
      }
      return true;
    },
    [supabase, noteWriteError, writeDownToKeys],
  );

  return useMemo(
    () => ({
      moveTimeEntries,
      writeDownToKeys,
      writeDownMemberToKeys,
    }),
    [
      moveTimeEntries,
      writeDownToKeys,
      writeDownMemberToKeys,
    ],
  );
}
