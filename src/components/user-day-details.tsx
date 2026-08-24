"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { formatFeedDate, formatHours, formatHoursShort, parseDuration } from "@/lib/format";
import { loggableMembers } from "@/lib/members";
import { Avatar, ClientChip, Modal, ModalClose, TaskNameLink } from "./ui";
import { LogTimeForm } from "./log-time-form";
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
        // the row is passed so an entry outside the feed window keeps its undo
        onClick={() => deleteTimeEntry(entry.id, entry)}
        title="Delete this time log"
        className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/**
 * A designer's entries on one day (timesheet cell) — editable per line.
 *
 * The `userId`/`date` props are the STARTING point, not a fixed target: an admin
 * can switch both from the header, which is what makes the Time Feed's generic
 * "Add new hours" button useful (it opens on today/self, and the studio needs to
 * backfill someone else's Tuesday). Members can only ever see their own day, so
 * they get the plain static header.
 */
export function UserDayDetails({
  userId,
  date,
  onClose,
}: {
  userId: string;
  date: string;
  onClose: () => void;
}) {
  const { tasks, clients, profiles, timeEntries, loadDayEntries, currentUserId } = useData();
  const [targetUserId, setTargetUserId] = useState(userId);
  const [targetDate, setTargetDate] = useState(date);
  /**
   * The fetched day, tagged with the person+date it belongs to. Keeping the key
   * WITH the rows means "ready" is derived rather than a second piece of state:
   * when an admin switches person or date, `loaded` is empty until the matching
   * fetch lands, so the previous person's entries can never flash up under a new
   * name — and there's no setState-in-effect to reset a separate flag.
   */
  const [fetched, setFetched] = useState<{ key: string; rows: TimeEntry[] } | null>(null);
  const profile = profiles.find((p) => p.id === targetUserId) ?? null;
  const isAdmin = useIsAdmin();
  const members = useMemo(() => loggableMembers(profiles, currentUserId), [profiles, currentUserId]);

  const dayKey = `${targetUserId}|${targetDate}`;
  const ready = fetched?.key === dayKey;

  useEffect(() => {
    let cancelled = false;
    loadDayEntries(targetUserId, targetDate).then((rows) => {
      if (!cancelled) setFetched({ key: `${targetUserId}|${targetDate}`, rows });
    });
    return () => {
      cancelled = true;
    };
  }, [loadDayEntries, targetUserId, targetDate]);

  const entries = useMemo(() => {
    // only the fetch that matches the currently selected person+day counts
    const rows = fetched?.key === dayKey ? fetched.rows : [];
    const byId = new Map(rows.map((e) => [e.id, e]));
    // the store's copy wins: it reflects edits and adds made since the fetch
    for (const e of timeEntries) {
      if (e.userId === targetUserId && e.date === targetDate && e.minutes > 0) byId.set(e.id, e);
    }
    return [...byId.values()];
  }, [fetched, dayKey, timeEntries, targetUserId, targetDate]);
  const total = entries.reduce((s, e) => s + e.minutes, 0);

  return (
    <Modal onClose={onClose} width="2xl">
      <>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar profile={profile} size={26} />
            {isAdmin ? (
              // Whose day and which day are both editable: an admin opening this
              // from "Add new hours" lands on today/self and almost always needs
              // to change one of them.
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <select
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  title="Whose hours these are"
                  className="rounded-md border border-border bg-surface px-1.5 py-1 text-sm font-medium"
                >
                  {members.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === currentUserId ? "Me" : p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => e.target.value && setTargetDate(e.target.value)}
                  title="The day these hours were worked"
                  className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
                />
                <span className="text-xs text-muted">
                  <span className="font-semibold tabular-nums">{formatHours(total)}</span> logged
                </span>
              </div>
            ) : (
              <div className="min-w-0">
                <h3 className="truncate font-heading text-sm">{profile?.name ?? "Member"}</h3>
                <div className="text-xs text-muted">
                  {formatFeedDate(targetDate)} ·{" "}
                  <span className="font-semibold tabular-nums">{formatHours(total)}</span>
                </div>
              </div>
            )}
          </div>
          <ModalClose onClose={onClose} />
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
                    {task ? (
                      // opening the task closes this popup — see CellDetails
                      <TaskNameLink
                        title={task.title}
                        taskId={task.id}
                        beforeOpen={onClose}
                        className="text-foreground"
                      />
                    ) : (
                      <span className="bidi-auto truncate text-foreground">(deleted task)</span>
                    )}
                  </span>
                }
              />
            );
          })}
        </div>

        {/* person and day come from the header controls above, so the form shows
            neither picker — one control for each, not two */}
        <div className="mt-2 border-t border-border pt-2.5">
          <LogTimeForm userId={targetUserId} date={targetDate} />
        </div>
      </>
    </Modal>
  );
}

