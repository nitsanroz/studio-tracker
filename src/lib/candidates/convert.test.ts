import { describe, expect, it } from "vitest";
import { cleanPosition, convertedAs, convertedHref } from "./convert";

describe("convertedAs", () => {
  it("is null for a candidate never converted", () => {
    expect(convertedAs(null, [{ kind: "hired" }, { kind: "stage_changed" }])).toBeNull();
  });

  it("reads the event even without 0061's link", () => {
    expect(convertedAs(null, [{ kind: "became_freelancer" }])).toBe("freelancer");
    expect(convertedAs(null, [{ kind: "joined_team" }])).toBe("member");
  });

  it("trusts the event over the profile", () => {
    expect(convertedAs("p1", [{ kind: "joined_team" }], { hasAccount: false })).toBe("member");
  });

  it("falls back to the linked profile: no login = freelancer", () => {
    expect(convertedAs("p1", [], { hasAccount: false })).toBe("freelancer");
    expect(convertedAs("p1", [], { hasAccount: true })).toBe("member");
    // Just made, not in the store yet.
    expect(convertedAs("p1", [], null)).toBe("member");
  });
});

describe("convertedHref", () => {
  it("points at the new record's own page", () => {
    expect(convertedHref("member", "p1")).toBe("/team/p1");
    expect(convertedHref("freelancer", "p1")).toBe("/freelancers/p1");
  });
});

describe("cleanPosition", () => {
  it("keeps a role name, tidied", () => {
    expect(cleanPosition("  Senior   designer ")).toBe("Senior designer");
  });

  it("never hands out the owner's position", () => {
    expect(cleanPosition("Owner")).toBeNull();
    expect(cleanPosition(" owner ")).toBeNull();
  });

  it("drops anything empty or not text", () => {
    expect(cleanPosition("")).toBeNull();
    expect(cleanPosition("   ")).toBeNull();
    expect(cleanPosition(undefined)).toBeNull();
    expect(cleanPosition(42)).toBeNull();
  });

  it("caps the length", () => {
    expect(cleanPosition("x".repeat(200))?.length).toBe(80);
  });
});
