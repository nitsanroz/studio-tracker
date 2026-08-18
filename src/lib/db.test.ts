import { describe, expect, it } from "vitest";
import { DbError, isMissingSchema } from "./db";

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
