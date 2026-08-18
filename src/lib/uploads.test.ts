import { describe, expect, it } from "vitest";
import {
  MAX_INTAKE_BYTES,
  MAX_INTAKE_TOTAL_BYTES,
  describeUploadSet,
  classifyImage,
  classifyUpload,
  describeUpload,
  formatSize,
} from "./uploads";

/** A File of a given name and size, without allocating the bytes. */
function file(name: string, size = 1024): File {
  const f = new File([], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("classifyUpload — the widened allowlist", () => {
  // The reason this whole change exists: an iPhone photo is .heic, so a client
  // attaching four photos and a PDF got exactly one file through, silently.
  const widened = [
    "heic",
    "heif",
    "tif",
    "tiff",
    "eps",
    "indd",
    "sketch",
    "fig",
    "mov",
    "mp4",
    "rar",
    "7z",
  ];

  it.each(widened)("accepts .%s and forces it to download", (ext) => {
    const cls = classifyUpload(file(`brief.${ext}`));
    expect(cls.ok).toBe(true);
    // Never an inline type: the browser must download these, not try to render
    // them. A HEIC given image/heic would promise a preview and show a broken
    // image; an .eps given an inline type is worse.
    expect(cls).toMatchObject({ contentType: "application/octet-stream" });
  });

  it("keeps the original types working", () => {
    expect(classifyUpload(file("a.png"))).toEqual({ ok: true, contentType: "image/png" });
    expect(classifyUpload(file("a.pdf"))).toEqual({ ok: true, contentType: "application/pdf" });
    expect(classifyUpload(file("a.psd"))).toMatchObject({ ok: true });
  });

  // These land in a PUBLIC bucket on the studio's own Supabase domain, so
  // anything a browser executes could host phishing there. Widening the list
  // must never have reached them.
  it.each(["svg", "html", "htm", "xml", "js", "exe", "sh"])("still refuses .%s", (ext) => {
    expect(classifyUpload(file(`x.${ext}`)).ok).toBe(false);
  });

  it("matches the extension case-insensitively", () => {
    expect(classifyUpload(file("PHOTO.HEIC")).ok).toBe(true);
    expect(classifyUpload(file("Scan.PDF")).ok).toBe(true);
  });

  it("judges by the LAST extension, so a double extension can't smuggle one past", () => {
    // `x.svg.png` is a png. `x.png.svg` is an svg, and must be refused — the
    // dangerous direction is the one that ends in the executable type.
    expect(classifyUpload(file("x.svg.png")).ok).toBe(true);
    expect(classifyUpload(file("x.png.svg")).ok).toBe(false);
  });

  it("refuses a name with no extension at all", () => {
    expect(classifyUpload(file("screenshot")).ok).toBe(false);
    expect(classifyUpload(file("")).ok).toBe(false);
  });

  it("leaves classifyImage alone — heic and tif must not become avatars", () => {
    // classifyImage backs avatars and client icons, which ARE rendered inline.
    // A format browsers can't display would be a broken image in the header.
    expect(classifyImage(file("me.heic")).ok).toBe(false);
    expect(classifyImage(file("me.tif")).ok).toBe(false);
    expect(classifyImage(file("me.png")).ok).toBe(true);
  });
});

describe("describeUpload — the reason a client is shown", () => {
  it("passes a good file straight through", () => {
    expect(describeUpload(file("logo.pdf"))).toEqual({
      ok: true,
      contentType: "application/pdf",
    });
  });

  it("refuses anything over the cap, names the size, and points at the link field", () => {
    const r = describeUpload(file("video.mp4", 24 * 1024 * 1024));
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining("WeTransfer") });
    // The client is told the actual size, not merely that it was too big.
    // ⚠️ Reads the CAP rather than spelling out a figure. This assertion said
    // "over the 10 MB limit" and broke the day the cap moved to the real
    // request budget — the rule under test is "the message names the actual
    // cap", not what that cap happens to be.
    expect((r as { reason: string }).reason).toContain(
      `That's 24 MB, over the ${formatSize(MAX_INTAKE_BYTES)} limit`,
    );
  });

  it("doesn't restate the cap twice for a file barely over it", () => {
    // 1 byte over rounds to the cap's own figure, and restating it reads as a
    // bug rather than a rule.
    const r = describeUpload(file("edge.zip", MAX_INTAKE_BYTES + 1));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe(
      `That's just over the ${formatSize(MAX_INTAKE_BYTES)} limit — add it as a WeTransfer or Drive link below instead.`,
    );
  });

  it("accepts a file exactly at the cap", () => {
    expect(describeUpload(file("big.zip", MAX_INTAKE_BYTES)).ok).toBe(true);
  });

  it("gives SVG its own answer, because zipping it genuinely works", () => {
    const r = describeUpload(file("icon.svg"));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/ZIP/);
  });

  it("names the extension it refused", () => {
    const r = describeUpload(file("notes.pages"));
    expect((r as { reason: string }).reason).toContain(".pages");
  });

  it("explains a missing extension rather than naming an empty one", () => {
    const r = describeUpload(file("screenshot"));
    expect((r as { reason: string }).reason).toContain("no extension");
    expect((r as { reason: string }).reason).not.toContain("..");
  });

  it("catches an empty file before anything else", () => {
    // A 0-byte pick is usually a file still syncing from Drive or iCloud —
    // the extension is fine, so the type message would be actively misleading.
    const r = describeUpload(file("report.pdf", 0));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("empty");
  });
});

describe("describeUploadSet", () => {
  const MB = 1024 * 1024;
  const f = (name: string, size: number) => ({ name, size });

  // ⚠️ THE REAL SUBMISSION THAT WAS LOST, 2026-08-17. Three screenshots on the
  // "Partner Event | Flags" brief: each one passed the per-file check, and
  // together they made a request the platform dropped before the route ran, so
  // the client got "Something went wrong" and nothing was ever recorded.
  it("refuses the set that broke the Flags brief", () => {
    const r = describeUploadSet([
      f("Screenshot 2026-08-17 at 22.35.58.png", 1.5 * MB),
      f("exec-11e47c0e-953b-4882-90ab-4a290e80b9bc.png", 2.7 * MB),
      f("WhatsApp Image 2026-08-04 at 20.15.09.jpeg", 105 * 1024),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // It must name the file to drop — "too large" across three attachments
    // leaves the client guessing, which is the failure this replaces.
    expect(r.reason).toContain("exec-11e47c0e");
    expect(r.reason).toContain("4.3 MB");
  });

  // The same client's earlier brief, which went through fine. A fix that also
  // refuses this one would have cost them briefs 1 and 2 as well.
  it("accepts the 2.65MB set that did get through", () => {
    expect(
      describeUploadSet([
        f("exec-9fbebd99.png", 2430 * 1024),
        f("WhatsApp Image 2026-08-04 at 20.14.58.jpeg", 179 * 1024),
        f("WhatsApp Image 2026-08-04 at 20.14.56.jpeg", 104 * 1024),
      ]).ok,
    ).toBe(true);
  });

  it("is exact at the boundary", () => {
    expect(describeUploadSet([f("a.png", MAX_INTAKE_TOTAL_BYTES)]).ok).toBe(true);
    expect(describeUploadSet([f("a.png", MAX_INTAKE_TOTAL_BYTES + 1)]).ok).toBe(false);
  });

  it("has nothing to complain about with no files", () => {
    const r = describeUploadSet([]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(0);
  });

  // ⚠️ The per-file cap must not exceed the request budget. It used to be 10MB
  // against a 4.5MB platform limit, so a 6MB file passed every check the app
  // made and then failed 100% of the time with no explanation.
  it("never promises a single file bigger than one request can carry", () => {
    expect(MAX_INTAKE_BYTES).toBeLessThanOrEqual(MAX_INTAKE_TOTAL_BYTES);
  });
});

describe("formatSize", () => {
  it("scales the unit", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(1024 * 1024 * 3.5)).toBe("3.5 MB");
    // No trailing ".0" — "10.0 MB each" in the form's hint reads like a machine
    // wrote it.
    expect(formatSize(10 * 1024 * 1024)).toBe("10 MB");
  });
});
