import { describe, expect, it } from "vitest";
import {
  assembleTaskBrief,
  readSubmission,
  renderSeenEmail,
  SEEN_EMAIL_DEFAULT,
  type IntakeAnswers,
} from "./brief";

const answers: IntakeAnswers = {
  name: "Dana Levi",
  email: "dana@northwind.com",
  company: "Northwind",
  taskName: "Instagram launch set",
  dimensions: "1080×1350",
  format: "PNG",
  animated: "No",
  dueDate: "2026-09-01",
  budgetRange: "5-8",
  creativeBrief: "Bold, high contrast.",
  goal: "",
  displayedWhere: "",
  targetAudience: "",
  thingsToAvoid: "",
  content: "",
  notes: "",
  scheduleMeeting: "No",
};

/**
 * The real "Partner Event 2026 | Roll ups" submission from No Traffic, as it
 * arrived. Its hand-edited task is what the expectations below encode — these
 * tests exist so the derived format can't silently drift back.
 */
const rollUps: IntakeAnswers = {
  name: "Dor Ronen",
  email: "dor.ronen@notraffic.tech",
  company: "notraffic",
  taskName: "Partner Event 2026 | Roll ups",
  format: "Print",
  dimensions: "85 × 200 cm",
  animated: "No",
  dueDate: "2026-08-18",
  budgetRange: "",
  goal: "Give good vibes.",
  targetAudience: "Our partners",
  displayedWhere: "Across the venue.",
  creativeBrief:
    "Create two coordinated 85 × 200 cm roll-ups for the event entrance in Savannah.\n\nRoll-up 1\n\nLarge Partner Event 2026 logo",
  content: "WELCOME, PARTNERS.",
  thingsToAvoid: "this needs to be with bright colors - in opposed to last year's event.",
  notes: "Attached reference.",
  scheduleMeeting: "No",
};

describe("assembleTaskBrief", () => {
  it("produces the shape Nitsan hand-edits these into", () => {
    expect(assembleTaskBrief(rollUps)).toBe(
      [
        "Format: Print\nDimensions: 85 × 200 cm",
        "Goal: Give good vibes.",
        "Target audience: Our partners",
        "Displayed at: Across the venue.",
        "Creative direction: Create two coordinated 85 × 200 cm roll-ups for the event entrance in Savannah.\n\nRoll-up 1\n\nLarge Partner Event 2026 logo",
        "Content: WELCOME, PARTNERS.",
        "Things to avoid: this needs to be with bright colors - in opposed to last year's event.",
        "Notes: Attached reference.",
        "Submitted by Dor Ronen <dor.ronen@notraffic.tech>",
      ].join("\n\n"),
    );
  });

  // Each of these was deleted by hand in all THREE real examples.
  it("drops everything the task itself already shows", () => {
    const out = assembleTaskBrief(rollUps);
    expect(out).not.toContain("SUMMARY");
    expect(out).not.toContain("requests"); // `notraffic requests "Roll ups"`
    expect(out).not.toContain("2026-08-18"); // the Dates field
    expect(out).not.toContain("Partner Event 2026 | Roll ups"); // the task title
    expect(out).not.toMatch(/— notraffic/); // the Client chip
  });

  it("drops animated when the answer is No, and keeps it when it isn't", () => {
    // All three real briefs were print jobs answering No, and he deleted it
    // every time — the absence of a property nobody asked about is not news.
    expect(assembleTaskBrief(rollUps)).not.toMatch(/[Aa]nimated/);
    expect(assembleTaskBrief({ ...rollUps, animated: "Yes" })).toContain("Animated: Yes");
    expect(assembleTaskBrief({ ...rollUps, animated: "Not sure yet" })).toContain(
      "Animated: Not sure yet",
    );
  });

  it("never prints an unanswered field or a list of them", () => {
    const bare = assembleTaskBrief({
      ...rollUps,
      goal: "",
      targetAudience: "",
      displayedWhere: "",
      content: "",
      thingsToAvoid: "",
      notes: "",
    });
    expect(bare).not.toContain("Not provided");
    expect(bare).not.toContain("MISSING INFORMATION");
    expect(bare).toBe(
      [
        "Format: Print\nDimensions: 85 × 200 cm",
        "Creative direction: Create two coordinated 85 × 200 cm roll-ups for the event entrance in Savannah.\n\nRoll-up 1\n\nLarge Partner Event 2026 logo",
        "Submitted by Dor Ronen <dor.ronen@notraffic.tech>",
      ].join("\n\n"),
    );
  });

  // A real submission's Notes read "none", and he deleted that line too.
  it("treats a written-out nothing as blank", () => {
    for (const nothing of ["none", "N/A", "n/a", "-", "—", "Nothing"]) {
      expect(assembleTaskBrief({ ...rollUps, notes: nothing })).not.toMatch(/Notes:/);
    }
    // ...but "No" stays, because it can be a real answer.
    expect(assembleTaskBrief({ ...rollUps, notes: "No" })).toContain("Notes: No");
  });

  it("keeps Budget, because the Hours field can only hold a number", () => {
    // The due date goes (its field survives it intact); a range like "5-8"
    // does not survive `parseBudgetHours`, so the client's words stay.
    expect(assembleTaskBrief({ ...rollUps, budgetRange: "5-8" })).toContain("Budget: 5-8");
  });

  it("never combines Format and Dimensions", () => {
    const out = assembleTaskBrief(rollUps);
    expect(out).toContain("Format: Print\nDimensions: 85 × 200 cm");
    expect(out).not.toContain("Print (85 × 200 cm)");
  });

  it("leaves the client's own line breaks alone", () => {
    // The deliverable structure clients type into the creative brief IS the
    // brief; reflowing it would destroy the only structure in there.
    expect(assembleTaskBrief(rollUps)).toContain("Savannah.\n\nRoll-up 1\n\nLarge");
  });

  it("lists attachments only on the submission's own copy", () => {
    const attach = {
      files: [{ name: "ref.png", url: "https://x/ref.png" }],
      links: [{ title: "Drive", url: "https://drive.google.com/1" }],
    };
    expect(assembleTaskBrief(rollUps, attach)).toContain("FILES\n• ref.png: https://x/ref.png");
    expect(assembleTaskBrief(rollUps, attach)).toContain("LINKS\n• Drive: https://drive.google.com/1");
    expect(assembleTaskBrief(rollUps)).not.toContain("FILES");
  });

  it("survives a submission with nothing in it at all", () => {
    const empty = Object.fromEntries(
      Object.keys(rollUps).map((k) => [k, ""]),
    ) as unknown as IntakeAnswers;
    expect(assembleTaskBrief(empty)).toBe("");
  });
});

describe("renderSeenEmail", () => {
  it("fills every placeholder", () => {
    const { subject, html } = renderSeenEmail(
      { subject: "{task} for {company}", body: "Hi {firstName} ({name}) — {studio}" },
      { submitterName: "Dana Levi", taskName: "Launch set", company: "Northwind" },
    );
    expect(subject).toBe("Launch set for Northwind");
    expect(html).toContain("Hi Dana (Dana Levi) — Studio&amp;more");
  });

  it("falls back to the default when the stored template is missing or blank", () => {
    for (const t of [null, undefined, { subject: "  ", body: "  " }]) {
      const { subject } = renderSeenEmail(t, { submitterName: "Dana", taskName: "Launch set" });
      expect(subject).toBe("We've got your brief — Launch set");
    }
  });

  it("has no dangling dash when there is no task name", () => {
    const { subject } = renderSeenEmail(SEEN_EMAIL_DEFAULT, {
      submitterName: "Dana",
      taskName: "",
    });
    expect(subject).toBe("We've got your brief");
  });

  it("addresses a nameless sender as 'there' rather than leaving a gap", () => {
    const { html } = renderSeenEmail(
      { subject: "x", body: "Hi {firstName}," },
      { submitterName: "   ", taskName: "T" },
    );
    expect(html).toContain("Hi there,");
  });

  // ⚠️ The values are client-supplied and land inside HTML. Substituting first
  // and escaping the whole result is what keeps a task title from closing a tag.
  it("escapes substituted values, so a client can't inject markup", () => {
    const { html } = renderSeenEmail(
      { subject: "s", body: "Task: {task}" },
      { submitterName: "Dana", taskName: "<script>alert(1)</script>" },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps an ampersand readable rather than double-escaping it", () => {
    const { html } = renderSeenEmail(
      { subject: "s", body: "{company}" },
      { submitterName: "D", taskName: "T", company: "Smith & Sons" },
    );
    expect(html).toContain("Smith &amp; Sons");
    expect(html).not.toContain("&amp;amp;");
  });

  it("strips newlines from the subject — it is a header, not markup", () => {
    const { subject } = renderSeenEmail(
      { subject: "Hi\nBcc: someone@example.com", body: "b" },
      { submitterName: "D", taskName: "T" },
    );
    expect(subject).not.toContain("\n");
  });

  it("turns blank lines into paragraphs and single breaks into <br>", () => {
    const { html } = renderSeenEmail(
      { subject: "s", body: "One\n\nTwo\nstill two" },
      { submitterName: "D", taskName: "T" },
    );
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain("Two<br>still two");
  });
});

describe("readSubmission", () => {
  it("returns null for a row that predates the answers column", () => {
    expect(readSubmission(null)).toBeNull();
  });

  it("reads files by `name` and links by `title`", () => {
    const got = readSubmission({
      ...answers,
      files: [{ name: "logo.pdf", url: "https://x/logo.pdf" }],
      links: [{ title: "Brand guide", url: "https://docs.google.com/1" }],
    });
    expect(got?.files).toEqual([{ name: "logo.pdf", url: "https://x/logo.pdf" }]);
    expect(got?.links).toEqual([{ title: "Brand guide", url: "https://docs.google.com/1" }]);
    expect(got?.answers.taskName).toBe("Instagram launch set");
  });

  // jsonb holds whatever was written on the day. The intake queue is the one
  // page whose entire job is to survive bad input, so none of these may throw.
  it("survives a malformed answers blob", () => {
    const got = readSubmission({
      name: 42,
      files: "not an array",
      links: [null, 7, {}, { url: "https://ok" }],
    } as unknown as Record<string, unknown>);
    expect(got?.answers.name).toBe("");
    expect(got?.files).toEqual([]);
    // The only usable row survives, titled with its URL rather than dropped.
    expect(got?.links).toEqual([{ title: "https://ok", url: "https://ok" }]);
  });

  it("drops entries with no URL — there is nothing to link to", () => {
    const got = readSubmission({ links: [{ title: "Named but empty", url: "" }] });
    expect(got?.links).toEqual([]);
  });
});
