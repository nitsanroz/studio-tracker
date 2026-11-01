import { describe, expect, it } from "vitest";
import { bucketTasks, taskBucket } from "./task-buckets";

// 2026-11-02 is a Monday; that week runs Sun 1 Nov – Sat 7 Nov.
const TODAY = "2026-11-02";

describe("taskBucket", () => {
  it("puts a past date in overdue and today in this week", () => {
    expect(taskBucket("2026-11-01", TODAY)).toBe("overdue");
    expect(taskBucket(TODAY, TODAY)).toBe("week");
  });

  it("runs this week through Saturday", () => {
    expect(taskBucket("2026-11-06", TODAY)).toBe("week"); // Friday
    expect(taskBucket("2026-11-07", TODAY)).toBe("week"); // Saturday
    expect(taskBucket("2026-11-08", TODAY)).toBe("later"); // next Sunday
  });

  it("treats a Sunday as the first day of its own week", () => {
    expect(taskBucket("2026-11-07", "2026-11-01")).toBe("week");
    expect(taskBucket("2026-11-08", "2026-11-01")).toBe("later");
  });

  it("is right across the October clocks-back change", () => {
    // Israel leaves summer time on Sun 25 Oct 2026.
    expect(taskBucket("2026-10-31", "2026-10-25")).toBe("week");
    expect(taskBucket("2026-11-01", "2026-10-25")).toBe("later");
  });

  it("has a group for no date", () => {
    expect(taskBucket(null, TODAY)).toBe("undated");
  });
});

describe("bucketTasks", () => {
  it("returns only non-empty groups, in order, sorted by date", () => {
    const tasks = [
      { id: "a", dueDate: "2026-11-20" },
      { id: "b", dueDate: null },
      { id: "c", dueDate: "2026-10-30" },
      { id: "d", dueDate: "2026-10-20" },
    ];
    expect(bucketTasks(tasks, TODAY).map((g) => [g.bucket, g.tasks.map((t) => t.id)])).toEqual([
      ["overdue", ["d", "c"]],
      ["later", ["a"]],
      ["undated", ["b"]],
    ]);
  });
});
