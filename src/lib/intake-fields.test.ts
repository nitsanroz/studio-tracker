import { describe, expect, it } from "vitest";
import { ALWAYS_ASKS, CLOSING_ASKS, FIELDS, WORK_KINDS, fieldsAsked, kindById } from "./intake-fields";

describe("work kinds", () => {
  it("every field a kind asks for actually exists", () => {
    for (const k of WORK_KINDS) {
      for (const key of [...k.asks, ...ALWAYS_ASKS, ...CLOSING_ASKS]) {
        expect(FIELDS[key], `${k.id} asks for a field "${key}" that isn't defined`).toBeDefined();
      }
    }
  });

  it("has unique ids and no kind asks the same thing twice", () => {
    expect(new Set(WORK_KINDS.map((k) => k.id)).size).toBe(WORK_KINDS.length);
    for (const k of WORK_KINDS) expect(new Set(k.asks).size).toBe(k.asks.length);
  });

  // The whole justification for stepping the form: the kind must actually
  // shorten it, or the steps are just extra clicks over the same questions.
  it("asks a document less than it asks a booth", () => {
    expect(fieldsAsked("document").length).toBeLessThan(fieldsAsked("event").length);
    expect(fieldsAsked("document")).not.toContain("animated");
    expect(fieldsAsked("event")).toContain("animated");
  });

  // Nitsan's rule: a format answer is meaningless without a size beside it.
  it("never asks for a format without also asking dimensions", () => {
    for (const k of WORK_KINDS) {
      if (k.asks.includes("format")) {
        expect(k.asks, `${k.id} asks format but not dimensions`).toContain("dimensions");
      }
    }
  });

  // ⚠️ The UNION, not the intersection. A brief holding a roll-up and a social
  // post must be asked everything either of them needs.
  it("takes the union when several kinds are picked", () => {
    const both = fieldsAsked(["document", "event"]);
    expect(both).toContain("animated"); // event's
    expect(both).toContain("content"); // both
    expect(new Set(both).size).toBe(both.length); // no duplicates
    expect(fieldsAsked(["logo"])).toEqual(fieldsAsked("logo"));
  });

  // The catch-all box is asked whatever the kind — it is where everything the
  // structured questions failed to anticipate ends up.
  it("always asks the technical catch-all", () => {
    for (const k of WORK_KINDS) expect(fieldsAsked([k.id])).toContain("techNotes");
    expect(fieldsAsked([])).toContain("techNotes");
  });

  it("gives every kind an icon", () => {
    for (const k of WORK_KINDS) expect(k.icon.length).toBeGreaterThan(0);
  });

  // `animated` earned one useful answer in 49 archived submissions — but 43 of
  // those were static web and print pieces where it never applied.
  it("only asks about animation where it could be true", () => {
    const asks = (id: string) => fieldsAsked(id).includes("animated");
    expect(asks("social")).toBe(true);
    expect(asks("event")).toBe(true);
    expect(asks("graphics")).toBe(true);
    expect(asks("document")).toBe(false);
    expect(asks("presentation")).toBe(false);
    expect(asks("logo")).toBe(false);
  });

  // ⚠️ An archived submission has no kind, and every one of them WAS asked
  // everything — so "not answered" must keep telling the truth about them.
  it("falls back to asking everything for an unknown or missing kind", () => {
    for (const id of ["", "not-a-kind", "SOCIAL"]) {
      expect(fieldsAsked(id)).toEqual(fieldsAsked("other"));
      expect(fieldsAsked(id)).toContain("dimensions");
      expect(fieldsAsked(id)).toContain("animated");
    }
    expect(kindById("not-a-kind")).toBeUndefined();
  });

  it("marks exactly the three required fields", () => {
    const required = Object.values(FIELDS).filter((f) => f.required).map((f) => f.key);
    expect(required.sort()).toEqual(["email", "name", "taskName"]);
  });

  it("every select offers options and every kind has a hint", () => {
    for (const f of Object.values(FIELDS)) {
      if (f.type === "select") expect(f.options?.length).toBeGreaterThan(0);
    }
    for (const k of WORK_KINDS) expect(k.hint.length).toBeGreaterThan(0);
  });
});
