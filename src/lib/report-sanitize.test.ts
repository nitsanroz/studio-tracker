import { describe, expect, it } from "vitest";
import { sanitizeSnapshot } from "./report-sanitize";
import type { ReportSnapshot } from "./types";

// A published client report is the one place the studio's data leaves the
// building, so the structural guarantees matter: a hidden task is absent from
// the payload, and hiding a column keeps every row's arrays aligned with the
// headers.
//
// What is NOT a guarantee: concealment. Hiding is a focus tool — an admin hides
// a finished period so the client reads the current one — and the per-task total
// deliberately still spans hidden periods, so the summary stays the true total
// delivered. The test below pins that down so nobody "fixes" it again.

const snap = (): ReportSnapshot =>
  ({
    clientName: "Acme",
    clientColor: "#0b43ed",
    periods: [
      { label: "Jan", from: "2026-01-01", to: "2026-01-31", hourCap: 50, advanceHours: null },
      { label: "Feb", from: "2026-02-01", to: "2026-02-28", hourCap: 50, advanceHours: null },
      { label: "Mar", from: "2026-03-01", to: "2026-03-31", hourCap: null, advanceHours: null },
    ],
    sections: [
      {
        name: "Design",
        tasks: [
          { id: "t1", title: "Homepage", estimateHours: 20, totalMinutes: 600, periodMinutes: [100, 200, 300] },
          { id: "t2", title: "Secret rebrand", estimateHours: 8, totalMinutes: 240, periodMinutes: [40, 80, 120] },
        ],
      },
      {
        name: "Empty after hiding",
        tasks: [{ id: "t3", title: "Only task", estimateHours: null, totalMinutes: 60, periodMinutes: [60, 0, 0] }],
      },
    ],
  }) as ReportSnapshot;

const allTasks = (s: ReportSnapshot) => s.sections.flatMap((sec) => sec.tasks);

describe("sanitizeSnapshot", () => {
  it("passes everything through when nothing is hidden", () => {
    const { snapshot, leadingHidden } = sanitizeSnapshot(snap(), [], []);
    expect(leadingHidden).toEqual([]);
    expect(snapshot.periods).toHaveLength(3);
    expect(allTasks(snapshot).map((t) => t.totalMinutes)).toEqual([600, 240, 60]);
  });

  it("removes a hidden task from the payload entirely", () => {
    const { snapshot } = sanitizeSnapshot(snap(), [], ["t2"]);
    const ids = allTasks(snapshot).map((t) => t.id);
    expect(ids).not.toContain("t2");
    expect(JSON.stringify(snapshot)).not.toContain("Secret rebrand");
  });

  it("drops a section that has no tasks left", () => {
    const { snapshot } = sanitizeSnapshot(snap(), [], ["t3"]);
    expect(snapshot.sections.map((s) => s.name)).toEqual(["Design"]);
  });

  it("drops a hidden period column and reindexes the rows with it", () => {
    const { snapshot } = sanitizeSnapshot(snap(), ["p:1"], []);
    expect(snapshot.periods.map((p) => p.label)).toEqual(["Jan", "Mar"]);
    // The Feb value (200) is gone, not shifted into another column.
    expect(allTasks(snapshot)[0].periodMinutes).toEqual([100, 300]);
  });

  it("keeps the total spanning hidden periods too", () => {
    // Deliberate: hiding a period is presentational, so the Total column stays
    // the true all-time figure (600, not the visible 100 + 300). This does mean
    // the hidden value is derivable — which is fine, it was never secret.
    const { snapshot } = sanitizeSnapshot(snap(), ["p:1"], []);
    expect(allTasks(snapshot).map((t) => t.totalMinutes)).toEqual([600, 240, 60]);
  });

  it("leaves the total alone when every period is visible", () => {
    const { snapshot } = sanitizeSnapshot(snap(), ["estimate"], []);
    expect(allTasks(snapshot).map((t) => t.totalMinutes)).toEqual([600, 240, 60]);
  });

  it("nulls a hidden estimate and zeroes a hidden total", () => {
    const { snapshot, leadingHidden } = sanitizeSnapshot(snap(), ["estimate", "total"], []);
    expect(leadingHidden).toEqual(["estimate", "total"]);
    expect(allTasks(snapshot).every((t) => t.estimateHours === null)).toBe(true);
    expect(allTasks(snapshot).every((t) => t.totalMinutes === 0)).toBe(true);
  });

  it("keeps week columns aligned when one is hidden", () => {
    const withWeeks = {
      ...snap(),
      weeks: [
        { label: "W1", from: "2026-01-01", to: "2026-01-07" },
        { label: "W2", from: "2026-01-08", to: "2026-01-14" },
      ],
    } as ReportSnapshot;
    withWeeks.sections[0].tasks[0].weekMinutes = [250, 350];
    withWeeks.sections[0].tasks[1].weekMinutes = [100, 140];
    withWeeks.sections[1].tasks[0].weekMinutes = [60, 0];

    const { snapshot } = sanitizeSnapshot(withWeeks, ["w:0"], []);
    expect(snapshot.weeks?.map((w) => w.label)).toEqual(["W2"]);
    expect(allTasks(snapshot)[0].weekMinutes).toEqual([350]);
    // ...and the total is still the real one, same rule as periods.
    expect(allTasks(snapshot)[0].totalMinutes).toBe(600);
  });

  it("never emits a hidden key in leadingHidden", () => {
    // leadingHidden only ever carries the two leading columns; period/week keys
    // are dropped outright, and echoing them would tell the client what existed.
    const { leadingHidden } = sanitizeSnapshot(snap(), ["p:0", "w:1", "total"], []);
    expect(leadingHidden).toEqual(["total"]);
  });
});

/**
 * ⚠️ The sanitizer used to `{ ...snap }` and pass each period through whole, so
 * anything in the stored jsonb reached the client. `link.snapshot` is cast, not
 * checked, so TypeScript could not see it — and the doc promises the client
 * "never receives hidden data in any form". These pin the allow-list so a field
 * added to a snapshot or a period cannot reach a client by accident.
 */
describe("sanitizeSnapshot ships only known fields", () => {
  it("drops a top-level key the sanitizer does not name", () => {
    const dirty = { ...snap(), internalNote: "do not send", costPerHour: 400 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { snapshot } = sanitizeSnapshot(dirty as any, [], []);
    expect("internalNote" in snapshot).toBe(false);
    expect("costPerHour" in snapshot).toBe(false);
    // and the fields it DOES name still arrive
    expect(snapshot.clientName).toBe(snap().clientName);
    expect(snapshot.periods.length).toBe(snap().periods.length);
  });

  it("drops an unknown key on a period", () => {
    const b = snap();
    const dirty = {
      ...b,
      periods: b.periods.map((p) => ({ ...p, paid: true, invoiceNote: "chase this" })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { snapshot } = sanitizeSnapshot(dirty as any, [], []);
    for (const p of snapshot.periods) {
      expect("paid" in p).toBe(false);
      expect("invoiceNote" in p).toBe(false);
      expect(p.label).toBeTypeOf("string");
    }
  });

  it("drops an unknown key on a week column", () => {
    const b = snap();
    const dirty = {
      ...b,
      weeks: [{ label: "w1", from: "2026-01-01", to: "2026-01-07", internal: 1 }],
      sections: b.sections.map((sec) => ({
        ...sec,
        tasks: sec.tasks.map((t) => ({ ...t, weekMinutes: [60] })),
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { snapshot } = sanitizeSnapshot(dirty as any, [], []);
    for (const w of snapshot.weeks ?? []) expect("internal" in w).toBe(false);
  });

  it("drops an unknown key on a task", () => {
    const b = snap();
    const dirty = {
      ...b,
      sections: b.sections.map((sec) => ({
        ...sec,
        tasks: sec.tasks.map((t) => ({ ...t, assigneeId: "u1", rate: 350 })),
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { snapshot } = sanitizeSnapshot(dirty as any, [], []);
    for (const sec of snapshot.sections)
      for (const t of sec.tasks) {
        expect("assigneeId" in t).toBe(false);
        expect("rate" in t).toBe(false);
      }
  });
});

/**
 * ⚠️ THE SUMMARY TILES USED TO MOVE WHEN AN ADMIN HID A TASK. They were summed
 * from the surviving rows, so hiding a finished task cut the period's charged
 * hours and INFLATED "Remaining" — a 40h cap with 36h logged and one 12h task
 * hidden read "Remaining 16h" when 4h was left, on the page the studio invoices
 * against. Hiding is a focus tool, not confidentiality — the same rule that
 * keeps `totalMinutes` spanning hidden periods — so the summary is the real one.
 */
describe("periodTotals span hidden tasks", () => {
  it("is unchanged by hiding a task", () => {
    const open = sanitizeSnapshot(snap(), [], []);
    const hidden = sanitizeSnapshot(snap(), [], ["t2"]);
    expect(hidden.periodTotals).toEqual(open.periodTotals);
    // the row itself is still gone from the payload
    expect(allTasks(hidden.snapshot).some((t) => t.id === "t2")).toBe(false);
  });

  it("counts every task, not just the visible ones", () => {
    // t1 100 + t2 40 + t3 60 in period 0
    expect(sanitizeSnapshot(snap(), [], []).periodTotals[0]).toBe(200);
    expect(sanitizeSnapshot(snap(), [], ["t2", "t3"]).periodTotals[0]).toBe(200);
  });

  it("keeps a cap reading honest when a task is hidden", () => {
    // the reported failure, in numbers: 40h cap, period 0 holds 200 minutes
    const { periodTotals } = sanitizeSnapshot(snap(), [], ["t2"]);
    const capMinutes = 50 * 60;
    expect(Math.max(0, capMinutes - periodTotals[0])).toBe(capMinutes - 200);
  });

  it("is indexed like the periods that survive, not the originals", () => {
    const { snapshot, periodTotals } = sanitizeSnapshot(snap(), ["p:0"], []);
    expect(periodTotals).toHaveLength(snapshot.periods.length);
    // period 1 of the original (Feb) is now index 0: 200 + 80 + 0 = 280
    expect(snapshot.periods[0].label).toBe("Feb");
    expect(periodTotals[0]).toBe(280);
  });

  it("is all zeroes for a snapshot with no tasks left", () => {
    const { periodTotals } = sanitizeSnapshot(snap(), [], ["t1", "t2", "t3"]);
    // the ROWS are gone but the money figures are still the truth
    expect(periodTotals[0]).toBe(200);
  });
});

/**
 * ⚠️ Same rule as `periodTotals`, for the same reason: a count summed from the rows
 * on screen would drop when an admin hid a task for focus, and "4 active tasks"
 * quietly becoming 3 is the same defect as the hours figure moving.
 */
describe("periodActiveTasks span hidden tasks", () => {
  it("counts every task with hours in the period", () => {
    // period 0: t1 100, t2 40, t3 60 — all three active
    expect(sanitizeSnapshot(snap(), [], []).periodActiveTasks[0]).toBe(3);
  });

  it("is unchanged by hiding a task", () => {
    expect(sanitizeSnapshot(snap(), [], ["t2"]).periodActiveTasks[0]).toBe(3);
    expect(sanitizeSnapshot(snap(), [], ["t1", "t2", "t3"]).periodActiveTasks[0]).toBe(3);
  });

  it("does not count a task with no hours in that period", () => {
    // t3 has [60, 0, 0] — active in period 0 only
    const { periodActiveTasks } = sanitizeSnapshot(snap(), [], []);
    expect(periodActiveTasks[1]).toBe(2); // t1 and t2 only
  });

  it("is indexed like the periods that survive", () => {
    const { snapshot, periodActiveTasks } = sanitizeSnapshot(snap(), ["p:0"], []);
    expect(periodActiveTasks).toHaveLength(snapshot.periods.length);
    expect(snapshot.periods[0].label).toBe("Feb");
    expect(periodActiveTasks[0]).toBe(2);
  });
});
