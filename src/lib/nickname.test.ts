import { describe, expect, it } from "vitest";
import { mapProfile } from "./db";
import { planColumnLabel } from "./members";

// 0071 — a nickname is the name the app shows; the full name is kept beside it.
describe("profile nickname", () => {
  const row = { id: "a", name: "Abolfazl Babaei", role: "designer", active: false, has_account: false };

  it("shows the nickname and keeps the full name", () => {
    const p = mapProfile({ ...row, nickname: "Ab" });
    expect(p.name).toBe("Ab");
    expect(p.fullName).toBe("Abolfazl Babaei");
    expect(p.nickname).toBe("Ab");
  });

  it("falls back to the full name when there is none, or it is blank, or the column is missing", () => {
    for (const nickname of [null, "  ", undefined]) {
      const p = mapProfile({ ...row, nickname });
      expect(p.name).toBe("Abolfazl Babaei");
      expect(p.nickname).toBeNull();
    }
  });

  it("labels a plan column by its person's nickname, else by the column's own name", () => {
    const profiles = [mapProfile({ ...row, nickname: "Ab" }), mapProfile({ ...row, id: "b", nickname: null })];
    expect(planColumnLabel({ name: "Abolfazl Babaei", profileId: "a" }, profiles)).toBe("Ab");
    expect(planColumnLabel({ name: "Milica", profileId: "b" }, profiles)).toBe("Milica");
    expect(planColumnLabel({ name: "Freelancers", profileId: null }, profiles)).toBe("Freelancers");
  });
});
