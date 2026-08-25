import { describe, expect, it } from "vitest";
import { capTone } from "./cap";

/**
 * The cap is SEMANTIC — Nitsan, 2026-08-24: "its only semantic for us and the
 * client to see that he doesn't exceed the cap without noticing, without
 * permission." Nothing is blocked; the figure has to say for itself that the
 * period is filling. Notice at 70%, severe at 90%.
 */
const H = (h: number) => h * 60;

describe("capTone", () => {
  it("is silent with no cap set", () => {
    expect(capTone(H(500), null)).toBe("");
  });

  it("is silent well below the notice threshold", () => {
    expect(capTone(H(50), 150)).toBe("");
    expect(capTone(H(104), 150)).toBe(""); // 69.3%
  });

  it("notices from 70%", () => {
    expect(capTone(H(105), 150)).toBe("text-amber-600"); // exactly 70%
    expect(capTone(H(130), 150)).toBe("text-amber-600"); // 86.7%
  });

  it("goes severe from 90%", () => {
    expect(capTone(H(135), 150)).toBe("text-danger"); // exactly 90%
    expect(capTone(H(136), 150)).toBe("text-danger"); // the 136/150 case
  });

  it("stays severe past the cap", () => {
    expect(capTone(H(200), 150)).toBe("text-danger");
  });

  /** ⚠️ A 0h cap would divide by zero and paint everything red for ever. */
  it("treats a zero or negative cap as no cap", () => {
    expect(capTone(H(10), 0)).toBe("");
    expect(capTone(H(10), -5)).toBe("");
  });

  it("is silent at zero hours against a real cap", () => {
    expect(capTone(0, 150)).toBe("");
  });
});
