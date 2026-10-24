import { describe, expect, it } from "vitest";
import { applyPlan, mergeFindings, toDb, visible, type AdviceRow } from "./merge";
import type { Finding } from "./signals";

const NOW = "2026-10-22T05:00:00.000Z";
const finding = (over: Partial<Finding> = {}): Finding => ({
  key: "cap:lumen:2026-10-01",
  signal: "cap",
  kind: "now",
  area: "Budget",
  clientId: "lumen",
  severity: 2,
  facts: { usedPct: 92 },
  title: "Lumen is at 92% of October's cap",
  body: "6 working days left.",
  reminder: true,
  href: "/client-reports",
  action: "Send a heads-up",
  ...over,
});
const row = (over: Partial<AdviceRow> = {}): AdviceRow => ({
  id: "r1",
  key: "cap:lumen:2026-10-01",
  signal: "cap",
  kind: "now",
  area: "Budget",
  clientId: "lumen",
  severity: 2,
  facts: { usedPct: 92 },
  title: "Lumen is at 92% of October's cap",
  body: "6 working days left.",
  wordedTitle: null,
  wordedBody: null,
  isReminder: true,
  firstSeen: "2026-10-20T05:00:00.000Z",
  lastSeen: "2026-10-21T05:00:00.000Z",
  resolvedAt: null,
  doneAt: null,
  snoozedUntil: null,
  snoozedAtSeverity: null,
  ...over,
});

describe("mergeFindings", () => {
  it("inserts a new finding with its action in the facts", () => {
    const p = mergeFindings([], [finding()], NOW);
    expect(p.insert).toHaveLength(1);
    expect(p.insert[0].facts).toMatchObject({ usedPct: 92, href: "/client-reports", action: "Send a heads-up" });
  });

  it("resolves a row no check finds any more — the automatic done", () => {
    expect(mergeFindings([row()], [], NOW).resolve).toEqual(["r1"]);
  });

  it("never resolves the daily run's ideas", () => {
    expect(mergeFindings([row({ signal: "idea", key: "idea:1" })], [], NOW).resolve).toEqual([]);
  });

  it("keeps a snooze while the finding is no worse", () => {
    const p = mergeFindings([row({ snoozedUntil: "2026-10-25", snoozedAtSeverity: 2, facts: { usedPct: 92, href: "/client-reports", action: "Send a heads-up" } })], [finding()], NOW);
    expect(p.update).toEqual([]);
  });

  it("writes nothing for an unchanged finding, whatever order jsonb kept its keys in", () => {
    const stored = row({ facts: { action: "Send a heads-up", href: "/client-reports", usedPct: 92 } });
    expect(mergeFindings([stored], [finding()], NOW).update).toEqual([]);
  });

  it("applyPlan gives the rows as written, without a read", () => {
    const p = mergeFindings([row(), row({ id: "r2", key: "gone" })], [finding({ severity: 3 })], NOW);
    const after = applyPlan([row(), row({ id: "r2", key: "gone" })], p, [], NOW);
    expect(after.find((r) => r.id === "r1")?.severity).toBe(3);
    expect(after.find((r) => r.id === "r2")?.resolvedAt).toBe(NOW);
  });

  it("breaks a snooze, or a done, when the finding gets worse", () => {
    for (const hidden of [{ snoozedUntil: "2026-10-25" }, { doneAt: "2026-10-21T08:00:00Z" }]) {
      const p = mergeFindings([row({ ...hidden, snoozedAtSeverity: 2 })], [finding({ severity: 3 })], NOW);
      expect(p.update[0].patch).toMatchObject({ snoozedUntil: null, doneAt: null, snoozedAtSeverity: null });
      expect(p.update[0].patch.facts).toMatchObject({ changed: true });
    }
  });

  it("drops Claude's wording when the figures change", () => {
    const p = mergeFindings([row({ wordedTitle: "Lumen is filling up" })], [finding({ title: "Lumen is at 95% of October's cap" })], NOW);
    expect(p.update[0].patch.wordedTitle).toBeNull();
  });

  it("reopens a resolved row that comes back", () => {
    const p = mergeFindings([row({ resolvedAt: "2026-10-21T05:00:00Z" })], [finding()], NOW);
    expect(p.update[0].patch.resolvedAt).toBeNull();
  });
});

describe("visible", () => {
  it("hides done, resolved and snoozed rows; a snooze ends on its date", () => {
    const rows = [
      row({ id: "a", key: "a" }),
      row({ id: "b", key: "b", doneAt: NOW }),
      row({ id: "c", key: "c", resolvedAt: NOW }),
      row({ id: "d", key: "d", snoozedUntil: "2026-10-25" }),
      row({ id: "e", key: "e", snoozedUntil: "2026-10-22" }),
    ];
    expect(visible(rows, "2026-10-22").map((r) => r.id)).toEqual(["a", "e"]);
  });

  it("puts Do now first, then the worst", () => {
    const rows = [row({ id: "h", key: "h", kind: "heads", severity: 3 }), row({ id: "n1", key: "n1", severity: 1 }), row({ id: "n2", key: "n2", severity: 3 })];
    expect(visible(rows, "2026-10-22").map((r) => r.id)).toEqual(["n2", "n1", "h"]);
  });
});

describe("toDb", () => {
  it("names the columns", () => {
    expect(toDb({ snoozedUntil: "2026-10-25", snoozedAtSeverity: 2 })).toEqual({ snoozed_until: "2026-10-25", snoozed_at_severity: 2 });
  });
});
