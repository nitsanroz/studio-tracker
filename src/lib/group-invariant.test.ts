import { describe, expect, it } from "vitest";
import { withGroupInvariant } from "./store";
import type { Task, TaskGroup } from "./types";

/**
 * A task's group must belong to the task's section. Migration 0027 cannot express
 * that as a constraint — a composite FK would need `task_groups(section_id, id)`
 * unique, which forbids the null-section case — so it lives in this function, and
 * every reader is written to tolerate a violation by rendering the task loose.
 * That tolerance is exactly why a hole here is silent: the symptom is a task
 * quietly falling out of its group, with no error anywhere.
 */
const group = (id: string, sectionId: string | null): TaskGroup =>
  ({ id, sectionId, clientId: "c1", name: id, position: 0 }) as unknown as TaskGroup;
const task = (sectionId: string | null, groupId: string | null): Task =>
  ({ id: "t1", clientId: "c1", sectionId, groupId }) as unknown as Task;

const groups = [group("g1", "s1"), group("g2", "s2")];

describe("withGroupInvariant", () => {
  it("adopts the group's section when filing a task into it", () => {
    expect(withGroupInvariant(task("s2", null), { groupId: "g1" }, groups)).toEqual({
      groupId: "g1",
      sectionId: "s1",
    });
  });

  /**
   * ⚠️ The regression: this compared the group's section against the section the
   * task was LEAVING, so a patch naming a group and a conflicting section passed
   * through untouched whenever the group already sat in the task's current
   * section — storing the task in a group that lives somewhere else.
   */
  it("overrules a section named alongside a group, even one it already sits in", () => {
    expect(
      withGroupInvariant(task("s1", null), { groupId: "g1", sectionId: "s2" }, groups),
    ).toEqual({ groupId: "g1", sectionId: "s1" });
  });

  it("leaves a group whose section already matches the patch", () => {
    expect(
      withGroupInvariant(task("s2", null), { groupId: "g1", sectionId: "s1" }, groups),
    ).toEqual({ groupId: "g1", sectionId: "s1" });
  });

  it("takes a task out of a group that lives in another section", () => {
    expect(withGroupInvariant(task("s1", "g1"), { sectionId: "s2" }, groups)).toEqual({
      sectionId: "s2",
      groupId: null,
    });
  });

  it("keeps the group when the section move stays inside it", () => {
    expect(withGroupInvariant(task("s1", "g1"), { sectionId: "s1" }, groups)).toEqual({
      sectionId: "s1",
    });
  });

  it("clearing the group is honoured as written", () => {
    expect(withGroupInvariant(task("s1", "g1"), { sectionId: "s2", groupId: null }, groups)).toEqual(
      { sectionId: "s2", groupId: null },
    );
  });

  it("leaves an unknown group id alone rather than guessing", () => {
    expect(withGroupInvariant(task("s1", null), { groupId: "gone" }, groups)).toEqual({
      groupId: "gone",
    });
  });

  it("passes through a patch that touches neither key", () => {
    expect(withGroupInvariant(task("s1", "g1"), { title: "x" }, groups)).toEqual({ title: "x" });
  });
});
