import { describe, expect, it } from "vitest";
import { makeMintCap } from "./mint-cap";

/**
 * The intake upload route's own cap counted objects that had LANDED in the
 * bucket — but that endpoint hands out a signed URL and writes nothing, so a
 * burst of calls that uploaded nothing saw an empty folder every time and was
 * never refused. This counter bounds what the endpoint issues.
 */
describe("makeMintCap", () => {
  const withClock = (max: number, windowMs: number) => {
    let t = 1_000_000;
    const cap = makeMintCap(max, windowMs, () => t);
    return { cap, advance: (ms: number) => (t += ms) };
  };

  it("allows up to the cap, then refuses", () => {
    const { cap } = withClock(3, 60_000);
    expect(cap.exceeded("a")).toBe(false);
    expect(cap.exceeded("a")).toBe(false);
    expect(cap.exceeded("a")).toBe(false);
    expect(cap.exceeded("a")).toBe(true);
    expect(cap.exceeded("a")).toBe(true);
  });

  it("counts each key separately", () => {
    const { cap } = withClock(1, 60_000);
    expect(cap.exceeded("a")).toBe(false);
    expect(cap.exceeded("a")).toBe(true);
    // another link must not inherit the first one's exhaustion
    expect(cap.exceeded("b")).toBe(false);
  });

  it("lets the allowance back once the window passes", () => {
    const { cap, advance } = withClock(2, 60_000);
    expect(cap.exceeded("a")).toBe(false);
    expect(cap.exceeded("a")).toBe(false);
    expect(cap.exceeded("a")).toBe(true);
    advance(60_001);
    expect(cap.exceeded("a")).toBe(false);
  });

  it("slides rather than resetting wholesale", () => {
    const { cap, advance } = withClock(2, 60_000);
    cap.exceeded("a"); // t0
    advance(40_000);
    cap.exceeded("a"); // t0+40s
    expect(cap.exceeded("a")).toBe(true);
    advance(21_000); // the first has aged out, the second has not
    expect(cap.exceeded("a")).toBe(false);
    expect(cap.exceeded("a")).toBe(true);
  });

  it("forgets an idle key instead of growing for ever", () => {
    const { cap, advance } = withClock(2, 60_000);
    cap.exceeded("a");
    expect(cap.size()).toBe(1);
    advance(60_001);
    cap.exceeded("b");
    // "a" is pruned the next time it is asked about
    cap.exceeded("a");
    expect(cap.size()).toBe(2);
  });

  it("a refused mint does not consume more allowance", () => {
    const { cap, advance } = withClock(1, 60_000);
    expect(cap.exceeded("a")).toBe(false);
    for (let i = 0; i < 50; i++) expect(cap.exceeded("a")).toBe(true);
    advance(60_001);
    // the 50 refusals must not have pushed the window forward
    expect(cap.exceeded("a")).toBe(false);
  });
});
