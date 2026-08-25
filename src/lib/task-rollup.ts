// What a container of tasks adds up to — the figures a section header or a group
// row shows when summaries are on: the span its work covers, how long that is in
// working days, the hours logged against it and the budget agreed for it.
//
// ONE helper because four surfaces show these numbers — the client Task list's
// section header and group row, and the Timeline's — and they must agree. The
// Timeline already computed half of it inline (a min/max over the group's rows)
// and that is now this function's `start`/`due`.

import { parseISO, workDaysBetween } from "./gantt";
import { taskMinutesDone } from "./task-hours";
import type { Section, Task } from "./types";

export interface Rollup {
  /** Earliest start, falling back to a task's due date when it has no start. */
  start: Date | null;
  /** Latest due date. Null together with `start` when nothing is dated. */
  due: Date | null;
  /** Working days from `start` to `due` — Fri/Sat and studio holidays excluded. */
  workDays: number;
  /** Σ of every task's real hours, INCLUDING each one's pre-Everhour remainder. */
  doneMinutes: number;
  /** Σ of the budgets that are set. Null when not one task carries a budget. */
  estimateHours: number | null;
  taskCount: number;
  doneCount: number;
  /** How many tasks are dated at all — `start`/`due` describe only these. */
  datedCount: number;
}

const EMPTY: Rollup = {
  start: null,
  due: null,
  workDays: 0,
  doneMinutes: 0,
  estimateHours: null,
  taskCount: 0,
  doneCount: 0,
  datedCount: 0,
};

/**
 * Roll a set of tasks up into the figures a container shows.
 *
 * `off` is the studio's non-working day set (weekends + `plan_day_states`), the
 * same one the Timeline draws its shading from — pass it so "12 working days"
 * means the same thing here as it does on a bar's tooltip.
 *
 * ⚠️ **`taskMinutesDone` already folds in each task's own `legacyHours`** — the
 * pre-Everhour hours an old Asana title recorded but that could never be pinned
 * to a person and a day. Never add `Section.legacyHours` on top of this: that is
 * a SECTION-level display figure recovered from the old section name, describing
 * the same work, and adding it counts those hours twice. The section header
 * renders it separately, which is the honest way to show it.
 */
export function rollupTasks(
  tasks: Task[],
  taskMinutes: (taskId: string) => number,
  off: Set<string> = new Set(),
): Rollup {
  if (tasks.length === 0) return EMPTY;

  let start: Date | null = null;
  let due: Date | null = null;
  let doneMinutes = 0;
  let estimate = 0;
  let hasEstimate = false;
  let doneCount = 0;
  let datedCount = 0;

  for (const t of tasks) {
    doneMinutes += taskMinutesDone(t, taskMinutes);
    if (t.estimateHours != null) {
      estimate += t.estimateHours;
      hasEstimate = true;
    }
    if (t.status === "done") doneCount++;

    // A task with no due date has no place on the span at all — a group whose
    // one dated task ends on the 20th spans to the 20th, and the undated ones
    // neither extend nor shrink that.
    if (!t.dueDate) continue;
    datedCount++;
    const d = parseISO(t.dueDate);
    // A start after the due date would run the span backwards. Clamp, exactly as
    // the Timeline clamps a single bar, rather than dropping the task.
    const s = t.startDate ? min(parseISO(t.startDate), d) : d;
    if (!start || s < start) start = s;
    if (!due || d > due) due = d;
  }

  return {
    start,
    due,
    workDays: start && due ? workDaysBetween(start, due, off) : 0,
    doneMinutes,
    estimateHours: hasEstimate ? estimate : null,
    taskCount: tasks.length,
    doneCount,
    datedCount,
  };
}

/**
 * A section's budget: its own recovered figure when it has one, the rollup
 * otherwise.
 *
 * `sections.estimate_hours` was parsed out of the old Asana section name by the
 * pre-Everhour recovery (0016) and is a real budget the studio quoted, so where
 * it exists it beats a sum over tasks whose individual budgets were never filled
 * in. `types.ts` has always documented this fallback; this is where it lives.
 *
 * Groups have no equivalent field — theirs is always the sum of their tasks.
 */
export function sectionBudgetHours(section: Section | null, rolled: Rollup): number | null {
  return section?.estimateHours ?? rolled.estimateHours;
}

function min(a: Date, b: Date): Date {
  return a < b ? a : b;
}
