import { describe, expect, it } from "vitest";
import { suggestLines, type TrackerPerson } from "./tracker-lines";

const today = new Date(2026, 10, 5); // 5 Nov 2026
const person = (id: string, name: string, extra: Partial<TrackerPerson> = {}): TrackerPerson => ({
  id,
  name,
  active: true,
  hasAccount: true,
  position: "designer",
  startDate: null,
  ...extra,
});

describe("suggestLines — freelance", () => {
  const people = [
    person("ek", "Ekaterina Ivanova", { active: false, hasAccount: false }),
    person("ab", "AB", { active: false, hasAccount: false }),
    person("mi", "Milica Gošić", { active: false, hasAccount: false }),
  ];
  const freelancers = [
    { profileId: "ek", createdAt: "2026-11-05T17:00:00Z" },
    { profileId: "ab", createdAt: "2026-10-13T09:00:00Z" },
    { profileId: "mi", createdAt: "2026-10-20T09:00:00Z" },
  ];

  it("offers a freelancer finance has no row for, from the month they were added", () => {
    const lines = [
      { name: "ab", profileId: null }, // matched by name, not linked on purpose
      { name: "Milica Gošić", profileId: "mi" },
    ];
    expect(suggestLines("freelance", people, freelancers, lines, new Set(), today)).toEqual([
      { profileId: "ek", name: "Ekaterina Ivanova", year: 2026, month: 11, reason: "Freelancer in the tracker" },
    ]);
  });

  it("leaves out anyone dismissed", () => {
    expect(suggestLines("freelance", people, freelancers, [], new Set(["ek", "ab", "mi"]), today)).toEqual([]);
  });

  it("starts a line made long ago in January of this year", () => {
    const [s] = suggestLines("freelance", people, [{ profileId: "ab", createdAt: "2024-03-01T00:00:00Z" }], [], new Set(), today);
    expect([s.year, s.month]).toEqual([2026, 1]);
  });
});

describe("suggestLines — salaries", () => {
  it("offers active members with a login only", () => {
    const people = [
      person("new", "Noa New", { startDate: "2026-12-01" }),
      person("old", "Old Timer"),
      person("gone", "Gone", { active: false }),
      person("past", "History Only", { hasAccount: false, active: false }),
      person("own", "The Owner", { position: "owner" }),
      person("dima", "Dima", { position: "designer" }),
    ];
    const got = suggestLines(
      "salaries",
      people,
      [{ profileId: "dima", createdAt: "2026-11-02T00:00:00Z" }], // paid on Freelance
      [{ name: "old timer ", profileId: null }],
      new Set(),
      today,
    );
    expect(got.map((s) => [s.profileId, s.year, s.month])).toEqual([["new", 2026, 12]]);
  });

  it("uses this month when no start date is known", () => {
    const [s] = suggestLines("salaries", [person("x", "X")], [], [], new Set(), today);
    expect([s.year, s.month]).toEqual([2026, 11]);
  });
});
