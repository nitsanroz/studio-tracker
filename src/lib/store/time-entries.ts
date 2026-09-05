"use client";

// Logging, editing and deleting time.
//
// ⚠️ EVERY WRITE HERE IS BILLABLE DATA. A client report is built from these rows,
// so an optimistic update that silently diverges from the DB is a wrong invoice,
// not a cosmetic glitch — which is why each one routes its failure through
// `noteWriteError` rather than swallowing it.
//
// The Keys write-down — the one path that REDUCES what a client is charged —
// lives in ./keys-write-down.ts, deliberately apart from ordinary logging.
//
// See ./plan.ts for why deps arrive as an object and the result is memoized.

import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTimeEntry, type DbRow } from "../db";
import { toISODate } from "../format";
import type { HistoryAction, Store, TimeEntryPatch } from "./types";
import type { EntrySum, TimeEntry } from "../types";

export interface TimeEntryDeps {
  supabase: SupabaseClient;
  timeEntries: TimeEntry[];
  setTimeEntries: Dispatch<SetStateAction<TimeEntry[]>>;
  entrySumsAll: EntrySum[];
  setEntrySums: Dispatch<SetStateAction<EntrySum[]>>;
  currentUserId: string | null;
  markFresh: (id: string) => void;
  record: (action: Omit<HistoryAction, "epoch">) => void;
  wrote: (label: string) => (res: { error: { message: string } | null }) => void;
  noteWriteError: (label: string, error: { message: string }) => void;
  counting: <T>(query: PromiseLike<T>) => Promise<T>;
  methodsRef: RefObject<Store | null>;
}

export function useTimeEntryActions(deps: TimeEntryDeps) {
  const {
    supabase,
    timeEntries,
    setTimeEntries,
    entrySumsAll,
    setEntrySums,
    currentUserId,
    markFresh,
    record,
    wrote,
    noteWriteError,
    counting,
    methodsRef,
  } = deps;


  const applyEntryLocally = useCallback((entry: TimeEntry) => {
    setTimeEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
    setEntrySums((prev) => [
      {
        id: entry.id,
        taskId: entry.taskId,
        userId: entry.userId,
        date: entry.date,
        minutes: entry.minutes,
        legacy: entry.legacy,
        dateEstimated: entry.dateEstimated,
      },
      ...prev.filter((e) => e.id !== entry.id),
    ]);
  }, [setEntrySums, setTimeEntries]);

  /**
   * Re-insert a deleted time entry with its original id (undo support).
   *
   * It MUST carry `legacy` and its companions. This used to write only
   * id/task/user/date/minutes/description, so undoing the deletion of a recovered
   * pre-Everhour entry brought it back as an ORDINARY one — and its hours then
   * leaked into days-worked, tenure, "my hours" and the feed timesheet, which is
   * exactly what the flag exists to prevent.
   */
  const restoreTimeEntry = useCallback(
    (entry: TimeEntry) => {
      applyEntryLocally(entry);
      supabase
        .from("time_entries")
        .insert({
          id: entry.id,
          task_id: entry.taskId,
          user_id: entry.userId,
          date: entry.date,
          minutes: entry.minutes,
          description: entry.description,
          legacy: entry.legacy ?? false,
          date_estimated: entry.dateEstimated ?? false,
          legacy_author_name: entry.legacyAuthorName ?? null,
          moved_from_task_id: entry.movedFromTaskId,
        })
        .then(wrote("restoreTimeEntry"));
    },
    [supabase, applyEntryLocally, wrote],
  );

  /** Resolves to the inserted entry, so a caller can edit it without a reload. */
  const addTimeEntry = useCallback(
    async (
      taskId: string,
      minutes: number,
      description: string,
      date?: string,
      userId?: string,
    ): Promise<TimeEntry | null> => {
      const { data, error } = await counting(
        supabase
          .from("time_entries")
          .insert({
            task_id: taskId,
            // admins may log hours for another member (e.g. from the timesheet day popup)
            user_id: userId ?? currentUserId,
            date: date ?? toISODate(new Date()),
            minutes,
            description,
          })
          .select()
          .single(),
      );
      if (error) {
        noteWriteError("addTimeEntry", error);
        return null;
      }
      const entry = mapTimeEntry(data);
      applyEntryLocally(entry);
      markFresh(entry.id);
      record({
        undo: () => methodsRef.current?.deleteTimeEntry(entry.id),
        redo: () => restoreTimeEntry(entry),
      });
      return entry;
    },
    [supabase, currentUserId, applyEntryLocally, record, restoreTimeEntry, noteWriteError, counting, markFresh, methodsRef],
  );

  /**
   * One member's entries for one day, straight from the DB.
   *
   * The store's `timeEntries` is only the most recent 400 rows studio-wide, so
   * it cannot answer "what did I log on 3 March" — hence a real query. It lives
   * here rather than in the component so the Supabase client and the row
   * mappers stay behind one boundary; "Log my hours" used to open its own
   * client and call mapTimeEntry itself.
   */
  const loadDayEntries = useCallback(
    async (userId: string, dateIso: string): Promise<TimeEntry[]> => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("user_id", userId)
        .eq("date", dateIso)
        .not("minutes", "is", null)
        .order("created_at");
      if (error) {
        console.error("loadDayEntries failed", error.message);
        return [];
      }
      return (data ?? []).map(mapTimeEntry);
    },
    [supabase],
  );

  /**
   * The individual log rows behind ONE hours cell of the client report.
   *
   * ⚠️⚠️ A NARROW SELECT AND A DATE WINDOW, BOTH DELIBERATE. `timeEntries` in this
   * store is only the newest 400 rows studio-wide, so the descriptions behind a
   * week column from March are simply not in memory — and `loadTaskExtras` would
   * fetch that task's comments, attachments, brief and EVERY entry it has, to show
   * five rows. Egress is this project's tightest constraint (see the v1.31.0 note),
   * and this fires on HOVER, so it asks for the five columns it renders and only
   * the dates on screen.
   *
   * ⚠️ Returned, not merged into state: nothing else needs these rows, and merging
   * would race the background refresh for no benefit. The caller caches per cell.
   */
  const loadCellEntries = useCallback(
    async (taskId: string, from: string, to: string): Promise<TimeEntry[]> => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("id, task_id, user_id, legacy_author_name, date, minutes, description")
        .eq("task_id", taskId)
        .gte("date", from)
        .lte("date", to)
        .not("minutes", "is", null)
        .order("date");
      if (error) {
        console.error("loadCellEntries failed", error.message);
        return [];
      }
      return (data ?? []).map(mapTimeEntry);
    },
    [supabase],
  );

  const updateTimeEntry = useCallback(
    (entryId: string, patch: TimeEntryPatch) => {
      // full row if loaded; the slim sums row covers minutes/date-only patches
      const before =
        timeEntries.find((e) => e.id === entryId) ??
        ("description" in patch ? undefined : entrySumsAll.find((e) => e.id === entryId));
      if (before) {
        const prev: TimeEntryPatch = {};
        if ("minutes" in patch) prev.minutes = before.minutes;
        if ("date" in patch) prev.date = before.date;
        if ("description" in patch) prev.description = (before as TimeEntry).description;
        // without this an undo would leave the reassignment in place
        if ("userId" in patch) prev.userId = before.userId ?? undefined;
        record({
          undo: () => methodsRef.current?.updateTimeEntry(entryId, prev),
          redo: () => methodsRef.current?.updateTimeEntry(entryId, patch),
        });
      }
      setTimeEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));
      if (patch.minutes != null || patch.date != null || patch.userId != null) {
        // entrySums is the per-person source behind days-worked, tenure, the week
        // timesheet and "avg / designer", so a reassignment has to reach it too
        setEntrySums((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  ...(patch.minutes != null && { minutes: patch.minutes }),
                  ...(patch.date != null && { date: patch.date }),
                  ...(patch.userId != null && { userId: patch.userId }),
                }
              : e,
          ),
        );
      }
      // Built explicitly: this used to pass `patch` straight to .update() and got
      // away with it only because minutes/description/date are spelled the same
      // in camelCase and snake_case. `userId` is not.
      const row: DbRow = {};
      if ("minutes" in patch) row.minutes = patch.minutes;
      if ("description" in patch) row.description = patch.description;
      if ("date" in patch) row.date = patch.date;
      if ("userId" in patch) row.user_id = patch.userId;
      supabase
        .from("time_entries")
        .update(row)
        .eq("id", entryId)
        .then(wrote("updateTimeEntry"));
    },
    [supabase, timeEntries, entrySumsAll, record, wrote, methodsRef, setEntrySums, setTimeEntries],
  );

  const deleteTimeEntry = useCallback(
    (entryId: string, known?: TimeEntry) => {
      /**
       * ⚠️ AN UNDO IS ONLY OFFERED WHEN THE WHOLE ROW IS IN HAND.
       *
       * This used to fall back to the slim `entrySumsAll` row with
       * `description: ""` and `movedFromTaskId: null` hardcoded — and
       * `restoreTimeEntry` faithfully writes back whatever it is given, so ⌘Z
       * put the entry back with its description ERASED, in an app where a
       * description is mandatory on every entry. The typed text was gone from
       * the database with nothing said.
       *
       * `timeEntries` holds only the newest 400 rows plus whatever `openTask`
       * loaded, while the three day surfaces render from `loadDayEntries`, which
       * returns its rows to the caller WITHOUT merging them into store state —
       * so deleting an entry older than the feed window hit that path every
       * time. Those callers pass the row they already hold as `known`; when
       * neither is available the delete still happens and no undo is recorded,
       * because no undo is better than one that silently rewrites the entry.
       */
      const before = timeEntries.find((e) => e.id === entryId) ?? known;
      if (before) {
        record({
          undo: () => restoreTimeEntry(before),
          redo: () => methodsRef.current?.deleteTimeEntry(entryId, before),
        });
      }
      setTimeEntries((prev) => prev.filter((e) => e.id !== entryId));
      setEntrySums((prev) => prev.filter((e) => e.id !== entryId));
      supabase
        .from("time_entries")
        .delete()
        .eq("id", entryId)
        .then(wrote("deleteTimeEntry"));
    },
    [supabase, timeEntries, record, restoreTimeEntry, wrote, methodsRef, setEntrySums, setTimeEntries],
  );

  return useMemo(
    () => ({
      applyEntryLocally,
      restoreTimeEntry,
      addTimeEntry,
      loadDayEntries,
      loadCellEntries,
      updateTimeEntry,
      deleteTimeEntry,
    }),
    [
      applyEntryLocally,
      restoreTimeEntry,
      addTimeEntry,
      loadDayEntries,
      loadCellEntries,
      updateTimeEntry,
      deleteTimeEntry,
    ],
  );
}
