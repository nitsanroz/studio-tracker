import { describe, it, expect } from "vitest";
import {
  ALLOWANCE_BYTES,
  cycleWindow,
  egressLevel,
  estimateBytes,
  estimateCycle,
  mergeSamples,
  type EgressState,
} from "./egress";

const state = (o: Partial<EgressState> = {}): EgressState => ({
  seedBytes: 0,
  seedDate: "2026-08-27",
  seedCycleStart: "2026-08-05",
  samples: [],
  lastPolledAt: "2026-08-27T12:00:00.000Z",
  ...o,
});

describe("cycleWindow", () => {
  it("runs from the 5th to the 4th of the next month", () => {
    expect(cycleWindow(new Date(2026, 7, 27))).toEqual({ start: "2026-08-05", end: "2026-09-04" });
  });

  it("belongs to the PREVIOUS month before the reset day", () => {
    // 2 Sep is still inside the cycle that opened 5 Aug
    expect(cycleWindow(new Date(2026, 8, 2))).toEqual({ start: "2026-08-05", end: "2026-09-04" });
  });

  it("rolls into the new cycle ON the reset day", () => {
    expect(cycleWindow(new Date(2026, 8, 5))).toEqual({ start: "2026-09-05", end: "2026-10-04" });
  });

  it("crosses a year boundary", () => {
    expect(cycleWindow(new Date(2027, 0, 3))).toEqual({ start: "2026-12-05", end: "2027-01-04" });
  });

  /**
   * ⚠️ Israel's clocks go back on 25 Oct 2026. Built on ms arithmetic this lands a
   * day out; built on calendar arithmetic it cannot.
   */
  it("is right across a clocks change", () => {
    expect(cycleWindow(new Date(2026, 9, 26))).toEqual({ start: "2026-10-05", end: "2026-11-04" });
  });
});

describe("estimateBytes", () => {
  it("reproduces the calibration day", () => {
    // 8,431 REST requests was 256.011 MB on the dashboard. Within the 2.5% uplift.
    const mb = estimateBytes(8431) / 1024 ** 2;
    expect(mb).toBeGreaterThan(255);
    expect(mb).toBeLessThan(264);
  });

  it("is zero for no requests", () => {
    expect(estimateBytes(0)).toBe(0);
  });
});

describe("estimateCycle", () => {
  const now = new Date(2026, 7, 30); // 30 Aug, inside the 5 Aug cycle

  it("adds only the days AFTER the seed", () => {
    // ⚠️ The seed already contains its own day; counting it again double-counts.
    const est = estimateCycle(
      state({
        seedBytes: 1024 ** 3,
        seedDate: "2026-08-27",
        samples: [
          { date: "2026-08-26", rest: 100000 }, // before the seed — must be ignored
          { date: "2026-08-27", rest: 100000 }, // the seed's own day — ignored
          { date: "2026-08-28", rest: 8431 }, // counted
        ],
      }),
      now,
    );
    expect(est.daysCounted).toBe(1);
    expect(est.bytes).toBe(1024 ** 3 + estimateBytes(8431));
  });

  it("DISCARDS a seed from a previous cycle rather than carrying it forward", () => {
    // The 11.9GB of the August cycle must not open September at 240%.
    const est = estimateCycle(
      state({
        seedBytes: 12 * 1024 ** 3,
        seedDate: "2026-08-27",
        seedCycleStart: "2026-08-05",
        samples: [{ date: "2026-09-06", rest: 8431 }],
      }),
      new Date(2026, 8, 7), // 7 Sep — a new cycle
    );
    expect(est.cycle.start).toBe("2026-09-05");
    expect(est.seedIgnored).toBe(true);
    expect(est.bytes).toBe(estimateBytes(8431));
    expect(est.pct).toBeLessThan(10);
  });

  it("counts from the cycle start when there is no usable seed", () => {
    const est = estimateCycle(
      state({
        seedBytes: 0,
        seedCycleStart: "1970-01-01",
        samples: [
          { date: "2026-08-04", rest: 999999 }, // previous cycle
          { date: "2026-08-05", rest: 8431 }, // the cycle's first day, inclusive
        ],
      }),
      now,
    );
    expect(est.daysCounted).toBe(1);
    expect(est.bytes).toBe(estimateBytes(8431));
  });

  it("ignores samples past the cycle end", () => {
    const est = estimateCycle(
      state({ seedBytes: 0, seedCycleStart: "x", samples: [{ date: "2026-09-05", rest: 5000 }] }),
      now,
    );
    expect(est.daysCounted).toBe(0);
  });
});

describe("egressLevel", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const at = (pct: number) => ({
    bytes: (ALLOWANCE_BYTES * pct) / 100,
    pct,
    cycle: { start: "2026-08-05", end: "2026-09-04" },
    daysCounted: 5,
    seedIgnored: false,
  });

  it("is quiet below 80%", () => {
    expect(egressLevel(at(79.9), now.toISOString(), now)).toBe("ok");
  });

  it("warns at exactly 80% and criticals at exactly 95%", () => {
    expect(egressLevel(at(80), now.toISOString(), now)).toBe("warn");
    expect(egressLevel(at(94.9), now.toISOString(), now)).toBe("warn");
    expect(egressLevel(at(95), now.toISOString(), now)).toBe("critical");
    expect(egressLevel(at(240), now.toISOString(), now)).toBe("critical");
  });

  /**
   * ⚠️ The one that matters most: an expired token must not read as "all clear".
   * Nitsan's token is set to 90 days, so this WILL happen.
   */
  it("reports stale rather than a comfortable number when the poll has stopped", () => {
    const old = new Date("2026-08-24T12:00:00.000Z").toISOString(); // 3 days
    expect(egressLevel(at(12), old, now)).toBe("stale");
    expect(egressLevel(at(12), null, now)).toBe("stale");
  });

  it("stale outranks even a critical percentage", () => {
    expect(egressLevel(at(99), null, now)).toBe("stale");
  });

  it("tolerates a poll from within the window", () => {
    const recent = new Date("2026-08-26T20:00:00.000Z").toISOString();
    expect(egressLevel(at(50), recent, now)).toBe("ok");
  });
});

describe("mergeSamples", () => {
  it("lets a later read replace a day still in progress", () => {
    const out = mergeSamples([{ date: "2026-08-27", rest: 100 }], [{ date: "2026-08-27", rest: 900 }]);
    expect(out).toEqual([{ date: "2026-08-27", rest: 900 }]);
  });

  it("sorts and bounds the history", () => {
    const many = Array.from({ length: 90 }, (_, i) => ({
      date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
      rest: i,
    }));
    const out = mergeSamples([], many, 70);
    expect(out.length).toBeLessThanOrEqual(70);
    expect([...out].sort((a, b) => a.date.localeCompare(b.date))).toEqual(out);
  });
});
