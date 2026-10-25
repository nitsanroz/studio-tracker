import { describe, expect, it } from "vitest";
import {
  appliedOnOf,
  attachmentName,
  bodyOf,
  documentLink,
  documentLinks,
  extractEmail,
  extractLinks,
  extractPhone,
  htmlToText,
  judgeLink,
  pickApplicant,
  planAttachments,
  sourceOf,
} from "./email-import";

describe("pickApplicant", () => {
  it("takes the sender when they wrote in themselves", () => {
    expect(pickApplicant({ from: { name: "Dana Levi", address: "Dana.Levi@Gmail.com" } }, "")).toEqual({
      name: "Dana Levi",
      email: "dana.levi@gmail.com",
    });
  });

  it("finds the applicant inside a studio forward", () => {
    const body = "fyi\n\n---------- Forwarded message ---------\nFrom: Noa Cohen <noa.c@walla.co.il>\nDate: …";
    expect(pickApplicant({ from: { name: "Nitsan", address: "nitsan@studionmore.com" } }, body)).toEqual({
      name: "Noa Cohen",
      email: "noa.c@walla.co.il",
    });
  });

  it("reads a Hebrew forward header", () => {
    const body = "מאת: יעל כהן <yael@gmail.com>\nנשלח: …";
    expect(pickApplicant({ from: { name: "", address: "michal@studionmore.com" } }, body)?.email).toBe(
      "yael@gmail.com",
    );
  });

  it("returns null rather than naming the studio as the applicant", () => {
    expect(pickApplicant({ from: { name: "Nitsan", address: "nitsan@studionmore.com" } }, "see attached")).toBeNull();
  });

  it("uses Reply-To when a robot sent it", () => {
    expect(
      pickApplicant(
        {
          from: { name: "LinkedIn", address: "jobs-noreply@linkedin.com" },
          replyTo: [{ name: "Omer Bar", address: "omer@bar.design" }],
        },
        "",
      ),
    ).toEqual({ name: "Omer Bar", email: "omer@bar.design" });
  });

  it("makes a name from the address when there is none", () => {
    expect(pickApplicant({ from: { name: "", address: "dana.levi87@gmail.com" } }, "")?.name).toBe("Dana Levi");
  });
});

describe("extractPhone", () => {
  it.each([
    ["Phone: 050-1234567", "050-1234567"],
    ["call me 054 123 4567 anytime", "054 123 4567"],
    ["+972 52-765-4321", "+972 52-765-4321"],
    ["(03) 555-1234 office", "(03) 555-1234"],
  ])("finds %s", (text, phone) => {
    expect(extractPhone(text)).toBe(phone);
  });

  it("ignores years, ranges and IDs", () => {
    expect(extractPhone("Studio X 2019 - 2023, Tel Aviv 6713201, ID 312345678")).toBeNull();
  });

  it("returns the first number in order", () => {
    expect(extractPhone("2018–2021 Wix\nmobile 0521112233\nfax 03-1234567")).toBe("0521112233");
  });
});

describe("links", () => {
  it("keeps portfolios and drops plumbing", () => {
    const found = extractLinks([
      "Portfolio: www.danalevi.com. Behance: behance.net/danalevi\n" +
        "https://www.linkedin.com/in/dana-levi/ https://www.linkedin.com/comm/jobs/view/123\n" +
        "https://mail.google.com/x https://studionmore.com/careers https://cdn.x.com/logo.png",
    ]);
    expect(found.map((l) => [l.title, l.url])).toEqual([
      ["danalevi.com", "https://www.danalevi.com"],
      ["Behance", "https://behance.net/danalevi"],
      ["LinkedIn", "https://www.linkedin.com/in/dana-levi"],
    ]);
  });

  it("dedupes the same link written two ways", () => {
    expect(extractLinks(["www.dana.com", "https://dana.com/"])).toHaveLength(1);
  });

  it("rejects trackers", () => {
    expect(judgeLink("https://email.example.com/click?u=1")).toBeNull();
  });
});

describe("documentLink", () => {
  it("turns a Drive share page into its download address", () => {
    expect(documentLink("https://drive.google.com/file/d/1AbC-d_9/view?usp=sharing")).toEqual({
      url: "https://drive.google.com/file/d/1AbC-d_9/view?usp=sharing",
      fetchUrl: "https://drive.google.com/uc?export=download&id=1AbC-d_9",
      title: "Google Drive",
    });
  });

  it("exports a Google Doc as PDF", () => {
    expect(documentLink("https://docs.google.com/document/d/XyZ/edit")?.fetchUrl).toBe(
      "https://docs.google.com/document/d/XyZ/export?format=pdf",
    );
  });

  it("asks Dropbox for the file, not the preview", () => {
    expect(documentLink("https://www.dropbox.com/scl/fi/abc/cv.pdf?rlkey=k&dl=0")?.fetchUrl).toBe(
      "https://www.dropbox.com/scl/fi/abc/cv.pdf?rlkey=k&dl=1",
    );
  });

  it("takes a direct PDF and names it from the path", () => {
    expect(documentLink("https://dana.com/files/Dana%20Levi%20CV.pdf.")?.title).toBe("Dana Levi CV.pdf");
  });

  it("ignores pages, plain http and Drive folders", () => {
    expect(documentLink("https://dana.com/about")).toBeNull();
    expect(documentLink("http://dana.com/cv.pdf")).toBeNull();
    expect(documentLink("https://drive.google.com/drive/folders/abc")).toBeNull();
  });

  it("finds them in a body, once each", () => {
    const body =
      "CV: https://drive.google.com/file/d/A1/view and again https://drive.google.com/open?id=A1, site https://dana.com";
    expect(documentLinks([body]).map((d) => d.fetchUrl)).toEqual([
      "https://drive.google.com/uc?export=download&id=A1",
    ]);
  });
});

describe("body and source", () => {
  it("turns html into readable text with link targets", () => {
    expect(htmlToText('<p>Hi&nbsp;there</p><p>My <a href="https://dana.com">site</a></p>')).toBe(
      "Hi there\nMy site (https://dana.com)",
    );
  });

  it("prefers the plain text part", () => {
    expect(bodyOf({ text: "plain", html: "<p>html</p>" })).toBe("plain");
    expect(bodyOf({ html: "<p>only html</p>" })).toBe("only html");
  });

  it("tells LinkedIn applications apart", () => {
    expect(sourceOf({ from: { name: "", address: "jobs-noreply@linkedin.com" } }, "")).toBe("LinkedIn");
    expect(sourceOf({ from: { name: "", address: "dana@gmail.com" } }, "Hi")).toBe("Email");
  });

  it("dates the application in Israel", () => {
    expect(appliedOnOf("Sun, 25 Oct 2026 23:30:00 +0000")).toBe("2026-10-26");
    expect(appliedOnOf("nonsense")).toBeNull();
  });

  it("finds an email in CV text but never the studio's", () => {
    expect(extractEmail("jobs@studionmore.com · dana@gmail.com")).toBe("dana@gmail.com");
  });
});

describe("planAttachments", () => {
  const att = (filename: string, mimeType = "application/pdf", inline = false) => ({ filename, mimeType, inline });

  it("picks the file named like a CV", () => {
    expect(planAttachments([att("Portfolio 2026.pdf"), att("Dana Levi CV.pdf")])).toEqual([
      { index: 0, kind: "portfolio" },
      { index: 1, kind: "cv" },
    ]);
  });

  it("falls back to the first document that isn't a portfolio", () => {
    expect(planAttachments([att("portfolio.pdf"), att("Dana Levi.pdf"), att("cover.pdf")])).toEqual([
      { index: 0, kind: "portfolio" },
      { index: 1, kind: "cv" },
      { index: 2, kind: "other" },
    ]);
  });

  it("drops inline signature images", () => {
    expect(planAttachments([att("logo.png", "image/png", true), att("קורות חיים.pdf")])).toEqual([
      { index: 1, kind: "cv" },
    ]);
  });

  it("names an attachment that came without one", () => {
    expect(attachmentName(null, "application/pdf", 0)).toBe("attachment-1.pdf");
    expect(attachmentName(null, "image/jpeg", 2)).toBe("attachment-3.jpg");
  });
});
