import { describe, expect, it } from "vitest";
import { cleanDetails } from "./freelancer-details";

describe("cleanDetails", () => {
  it("trims, and turns empty fields into nothing", () => {
    expect(cleanDetails({ email: " a@b.co ", phone: "", website: " ", location: " Berlin, Germany ", notes: "" })).toEqual({
      email: "a@b.co",
      phone: null,
      website: null,
      location: "Berlin, Germany",
      notes: null,
    });
  });

  it("gives a bare site https://", () => {
    expect(cleanDetails({ website: "behance.net/someone" })).toMatchObject({ website: "https://behance.net/someone" });
  });

  it("refuses a link that would run code", () => {
    expect(cleanDetails({ website: "javascript:alert(1)" })).toEqual({ error: "That website isn't a link that can be opened." });
  });

  it("refuses an email or phone that isn't one", () => {
    expect(cleanDetails({ email: "not an email" })).toHaveProperty("error");
    expect(cleanDetails({ phone: "call me" })).toHaveProperty("error");
    expect(cleanDetails({ phone: "+49 (30) 1234-567" })).toMatchObject({ phone: "+49 (30) 1234-567" });
  });

  it("ignores what isn't text", () => {
    expect(cleanDetails({ email: 5, notes: {} })).toMatchObject({ email: null, notes: null });
  });
});
