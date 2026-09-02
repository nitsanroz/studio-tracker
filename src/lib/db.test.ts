import { describe, expect, it } from "vitest";
import { DbError, canonicalReportLink, fetchAll, isMissingSchema, isServiceBlocked } from "./db";
import type { ReportLink } from "./types";

describe("isMissingSchema", () => {
  it("recognises a missing column on a SELECT", () => {
    expect(isMissingSchema(new DbError("tasks", "column x does not exist", "42703"))).toBe(true);
  });

  it("recognises a missing table", () => {
    expect(isMissingSchema(new DbError("links", "relation does not exist", "42P01"))).toBe(true);
  });

  /**
   * ⚠️ The one this suite exists for. Postgres raises 42703 for a SELECT, but an
   * INSERT or UPDATE is refused a layer earlier by PostgREST with PGRST204 — so a
   * write-side fallback keyed only on 42703 silently never fires. That is exactly
   * what broke every intake submission while 0029 was pending (v1.19.4).
   */
  it("recognises a missing column on a WRITE, which reports a different code", () => {
    expect(
      isMissingSchema(
        new DbError(
          "task_requests",
          "Could not find the 'edit_key' column of 'task_requests' in the schema cache",
          "PGRST204",
        ),
      ),
    ).toBe(true);
  });

  it("does not swallow a real failure", () => {
    // A permission error, a constraint violation and a network error are all
    // genuine and must surface rather than degrading to a narrower query.
    expect(isMissingSchema(new DbError("tasks", "permission denied", "42501"))).toBe(false);
    expect(isMissingSchema(new DbError("tasks", "violates check constraint", "23514"))).toBe(false);
    expect(isMissingSchema(new DbError("tasks", "fetch failed"))).toBe(false);
    expect(isMissingSchema(new Error("fetch failed"))).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });
});

// `isServiceBlocked` decides whether a failure gets a BANNER or stays silent, so
// its narrowness is the feature. A background refresh failing is normally a
// dropped connection — nothing the user can act on — and promoting those to a
// banner is how people learn to ignore banners. Only Supabase's 402 quota
// refusal qualifies: persistent, actionable, and otherwise invisible.

describe("isServiceBlocked", () => {
  it("catches the 402 by status", () => {
    expect(isServiceBlocked(new DbError("profiles", "Payment Required", undefined, 402))).toBe(true);
  });

  it("catches it by message when the status was lost on the way", () => {
    // Paths that build a query directly used to throw a plain Error, so the
    // message is the fallback. Observed verbatim from a forced 402 in the app.
    expect(isServiceBlocked(new Error("profiles: Payment Required"))).toBe(true);
  });

  it("ignores an ordinary dropped connection", () => {
    expect(isServiceBlocked(new Error("Failed to fetch"))).toBe(false);
    expect(isServiceBlocked(new DbError("tasks", "network error"))).toBe(false);
  });

  it("ignores a missing column, which has its own ladder", () => {
    // 42703 must keep degrading quietly through the column ladder — see
    // snapshot.ts. A banner there would fire on any un-applied migration.
    const missing = new DbError("tasks", "column does not exist", "42703", 400);
    expect(isServiceBlocked(missing)).toBe(false);
    expect(isMissingSchema(missing)).toBe(true);
  });

  it("ignores other HTTP failures — 401, 403, 500 are not quota refusals", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      expect(isServiceBlocked(new DbError("tasks", "nope", undefined, status))).toBe(false);
    }
  });

  it("ignores non-errors", () => {
    expect(isServiceBlocked(null)).toBe(false);
    expect(isServiceBlocked("Payment Required")).toBe(false);
  });
});

describe("canonicalReportLink", () => {
  const link = (over: Partial<ReportLink>): ReportLink =>
    ({
      id: "x",
      clientId: "c",
      token: "t",
      preset: null,
      dateFrom: null,
      dateTo: null,
      active: true,
      createdAt: "2026-01-01T00:00:00Z",
      snapshot: null,
      publishedAt: null,
      hiddenColumns: [],
      hiddenTaskIds: [],
      viewFlags: null,
      ...over,
    }) as ReportLink;

  it("returns null for no links", () => {
    expect(canonicalReportLink([])).toBeNull();
  });

  it("prefers a published link over a NEWER unpublished one", () => {
    const published = link({ id: "old", createdAt: "2026-01-01T00:00:00Z", publishedAt: "2026-02-01T00:00:00Z" });
    const newer = link({ id: "new", createdAt: "2026-06-01T00:00:00Z" });
    expect(canonicalReportLink([newer, published])?.id).toBe("old");
    expect(canonicalReportLink([published, newer])?.id).toBe("old");
  });

  it("falls back to the OLDEST when none is published", () => {
    const a = link({ id: "old", createdAt: "2026-01-01T00:00:00Z" });
    const b = link({ id: "new", createdAt: "2026-06-01T00:00:00Z" });
    expect(canonicalReportLink([b, a])?.id).toBe("old");
  });

  it("prefers the oldest published when two are published", () => {
    const a = link({ id: "first", createdAt: "2026-01-01T00:00:00Z", publishedAt: "2026-03-01T00:00:00Z" });
    const b = link({ id: "second", createdAt: "2026-02-01T00:00:00Z", publishedAt: "2026-02-01T00:00:00Z" });
    expect(canonicalReportLink([b, a])?.id).toBe("first");
  });
});

/**
 * ⚠️ `fetchAll` PAGED WITH NO ORDER BY. PostgREST adds no implicit one and
 * Postgres gives no stable order for LIMIT/OFFSET without it, so page 2 — a
 * separate query — could repeat a row from page 1 or skip one whenever the heap
 * moved in between. `time_entries` is ~24,000 rows over 25 pages, refetched
 * while designers log hours into it: a skipped row is hours silently missing
 * from every client report and per-person figure.
 */
describe("fetchAll paging", () => {
  /** Records the query chain and serves `total` rows named by index. */
  function stub(total: number) {
    const calls: { ordered: string[]; ranges: [number, number][] } = { ordered: [], ranges: [] };
    const sb = {
      from: () => ({
        select: () => {
          const chain: Record<string, unknown> = {};
          chain.order = (col: string) => {
            calls.ordered.push(col);
            return chain;
          };
          chain.range = (a: number, b: number) => {
            calls.ranges.push([a, b]);
            const rows = [];
            for (let i = a; i <= b && i < total; i++) rows.push({ id: `r${i}` });
            return Promise.resolve({ data: rows, error: null, status: 200 });
          };
          return chain;
        },
      }),
    };
    return { sb, calls };
  }

  it("orders by a stable unique key on every page", async () => {
    const { sb, calls } = stub(2500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fetchAll(sb as any, "time_entries", "*");
    expect(calls.ordered).toEqual(["id", "id", "id"]);
  });

  it("returns every row exactly once across pages", async () => {
    const { sb } = stub(2500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchAll<{ id: string }>(sb as any, "time_entries", "*");
    expect(rows.length).toBe(2500);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
  });

  it("stops after a short page rather than asking for another", async () => {
    const { sb, calls } = stub(1500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fetchAll(sb as any, "tasks", "*");
    expect(calls.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("needs no extra request when the total is an exact multiple", async () => {
    const { sb, calls } = stub(1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchAll(sb as any, "tasks", "*");
    expect(rows.length).toBe(1000);
    expect(calls.ranges.length).toBe(2); // second page comes back empty and ends it
  });
});
