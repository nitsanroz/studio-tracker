import { describe, expect, it } from "vitest";
import { compareVersions, whatsNewSince, MAX_STEPS, RELEASES } from "./whats-new";

describe("compareVersions", () => {
  it("orders by each part, not by string", () => {
    // The string comparison this replaces gets this exact case wrong:
    // "v1.9.0" > "v1.12.0" alphabetically, which would have hidden every
    // release between 1.9 and 1.13 from anyone who last looked at 1.9.
    expect(compareVersions("v1.12.0", "v1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.9.0", "v1.12.0")).toBeLessThan(0);
    expect(compareVersions("v1.12.0", "v1.12.0")).toBe(0);
    expect(compareVersions("v2.0.0", "v1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("v1.12.1", "v1.12.0")).toBeGreaterThan(0);
  });

  it("tolerates a missing v and unparseable input", () => {
    expect(compareVersions("1.12.0", "v1.12.0")).toBe(0);
    expect(compareVersions("v1.0.0", "nonsense")).toBeGreaterThan(0);
  });
});

describe("whatsNewSince", () => {
  it("shows nothing when you've already seen the newest", () => {
    expect(whatsNewSince(RELEASES[0].version, true)).toBeNull();
  });

  it("shows only what is newer than the version you acknowledged", () => {
    const seen = RELEASES[1].version;
    const got = whatsNewSince(seen, true);
    expect(got).not.toBeNull();
    for (const r of got!.releases) {
      expect(compareVersions(r.version, seen)).toBeGreaterThan(0);
    }
  });

  it("returns releases newest first", () => {
    const got = whatsNewSince(null, true)!;
    for (let i = 1; i < got.releases.length; i++) {
      expect(compareVersions(got.releases[i - 1].version, got.releases[i].version)).toBeGreaterThan(0);
    }
  });

  it("caps the steps and accounts for every dropped item", () => {
    const got = whatsNewSince(null, true)!;
    expect(got.steps.length).toBeLessThanOrEqual(MAX_STEPS);
    const eligibleItems = RELEASES.reduce(
      (n, r) =>
        n + r.items.filter((i) => i.audience === "all" || i.audience === "admin").length,
      0,
    );
    expect(got.steps.length + got.olderCount).toBe(eligibleItems);
  });

  it("sorts by priority first, so a deprioritised item lands behind older ones", () => {
    const got = whatsNewSince(null, true)!;
    const prio = got.steps.map((s) => s.priority ?? 0);
    expect([...prio].sort((a, b) => b - a)).toEqual(prio);
    // The real case: mobile is the NEWEST release but must not lead, because the
    // studio works on laptops and the week's desktop work is what they can use.
    const firstMobile = got.steps.findIndex((s) => (s.priority ?? 0) < 0);
    if (firstMobile !== -1) {
      expect(compareVersions(got.steps[0].version, got.steps[firstMobile].version)).toBeLessThan(0);
    }
  });

  it("keeps version order within one priority band", () => {
    const got = whatsNewSince(null, true)!;
    const band = got.steps.filter((s) => (s.priority ?? 0) === 0);
    for (let i = 1; i < band.length; i++) {
      expect(compareVersions(band[i - 1].version, band[i].version)).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every step the version and date it came from", () => {
    const got = whatsNewSince(null, true)!;
    for (const s of got.steps) {
      expect(RELEASES.some((r) => r.version === s.version && r.date === s.date)).toBe(true);
    }
  });

  it("never shows a member an admin-only item", () => {
    const got = whatsNewSince(null, false);
    for (const r of got?.releases ?? []) {
      for (const item of r.items) {
        expect(item.audience).not.toBe("admin");
      }
    }
  });

  it("drops a release whose every item was for the other role", () => {
    // A release that is entirely admin-only must not reach a member as an empty
    // card — that would teach them the panel is worth skipping.
    const got = whatsNewSince(null, false);
    for (const r of got?.releases ?? []) {
      expect(r.items.length).toBeGreaterThan(0);
    }
  });
});
