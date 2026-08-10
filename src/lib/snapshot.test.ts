import { describe, expect, it } from "vitest";
import { refreshVerdict } from "./snapshot";

// The rule that decides whether a background refresh may paint over what the
// user is looking at. It exists because of a real complaint — "sometimes when I
// change something it jumps back" — and the cases below are the ones that
// actually produced it, so they're worth keeping honest.
//
// The subtle one is `write-settled-before-response`. The obvious guard, "is a
// write in flight right now?", passes there: the write went out AND came back
// while the refresh was still in the air, so at apply time nothing looks busy —
// yet the rows in hand were read before the edit and applying them reverts it.

const base = { mine: 1, generation: 1, seenWrites: 7, writeSeq: 7, focused: false };

describe("refreshVerdict", () => {
  it("applies a response nothing has overtaken", () => {
    expect(refreshVerdict(base)).toBe("apply");
  });

  it("drops a response a newer refresh or a boot has superseded", () => {
    // Silently: a newer read is already on its way, so refetching would just
    // stack another one behind it.
    expect(refreshVerdict({ ...base, generation: 2 })).toBe("stale");
  });

  it("defers when the user wrote while the fetch was in the air", () => {
    expect(refreshVerdict({ ...base, writeSeq: 8 })).toBe("deferred");
  });

  it("defers even when that write has already settled", () => {
    // THE regression case. `writeSeq` counts writes ISSUED and never goes down,
    // which is the whole reason it can answer this and a busy-counter can't.
    expect(refreshVerdict({ ...base, writeSeq: 9, focused: false })).toBe("deferred");
  });

  it("defers while focus sits in an editor", () => {
    expect(refreshVerdict({ ...base, focused: true })).toBe("deferred");
  });

  it("prefers stale over deferred — a superseded response is not worth refetching", () => {
    expect(refreshVerdict({ ...base, generation: 2, writeSeq: 8, focused: true })).toBe("stale");
  });
});
