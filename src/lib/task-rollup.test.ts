import { describe, expect, it } from "vitest";
import { rollupTasks, sectionBudgetHours } from "./task-rollup";
import { toISO } from "./gantt";
import type { Section, Task } from "./types";

/** A task with only the fields the rollup reads; everything else is filler. */
function task(p: Partial<Task> & { id: string }): Task {
  return {
    clientId: "c1",
    sectionId: null,
    groupId: null,
    title: p.id,
    brief: "",
    figmaUrl: null,
    status: "todo",
    tag: null,
    typeId: null,
    assigneeId: null,
    dueDate: null,
    startDate: null,
    billable: true,
    estimateHours: null,
    position: 0,
    timelinePosition: null,
    ...p,
  };
}

function section(p: Partial<Section> = {}): Section {
  return { id: "s1", clientId: "c1", name: "Website", position: 1, ...p };
}

/** No minutes anywhere unless a test says otherwise. */
const noMinutes = () => 0;

describe("rollupTasks", () => {
  it("returns the empty shape for no tasks", () => {
    const r = rollupTasks([], noMinutes);
    expect(r.start).toBeNull();
    expect(r.due).toBeNull();
    expect(r.workDays).toBe(0);
    expect(r.doneMinutes).toBe(0);
    expect(r.estimateHours).toBeNull();
    expect(r.taskCount).toBe(0);
    expect(r.datedCount).toBe(0);
  });

  it("spans the earliest start to the latest due", () => {
    // 2026-08-12 is a Wednesday, 2026-08-20 a Thursday.
    const r = rollupTasks(
      [
        task({ id: "a", startDate: "2026-08-12", dueDate: "2026-08-14" }),
        task({ id: "b", startDate: "2026-08-17", dueDate: "2026-08-20" }),
      ],
      noMinutes,
    );
    expect(toISO(r.start!)).toBe("2026-08-12");
    expect(toISO(r.due!)).toBe("2026-08-20");
    expect(r.datedCount).toBe(2);
  });

  it("a task with a due date but no start contributes that one day", () => {
    const r = rollupTasks([task({ id: "a", dueDate: "2026-08-19" })], noMinutes);
    expect(toISO(r.start!)).toBe("2026-08-19");
    expect(toISO(r.due!)).toBe("2026-08-19");
  });

  it("counts undated tasks but never lets them move the span", () => {
    const r = rollupTasks(
      [
        task({ id: "a", startDate: "2026-08-17", dueDate: "2026-08-20" }),
        task({ id: "b" }), // no dates at all
      ],
      noMinutes,
    );
    expect(r.taskCount).toBe(2);
    expect(r.datedCount).toBe(1);
    expect(toISO(r.start!)).toBe("2026-08-17");
    expect(toISO(r.due!)).toBe("2026-08-20");
  });

  it("clamps a start that falls after the due date, rather than running backwards", () => {
    const r = rollupTasks(
      [task({ id: "a", startDate: "2026-08-25", dueDate: "2026-08-20" })],
      noMinutes,
    );
    expect(toISO(r.start!)).toBe("2026-08-20");
    expect(toISO(r.due!)).toBe("2026-08-20");
    expect(r.workDays).toBe(1);
  });

  it("counts working days, excluding the studio's Fri/Sat weekend", () => {
    // Sun 16 Aug 2026 → Thu 20 Aug 2026 is a full studio week: 5 working days.
    const week = rollupTasks(
      [task({ id: "a", startDate: "2026-08-16", dueDate: "2026-08-20" })],
      noMinutes,
    );
    expect(week.workDays).toBe(5);

    // Thu 20 Aug → Sun 23 Aug crosses the weekend: 2 working days, not 4.
    const overWeekend = rollupTasks(
      [task({ id: "a", startDate: "2026-08-20", dueDate: "2026-08-23" })],
      noMinutes,
    );
    expect(overWeekend.workDays).toBe(2);
  });

  it("excludes a studio holiday passed in `off`", () => {
    const off = new Set(["2026-08-18"]); // a Tuesday
    const r = rollupTasks(
      [task({ id: "a", startDate: "2026-08-16", dueDate: "2026-08-20" })],
      noMinutes,
      off,
    );
    expect(r.workDays).toBe(4);
  });

  it("sums logged minutes across its tasks", () => {
    const minutes = (id: string) => (id === "a" ? 90 : id === "b" ? 30 : 0);
    const r = rollupTasks([task({ id: "a" }), task({ id: "b" }), task({ id: "c" })], minutes);
    expect(r.doneMinutes).toBe(120);
  });

  it("counts a task's pre-Everhour remainder EXACTLY ONCE", () => {
    // ⚠️ The double-count this guards: `taskHoursDone` already adds the task's
    // own `legacyHours`, so a rollup must not add it a second time — and the
    // SECTION's own `legacyHours` describes the same work again, which is why
    // it is never summed here (see the note on `rollupTasks`).
    const r = rollupTasks(
      [task({ id: "a", legacyHours: 2 }), task({ id: "b" })],
      (id) => (id === "a" ? 60 : 0),
    );
    expect(r.doneMinutes).toBe(180); // 60 itemised + 2h remainder
  });

  it("sums only the budgets that are set, and stays null when none is", () => {
    expect(rollupTasks([task({ id: "a" }), task({ id: "b" })], noMinutes).estimateHours).toBeNull();
    expect(
      rollupTasks(
        [task({ id: "a", estimateHours: 8 }), task({ id: "b" }), task({ id: "c", estimateHours: 4 })],
        noMinutes,
      ).estimateHours,
    ).toBe(12);
  });

  it("counts completed tasks", () => {
    const r = rollupTasks(
      [task({ id: "a", status: "done" }), task({ id: "b" }), task({ id: "c", status: "done" })],
      noMinutes,
    );
    expect(r.doneCount).toBe(2);
    expect(r.taskCount).toBe(3);
  });
});

describe("sectionBudgetHours", () => {
  it("prefers the section's own recovered budget over the sum of its tasks", () => {
    const rolled = rollupTasks([task({ id: "a", estimateHours: 8 })], noMinutes);
    expect(sectionBudgetHours(section({ estimateHours: 40 }), rolled)).toBe(40);
  });

  it("falls back to the rollup when the section has no budget of its own", () => {
    const rolled = rollupTasks([task({ id: "a", estimateHours: 8 })], noMinutes);
    expect(sectionBudgetHours(section(), rolled)).toBe(8);
    expect(sectionBudgetHours(section({ estimateHours: null }), rolled)).toBe(8);
  });

  it("a group (no section) is always the sum of its tasks", () => {
    const rolled = rollupTasks([task({ id: "a", estimateHours: 3 })], noMinutes);
    expect(sectionBudgetHours(null, rolled)).toBe(3);
  });
});
