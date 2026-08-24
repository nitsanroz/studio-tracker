import { describe, expect, it } from "vitest";
import { formatDate, greetingFor, shiftDays, shortRangeLabel, startOfWeek, toISODate } from "./format";

describe("greetingFor", () => {
  const at = (h: number) => greetingFor(new Date(2026, 7, 17, h, 30));

  it("names the three parts of the day", () => {
    expect(at(9)).toBe("Good morning");
    expect(at(14)).toBe("Good afternoon");
    expect(at(20)).toBe("Good evening");
  });

  // The boundaries are the whole reason this is one function rather than two
  // inline copies: noon is afternoon, 18:00 is evening, and midnight is morning
  // (nobody in the studio is greeted at 00:30, but "Good evening" for the small
  // hours would still be wrong).
  it("puts each boundary on the later greeting", () => {
    expect(at(0)).toBe("Good morning");
    expect(at(11)).toBe("Good morning");
    expect(at(12)).toBe("Good afternoon");
    expect(at(17)).toBe("Good afternoon");
    expect(at(18)).toBe("Good evening");
    expect(at(23)).toBe("Good evening");
  });
});

describe("formatDate", () => {
  it("formats a plain date", () => {
    expect(formatDate("2026-08-11")).toBe("11/8/26");
    expect(formatDate("2025-01-05")).toBe("5/1/25");
  });

  // ⚠️ Every `created_at` column holds a full TIMESTAMP, not a date. Splitting
  // on "-" without slicing first made the day `11T17:48:52.724326+00:00`, so
  // `Number()` returned NaN and the intake queue printed every submission as
  // "NaN/8/26" — for months, on the pending cards, before anyone noticed.
  it("accepts a full ISO timestamp", () => {
    expect(formatDate("2026-08-11T17:48:52.724326+00:00")).toBe("11/8/26");
    expect(formatDate("2026-08-11T00:00:00Z")).toBe("11/8/26");
  });
});

/**
 * ⚠️ THESE GUARD A PRIMITIVE THAT SHIPPED BROKEN FOR MONTHS. `shiftDays` replaced
 * an ms-based `addDays` (`getTime() + days * 86_400_000`) that was an hour short
 * across a clocks-back transition, so `addDays(sunday, 6)` landed at 23:00 on the
 * FRIDAY and `toISODate` reported the wrong DAY. All 24 call sites were
 * date-semantic, so it mis-dated a "This week", a billing-period boundary, a plan
 * day loop and the Time Feed's paging — none of which had a test.
 *
 * Israel moved clocks back on Sunday 26 Oct 2025, so every case below crosses it.
 * The suite pins TZ=Asia/Jerusalem (vitest.config.ts); under TZ=UTC there is no
 * transition and these all pass with the bug present.
 */
describe("shiftDays across a clocks-back transition", () => {
  it("lands on the Saturday six days after the Sunday, not the Friday", () => {
    const sunday = new Date(2025, 9, 26);
    expect(toISODate(shiftDays(sunday, 6))).toBe("2025-11-01");
    // the ms-based version returned 2025-10-31 here
    expect(shiftDays(sunday, 6).getDay()).toBe(6); // Saturday
  });

  it("advances a day at a time without repeating or skipping one", () => {
    const seen: string[] = [];
    // ⚠️ The cap is deliberate. With ms arithmetic this walk NEVER TERMINATES —
    // 26 Oct comes out as 25 Oct 23:00, so the cursor recomputes the same day
    // forever. Bounded, a regression fails in a second instead of hanging CI the
    // way it hung the client-reports tab.
    let guard = 0;
    for (let d = new Date(2025, 9, 24); toISODate(d) <= "2025-10-29"; d = shiftDays(d, 1)) {
      seen.push(toISODate(d));
      if (++guard > 20) break;
    }
    expect(seen).toEqual([
      "2025-10-24",
      "2025-10-25",
      "2025-10-26",
      "2025-10-27",
      "2025-10-28",
      "2025-10-29",
    ]);
    expect(new Set(seen).size).toBe(seen.length); // no duplicate day, no duplicate React key
  });

  it("steps whole weeks without drifting off Sunday", () => {
    let w = startOfWeek(new Date(2025, 9, 19));
    for (let i = 0; i < 4; i++) w = shiftDays(w, 7);
    expect(toISODate(w)).toBe("2025-11-16");
    expect(w.getDay()).toBe(0); // still a Sunday; the ms version drifted to Saturday
  });

  it("is exact in both directions", () => {
    expect(toISODate(shiftDays(new Date(2025, 10, 1), -6))).toBe("2025-10-26");
    expect(toISODate(shiftDays(new Date(2025, 9, 26), -1))).toBe("2025-10-25");
  });

  it("normalises month and year overflow", () => {
    expect(toISODate(shiftDays(new Date(2025, 11, 30), 3))).toBe("2026-01-02");
    expect(toISODate(shiftDays(new Date(2024, 1, 28), 1))).toBe("2024-02-29"); // leap
  });
});

describe("shortRangeLabel", () => {
  it("names a range without the weekday", () => {
    expect(shortRangeLabel("2026-08-02", "2026-08-08")).toBe("2 Aug – 8 Aug");
  });

  it("tolerates a full timestamp rather than printing NaN", () => {
    expect(shortRangeLabel("2026-08-02T17:48:52Z", "2026-08-08")).toBe("2 Aug – 8 Aug");
  });
});
