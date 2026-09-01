import { describe, expect, it } from "vitest";
import { buildReportSnapshot, buildWeeks } from "./report-snapshot";
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

  it("returns nothing when there are no entries", () => {
    expect(buildWeeks([])).toEqual([]);
  });

  /**
   * The regression this exists for: a hand-edited column list used to REPLACE the
   * automatic weeks outright, so a report's timeline froze on the day someone
   * first nudged a column's dates. DualBird had stored columns ending 2026-07-31
   * while August already held hours, and no column could hold them.
   */
  it("appends the weeks after a hand-edited list, never overlapping it", () => {
    const entries = [e("2026-07-20"), e("2026-08-03"), e("2026-08-19")];
    const weeks = buildWeeks(entries, "2026-07-31");
    // 1 Aug 2026 is a Saturday, so the tail of that week is 1 Aug alone — and it
    // holds no hours, so it is correctly absent: the "only weeks with hours" rule
    // applies to a partial bucket exactly as it does to a full one.
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-02..2026-08-08",
      "2026-08-16..2026-08-22",
    ]);
    for (const w of weeks) expect(w.from > "2026-07-31").toBe(true);
  });

  it("keeps a partial first bucket when it does have hours", () => {
    // an hour ON 1 Aug, the Saturday that closes the week the boundary sits in
    const weeks = buildWeeks([e("2026-08-01"), e("2026-08-03")], "2026-07-31");
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-01..2026-08-01",
      "2026-08-02..2026-08-08",
    ]);
  });

  it("realigns to Sun–Sat after a partial first bucket", () => {
    // 2026-08-05 is a Wednesday, so the first bucket runs Thu–Sat
    const weeks = buildWeeks([e("2026-08-07"), e("2026-08-11")], "2026-08-05");
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-06..2026-08-08",
      "2026-08-09..2026-08-15",
    ]);
  });

  it("adds nothing when every hour is already covered", () => {
    expect(buildWeeks([e("2026-07-20")], "2026-07-31")).toEqual([]);
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

  it("appends past a hand-edited list across the boundary", () => {
    const weeks = buildWeeks([e("2025-10-27"), e("2025-11-03")], "2025-10-25");
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
   * period boundary belongs to both — so days outside the period were billed into
   * it. Baseline's August read 17.25h against the payment-periods pane's 16.75h
   * (2026-09-01, found by Nitsan), and the same wrong figure went to the client.
   *
   * `periodMinutes` is bucketed by DATE and is the only correct source for it.
   * These two assertions together say: the straddling week really does hold the
   * outside day, and the period really does not.
   */
  it("buckets a straddling week's outside days into the week but NOT the period", () => {
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
        sum("t1", "2026-09-01", 30), // Tue, SAME week bucket, outside August
      ],
      [august],
    );
    const t = snap.sections[0].tasks[0];
    expect(t.periodMinutes[0]).toBe(90); // not 120
    const straddling = (snap.weeks ?? []).findIndex((w) => w.from <= "2026-08-31" && w.to >= "2026-09-01");
    expect(straddling).toBeGreaterThanOrEqual(0);
    expect(t.weekMinutes?.[straddling]).toBe(120);
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
        client, [section("s1", "Design")], [task("t1", "s1")], week2, periods, null, "2026-08-22",
      );
      expect(snap.sections[0].tasks[0].totalMinutes).toBe(120);
    });

    it("drops the week COLUMN the excluded hours would have created", () => {
      const snap = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")], week2, periods, null, "2026-08-22",
      );
      expect(snap.weeks?.some((w) => w.from === "2026-08-23")).toBe(false);
    });

    it("keeps the period total in step with the columns", () => {
      const p: BillingPeriod[] = [
        { id: "p1", clientId: "c1", label: "August", dateFrom: "2026-08-01", dateTo: "2026-08-31" } as BillingPeriod,
      ];
      const snap = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")], week2, p, null, "2026-08-22",
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
        client, [section("s1", "Design")], [task("t1", "s1")], week2, periods, null, null,
      );
      expect(withOut.sections[0].tasks[0].totalMinutes).toBe(600);
      expect(withNull.sections[0].tasks[0].totalMinutes).toBe(600);
    });

    it("is INCLUSIVE of the cut-off day itself", () => {
      const snap = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")],
        [sum("t1", "2026-08-22", 60)], periods, null, "2026-08-22",
      );
      expect(snap.sections[0].tasks[0].totalMinutes).toBe(60);
    });

    it("drops a stored column that begins after the cut-off", () => {
      const snap = buildReportSnapshot(
        client, [section("s1", "Design")], [task("t1", "s1")], week2, periods,
        [
          { label: "16 Aug – 22 Aug", from: "2026-08-16", to: "2026-08-22" },
          { label: "23 Aug – 29 Aug", from: "2026-08-23", to: "2026-08-29" },
        ],
        "2026-08-22",
      );
      expect(snap.weeks?.map((w) => w.from)).toEqual(["2026-08-16"]);
    });
  });

  it("appends the weeks after a stored column list instead of freezing on it", () => {
    const snap = buildReportSnapshot(
      client,
      [section("s1", "Design")],
      [task("t1", "s1")],
      [sum("t1", "2026-07-20", 60), sum("t1", "2026-08-03", 90)],
      periods,
      [{ label: "stored", from: "2026-07-19", to: "2026-07-25" }],
    );
    expect(snap.weeks?.map((w) => w.from)).toEqual(["2026-07-19", "2026-08-02"]);
    expect(snap.sections[0].tasks[0].weekMinutes).toEqual([60, 90]);
  });
});
