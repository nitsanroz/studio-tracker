"use client";

// Add or edit one time entry, in a popup. Before this the task pane could only
// APPEND hours — there was no way to fix a typo'd figure or delete a wrong entry
// without going to the Time Feed and finding it again.

import { useState } from "react";
import { useData, useIsAdmin } from "@/lib/store";
import { loggableMembers } from "@/lib/members";
import { formatHoursShort, parseDuration } from "@/lib/format";
import { Modal, ModalClose } from "./ui";
import { LogTimeForm } from "./log-time-form";
import type { TimeEntry } from "@/lib/types";

/** Who may change an entry at all. Also re-asserted inside, never trusted from the caller. */
export function canEditEntry(
  entry: TimeEntry,
  isAdmin: boolean,
  currentUserId: string,
): boolean {
  // legacy rows are recovered history, not somebody's logged time — see below
  return !!entry.id && !entry.legacy && (isAdmin || entry.userId === currentUserId);
}

export function TimeEntryModal({
  taskId,
  entry,
  layer = "raised",
  onSaved,
  onDeleted,
  onClose,
}: {
  taskId: string;
  /** an entry to edit, or null to add a new one */
  entry: TimeEntry | null;
  layer?: "base" | "raised";
  /** For callers holding their own copy of the row (the reports page's period list). */
  onSaved?: (patch: { minutes: number; description: string; date: string; userId?: string }) => void;
  onDeleted?: () => void;
  onClose: () => void;
}) {
  const { profiles, currentUserId, updateTimeEntry, deleteTimeEntry } = useData();
  const isAdmin = useIsAdmin();
  const members = loggableMembers(profiles, currentUserId);

  const [duration, setDuration] = useState(entry ? formatHoursShort(entry.minutes) : "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [date, setDate] = useState(entry?.date ?? "");
  const [userId, setUserId] = useState(entry?.userId ?? currentUserId);

  if (!entry) {
    return (
      <Modal onClose={onClose} width="md" layer={layer}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-heading text-sm">Log time</h3>
          <ModalClose onClose={onClose} />
        </div>
        <LogTimeForm taskId={taskId} layout="stacked" autoFocus onAdded={onClose} />
      </Modal>
    );
  }

  const editable = canEditEntry(entry, isAdmin, currentUserId);
  const minutes = parseDuration(duration);
  const ready = editable && !!minutes && minutes > 0 && description.trim().length > 0;
  const input = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

  function save() {
    if (!ready || !minutes) return;
    const patch = {
      minutes,
      description: description.trim(),
      date,
      // Admins only. RLS refuses it for members anyway: `own time update`'s USING
      // clause constrains user_id itself, and Postgres reuses it as the check on
      // the new row — so the database, not just this form, is the boundary.
      ...(isAdmin && userId !== entry!.userId ? { userId } : {}),
    };
    updateTimeEntry(entry!.id, patch);
    onSaved?.(patch);
    onClose();
  }

  function remove() {
    if (!confirm("Delete this time entry? Its hours come off the task total.")) return;
    deleteTimeEntry(entry!.id);
    onDeleted?.();
    onClose();
  }

  return (
    <Modal onClose={onClose} width="md" layer={layer}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-heading text-sm">{editable ? "Edit time entry" : "Time entry"}</h3>
        <ModalClose onClose={onClose} />
      </div>

      {!editable && (
        <p className="mb-3 rounded-lg bg-background px-3 py-2 text-xs text-muted">
          {entry.legacy
            ? "Recovered pre-Everhour history — read-only, and deliberately so: its hours and often its date were reconstructed, not logged here."
            : "Only the person who logged these hours, or an admin, can change them."}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-20 shrink-0 text-muted">Hours</span>
          <input
            autoFocus
            disabled={!editable}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="1.5h"
            title="1.5, 1.5h, 1:30 and 90m all work"
            className={`w-24 ${input} ${duration && minutes == null ? "border-danger" : ""} disabled:opacity-60`}
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-20 shrink-0 text-muted">Date</span>
          <input
            type="date"
            disabled={!editable}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className={`${input} disabled:opacity-60`}
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-20 shrink-0 text-muted">Member</span>
          {isAdmin && editable ? (
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={input}>
              {members.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === currentUserId ? "Me" : p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="px-1 py-1.5">
              {profiles.find((p) => p.id === entry.userId)?.name ??
                entry.legacyAuthorName ??
                "Not recorded"}
            </span>
          )}
        </label>
        <label className="flex items-start gap-3 text-sm">
          <span className="w-20 shrink-0 pt-2 text-muted">Note</span>
          <input
            disabled={!editable}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you do? (required)"
            className={`bidi-auto min-w-0 flex-1 ${input} disabled:opacity-60`}
          />
        </label>
      </div>

      {editable && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={remove}
            className="rounded-md px-2 py-1.5 text-sm font-medium text-danger hover:bg-red-50"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-background"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!ready}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
