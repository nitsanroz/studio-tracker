import { describe, expect, it } from "vitest";
import {
  EMPTY_SPLIT,
  addEntry,
  billablePct,
  keysPct,
  keysTaskIds,
  newSplit,
  splitTitle,
  type HoursSplit,
} from "./hours-split";
import type { Client } from "./types";

// This file's own header states two invariants the reports page depends on:
// keys is a SUBSET of non-billable, and billable + keys + other === total with
// no overlap. Both are asserted here, because the failure mode is silent — a
// designer's billable share would simply read wrong, and nothing would throw.

const client = (over: Partial<Client> = {}): Client =>
  ({ id: "c1", name: "Acme", color: "#0b43ed", billable: true, ...over }) as Client;

/** Fold a list of entries in, the way the reports page does. */
const fold = (entries: { minutes: number; billable: boolean; keys: boolean }[]): HoursSplit =>
  entries.reduce((s, e) => addEntry(s, e.minutes, e), newSplit());

describe("addEntry", () => {
  it("is pure — the input split is not mutated", () => {
    // Not fastidiousness: the mutating version defeated the React Compiler's
    // memoization of the per-designer loop, per this module's header.
    const start = newSplit();
    addEntry(start, 60, { billable: true, keys: false });
    expect(start).toEqual(EMPTY_SPLIT);
  });

  it("puts billable minutes on the billable side only", () => {
    const s = addEntry(newSplit(), 90, { billable: true, keys: false });
    expect(s).toEqual({ total: 90, billable: 90, keys: 0, other: 0 });
  });

  it("counts a keys entry as non-billable, never as billable", () => {
    const s = addEntry(newSplit(), 90, { billable: false, keys: true });
    expect(s).toEqual({ total: 90, billable: 0, keys: 90, other: 0 });
  });

  it("ignores the keys flag on a billable entry", () => {
    // A keys task is non-billable by construction; if the data ever disagrees,
    // billable wins and keys must NOT also claim the minutes, or the parts
    // would sum past the total.
    const s = addEntry(newSplit(), 90, { billable: true, keys: true });
    expect(s).toEqual({ total: 90, billable: 90, keys: 0, other: 0 });
    expect(s.billable + s.keys + s.other).toBe(s.total);
  });

  it("keeps billable + keys + other === total over a mixed period", () => {
    const s = fold([
      { minutes: 120, billable: true, keys: false },
      { minutes: 30, billable: false, keys: true },
      { minutes: 45, billable: false, keys: false },
      { minutes: 15, billable: true, keys: true },
    ]);
    expect(s.total).toBe(210);
    expect(s.billable + s.keys + s.other).toBe(s.total);
    expect(s).toEqual({ total: 210, billable: 135, keys: 30, other: 45 });
  });

  it("handles a negative entry without breaking the identity", () => {
    // The recovery imported 68 `מפתח` reductions as negative minutes; they are
    // real ledger lines, so the identity has to survive them.
    const s = fold([
      { minutes: 120, billable: true, keys: false },
      { minutes: -30, billable: true, keys: false },
    ]);
    expect(s.total).toBe(90);
    expect(s.billable + s.keys + s.other).toBe(s.total);
  });
});

describe("billablePct", () => {
  it("is null with no hours, rather than 0", () => {
    // 0% and "no hours" are different claims about a designer's week.
    expect(billablePct(newSplit())).toBeNull();
  });

  it("rounds to a whole percent", () => {
    expect(billablePct(fold([
      { minutes: 100, billable: true, keys: false },
      { minutes: 200, billable: false, keys: false },
    ]))).toBe(33);
  });

  it("reads 100 when everything is billable", () => {
    expect(billablePct(fold([{ minutes: 60, billable: true, keys: false }]))).toBe(100);
  });
});

describe("keysPct", () => {
  it("is 0 with no hours, not NaN", () => {
    expect(keysPct(newSplit())).toBe(0);
  });

  it("is a share of the whole, not of the non-billable part", () => {
    const s = fold([
      { minutes: 75, billable: true, keys: false },
      { minutes: 25, billable: false, keys: true },
    ]);
    expect(keysPct(s)).toBe(25);
  });
});

describe("keysTaskIds", () => {
  it("reads clients.keys_task_id and never a title", () => {
    const ids = keysTaskIds([
      client({ id: "c1", keysTaskId: "t-keys" }),
      client({ id: "c2", keysTaskId: null }),
      client({ id: "c3", keysTaskId: "t-other" }),
    ] as Client[]);
    expect([...ids].sort()).toEqual(["t-keys", "t-other"]);
  });

  it("is empty when no client has chosen one", () => {
    expect(keysTaskIds([client({ keysTaskId: null })] as Client[]).size).toBe(0);
  });
});

describe("splitTitle", () => {
  it("names all three parts even when keys is zero", () => {
    // An omitted line reads as "not measured"; "keys 0h" is the answer.
    const t = splitTitle(fold([{ minutes: 60, billable: true, keys: false }]), "Nadav");
    expect(t).toContain("Nadav");
    expect(t).toContain("keys 0h (0%)");
    expect(t).toContain("billable 1h (100%)");
  });

  it("says so plainly when there are no hours", () => {
    expect(splitTitle(newSplit(), "Sefi")).toBe("Sefi — no hours in this period");
    expect(splitTitle(newSplit())).toBe("No hours in this period");
  });
});
