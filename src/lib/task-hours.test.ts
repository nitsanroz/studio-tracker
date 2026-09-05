import { describe, expect, it } from "vitest";
import { taskLegacyMinutes, taskMinutesDone } from "./task-hours";
import type { Task } from "./types";

// This helper exists because three surfaces had drifted: the task pane counted
// only itemised entries while the client table added the pre-Everhour remainder,
// so one task read 12h in one place and 165h in another. These cases pin the
// definition so they cannot drift apart again.

const task = (over: Partial<Task> = {}): Task =>
  ({ id: "t1", title: "Homepage", clientId: "c1", legacyHours: null, ...over }) as Task;

/** Stand-in for the store's `taskMinutes(id)`. */
const minutes = (map: Record<string, number>) => (id: string) => map[id] ?? 0;

describe("taskMinutesDone", () => {
  it("adds the undated remainder to the itemised entries", () => {
    // "Ui system - 165hrs" with comments totalling 8h: 157h had no day at all
    // and lives in legacy_hours, but the task really did take 165h.
    const t = task({ id: "t1", legacyHours: 157 });
    expect(taskMinutesDone(t, minutes({ t1: 8 * 60 }))).toBe(165 * 60);
  });

  it("is just the entries when there is no remainder", () => {
    expect(taskMinutesDone(task({ id: "t1" }), minutes({ t1: 90 }))).toBe(90);
  });

  it("is just the remainder when nothing was itemised", () => {
    expect(taskMinutesDone(task({ id: "t1", legacyHours: 12 }), minutes({}))).toBe(720);
  });

  it("treats a null remainder as zero, not NaN", () => {
    expect(taskMinutesDone(task({ id: "t1", legacyHours: null }), minutes({ t1: 60 }))).toBe(60);
  });

  it("is zero for a task with neither", () => {
    expect(taskMinutesDone(task({ id: "t1" }), minutes({}))).toBe(0);
  });

  it("converts fractional remainder hours to whole minutes", () => {
    // Recovered titles carry quarter hours — 0.25h must not round to nothing.
    expect(taskMinutesDone(task({ id: "t1", legacyHours: 0.25 }), minutes({}))).toBe(15);
    expect(taskMinutesDone(task({ id: "t1", legacyHours: 1.75 }), minutes({}))).toBe(105);
  });

  it("survives a negative remainder", () => {
    // Inbal Kim Doron's מפתח reductions net to −83h across the recovery; the
    // arithmetic must not special-case them away.
    expect(taskMinutesDone(task({ id: "t1", legacyHours: -2 }), minutes({ t1: 180 }))).toBe(60);
  });

  it("looks the task up by its own id", () => {
    const t = task({ id: "t2" });
    expect(taskMinutesDone(t, minutes({ t1: 999, t2: 30 }))).toBe(30);
  });
});

describe("taskLegacyMinutes", () => {
  it("reports only the part that isn't itemised", () => {
    expect(taskLegacyMinutes(task({ legacyHours: 157 }))).toBe(157 * 60);
    expect(taskLegacyMinutes(task({ legacyHours: null }))).toBe(0);
  });

  it("is the difference between the total and the entries", () => {
    // The invariant the UI leans on when it explains a total:
    //   taskMinutesDone === entries + taskLegacyMinutes
    const t = task({ id: "t1", legacyHours: 10 });
    const entries = 45;
    expect(taskMinutesDone(t, minutes({ t1: entries }))).toBe(entries + taskLegacyMinutes(t));
  });
});
