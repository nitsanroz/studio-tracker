import { describe, expect, it } from "vitest";
import { planDuplicate } from "./duplicate";
import type { Link, Section, Task, TaskGroup } from "./types";

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  clientId: "c1",
  sectionId: "s1",
  groupId: null,
  title: id,
  brief: `brief ${id}`,
  figmaUrl: null,
  status: "done",
  tag: "Approved",
  typeId: "type1",
  assigneeId: "u1",
  dueDate: "2026-10-20",
  startDate: "2026-10-18",
  billable: true,
  estimateHours: 4,
  position: 1,
  timelinePosition: 3,
  legacyHours: 2,
  ...over,
});

const sections: Section[] = [
  { id: "s1", clientId: "c1", name: "Phase 1", position: 1 },
  { id: "s2", clientId: "c1", name: "Phase 2", position: 2 },
];
const taskGroups: TaskGroup[] = [
  { id: "g1", clientId: "c1", sectionId: "s1", name: "Home", position: 1 },
  { id: "g2", clientId: "c1", sectionId: "s1", name: "About", position: 2 },
];
const tasks: Task[] = [
  task("a", { position: 1 }),
  task("b", { position: 2 }),
  task("c", { position: 3 }),
  task("h1", { groupId: "g1", position: 1 }),
  task("h2", { groupId: "g1", position: 2 }),
  task("x", { sectionId: "s2", position: 1 }),
];
const links: Link[] = [
  { id: "l1", taskId: "b", clientId: null, title: "Doc", url: "https://x", position: 1 },
];
const state = { sections, taskGroups, tasks, links };

/** Deterministic ids: n1, n2, … */
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe("planDuplicate — tasks", () => {
  it("places each copy right after its original and shifts the rest down", () => {
    const plan = planDuplicate({ taskIds: ["b"] }, state, ids());
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({ title: "b", sectionId: "s1", groupId: null, position: 3 });
    expect(plan.moves.tasks).toEqual([{ id: "c", position: 4 }]);
  });

  it("copies the work but not its progress or Timeline placement", () => {
    const [copy] = planDuplicate({ taskIds: ["a"] }, state, ids()).tasks;
    expect(copy).toMatchObject({
      brief: "brief a",
      typeId: "type1",
      assigneeId: "u1",
      dueDate: "2026-10-20",
      startDate: "2026-10-18",
      estimateHours: 4,
      billable: true,
      status: "todo",
      tag: null,
      timelinePosition: null,
    });
    expect(copy).not.toHaveProperty("legacyHours");
  });

  it("brings the task's links along", () => {
    const plan = planDuplicate({ taskIds: ["b"] }, state, ids());
    expect(plan.links).toEqual([
      { id: "n2", taskId: plan.tasks[0].id, title: "Doc", url: "https://x", position: 1 },
    ]);
  });

  it("interleaves several copies in one container", () => {
    const plan = planDuplicate({ taskIds: ["a", "c"] }, state, ids());
    const pos = Object.fromEntries(plan.tasks.map((t) => [t.title, t.position]));
    expect(pos).toEqual({ a: 2, c: 5 });
    expect(plan.moves.tasks).toEqual([
      { id: "b", position: 3 },
      { id: "c", position: 4 },
    ]);
  });

  it("densifies a container that is all zeros", () => {
    const zeros = tasks.map((t) => (t.sectionId === "s1" && !t.groupId ? { ...t, position: 0 } : t));
    const plan = planDuplicate({ taskIds: ["a"] }, { ...state, tasks: zeros }, ids());
    expect(plan.tasks[0].position).toBeGreaterThan(0);
    expect(new Set([plan.tasks[0].position, ...plan.moves.tasks.map((m) => m.position)]).size).toBe(
      plan.moves.tasks.length + 1,
    );
  });
});

describe("planDuplicate — groups and sections", () => {
  it("keeps every name as it was — no \"(copy)\" suffix", () => {
    const plan = planDuplicate({ sectionIds: ["s1"], groupIds: [], taskIds: ["x"] }, state, ids());
    const names = [...plan.sections.map((s) => s.name), ...plan.groups.map((g) => g.name), ...plan.tasks.map((t) => t.title)];
    expect(names.some((n) => n.includes("copy"))).toBe(false);
  });

  it("a ticked group plus a loose task copies the group whole and the task beside it", () => {
    const plan = planDuplicate({ groupIds: ["g1"], taskIds: ["h1", "h2", "a"] }, state, ids());
    expect(plan.groups).toHaveLength(1);
    const g = plan.groups[0].id;
    expect(plan.tasks.filter((t) => t.groupId === g).map((t) => t.title)).toEqual(["h1", "h2"]);
    expect(plan.tasks.filter((t) => t.groupId === null).map((t) => t.title)).toEqual(["a"]);
  });

  it("a group copy carries its tasks", () => {
    const plan = planDuplicate({ groupIds: ["g1"] }, state, ids());
    expect(plan.groups).toEqual([
      { id: "n1", clientId: "c1", sectionId: "s1", name: "Home", position: 2 },
    ]);
    expect(plan.moves.groups).toEqual([{ id: "g2", position: 3 }]);
    expect(plan.tasks.map((t) => [t.title, t.groupId, t.position])).toEqual([
      ["h1", "n1", 1],
      ["h2", "n1", 2],
    ]);
  });

  it("a section copy carries its groups and every task, wired to the new rows", () => {
    const plan = planDuplicate({ sectionIds: ["s1"] }, state, ids());
    expect(plan.sections).toEqual([{ id: "n1", clientId: "c1", name: "Phase 1", position: 2 }]);
    expect(plan.moves.sections).toEqual([{ id: "s2", position: 3 }]);
    expect(plan.groups.map((g) => [g.name, g.sectionId])).toEqual([
      ["Home", "n1"],
      ["About", "n1"],
    ]);
    const home = plan.groups[0].id;
    expect(plan.tasks.every((t) => t.sectionId === "n1")).toBe(true);
    expect(plan.tasks.filter((t) => t.groupId === home).map((t) => t.title)).toEqual(["h1", "h2"]);
    expect(plan.tasks.filter((t) => t.groupId === null).map((t) => t.title)).toEqual(["a", "b", "c"]);
    expect(plan.links).toHaveLength(1);
  });

  it("does not copy a picked task or group twice when its section is picked too", () => {
    const plan = planDuplicate({ sectionIds: ["s1"], groupIds: ["g1"], taskIds: ["a", "h1"] }, state, ids());
    expect(plan.sections).toHaveLength(1);
    expect(plan.groups).toHaveLength(2);
    expect(plan.tasks).toHaveLength(5);
    // every task copy went into the new section, none beside its original
    expect(plan.tasks.every((t) => t.sectionId === plan.sections[0].id)).toBe(true);
  });

  it("nothing picked → nothing planned", () => {
    const plan = planDuplicate({}, state, ids());
    expect(plan.sections.length + plan.groups.length + plan.tasks.length).toBe(0);
  });
});
