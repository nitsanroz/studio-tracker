import { describe, expect, it } from "vitest";
import {
  MAX_INTAKE_BYTES,
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
    expect((r as { reason: string }).reason).toContain("That's 24 MB, over the 10 MB limit");
  });

  it("doesn't say '10 MB, over the 10 MB limit' for a file barely over", () => {
    // 1 byte over rounds to the cap's own figure, and restating it reads as a
    // bug rather than a rule.
    const r = describeUpload(file("edge.zip", MAX_INTAKE_BYTES + 1));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe(
      "That's just over the 10 MB limit — add it as a WeTransfer or Drive link below instead.",
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
