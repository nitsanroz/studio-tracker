import { describe, expect, it } from "vitest";
import {
  fetchCold,
  fetchHot,
  fetchTasks,
  fingerprint,
  historyEpochShouldMove,
  idleTransition,
  pollDecision,
  refreshVerdict,
  wakeTransition,
} from "./snapshot";
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
    await fetchHot(sb);
    const te = calls.filter((c) => c.table === "time_entries");
    expect(te).toHaveLength(1);
    expect(te[0].limit).toBe(400);
  });

  it("a hot tick does not touch tasks at all", async () => {
    // The other half of the egress fix, and the one a future edit is most
    // likely to undo by folding the tasks query back into fetchHot: at ~2.5 MB
    // it was 88% of what a 60-second tick cost.
    const { sb, calls } = recordingClient();
    await fetchHot(sb);
    expect(calls.filter((c) => c.table === "tasks")).toHaveLength(0);
    expect(calls.map((c) => c.table).sort()).toEqual([
      "dev_items",
      "plan_entries",
      "task_requests",
      "time_entries",
    ]);
  });

  it("fetchTasks is the one that pages tasks, keeping the top rung's columns", async () => {
    const { sb, calls } = recordingClient();
    await fetchTasks(sb, { tagNames: new Map(), projectClient: new Map() });
    const t = calls.filter((c) => c.table === "tasks");
    expect(t).toHaveLength(1);
    // Top rung of the ladder: every migration's column present. A silent drop
    // to a lower rung would take real fields off every task in the studio.
    for (const col of ["group_id", "type_id", "timeline_position", "start_date", "legacy_hours"]) {
      expect(t[0].columns).toContain(col);
    }
    // `brief` is per-task detail, fetched lazily — never in the list query.
    expect(t[0].columns).not.toContain("brief");
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

// ── fingerprint, now that tasks and sums are passed in ───────────────────
// It answers one question: did somebody ELSE change something an undo step
// could be sitting on? A false "yes" expires the user's undo history, so the
// half that matters most is that a hot tick with unchanged data holds still.

const hot = (over: Partial<HotSnapshot> = {}) =>
  ({
    planEntries: [],
    timeEntries: [{ id: "e1", minutes: 60 }],
    taskRequests: [],
    devItems: [],
    ...over,
  }) as unknown as HotSnapshot;

const sums = (minutes: number[]) =>
  minutes.map((m, i) => ({ id: `s${i}`, minutes: m })) as unknown as EntrySum[];

/** The cross-tier half of the print: what the last server response held. */
const server = (entrySums: EntrySum[], tasks: unknown[] = []) =>
  ({ entrySums, tasks }) as unknown as Parameters<typeof fingerprint>[1];

const task = (id: string, title: string) => ({ id, title, status: "todo" });

describe("fingerprint", () => {
  it("holds still across a hot tick that changed nothing", () => {
    // THE regression this guards. `entrySums` only arrives every ~10 minutes
    // now, so reading it off the hot snapshot would compare a full set against
    // an absent one and report a change every single minute — silently clearing
    // the undo history of anyone with a tab open.
    const carried = sums([30, 45]);
    expect(fingerprint(hot(), server(carried))).toBe(fingerprint(hot(), server(carried)));
  });

  it("still notices a change in the entry totals when a cold tick brings them", () => {
    expect(fingerprint(hot(), server(sums([30, 45])))).not.toBe(
      fingerprint(hot(), server(sums([30, 50]))),
    );
  });

  it("notices a new entry with the same total", () => {
    // Count and sum are both in the print, so a split entry can't hide.
    expect(fingerprint(hot(), server(sums([60])))).not.toBe(
      fingerprint(hot(), server(sums([30, 30]))),
    );
  });

  it("holds still on the two ticks in three that don't refetch tasks", () => {
    // Same shape as the entries case above, for the tier added on 2026-08-18:
    // tasks now arrive every 3rd tick, so a tick that didn't fetch them passes
    // the previous list through and the print must not move.
    const carried = server(sums([30]), [task("t1", "Homepage")]);
    expect(fingerprint(hot(), carried)).toBe(fingerprint(hot(), carried));
  });

  it("still notices a colleague renaming a task when the tasks tick lands", () => {
    expect(fingerprint(hot(), server(sums([30]), [task("t1", "Homepage")]))).not.toBe(
      fingerprint(hot(), server(sums([30]), [task("t1", "Home page")])),
    );
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
    expect(fingerprint(a, server(carried))).not.toBe(fingerprint(b, server(carried)));
  });
});

// ── an optional table may only be blanked by a MISSING table ─────────────
// `links`, `timeline_marks`, `task_types`, `task_groups`, `client_billing_periods`
// and `plan_day_states` are each fetched tolerantly, because the migration that
// creates them may not have been run yet. That tolerance was a bare
// `.catch(() => [])` until v1.21.1, and an empty list is INDISTINGUISHABLE FROM
// THE TRUTH here — it renders as "no links anywhere", with no banner and nothing
// in the console. So one timed-out query, one 401 during a token refresh, or the
// 402 Supabase returns over quota silently took every link in the app off the
// screen until a later cold refresh happened to succeed. Reported 20 Aug 2026 as
// a link that would not stay put.

/** Like `recordingClient`, but one table answers with an error. */
function failingClient(failTable: string, error: { message: string; code?: string }) {
  /* eslint-disable @typescript-eslint/no-explicit-any -- test double for the DB boundary */
  const select = (table: string) => {
    const chain: any = {
      range: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (r: any) => void) =>
        resolve(table === failTable ? { data: null, error } : { data: [], error: null }),
    };
    return chain;
  };
  const sb: any = { from: (table: string) => ({ select: () => select(table) }) };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return sb;
}

describe("optional tables in the cold snapshot", () => {
  it("reads a table the migration hasn't created yet as no rows", async () => {
    // 42P01 = undefined_table. This is the ONLY thing an empty list may mean.
    const snap = await fetchCold(failingClient("links", { message: "no such table", code: "42P01" }));
    expect(snap.links).toEqual([]);
  });

  it("REFUSES to read a failed links query as an empty studio", async () => {
    // No code at all — a timeout, a dropped connection, a 402 over quota. The
    // boot path turns this into an error screen and the refresh path keeps the
    // data already on screen; both beat inventing "no links anywhere".
    await expect(fetchCold(failingClient("links", { message: "Payment Required" }))).rejects.toThrow();
  });

  it("refuses on a permission error too, rather than blanking the table", async () => {
    // 42501 = insufficient_privilege. Genuinely broken grants must be visible,
    // not rendered as a studio that never saved a link.
    await expect(
      fetchCold(failingClient("links", { message: "permission denied for table links", code: "42501" })),
    ).rejects.toThrow();
  });

  it("applies the same rule to every other optional table", async () => {
    for (const table of [
      "timeline_marks",
      "task_types",
      "task_groups",
      "client_billing_periods",
      "plan_day_states",
    ]) {
      await expect(fetchCold(failingClient(table, { message: "boom" }))).rejects.toThrow();
    }
  });
});

/**
 * ⚠️ `dev_items` kept a bare `.catch(() => [])` after the v1.21.1 sweep fixed the
 * six tables in `fetchCold`. Swallowing every failure renders as a client with
 * nothing in development — indistinguishable from the truth, no banner, nothing
 * in the console — including the 402 the project returns over quota, which is the
 * one failure `isServiceBlocked` exists to surface.
 */
describe("dev_items in the hot snapshot", () => {
  it("reads a table the migration hasn't created yet as no rows", async () => {
    const snap = await fetchHot(failingClient("dev_items", { message: "no such table", code: "42P01" }));
    expect(snap.devItems).toEqual([]);
  });

  it("REFUSES to read a quota refusal as an empty dev list", async () => {
    await expect(
      fetchHot(failingClient("dev_items", { message: "Payment Required" })),
    ).rejects.toThrow();
  });

  it("REFUSES to read a permission error as an empty dev list", async () => {
    await expect(
      fetchHot(failingClient("dev_items", { message: "permission denied", code: "42501" })),
    ).rejects.toThrow();
  });
});

/**
 * ⚠️ THE UNDO HISTORY USED TO BE DESTROYED BY THE USER'S OWN EDIT. The
 * fingerprint is computed from the SERVER response, so a local change alters it
 * the moment it comes back — the epoch was bumped, and the next ⌘Z wiped the
 * history claiming "Someone else changed the studio data since then" when nobody
 * had. Every mutation reaches the print, so undo lasted under a minute.
 */
describe("historyEpochShouldMove", () => {
  it("moves when the data changed and we wrote nothing", () => {
    // the only case that is definitively somebody else
    expect(historyEpochShouldMove({ printChanged: true, wroteSincePrint: false })).toBe(true);
  });

  it("does NOT move for a change we caused ourselves", () => {
    expect(historyEpochShouldMove({ printChanged: true, wroteSincePrint: true })).toBe(false);
  });

  it("does not move on a quiet tick", () => {
    expect(historyEpochShouldMove({ printChanged: false, wroteSincePrint: false })).toBe(false);
    expect(historyEpochShouldMove({ printChanged: false, wroteSincePrint: true })).toBe(false);
  });
});

// ── whether to poll at all ───────────────────────────────────────────────
// An open tab costs ~110 MB/hour in polling, so a tracker left on a second
// monitor for a working day spends ~880 MB of a 5 GB monthly allowance without
// anyone touching it. That is what got the project cut off with a 402. These
// cases are the rule that stops it, and the 15-minute threshold is only safe
// because waking is immediate — see `catchUp` in store.tsx.

const IDLE = 15 * 60_000;
const decide = (over: Partial<Parameters<typeof pollDecision>[0]> = {}) =>
  pollDecision({ hidden: false, msSinceActivity: 0, idleAfterMs: IDLE, ...over });

describe("pollDecision", () => {
  it("polls a tab someone is using", () => {
    expect(decide()).toBe("poll");
    expect(decide({ msSinceActivity: 60_000 })).toBe("poll");
  });

  it("keeps polling through an ordinary pause in work", () => {
    // Reading a brief, a phone call, a conversation over a desk. The threshold
    // has to sit well beyond these or people would notice it.
    expect(decide({ msSinceActivity: 14 * 60_000 })).toBe("poll");
  });

  it("stops once the tab has been untouched for the full interval", () => {
    expect(decide({ msSinceActivity: IDLE })).toBe("skip-idle");
    expect(decide({ msSinceActivity: 8 * 3_600_000 })).toBe("skip-idle");
  });

  it("hidden beats idle, and is reported separately", () => {
    // Different reasons, and the store treats them differently: a hidden tab
    // says nothing to the user, while an idle one dims the sync dot.
    expect(decide({ hidden: true })).toBe("skip-hidden");
    expect(decide({ hidden: true, msSinceActivity: IDLE })).toBe("skip-hidden");
  });

  it("is exclusive at the boundary, so the threshold can't be off by a tick", () => {
    expect(decide({ msSinceActivity: IDLE - 1 })).toBe("poll");
    expect(decide({ msSinceActivity: IDLE })).toBe("skip-idle");
  });
});

// ── the idle state machine ───────────────────────────────────────────────
// The transitions, which are what a browser test would have exercised and
// couldn't: the dev preview reloads the page, reports document.hidden while the
// pane is off screen, and slows the tick tenfold. Two properties matter — the
// pause is announced ONCE however long it lasts, and waking ALWAYS catches up.

describe("idleTransition", () => {
  it("a used tab is not paused and says nothing", () => {
    expect(idleTransition(false, "poll")).toEqual({ paused: false, announce: false, catchUp: false });
  });

  it("announces the pause exactly once, not on every later tick", () => {
    // A paused tab keeps deciding skip-idle every minute; re-announcing would
    // re-render the whole app once a minute for as long as it sits there.
    expect(idleTransition(false, "skip-idle")).toEqual({
      paused: true,
      announce: true,
      catchUp: false,
    });
    expect(idleTransition(true, "skip-idle")).toEqual({
      paused: true,
      announce: false,
      catchUp: false,
    });
  });

  it("a hidden tab neither pauses nor un-pauses", () => {
    // ⚠️ Both directions. Hiding must not claim "paused while you're away" —
    // nobody is looking — and it must not clear a pause that was already set,
    // or hiding and showing a tab would silently resume polling forever.
    expect(idleTransition(false, "skip-hidden")).toEqual({
      paused: false,
      announce: false,
      catchUp: false,
    });
    expect(idleTransition(true, "skip-hidden")).toEqual({
      paused: true,
      announce: false,
      catchUp: false,
    });
  });

  it("resuming clears the pause without announcing anything", () => {
    // The clock alone can't wake it — only input can, via wakeTransition — so a
    // "poll" decision while paused should never happen, and if it does the state
    // must land un-paused rather than stuck.
    expect(idleTransition(true, "poll")).toEqual({
      paused: false,
      announce: false,
      catchUp: false,
    });
  });
});

describe("wakeTransition", () => {
  it("waking from a pause catches up", () => {
    // THE property that makes pausing safe. Without this a woken tab would show
    // whatever it held when it fell asleep, which is the silent-staleness bug
    // this whole change is supposed to avoid.
    expect(wakeTransition(true)).toEqual({ paused: false, catchUp: true });
  });

  it("ordinary input on a live tab fetches nothing", () => {
    // This runs on every pointermove. If it asked for a refresh, moving the
    // mouse would hammer the database.
    expect(wakeTransition(false)).toEqual({ paused: false, catchUp: false });
  });
});
