import { describe, expect, it } from "vitest";
import { hostLabel, isSafeUrl, normalizeUrl } from "./links";

/**
 * The protocol allowlist every URL surface in the app leans on — task links,
 * client links, intake links and (since the figma field was brought in line)
 * `tasks.figma_url`. It had no tests, which is how the one field that skipped it
 * went unnoticed: React 19 THROWS on a `javascript:` href, and with no error
 * boundary in the app a single stored row blanked the page for everyone.
 */

describe("normalizeUrl — what may be stored", () => {
  it("keeps the three safe schemes", () => {
    expect(normalizeUrl("https://figma.com/file/abc")).toBe("https://figma.com/file/abc");
    expect(normalizeUrl("http://intranet/doc")).toBe("http://intranet/doc");
    expect(normalizeUrl("mailto:nitsan@studionmore.com")).toBe("mailto:nitsan@studionmore.com");
  });

  it("assumes https for a bare host, because nobody types the scheme", () => {
    expect(normalizeUrl("figma.com/file/abc")).toBe("https://figma.com/file/abc");
    expect(normalizeUrl("  docs.google.com/x  ")).toBe("https://docs.google.com/x");
  });

  it("refuses every scheme that could run something", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
    ]) {
      expect(normalizeUrl(bad), bad).toBeNull();
    }
  });

  it("refuses empty and unparseable input", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl("http://")).toBeNull();
  });
});

describe("isSafeUrl — what may be rendered as an href", () => {
  it("agrees with normalizeUrl on anything normalizeUrl accepted", () => {
    for (const raw of ["figma.com/x", "https://a.test/b", "mailto:a@b.co"]) {
      const stored = normalizeUrl(raw);
      expect(stored).not.toBeNull();
      expect(isSafeUrl(stored!), raw).toBe(true);
    }
  });

  it("still refuses a row written straight into SQL, which is why it exists", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
    // A bare host is not a URL yet — stored rows are always normalised first.
    expect(isSafeUrl("figma.com/x")).toBe(false);
  });
});

describe("hostLabel — the fallback title", () => {
  it("drops the www so the label reads like a name", () => {
    expect(hostLabel("https://www.dropbox.com/s/x")).toBe("dropbox.com");
    expect(hostLabel("https://figma.com/file/abc")).toBe("figma.com");
  });

  it("hands back the raw string rather than throwing", () => {
    expect(hostLabel("not a url")).toBe("not a url");
  });
});
