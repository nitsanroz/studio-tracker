import { describe, expect, it } from "vitest";
import { studioDay, studioToday, studioYear } from "@/lib/finance/format";

describe("studioToday", () => {
  it("is Tel Aviv's date, not UTC's, just after midnight", () => {
    // 01:30 on 9 Nov in Tel Aviv (UTC+2) is still 8 Nov in UTC.
    expect(studioToday(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-09");
    // Summer time (UTC+3): 02:30 on 1 Jul is 23:30 on 30 Jun in UTC.
    expect(studioToday(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    expect(studioToday(new Date("2026-11-09T12:00:00Z"))).toBe("2026-11-09");
  });
});

describe("studioDay / studioYear", () => {
  it("reads a stored timestamp as the studio's date, not the UTC slice", () => {
    expect(studioDay("2026-11-09T22:30:00Z")).toBe("2026-11-10"); // 00:30 Tel Aviv
    expect(studioDay("2026-11-09T21:59:00+00:00")).toBe("2026-11-09"); // 23:59
    expect(studioDay("2026-11-09")).toBe("2026-11-09");
  });

  it("the year turns at Tel Aviv midnight", () => {
    expect(studioYear(new Date("2026-12-31T22:30:00Z"))).toBe(2027);
    expect(studioYear(new Date("2026-12-31T21:30:00Z"))).toBe(2026);
  });
});
