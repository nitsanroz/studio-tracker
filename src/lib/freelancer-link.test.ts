import { describe, expect, it } from "vitest";
import { freelancerPath, linkSlug, tokenFromSegment } from "./freelancer-link";

describe("freelancer link", () => {
  it("reads as his name, and keeps the secret findable", () => {
    const token = "Xa82kQ9mZpL3tR7vB1nC4dE6";
    expect(freelancerPath("Abolfazi Babaei", token)).toBe(`/log/abolfazi-${token}`);
    expect(tokenFromSegment(`abolfazi-${token}`)).toBe(token);
  });

  it("still opens a link minted before names (a bare secret, dashes and all)", () => {
    expect(tokenFromSegment("gibSAdUR6RvGC-y-4xRERoCORs7bZZJe")).toBe("gibSAdUR6RvGC-y-4xRERoCORs7bZZJe");
  });

  it("never lets the name decide anything", () => {
    expect(linkSlug("עמיחי שטרית")).toBe("freelancer");
    expect(tokenFromSegment("someoneelse-Xa82kQ9mZpL3tR7vB1nC4dE6")).toBe("Xa82kQ9mZpL3tR7vB1nC4dE6");
  });
});
