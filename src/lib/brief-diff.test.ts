import { describe, expect, it } from "vitest";
import { diffBriefs, needsReview } from "./brief-diff";

const file = (name: string, url: string, size = 1000) => ({ name, url, size });

describe("diffBriefs", () => {
  it("reports a changed answer with both versions", () => {
    const d = diffBriefs({ goal: "logo, big, for the stage" }, { goal: "logo on the stage" });
    expect(d.fields).toHaveLength(1);
    expect(d.fields[0]).toMatchObject({ was: "logo on the stage", now: "logo, big, for the stage" });
    expect(d.empty).toBe(false);
  });

  it("says nothing changed when nothing did", () => {
    const same = { goal: "same", files: [file("a.png", "u/a")] };
    expect(diffBriefs(same, { ...same }).empty).toBe(true);
  });

  // ⚠️ Whitespace-only edits are not changes. A client tabbing through the form
  // and re-saving must not raise a revision the studio has to review.
  it("ignores a difference of only surrounding whitespace", () => {
    expect(diffBriefs({ goal: "  the stage  " }, { goal: "the stage" }).empty).toBe(true);
  });

  /**
   * ⚠️ Identity is answered on the details step by whoever is filling the form in
   * NOW. A colleague sending a revision would otherwise flag name and email as
   * changes on every single one.
   */
  it("never reports name, email or company as a change", () => {
    const d = diffBriefs(
      { name: "Dor", email: "dor@x.com", company: "No Traffic", goal: "g" },
      { name: "Maya", email: "maya@x.com", company: "NoTraffic", goal: "g" },
    );
    expect(d.fields).toEqual([]);
    expect(d.empty).toBe(true);
  });

  /**
   * ⚠️ Files are matched by URL, not name. A client sending a second `logo.png`
   * from another folder is ordinary, and a duplicated brief deliberately shares
   * the very same object — the URL is the only thing that identifies one.
   */
  it("tells added, removed and unchanged files apart by URL", () => {
    const d = diffBriefs(
      { files: [file("logo.png", "u/1"), file("logo.png", "u/2"), file("new.pdf", "u/3")] },
      { files: [file("logo.png", "u/1"), file("gone.pdf", "u/9")] },
    );
    expect(d.addedFiles.map((f) => f.url)).toEqual(["u/2", "u/3"]);
    expect(d.removedFiles.map((f) => f.url)).toEqual(["u/9"]);
    expect(d.keptFiles.map((f) => f.url)).toEqual(["u/1"]);
  });

  it("compares deliverables as rendered lines", () => {
    const d = diffBriefs(
      { deliverables: [{ name: "Roll-up 1", dimensions: "80 × 200 cm", format: "Print", details: "2027 tagline" }] },
      { deliverables: [{ name: "Roll-up 1", dimensions: "80 × 200 cm", format: "Print", details: "" }] },
    );
    expect(d.deliverablesChanged).toBe(true);
    expect(d.deliverablesNow[0]).toBe("Roll-up 1 — 80 × 200 cm · Print — 2027 tagline");
    expect(d.empty).toBe(false);
  });

  /**
   * ⚠️ An old brief has no snapshot to compare against (0030 only starts
   * recording one on the next acknowledgement). The UI must say so rather than
   * render an empty diff, which reads as "nothing changed" — the one wrong
   * conclusion here, since it would invite approving a revision unread.
   */
  it("flags a missing baseline instead of reporting no changes", () => {
    const d = diffBriefs({ goal: "anything" }, null);
    expect(d.noBaseline).toBe(true);
    expect(d.fields.length).toBeGreaterThan(0);
  });

  it("survives junk in place of the lists", () => {
    const d = diffBriefs(
      { files: "not an array", links: null, deliverables: 7 },
      { files: [file("a.png", "u/a")] },
    );
    expect(d.addedFiles).toEqual([]);
    expect(d.removedFiles.map((f) => f.url)).toEqual(["u/a"]);
  });
});

describe("needsReview", () => {
  it("is true only when the client edited after the studio last looked", () => {
    expect(needsReview({ editedAt: null, ackedAt: null })).toBe(false);
    expect(needsReview({ editedAt: null, ackedAt: "2026-08-18T10:00:00Z" })).toBe(false);
    expect(needsReview({ editedAt: "2026-08-18T11:00:00Z", ackedAt: "2026-08-18T10:00:00Z" })).toBe(true);
    expect(needsReview({ editedAt: "2026-08-18T09:00:00Z", ackedAt: "2026-08-18T10:00:00Z" })).toBe(false);
  });

  // An edit on a brief from before 0030 has nothing to compare against, and the
  // safe answer is to show it rather than hide it.
  it("shows an edited brief that was never acknowledged", () => {
    expect(needsReview({ editedAt: "2026-08-18T11:00:00Z", ackedAt: null })).toBe(true);
  });
});
