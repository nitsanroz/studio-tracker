"use client";

// One log-time form for the whole app. There were six hand-rolled copies and only
// one of them had the admin "log for someone else" picker, so where an admin could
// backfill a colleague's hours depended on which screen they happened to be on.
//
// The studio's rules live here now, once:
//  · a description is mandatory
//  · the duration accepts 1.5, 1.5h, 1:30 and 90m (parseDuration)
//  · admins get a member picker (themselves as "Me") and a date; members get
//    neither, because they can only ever log for themselves today
//  · after an add the DATE STAYS PUT while duration and description clear —
//    backfilling is usually several entries on one past day

import { useState } from "react";
import { useData, useIsAdmin } from "@/lib/store";
import { loggableMembers } from "@/lib/members";
import { parseDuration, toISODate } from "@/lib/format";
import { TaskAutocomplete } from "./task-autocomplete";
import type { TimeEntry } from "@/lib/types";

export function LogTimeForm({
  taskId: fixedTaskId,
  userId: fixedUserId,
  date: fixedDate,
  layout = "row",
  submitLabel = "Add",
  autoFocus = false,
  onAdded,
}: {
  /** omit to let the user pick a task */
  taskId?: string;
  /** omit to attribute to the signed-in user, or let an admin choose */
  userId?: string;
  /** omit to default to today, or let an admin choose */
  date?: string;
  layout?: "row" | "stacked";
  submitLabel?: string;
  autoFocus?: boolean;
  onAdded?: (entry: TimeEntry | null) => void;
}) {
  const { addTimeEntry, profiles, currentUserId } = useData();
  const isAdmin = useIsAdmin();
  const members = loggableMembers(profiles, currentUserId);

  const [taskId, setTaskId] = useState<string | null>(fixedTaskId ?? null);
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");
  const [forUserId, setForUserId] = useState<string>(fixedUserId ?? currentUserId);
  const [date, setDate] = useState<string>(fixedDate ?? toISODate(new Date()));
  const [busy, setBusy] = useState(false);
  /** bumped after an add, as the autocomplete's `key`, to reset its filled-in title */
  const [pickerNonce, setPickerNonce] = useState(0);

  const minutes = parseDuration(duration);
  const ready = !!taskId && !!minutes && minutes > 0 && description.trim().length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || !taskId || !minutes) return;
    setBusy(true);
    const entry = await addTimeEntry(
      taskId,
      minutes,
      description.trim(),
      fixedDate ?? date,
      fixedUserId ?? forUserId,
    );
    setBusy(false);
    setDuration("");
    setDescription("");
    if (!fixedTaskId) {
      setTaskId(null);
      // the picker holds the chosen title in its own input; remount it so the
      // field doesn't keep naming a task that is no longer selected
      setPickerNonce((n) => n + 1);
    }
    onAdded?.(entry);
  }

  const input = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";
  const stacked = layout === "stacked";

  return (
    <form onSubmit={submit} className={stacked ? "flex flex-col gap-2" : "flex flex-wrap gap-2"}>
      {!fixedTaskId && (
        <div className={stacked ? "" : "min-w-48 flex-1"}>
          <TaskAutocomplete
            key={pickerNonce}
            placeholder="Which task?"
            autoFocus={autoFocus}
            onPickTask={(m) => setTaskId(m.task.id)}
            onQueryEdited={() => setTaskId(null)}
          />
        </div>
      )}
      <div className="flex gap-2">
        <input
          required
          autoFocus={autoFocus && !!fixedTaskId}
          placeholder="1.5h"
          title="1.5, 1.5h, 1:30 and 90m all work"
          className={`w-20 ${input} ${duration && minutes == null ? "border-danger" : ""}`}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
        {/* Admins log for whoever actually did the work, on whatever day they did
            it. Members get neither control — they can only log for themselves. */}
        {isAdmin && !fixedUserId && (
          <select
            value={forUserId}
            onChange={(e) => setForUserId(e.target.value)}
            title="Who these hours are for"
            className={input}
          >
            {members.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === currentUserId ? "Me" : p.name}
              </option>
            ))}
          </select>
        )}
        {isAdmin && !fixedDate && (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || toISODate(new Date()))}
            title="The day these hours were worked"
            className={input}
          />
        )}
      </div>
      <input
        required
        placeholder="What did you do? (required)"
        className={`bidi-auto ${stacked ? "" : "min-w-40 flex-1"} ${input}`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button
        disabled={!ready}
        className={`rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40 ${
          stacked ? "self-end" : ""
        }`}
      >
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
