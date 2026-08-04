import type { Task } from "./types";

/**
 * A task's real logged minutes: its time entries PLUS the pre-Everhour remainder
 * that never became entries (`legacy_hours` — hours the old Asana title recorded
 * but that couldn't be pinned to a person and a day).
 *
 * One helper because three surfaces show this number — the client table, the My
 * Tasks table and the task pane — and they had drifted: the pane counted only
 * itemised entries, so the same task read 12h there and 165h in the table.
 *
 * Anything that aggregates BY MONTH or BY PERSON must use the entries alone, not
 * this: the remainder has neither a date nor an author.
 */
export function taskHoursDone(task: Task, taskMinutes: (id: string) => number): number {
  return taskMinutes(task.id) + (task.legacyHours ?? 0) * 60;
}

/** The part of `taskHoursDone` that isn't itemised, so the UI can explain it. */
export function taskLegacyMinutes(task: Task): number {
  return (task.legacyHours ?? 0) * 60;
}
