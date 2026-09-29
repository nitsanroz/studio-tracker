import { describe, expect, it } from "vitest";
import {
  formatScore,
  interviewAverage,
  overallScore,
  isOnBoard,
  splitApplicationReview,
  APPLICATION_REVIEW_KIND,
  scoreTone,
  subjectAverage,
  type Candidate,
  type Interview,
  type ScoreSubject,
} from "./types";

const iv = (at: string, scores: Record<string, number>): Interview => ({
  id: at,
  candidateId: "c1",
  kind: "Interview",
  heldOn: at,
  heldAtTime: null,
  interviewerId: null,
  summary: null,
  createdAt: `${at}T09:00:00Z`,
  scores,
});

const subject = (params: string[]): ScoreSubject => ({
  id: "s1",
  name: "Personality",
  position: 1,
  active: true,
  fromSubmission: false,
  params: params.map((id, i) => ({
    id,
    subjectId: "s1",
    name: id,
    position: i + 1,
    active: true,
  })),
});

describe("interviewAverage", () => {
  it("averages the scores that were given", () => {
    expect(interviewAverage({ a: 9, b: 8, c: 7 })).toBe(8);
  });

  /**
   * ⚠️ THE ONE THAT MATTERS. A parameter nobody scored is ABSENT, and counting
   * it as 0 would punish an interviewer for skipping a question — dragging a
   * genuine 9 down to 4.5 because half the card was left blank.
   */
  it("ignores parameters that were never scored", () => {
    expect(interviewAverage({ a: 9 })).toBe(9);
  });

  it("returns null when nothing was scored at all", () => {
    expect(interviewAverage({})).toBeNull();
  });

  it("keeps the fraction rather than rounding early", () => {
    // 8+7+7 = 22/3. Rounding here would make two interviews that differ by a
    // third of a point display as identical.
    expect(interviewAverage({ a: 8, b: 7, c: 7 })).toBeCloseTo(7.3333, 4);
  });
});

describe("subjectAverage", () => {
  it("averages only that subject's own parameters", () => {
    // `other` belongs to a different subject and must not be counted.
    const scores = { p1: 9, p2: 7, other: 1 };
    expect(subjectAverage(subject(["p1", "p2"]), scores)).toBe(8);
  });

  it("returns null when none of its parameters were scored", () => {
    expect(subjectAverage(subject(["p1", "p2"]), { other: 9 })).toBeNull();
  });

  /** A subject can hold 3–8 parameters; a partly-filled column still averages. */
  it("averages a partly filled subject over what is there", () => {
    const wide = subject(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
    expect(subjectAverage(wide, { p1: 8, p2: 6 })).toBe(7);
  });
});

describe("formatScore", () => {
  it("always shows one decimal so a column reads at one precision", () => {
    expect(formatScore(8)).toBe("8.0");
    expect(formatScore(7.25)).toBe("7.3");
  });

  it("shows a dash rather than a number when there is no score", () => {
    expect(formatScore(null)).toBe("—");
  });
});

describe("scoreTone", () => {
  it("bands at 8 and 6, inclusive at the boundary", () => {
    expect(scoreTone(8)).toBe("high");
    expect(scoreTone(7.9)).toBe("mid");
    expect(scoreTone(6)).toBe("mid");
    expect(scoreTone(5.9)).toBe("low");
  });

  it("has its own band for no score, never 'low'", () => {
    // Unscored and bad must not look the same — one is a missing write-up.
    expect(scoreTone(null)).toBe("none");
  });
});

describe("isOnBoard", () => {
  const base: Candidate = {
    id: "c1",
    name: "A",
    email: null,
    phone: null,
    roleId: null,
    stageId: null,
    ownerId: null,
    status: "active",
    outcome: null,
    archivedAt: null,
    source: null,
    applicationText: null,
    appliedOn: null,
    lastActivityAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    interviewCount: 0,
    linkCount: 0,
    commentCount: 0,
    avgScore: null,
  };

  /**
   * ⚠️ The rule the Asana board did not have. 140 of its 271 cards sat in a
   * "To Reject" column, making the widest column on screen the one nobody
   * wanted to read.
   */
  it("keeps only active candidates on the board", () => {
    expect(isOnBoard(base)).toBe(true);
    expect(isOnBoard({ ...base, status: "on_hold" })).toBe(false);
    expect(isOnBoard({ ...base, status: "archived", outcome: "rejected" })).toBe(false);
    // Hired leaves the board too — a decision is a decision either way.
    expect(isOnBoard({ ...base, status: "archived", outcome: "hired" })).toBe(false);
  });
});

describe("overallScore", () => {
  it("is just the average when there is one interview", () => {
    expect(overallScore([iv("2026-09-01", { a: 8, b: 6 })])).toBe(7);
  });

  /**
   * ⚠️ THE SHAPE OF THE WHOLE THING. Two interviews weight 1:2, so the later
   * one is two thirds of the answer — a physical interview outweighing a phone
   * screen without erasing it. (6×1 + 9×2) / 3 = 8.
   */
  it("weights the later interview twice the earlier", () => {
    const r = overallScore([iv("2026-09-01", { a: 6 }), iv("2026-09-20", { a: 9 })]);
    expect(r).toBe(8);
  });

  it("orders by when the interview happened, not the order given", () => {
    const later = iv("2026-09-20", { a: 9 });
    const earlier = iv("2026-09-01", { a: 6 });
    // Same answer whichever way round the array arrives.
    expect(overallScore([later, earlier])).toBe(8);
    expect(overallScore([earlier, later])).toBe(8);
  });

  /**
   * ⚠️ WHAT THE LINEAR WEIGHTS ACTUALLY BUY, pinned with real arithmetic
   * because the first version of this test asserted a number I had worked out
   * in my head and got wrong.
   *
   * Three 8s followed by a 2 gives 5.6. Compare: a flat mean gives 6.5, and
   * doubling weights gives 4.8. So the newest reading moves the figure a long
   * way — it SHOULD, it is the most informed one — without replacing the
   * earlier ones outright, which is the whole space between those two numbers.
   */
  it("lets the newest reading move the figure a long way without erasing the rest", () => {
    const r = overallScore([
      iv("2026-09-01", { a: 8 }),
      iv("2026-09-05", { a: 8 }),
      iv("2026-09-10", { a: 8 }),
      iv("2026-09-20", { a: 2 }),
    ]);
    // (8·1 + 8·2 + 8·3 + 2·4) / 10 = 56/10
    expect(r).toBeCloseTo(5.6, 5);
    // Below a flat mean (6.5) because the 2 is latest, above the 4.8 that
    // doubling weights would give, and nowhere near the 2 itself.
    expect(r!).toBeLessThan(6.5);
    expect(r!).toBeGreaterThan(4.8);
  });

  /** An interview nobody filled in holds no opinion and must not drag anything. */
  it("skips an interview with no scores at all", () => {
    const r = overallScore([iv("2026-09-01", { a: 9 }), iv("2026-09-20", {})]);
    expect(r).toBe(9);
  });

  it("returns null when nothing anywhere has been scored", () => {
    expect(overallScore([])).toBeNull();
    expect(overallScore([iv("2026-09-01", {})])).toBeNull();
  });

  /** An undated card is the newest thing we know, so it sorts last. */
  it("falls back to when the card was made", () => {
    const undated: Interview = { ...iv("2026-09-25", { a: 10 }), heldOn: null };
    const r = overallScore([iv("2026-09-01", { a: 4 }), undated]);
    expect(r).toBe(8); // (4·1 + 10·2) / 3
  });
});

describe("splitApplicationReview", () => {
  const app = (): Interview => ({ ...iv("2026-01-01", { p1: 8 }), kind: APPLICATION_REVIEW_KIND });

  it("lifts the application scorecard out of the interview list", () => {
    const a = app();
    const phone = iv("2026-02-01", { p1: 6 });
    const split = splitApplicationReview([a, phone]);
    expect(split.application).toBe(a);
    expect(split.interviews).toEqual([phone]);
  });

  it("reports no application when there is none", () => {
    const phone = iv("2026-02-01", { p1: 6 });
    const split = splitApplicationReview([phone]);
    expect(split.application).toBeNull();
    expect(split.interviews).toEqual([phone]);
  });

  // ⚠️ The kind was a free picker option before 0040, so a board can hold two.
  // Dropping the extra would hide numbers somebody recorded.
  it("keeps a second application-review row visible as an ordinary scorecard", () => {
    const first = app();
    const second: Interview = { ...app(), id: "second" };
    const split = splitApplicationReview([first, second]);
    expect(split.application).toBe(first);
    expect(split.interviews).toEqual([second]);
  });

  // The application is an opinion and must still weigh in the headline figure;
  // it is the interview LIST it leaves, not the scoring.
  it("leaves the caller free to score the full set", () => {
    const all = [app(), iv("2026-02-01", { p1: 2 })];
    expect(overallScore(all)).toBeCloseTo((8 * 1 + 2 * 2) / 3);
  });
});
