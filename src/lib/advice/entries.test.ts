import { describe, expect, it } from "vitest";
import { moneyEntries, moneyEntriesFrom, studioEntries, studioEntriesFrom, type EntryRow, type SharedEntries } from "./entries";

const row = (date: string, legacy: boolean | null = false): EntryRow => ({ task_id: "t", user_id: "u", date, minutes: 60, legacy });

describe("the one fetch of logged hours", () => {
  const today = "2026-11-15";

  it("starts the studio side six whole months back", () => {
    expect(studioEntriesFrom(today)).toBe("2026-05-01");
  });

  it("starts the money side at four months, 120 days, or the earliest period — whichever is first", () => {
    expect(moneyEntriesFrom(today, [])).toBe("2026-07-01");
    expect(moneyEntriesFrom(today, ["2026-09-01"])).toBe("2026-07-01");
    // A long period that ended lately reaches back past both.
    expect(moneyEntriesFrom(today, ["2026-01-10", "2026-10-01"])).toBe("2026-01-10");
  });

  it("gives each side the rows its own query used to return", () => {
    const shared: SharedEntries = {
      from: "2026-01-10",
      rows: [row("2026-02-01"), row("2026-04-30"), row("2026-05-01"), row("2026-08-01", true), row("2026-08-02", null), row("2026-11-15")],
    };
    // Studio: from 1 May, logged hours only.
    expect(studioEntries(shared, today).map((e) => e.date)).toEqual(["2026-05-01", "2026-11-15"]);
    // Money: everything from its own start, recovered history included.
    expect(moneyEntries(shared, "2026-07-01").map((e) => e.date)).toEqual(["2026-08-01", "2026-08-02", "2026-11-15"]);
    expect(moneyEntries(shared, "2026-01-10")).toHaveLength(6);
  });
});
