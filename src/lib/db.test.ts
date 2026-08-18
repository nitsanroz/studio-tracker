import { describe, expect, it } from "vitest";
import { DbError, isMissingSchema, isServiceBlocked } from "./db";

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
