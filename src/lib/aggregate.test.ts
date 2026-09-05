import { describe, expect, it } from "vitest";
import { buildTaskClientMap, latestActivityByClient, minutesByClientInRange } from "./aggregate";
import type { EntrySum, Task } from "./types";

// These three feed the clients list's per-period hours and its recent-activity
// ordering. Pure and small, but the range comparison is a STRING compare on ISO
// dates and the boundaries are inclusive — worth pinning, because an off-by-one
// here silently moves hours between periods.

const task = (id: string, clientId: string | null): Task =>
  ({ id, clientId, title: id }) as Task;

const entry = (over: Partial<EntrySum> = {}): EntrySum =>
  ({ id: "e1", taskId: "t1", userId: "u1", date: "2026-07-15", minutes: 60, ...over }) as EntrySum;

describe("buildTaskClientMap", () => {
  it("maps each task to its client", () => {
    const m = buildTaskClientMap([task("t1", "c1"), task("t2", "c2")]);
    expect(m.get("t1")).toBe("c1");
    expect(m.get("t2")).toBe("c2");
  });

  it("skips a task with no client rather than mapping it to null", () => {
    // A task with no client is real (the "No section"/unsorted path); it must
    // simply not appear, so the callers' `if (!clientId) continue` holds.
    const m = buildTaskClientMap([task("t1", null)]);
    expect(m.has("t1")).toBe(false);
    expect(m.size).toBe(0);
  });
});

describe("minutesByClientInRange", () => {
  const map = buildTaskClientMap([task("t1", "c1"), task("t2", "c1"), task("t3", "c2")]);

  it("sums per client across tasks", () => {
    const out = minutesByClientInRange(
      [entry({ taskId: "t1", minutes: 60 }), entry({ taskId: "t2", minutes: 30 }), entry({ taskId: "t3", minutes: 45 })],
      "2026-07-01",
      "2026-07-31",
      map,
    );
    expect(out.get("c1")).toBe(90);
    expect(out.get("c2")).toBe(45);
  });

  it("includes both endpoints of the range", () => {
    const out = minutesByClientInRange(
      [entry({ date: "2026-07-01" }), entry({ date: "2026-07-31" })],
      "2026-07-01",
      "2026-07-31",
      map,
    );
    expect(out.get("c1")).toBe(120);
  });

  it("excludes the day either side", () => {
    const out = minutesByClientInRange(
      [entry({ date: "2026-06-30" }), entry({ date: "2026-08-01" })],
      "2026-07-01",
      "2026-07-31",
      map,
    );
    expect(out.size).toBe(0);
  });

  it("drops an entry whose task has no client", () => {
    const out = minutesByClientInRange([entry({ taskId: "unknown" })], "2026-07-01", "2026-07-31", map);
    expect(out.size).toBe(0);
  });

  it("carries negative minutes through rather than clamping", () => {
    // The recovery's מפתח reductions are negative ledger lines and belong in
    // the client's total.
    const out = minutesByClientInRange(
      [entry({ taskId: "t1", minutes: 120 }), entry({ taskId: "t1", minutes: -30 })],
      "2026-07-01",
      "2026-07-31",
      map,
    );
    expect(out.get("c1")).toBe(90);
  });
});

describe("latestActivityByClient", () => {
  const map = buildTaskClientMap([task("t1", "c1"), task("t2", "c1")]);

  it("keeps the latest date per client, whatever order they arrive in", () => {
    const out = latestActivityByClient(
      [
        entry({ taskId: "t1", date: "2026-07-10" }),
        entry({ taskId: "t2", date: "2026-07-28" }),
        entry({ taskId: "t1", date: "2026-07-19" }),
      ],
      map,
    );
    expect(out.get("c1")).toBe("2026-07-28");
  });

  it("compares ISO dates as strings correctly across a year boundary", () => {
    const out = latestActivityByClient(
      [entry({ date: "2025-12-31" }), entry({ date: "2026-01-01" })],
      map,
    );
    expect(out.get("c1")).toBe("2026-01-01");
  });

  it("has no entry for a client with no activity", () => {
    expect(latestActivityByClient([], map).size).toBe(0);
  });
});
