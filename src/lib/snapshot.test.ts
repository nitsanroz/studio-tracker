import { describe, expect, it } from "vitest";
import { fetchCold, fetchHot, fingerprint, refreshVerdict } from "./snapshot";
import type { HotSnapshot } from "./snapshot";
import type { EntrySum } from "./types";

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

// ── which tier reads what ────────────────────────────────────────────────
// `time_entries` is by far the biggest table in the studio (~10 years, tens of
// thousands of rows), and paging ALL of it every 60 seconds per open tab is what
// pushed Supabase egress past the free tier (8.08 GB against 5 GB). The split
// below is the fix, and it is one a future edit could silently undo — moving the
// fetch back onto the hot tier costs nothing at the type level and nothing in
// the UI, and would only show up on a billing dashboard weeks later.

type Call = { table: string; columns: string; limit: number | null };

/** Minimal supabase-shaped stub that records what was asked for, and returns nothing. */
function recordingClient() {
  const calls: Call[] = [];
  const select = (table: string, columns: string) => {
    const call: Call = { table, columns, limit: null };
    calls.push(call);
    /* eslint-disable @typescript-eslint/no-explicit-any -- test double for the DB boundary */
    const chain: any = {
      range: () => chain,
      not: () => chain,
      order: () => chain,
      limit: (n: number) => {
        call.limit = n;
        return chain;
      },
      // awaiting a PostgrestBuilder resolves it — one empty page ends fetchAll's loop
      then: (resolve: (r: { data: never[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return chain;
  };
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- ditto */
  const sb: any = {
    from: (table: string) => ({ select: (columns: string) => select(table, columns) }),
  };
  return { sb, calls };
}

describe("refresh tiers", () => {
  it("a hot tick reads time_entries ONLY as the 400-row feed window", async () => {
    const { sb, calls } = recordingClient();
    await fetchHot(sb, { tagNames: new Map(), projectClient: new Map() });
    const te = calls.filter((c) => c.table === "time_entries");
    expect(te).toHaveLength(1);
    expect(te[0].limit).toBe(400);
  });

  it("the whole table is paged on the cold tick, with the legacy flag intact", async () => {
    const { sb, calls } = recordingClient();
    await fetchCold(sb);
    const te = calls.filter((c) => c.table === "time_entries");
    expect(te).toHaveLength(1);
    expect(te[0].limit).toBeNull();
    // Top rung of the degradation ladder. Losing `legacy` here is the expensive
    // mistake the ladder exists to prevent — see the header of snapshot.ts.
    expect(te[0].columns).toContain("legacy");
    expect(te[0].columns).toContain("date_estimated");
  });
});

// ── fingerprint, now that the sums are passed in ──────────────────────────
// It answers one question: did somebody ELSE change something an undo step
// could be sitting on? A false "yes" expires the user's undo history, so the
// half that matters most is that a hot tick with unchanged data holds still.

const hot = (over: Partial<HotSnapshot> = {}) =>
  ({
    tasks: [],
    planEntries: [],
    timeEntries: [{ id: "e1", minutes: 60 }],
    taskRequests: [],
    devItems: [],
    ...over,
  }) as unknown as HotSnapshot;

const sums = (minutes: number[]) =>
  minutes.map((m, i) => ({ id: `s${i}`, minutes: m })) as unknown as EntrySum[];

describe("fingerprint", () => {
  it("holds still across a hot tick that changed nothing", () => {
    // THE regression this guards. `entrySums` only arrives every ~10 minutes
    // now, so reading it off the hot snapshot would compare a full set against
    // an absent one and report a change every single minute — silently clearing
    // the undo history of anyone with a tab open.
    const carried = sums([30, 45]);
    expect(fingerprint(hot(), carried)).toBe(fingerprint(hot(), carried));
  });

  it("still notices a change in the entry totals when a cold tick brings them", () => {
    expect(fingerprint(hot(), sums([30, 45]))).not.toBe(fingerprint(hot(), sums([30, 50])));
  });

  it("notices a new entry with the same total", () => {
    // Count and sum are both in the print, so a split entry can't hide.
    expect(fingerprint(hot(), sums([60]))).not.toBe(fingerprint(hot(), sums([30, 30])));
  });

  it("notices recent activity from the feed alone, at the hot cadence", () => {
    // Why the 400-row window is folded in: it's the only view of time entries a
    // hot tick has, and recent rows are the only ones an undo step can target.
    const a = hot({ timeEntries: [{ id: "e1", minutes: 60 }] } as Partial<HotSnapshot>);
    const b = hot({
      timeEntries: [
        { id: "e1", minutes: 60 },
        { id: "e2", minutes: 15 },
      ],
    } as Partial<HotSnapshot>);
    const carried = sums([30]);
    expect(fingerprint(a, carried)).not.toBe(fingerprint(b, carried));
  });
});
