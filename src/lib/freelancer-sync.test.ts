import { describe, expect, it } from "vitest";
import { entryPatch, type LogSnap } from "./freelancer-sync";

const snap = (o: Partial<LogSnap> = {}): LogSnap => ({
  date: "2026-11-04",
  minutes: 420,
  description: "Moodboards",
  task_id: "branding",
  client_id: "freehand",
  task_hint: null,
  ...o,
});

describe("entryPatch — a change to an approved freelancer line, onto its time entry", () => {
  it("moves the date and note, minutes unchanged, when the hours didn't change", () => {
    const r = entryPatch({ minutes: 420, task_id: "branding" }, snap(), snap({ date: "2026-11-03", description: "Fixed" }));
    expect(r).toEqual({ patch: { minutes: 420, date: "2026-11-03", description: "Fixed" } });
  });

  it("keeps a Keys write-down: 7h line written down to 5h, line raised to 8h → entry 6h", () => {
    const r = entryPatch({ minutes: 300, task_id: "branding" }, snap(), snap({ minutes: 480 }));
    expect("patch" in r && r.patch.minutes).toBe(360);
  });

  it("refuses to go below what Keys already took", () => {
    const r = entryPatch({ minutes: 60, task_id: "branding" }, snap(), snap({ minutes: 300 }));
    expect("error" in r && r.error).toMatch(/6h of this line were already written down to Keys/);
  });

  it("moves the task only while the entry still sits on the approved task", () => {
    const to = snap({ task_id: "logo" });
    const onTask = entryPatch({ minutes: 420, task_id: "branding" }, snap(), to);
    expect("patch" in onTask && onTask.patch.task_id).toBe("logo");
    // written down whole: the entry lives on the client's Keys task — stays there
    const onKeys = entryPatch({ minutes: 420, task_id: "freehand-keys" }, snap(), to);
    expect("patch" in onKeys && onKeys.patch.task_id).toBeUndefined();
  });
});
