import { describe, expect, it } from "vitest";
import { buildReportSnapshot, buildWeeks, periodCuts } from "./report-snapshot";
import type { BillingPeriod, Client, EntrySum, Section, Task } from "./types";

const e = (date: string, minutes = 60): EntrySum =>
  ({ taskId: "t", userId: "u", date, minutes }) as EntrySum;

describe("buildWeeks", () => {
  it("covers only the weeks that have hours", () => {
    // 2026-08-02 is a Sunday; skip a week, then log again
    const weeks = buildWeeks([e("2026-08-03"), e("2026-08-19")]);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-02..2026-08-08",
      "2026-08-16..2026-08-22",
    ]);
  });

  /**
   * Nitsan's ask, and the arithmetic behind it: a period that ends mid-week left
   * one column belonging to two periods, so the columns on screen could not add up
   * to the period total under them (Visitt's January read 204h of columns against
   * a 216.5h period).
   */
  it("splits a week at a billing-period boundary", () => {
    // 20/8 starts a new period, in the middle of the Sun 16 – Sat 22 week
    const cuts = periodCuts([
      { dateFrom: "2026-07-20", dateTo: "2026-08-19" } as BillingPeriod,
      { dateFrom: "2026-08-20", dateTo: "2026-09-19" } as BillingPeriod,
    ]);
    const weeks = buildWeeks([e("2026-08-17"), e("2026-08-21")], cuts);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-16..2026-08-19",
      "2026-08-20..2026-08-22",
    ]);
  });

  it("splits twice when two boundaries fall in one week", () => {
    // a one-day period in the middle of a week: three columns, not two
    const cuts = periodCuts([
      { dateFrom: "2026-08-19", dateTo: "2026-08-19" } as BillingPeriod,
    ]);
    const weeks = buildWeeks(
      [e("2026-08-17"), e("2026-08-19"), e("2026-08-21")],
      cuts,
    );
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-16..2026-08-18",
      "2026-08-19..2026-08-19",
      "2026-08-20..2026-08-22",
    ]);
  });

  it("cuts a gap between periods out of the column before it", () => {
    // Anchor's real shape: August ends 19/8, September starts 21/8, so 20 Aug is
    // in no period at all — and must not be counted inside the August column.
    const cuts = periodCuts([
      { dateFrom: "2026-08-01", dateTo: "2026-08-19" } as BillingPeriod,
      { dateFrom: "2026-08-21", dateTo: "2026-09-19" } as BillingPeriod,
    ]);
    const weeks = buildWeeks(
      [e("2026-08-17"), e("2026-08-20"), e("2026-08-22")],
      cuts,
    );
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-16..2026-08-19",
      "2026-08-20..2026-08-20",
      "2026-08-21..2026-08-22",
    ]);
  });

  it("leaves a week alone when a boundary lands on its own edges", () => {
    // a period starting on the Sunday needs no split — the week already breaks there
    const cuts = periodCuts([
      { dateFrom: "2026-08-16", dateTo: "2026-08-22" } as BillingPeriod,
    ]);
    const weeks = buildWeeks([e("2026-08-17")], cuts);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual(["2026-08-16..2026-08-22"]);
  });

  /**
   * Nitsan's rule, and the report that produced it: *"theres a week missing in
   * baseline"*. A bucket used to need hours to exist, so a quiet week in the middle
   * of a month read as though a week of the report had gone missing — which on a
   * page a client reads is a completely different claim from "we logged nothing
   * that week".
   */
  it("keeps an empty week that falls inside a billing period", () => {
    // as the app calls it: the cuts and the cover come from the SAME periods, so a
    // bucket that pokes out of the period is trimmed at its edge
    const august = { dateFrom: "2026-08-01", dateTo: "2026-08-31" } as BillingPeriod;
    const cover = [{ from: august.dateFrom, to: august.dateTo }];
    // hours on either side of the Sun 9 – Sat 15 week, none in it
    const weeks = buildWeeks([e("2026-08-05"), e("2026-08-19")], periodCuts([august]), cover);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-01..2026-08-01", // 1 Aug is a Saturday — the period's own first day
      "2026-08-02..2026-08-08",
      "2026-08-09..2026-08-15", // ← the week that used to go missing
      "2026-08-16..2026-08-22",
      "2026-08-23..2026-08-29",
      "2026-08-30..2026-08-31",
    ]);
  });

  it("covers a period's whole span, before the first logged hour and after the last", () => {
    const august = { dateFrom: "2026-08-01", dateTo: "2026-08-31" } as BillingPeriod;
    const weeks = buildWeeks([e("2026-08-19")], periodCuts([august]), [
      { from: august.dateFrom, to: august.dateTo },
    ]);
    expect(weeks[0].from).toBe("2026-08-01");
    expect(weeks[weeks.length - 1].to).toBe("2026-08-31");
    // and every day of the period is in exactly one column
    const days = weeks.reduce((n, w) => n + (Date.parse(w.to) - Date.parse(w.from)) / 864e5 + 1, 0);
    expect(days).toBe(31);
  });

  it("still leaves out an empty week that no period covers", () => {
    // the skipping he does want: a stretch with no period over it
    const cover = [{ from: "2026-08-16", to: "2026-08-31" }];
    const weeks = buildWeeks([e("2026-08-05"), e("2026-08-19")], [], cover);
    expect(weeks.map((w) => w.from)).toEqual([
      "2026-08-02", // has hours
      "2026-08-16", // in the period
      "2026-08-23", // in the period, no hours
      "2026-08-30", // in the period, no hours
    ]);
  });

  it("obeys the period cuts while filling, so a covered week still splits", () => {
    const cuts = periodCuts([
      { dateFrom: "2026-08-01", dateTo: "2026-08-19" } as BillingPeriod,
      { dateFrom: "2026-08-20", dateTo: "2026-08-31" } as BillingPeriod,
    ]);
    const cover = [
      { from: "2026-08-01", to: "2026-08-19" },
      { from: "2026-08-20", to: "2026-08-31" },
    ];
    const weeks = buildWeeks([e("2026-08-03")], cuts, cover);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toContain("2026-08-16..2026-08-19");
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toContain("2026-08-20..2026-08-22");
  });

  it("returns nothing when there are no entries and no periods", () => {
    expect(buildWeeks([])).toEqual([]);
  });

  it("draws a period's columns even with no hours at all", () => {
    // a client billed for a month they have not been worked on yet: the columns
    // exist and read zero, rather than the report looking like it has no scope
    const weeks = buildWeeks([], [], [{ from: "2026-08-02", to: "2026-08-15" }]);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-02..2026-08-08",
      "2026-08-09..2026-08-15",
    ]);
  });

});

/**
 * The regression that froze the client-reports tab for any client whose hours span
 * a clocks-back transition. `format.ts`'s `addDays` is millisecond-based, so
 * `addDays(sunday, 6)` across Israel's late-October change lands at 23:00 on the
 * FRIDAY; a walk that re-derives its cursor from that date string never advances.
 * Anchor (August only) was fine, DualBird and Blazepod hung, and August-only tests
 * like the ones above passed — hence these, which straddle the boundary.
 */
describe("buildWeeks across a DST change", () => {
  it("terminates and keeps walking forward through late October", () => {
    // Israel moved clocks back on 2025-10-26 (a Sunday)
    const entries = [
      e("2025-10-20"),
      e("2025-10-27"),
      e("2025-11-03"),
    ];
    const weeks = buildWeeks(entries);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2025-10-19..2025-10-25",
      "2025-10-26..2025-11-01",
      "2025-11-02..2025-11-08",
    ]);
  });

  it("spans a whole year without stalling", () => {
    const weeks = buildWeeks([e("2025-05-26"), e("2026-08-20")]);
    expect(weeks.length).toBe(2); // only the two weeks that hold hours
    expect(weeks[0].from).toBe("2025-05-25");
    expect(weeks[1].to).toBe("2026-08-22");
  });

  it("keeps walking across the boundary from a mid-week period cut", () => {
    // 25 Oct 2025 closes a period, so the walk restarts on the 26th — the Sunday
    // Israel moved its clocks back
    const cuts = periodCuts([
      { dateFrom: "2025-10-01", dateTo: "2025-10-25" } as BillingPeriod,
      { dateFrom: "2025-10-26", dateTo: "2025-11-30" } as BillingPeriod,
    ]);
    const weeks = buildWeeks([e("2025-10-27"), e("2025-11-03")], cuts);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2025-10-26..2025-11-01",
      "2025-11-02..2025-11-08",
    ]);
  });
});

/**
 * `buildReportSnapshot` had NO tests. These pin the two ways hours can silently
 * stop adding up: a task whose section is not one of the client's (the row used to
 * vanish while its minutes stayed in the totals), and the appended-week path.
 */
describe("buildReportSnapshot", () => {
  const client = { id: "c1", name: "Acme", color: "#000" } as Client;
  const task = (id: string, sectionId: string | null): Task =>
    ({ id, clientId: "c1", title: id, billable: true, pending: false, sectionId, position: 0,
       estimateHours: null }) as unknown as Task;
  const section = (id: string, name: string): Section =>
    ({ id, clientId: "c1", name, position: 0 }) as unknown as Section;
  const sum = (taskId: string, date: string, minutes: number): EntrySum =>
    ({ taskId, userId: "u", date, minutes }) as EntrySum;
  const periods: BillingPeriod[] = [];

  it("keeps a task whose section belongs to no client section, under Other", () => {
    const snap = buildReportSnapshot(
      client,
      [section("s1", "Design")],
      [task("t1", "s1"), task("t2", "s-gone")],
      [sum("t1", "2026-08-03", 60), sum("t2", "2026-08-03", 120)],
      periods,
    );
    const rows = snap.sections.flatMap((s) => s.tasks.map((t) => t.id));
    expect(rows).toContain("t2"); // used to be dropped entirely
    const other = snap.sections.find((s) => s.name === "Other");
    expect(other?.tasks.map((t) => t.id)).toEqual(["t2"]);
    // and the hours it holds are the hours it was given
    expect(other?.tasks[0].totalMinutes).toBe(120);
  });

  /**
   * ⚠️⚠️ THE INVARIANT BEHIND THE GREEN "Period" COLUMN, pinned here because the
   * bug it replaces was invisible: `report-table.tsx` used to total that column by
   * summing every WEEK bucket overlapping the period, and a week straddling a
   * period boundary belonged to both — so days outside the period were billed into
   * it. Baseline's August read 17.25h against the payment-periods pane's 16.75h
   * (2026-09-01, found by Nitsan), and the same wrong figure went to the client.
   *
   * ⚠️ THIS TEST ASSERTED THE OPPOSITE UNTIL WEEK COLUMNS LEARNED TO SPLIT. It
   * used to say "the straddling week holds the outside day and the period does
   * not", which was the honest description of a report whose columns could not add
   * up to the period beneath them. Now no column crosses a boundary at all, so the
   * two axes agree — and `periodMinutes` is still bucketed by DATE, which is what
   * keeps that true even for a hand-edited column list, where the split does not
   * apply.
   */
  it("puts a period boundary between columns, so no column spans two periods", () => {
    const august = {
      id: "p1", clientId: "c1", label: "August",
      dateFrom: "2026-08-01", dateTo: "2026-08-31", position: 0,
    } as unknown as BillingPeriod;
    const snap = buildReportSnapshot(
      client,
      [section("s1", "Design")],
      [task("t1", "s1")],
      [
        sum("t1", "2026-08-30", 30), // Sun, inside August
        sum("t1", "2026-08-31", 60), // Mon, inside August
        sum("t1", "2026-09-01", 30), // Tue, SAME Sun–Sat week, outside August
      ],
      [august],
    );
    const t = snap.sections[0].tasks[0];
    expect(t.periodMinutes[0]).toBe(90); // not 120
    // no column crosses 31 Aug → 1 Sep any more
    expect((snap.weeks ?? []).some((w) => w.from <= "2026-08-31" && w.to >= "2026-09-01")).toBe(
      false,
    );
    // and the columns that DO sit inside August sum to exactly the period figure
    const inAugust = (snap.weeks ?? [])
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.from >= "2026-08-01" && w.to <= "2026-08-31");
    expect(inAugust.reduce((n, { i }) => n + (t.weekMinutes?.[i] ?? 0), 0)).toBe(90);
  });

  it("never reports fewer hours than were logged", () => {
    const snap = buildReportSnapshot(
      client,
      [section("s1", "Design")],
      [task("t1", "s1"), task("t2", "s-gone"), task("t3", null)],
      [sum("t1", "2026-08-03", 60), sum("t2", "2026-08-03", 120), sum("t3", "2026-08-04", 30)],
      periods,
    );
    const reported = snap.sections
      .flatMap((s) => s.tasks)
      .reduce((n, t) => n + t.totalMinutes, 0);
    expect(reported).toBe(210);
  });

  /**
   * The cut-off. These exist because the failure it fixes was not "a column is
   * showing" but "the page contradicts itself": hiding the week left its hours in
   * the row totals and the header figure. So each of these asserts a DIFFERENT
   * figure moves together — dropping any one of them is how the bug comes back.
   */
  describe("through (cut-off date)", () => {
    const week2 = [
      sum("t1", "2026-08-20", 120), // Thu, inside the reported week
      sum("t1", "2026-08-24", 480), // Mon, the new week — 8h, the real Anchor case
    ];

    it("leaves out hours logged after the cut-off, in the row total", () => {
      const snap = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")], week2, periods, "2026-08-22",
      );
      expect(snap.sections[0].tasks[0].totalMinutes).toBe(120);
    });

    it("drops the week COLUMN the excluded hours would have created", () => {
      const snap = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")], week2, periods, "2026-08-22",
      );
      expect(snap.weeks?.some((w) => w.from === "2026-08-23")).toBe(false);
    });

    it("keeps the period total in step with the columns", () => {
      const p: BillingPeriod[] = [
        { id: "p1", clientId: "c1", label: "August", dateFrom: "2026-08-01", dateTo: "2026-08-31" } as BillingPeriod,
      ];
      const snap = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")], week2, p, "2026-08-22",
      );
      const row = snap.sections[0].tasks[0];
      // the figure the client's header is built from, and the row's own total
      expect(row.periodMinutes[0]).toBe(120);
      expect(row.totalMinutes).toBe(120);
      // and the week cells add up to exactly that — the check that failed on the
      // live Anchor link when the column was merely hidden
      expect((row.weekMinutes ?? []).reduce((a, b) => a + b, 0)).toBe(120);
    });

    it("changes nothing when no cut-off is given", () => {
      const withOut = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")], week2, periods,
      );
      const withNull = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")], week2, periods, null,
      );
      expect(withOut.sections[0].tasks[0].totalMinutes).toBe(600);
      expect(withNull.sections[0].tasks[0].totalMinutes).toBe(600);
    });

    it("is INCLUSIVE of the cut-off day itself", () => {
      const snap = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")],
        [sum("t1", "2026-08-22", 60)], periods, "2026-08-22",
      );
      expect(snap.sections[0].tasks[0].totalMinutes).toBe(60);
    });

  });

});
