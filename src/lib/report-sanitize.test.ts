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
