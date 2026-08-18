import { describe, expect, it } from "vitest";
import {
  MAX_INTAKE_BYTES,
  MAX_INTAKE_TOTAL_BYTES,
  STORED_CONTENT_TYPES,
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
    // ⚠️ Sized from the CAP, not a literal. This said 24MB against a 10MB cap
    // and started passing the day the cap rose to 25MB — the rule under test is
    // "over the limit is refused", which no fixed number can express.
    const r = describeUpload(file("video.mp4", MAX_INTAKE_BYTES + 5 * 1024 * 1024));
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining("WeTransfer") });
    // The client is told the actual size, not merely that it was too big.
    // ⚠️ Reads the CAP rather than spelling out a figure. This assertion said
    // "over the 10 MB limit" and broke the day the cap moved to the real
    // request budget — the rule under test is "the message names the actual
    // cap", not what that cap happens to be.
    expect((r as { reason: string }).reason).toContain(
      `That's ${formatSize(MAX_INTAKE_BYTES + 5 * 1024 * 1024)}, over the ${formatSize(MAX_INTAKE_BYTES)} limit`,
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

describe("the set that cost a client a brief", () => {
  const MB = 1024 * 1024;
  const file = (name: string, size: number) => ({ name, size }) as File;

  /**
   * ⚠️ THE REAL SUBMISSION, 2026-08-17. Three screenshots on "Partner Event |
   * Flags" totalling 4.3MB. They were refused not by any rule the app chose but
   * by the platform, which drops a request body over 4.5MB before the route
   * runs — so the client saw "Something went wrong" and the brief was never
   * recorded. v1.19.2 made the app say so honestly; v1.19.3 removed the request
   * from the file path altogether, so these three now go through.
   */
  it("accepts all three files that were lost", () => {
    for (const f of [
      file("Screenshot 2026-08-17 at 22.35.58.png", 1.5 * MB),
      file("exec-11e47c0e-953b-4882-90ab-4a290e80b9bc.png", 2.7 * MB),
      file("WhatsApp Image 2026-08-04 at 20.15.09.jpeg", 105 * 1024),
    ]) {
      expect(describeUpload(f).ok).toBe(true);
    }
  });

  // The thing Nitsan actually asked for: "not less than 10mb for sure".
  it("takes a file well past the old 10MB ceiling", () => {
    expect(describeUpload(file("poster.pdf", 20 * MB)).ok).toBe(true);
    expect(MAX_INTAKE_BYTES).toBeGreaterThanOrEqual(10 * MB);
  });

  it("lets one file spend the whole brief budget, and no more", () => {
    expect(describeUploadSet([file("one.pdf", MAX_INTAKE_TOTAL_BYTES)]).ok).toBe(true);
    expect(describeUploadSet([file("one.pdf", MAX_INTAKE_TOTAL_BYTES + 1)]).ok).toBe(false);
  });

  // ⚠️ The cap is now a TOTAL, so it is the sum that must be refused — fifteen
  // files each comfortably legal on their own are not.
  it("refuses a set that only breaks the budget together, naming the biggest", () => {
    const r = describeUploadSet([
      file("small.png", 2 * MB),
      file("huge.pdf", 25 * MB),
      file("medium.png", 8 * MB),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("huge.pdf");
    expect(r.reason).toContain(formatSize(MAX_INTAKE_TOTAL_BYTES));
  });

  /**
   * ⚠️ These are the types the BUCKET is configured to allow, and that config is
   * now the only thing standing between a direct browser upload and an
   * `x.png` stored as `text/html` on a public bucket on our own domain. The
   * route used to force the type on every upload and cannot any more.
   * If this list changes, re-run scripts/configure-intake-bucket.mjs.
   */
  it("stores everything as one of eight safe types, none of them renderable markup", () => {
    expect(STORED_CONTENT_TYPES).toEqual([
      "application/octet-stream",
      "application/pdf",
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
      "text/csv",
      "text/plain",
    ]);
    for (const t of STORED_CONTENT_TYPES) {
      expect(t).not.toMatch(/html|svg|xml|javascript/);
    }
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
