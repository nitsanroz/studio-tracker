import { describe, expect, it } from "vitest";
import {
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
