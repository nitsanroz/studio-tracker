import { parseISO, shiftDays, startOfWeek, toISODate } from "./format";

// My Tasks' groups (2026-11, design-lab round 7, option A "Grouped"): what is
// late, what is due before the week ends, what can wait, and what has no date.

export type TaskBucket = "overdue" | "week" | "later" | "undated";

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  overdue: "Overdue",
  week: "Due this week",
  later: "Later",
  undated: "No due date",
};

export const BUCKET_ORDER: TaskBucket[] = ["overdue", "week", "later", "undated"];

/**
 * Which group a due date falls in, judged against `todayIso`.
 *
 * ⚠️ "This week" runs to SATURDAY, the end of the Israeli week that
 * `startOfWeek` begins on Sunday — a Friday deadline is this week's problem, not
 * "later". Computed with `shiftDays` and compared as ISO strings, never with
 * millisecond arithmetic (see `shiftDays` for the October clocks-back trap).
 */
export function taskBucket(dueIso: string | null, todayIso: string): TaskBucket {
  if (!dueIso) return "undated";
  if (dueIso < todayIso) return "overdue";
  const weekEnd = toISODate(shiftDays(startOfWeek(parseISO(todayIso)), 6));
  return dueIso <= weekEnd ? "week" : "later";
}

/** Tasks split into the non-empty groups, in order, each sorted by due date. */
export function bucketTasks<T extends { dueDate: string | null }>(
  tasks: T[],
  todayIso: string,
): { bucket: TaskBucket; tasks: T[] }[] {
  const by = new Map<TaskBucket, T[]>();
  for (const t of tasks) {
    const b = taskBucket(t.dueDate, todayIso);
    const list = by.get(b);
    if (list) list.push(t);
    else by.set(b, [t]);
  }
  return BUCKET_ORDER.filter((b) => by.has(b)).map((b) => ({
    bucket: b,
    // Stable for equal dates; undated keeps the order it came in.
    tasks: by.get(b)!.sort((a, z) => (a.dueDate ?? "").localeCompare(z.dueDate ?? "")),
  }));
}
