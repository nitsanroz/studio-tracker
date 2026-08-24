import { describe, expect, it } from "vitest";
import { avatarVariantFor } from "./avatar-variant";

// `member_hr.gender` is free text seeded from a spreadsheet, so this has to cope
// with whatever was typed and refuse to guess at anything else.
describe("avatarVariantFor", () => {
  it("reads the English vocabulary", () => {
    for (const v of ["m", "M", "male", "Male", "man", " MAN "]) {
      expect(avatarVariantFor(v)).toBe("man");
    }
    for (const v of ["f", "F", "female", "Female", "woman", " WOMAN "]) {
      expect(avatarVariantFor(v)).toBe("woman");
    }
  });

  it("reads the Hebrew vocabulary", () => {
    expect(avatarVariantFor("זכר")).toBe("man");
    expect(avatarVariantFor("גבר")).toBe("man");
    expect(avatarVariantFor("נקבה")).toBe("woman");
    expect(avatarVariantFor("אישה")).toBe("woman");
  });

  /**
   * ⚠️ The regression this file exists for: "female" CONTAINS "male", so a
   * substring check answers every woman in the studio with the man's portrait.
   */
  it("does not match 'male' inside 'female'", () => {
    expect(avatarVariantFor("female")).toBe("woman");
    expect(avatarVariantFor("Female")).toBe("woman");
  });

  it("returns null rather than guessing", () => {
    for (const v of ["", "  ", "other", "n/a", "-", "1", "prefer not to say", "x"]) {
      expect(avatarVariantFor(v)).toBeNull();
    }
    expect(avatarVariantFor(null)).toBeNull();
    expect(avatarVariantFor(undefined)).toBeNull();
  });

  it("never derives anything from a name", () => {
    // a name is not a gender statement; these must all fall through to neutral
    for (const v of ["Nitsan", "Adaya", "Nadav", "Shaked"]) {
      expect(avatarVariantFor(v)).toBeNull();
    }
  });

  it("tolerates trailing punctuation from a hand-filled sheet", () => {
    expect(avatarVariantFor("male.")).toBe("man");
    expect(avatarVariantFor("female ")).toBe("woman");
  });
});
