import { describe, expect, it } from "vitest";
import { snoozeOptions } from "./advice";

describe("snoozeOptions", () => {
  it("never offers a Friday or Saturday, nor one date twice", () => {
    for (const today of ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]) {
      const opts = snoozeOptions(today);
      expect(new Set(opts.map((o) => o.until)).size).toBe(3);
      for (const o of opts) expect(new Date(`${o.until}T12:00:00`).getDay()).toBeLessThanOrEqual(4);
    }
  });

  it("names the next workday: Thursday → Sunday, Saturday → Tomorrow", () => {
    expect(snoozeOptions("2026-10-22")[0]).toEqual({ label: "Sunday", until: "2026-10-25" });
    expect(snoozeOptions("2026-10-24")[0]).toEqual({ label: "Tomorrow", until: "2026-10-25" });
    expect(snoozeOptions("2026-10-24")[1]).toEqual({ label: "Next week", until: "2026-11-01" });
  });
});
