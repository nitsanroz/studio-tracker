"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useData } from "@/lib/store";
import { formatFeedDate, formatHours, formatHoursShort, parseDuration } from "@/lib/format";
import { Avatar, ClientChip } from "./ui";
import { TaskAutocomplete, type TaskMatch } from "./task-autocomplete";
import type { TimeEntry } from "@/lib/types";

// Extracted from the Time Feed page so the admin home's week timesheet opens
// the SAME popup — two copies would drift, and this one already carries the
// mandatory-description rule and the admin-logs-for-someone-else path.

/** One editable time-entry line: hours, date, description, delete. */
export function EntryEditRow({
  entry,
  leading,
}: {
  entry: TimeEntry;
  leading?: React.ReactNode;
}) {
  const { profiles, updateTimeEntry, deleteTimeEntry } = useData();
  const [duration, setDuration] = useState(formatHoursShort(entry.minutes));
  const [description, setDescription] = useState(entry.description);
  const [date, setDate] = useState(entry.date);
  const user = profiles.find((p) => p.id === entry.userId) ?? null;

  const minutes = parseDuration(duration);
  const dirty =
    (minutes != null && minutes !== entry.minutes) ||
    description !== entry.description ||
    (!!date && date !== entry.date);

  function save() {
    if (minutes == null || minutes <= 0 || !date) return;
    updateTimeEntry(entry.id, { minutes, description, date });
  }

  return (
    <div className="group flex items-center gap-2 border-b border-border py-2 last:border-b-0">
      {leading ?? <Avatar profile={user} size={24} />}
      <input
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        className={`w-16 rounded-md border bg-surface px-1.5 py-1 text-sm tabular-nums outline-none focus:border-brand ${
          duration && minutes == null ? "border-danger" : "border-border"
        }`}
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-brand"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && dirty && save()}
        placeholder="Description"
        className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand"
      />
      {dirty && (
        <button
          onClick={save}
          disabled={minutes == null || minutes <= 0 || !date}
          className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
        >
          Save
        </button>
      )}
      <button
        onClick={() => deleteTimeEntry(entry.id)}
        title="Delete this time log"
        className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/** A designer's entries on one day (timesheet cell) — editable per line. */
export function UserDayDetails({
  userId,
  date,
  onClose,
}: {
  userId: string;
  date: string;
  onClose: () => void;
}) {
  const { tasks, clients, profiles, timeEntries, addTimeEntry, loadDayEntries } = useData();
  const [loaded, setLoaded] = useState<TimeEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [adding, setAdding] = useState(true); // open the add form immediately
  const [picked, setPicked] = useState<TaskMatch | null>(null);
  const [addDuration, setAddDuration] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const profile = profiles.find((p) => p.id === userId) ?? null;

  useEffect(() => {
    let cancelled = false;
    loadDayEntries(userId, date).then((rows) => {
      if (cancelled) return;
      setLoaded(rows);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loadDayEntries, userId, date]);

  const entries = useMemo(() => {
    const byId = new Map(loaded.map((e) => [e.id, e]));
    for (const e of timeEntries) {
      if (e.userId === userId && e.date === date && e.minutes > 0) byId.set(e.id, e);
    }
    return [...byId.values()];
  }, [loaded, timeEntries, userId, date]);
  const total = entries.reduce((s, e) => s + e.minutes, 0);

  const addMinutes = parseDuration(addDuration);
  const canAdd = picked && addMinutes != null && addMinutes > 0 && addDescription.trim().length > 0;

  function submitAdd() {
    if (!canAdd || !picked || addMinutes == null) return;
    addTimeEntry(picked.task.id, addMinutes, addDescription.trim(), date, userId);
    setPicked(null);
    setAddDuration("");
    setAddDescription("");
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-1/3 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar profile={profile} size={26} />
            <div className="min-w-0">
              <h3 className="truncate font-heading text-sm">{profile?.name ?? "Member"}</h3>
              <div className="text-xs text-muted">
                {formatFeedDate(date)} ·{" "}
                <span className="font-semibold tabular-nums">{formatHours(total)}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md px-1.5 text-muted hover:bg-background">
            <X size={16} />
          </button>
        </div>
        <div className="mt-2 flex max-h-96 flex-col overflow-y-auto">
          {!ready && <p className="py-3 text-center text-sm text-faint">Loading…</p>}
          {ready && entries.length === 0 && (
            <p className="py-3 text-center text-sm text-faint">No hours on this day.</p>
          )}
          {entries.map((e) => {
            const task = tasks.find((t) => t.id === e.taskId);
            const client = clients.find((c) => c.id === task?.clientId);
            return (
              <EntryEditRow
                key={e.id}
                entry={e}
                leading={
                  // client on its own line — a bare task title ("Homepage") reads
                  // the same for half the studio's clients
                  <span
                    className="flex w-48 shrink-0 flex-col gap-0.5 text-xs text-muted"
                    title={client ? `${client.name} · ${task?.title ?? ""}` : task?.title}
                  >
                    {client && (
                      <span className="min-w-0 truncate">
                        <ClientChip client={client} size="sm" />
                      </span>
                    )}
                    <span className="bidi-auto truncate text-foreground">
                      {task?.title ?? "(deleted task)"}
                    </span>
                  </span>
                }
              />
            );
          })}
        </div>

        <div className="mt-2 border-t border-border pt-2.5">
          {adding ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  value={addDuration}
                  onChange={(e) => setAddDuration(e.target.value)}
                  placeholder="1.5h"
                  className={`w-16 shrink-0 rounded-md border bg-surface px-1.5 py-1.5 text-sm outline-none focus:border-brand ${
                    addDuration && addMinutes == null ? "border-danger" : "border-border"
                  }`}
                />
                {picked ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                    {picked.client && <ClientChip client={picked.client} size="sm" link={false} />}
                    <span className="bidi-auto min-w-0 flex-1 truncate font-medium">
                      {picked.task.title}
                    </span>
                    <button
                      onClick={() => setPicked(null)}
                      className="shrink-0 text-muted hover:text-foreground"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <TaskAutocomplete placeholder="Search a task…" onPickTask={setPicked} />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={addDescription}
                  onChange={(e) => setAddDescription(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitAdd()}
                  placeholder="What was done? (required)"
                  className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
                />
                <button
                  disabled={!canAdd}
                  onClick={submitAdd}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted hover:text-brand"
              title="Log a new time entry on this day"
            >
              <Plus size={13} /> Add hours to this day
            </button>
          )}
        </div>
      </div>
    </>
  );
}
