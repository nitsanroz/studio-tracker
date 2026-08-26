import { describe, it, expect } from "vitest";
import { proxyStorageUrl, parseProxyRequest } from "./storage-url";

const BASE = "https://hjrhfifbmxduwacjzqdt.supabase.co/storage/v1/object/public";

/**
 * These pin the two ways this can fail badly rather than visibly: rewriting a URL
 * it should not touch (a client's own link stops working), and NOT rewriting one it
 * should (the file stays world-readable, which is the whole point of the change).
 */
describe("proxyStorageUrl", () => {
  it("rewrites a task-files attachment to the proxy", () => {
    expect(proxyStorageUrl(`${BASE}/task-files/7785740a/Laredo POV Estimate v3.pdf`)).toBe(
      "/api/file?b=task-files&p=7785740a%2FLaredo%20POV%20Estimate%20v3.pdf",
    );
  });

  it("rewrites an intake object to the proxy", () => {
    expect(proxyStorageUrl(`${BASE}/intake/abc123/brief.pdf`)).toBe(
      "/api/file?b=intake&p=abc123%2Fbrief.pdf",
    );
  });

  it("decodes the stored escaping once, so the signed key is the real object key", () => {
    // a real filename with a space, as stored inside a URL
    expect(proxyStorageUrl(`${BASE}/intake/abc/my%20logo.png`)).toBe(
      "/api/file?b=intake&p=abc%2Fmy%20logo.png",
    );
  });

  it("rewrites an avatar, now that its bucket is private too", () => {
    expect(proxyStorageUrl(`${BASE}/avatars/client/x.png`)).toBe(
      "/api/file?b=avatars&p=client%2Fx.png",
    );
  });

  /**
   * ⚠️⚠️ THE ONE THAT HOLDS THE TWO MECHANISMS APART. The public client report and
   * the shared Gantt have no session, so `/api/file` would 401 their readers —
   * those pages sign the client's mark SERVER-SIDE and pass the signed url into
   * the very same `ClientAvatar` the app uses. This asserts the signed url is left
   * alone; if that ever stopped being true, every client's own mark would silently
   * become a broken image on their own report.
   */
  it("NEVER re-proxies an already-signed url", () => {
    const signed =
      "https://hjrhfifbmxduwacjzqdt.supabase.co/storage/v1/object/sign/avatars/client/x.png" +
      "?token=eyJhbGciOiJIUzI1NiJ9.abc.def";
    expect(proxyStorageUrl(signed)).toBe(signed);
  });

  it("leaves a client's own typed link completely alone", () => {
    for (const u of [
      "https://docs.google.com/document/d/abc/edit",
      "https://example.com/a/storage/v1/object/public",
      "mailto:someone@example.com",
      "",
    ]) {
      expect(proxyStorageUrl(u)).toBe(u);
    }
  });

  it("survives null and undefined without throwing", () => {
    expect(proxyStorageUrl(null)).toBe("");
    expect(proxyStorageUrl(undefined)).toBe("");
  });

  it("leaves a malformed escape exactly as stored rather than mangling it", () => {
    const u = `${BASE}/intake/abc/100%.png`;
    expect(proxyStorageUrl(u)).toBe(u);
  });

  it("leaves a bucket with no object path alone", () => {
    expect(proxyStorageUrl(`${BASE}/intake/`)).toBe(`${BASE}/intake/`);
    expect(proxyStorageUrl(`${BASE}/intake`)).toBe(`${BASE}/intake`);
  });
});

describe("parseProxyRequest", () => {
  it("accepts an allow-listed bucket", () => {
    expect(parseProxyRequest("intake", "abc/brief.pdf")).toEqual({
      bucket: "intake",
      path: "abc/brief.pdf",
    });
  });

  it("accepts task-files, the second bucket to go private", () => {
    expect(parseProxyRequest("task-files", "abc/plan.pdf")).toEqual({
      bucket: "task-files",
      path: "abc/plan.pdf",
    });
  });

  it("REFUSES a bucket that is not allow-listed, however valid the path", () => {
    // without this the route would sign any object in any bucket for any session.
    // ⚠️ All three real buckets are allow-listed now, so this guards the shape
    // rather than a specific name: anything NOT in the list is refused, which is
    // what stops the route signing an arbitrary bucket for anyone with a session.
    expect(parseProxyRequest("secrets", "a/b.png")).toBeNull();
    expect(parseProxyRequest("storage", "a/b.png")).toBeNull();
    expect(parseProxyRequest("", "a/b.png")).toBeNull();
  });

  it("refuses traversal and absolute keys", () => {
    expect(parseProxyRequest("intake", "../avatars/x.png")).toBeNull();
    expect(parseProxyRequest("intake", "a/../../x")).toBeNull();
    expect(parseProxyRequest("intake", "/abc/x.png")).toBeNull();
  });

  it("refuses a missing bucket or path", () => {
    expect(parseProxyRequest(null, "a")).toBeNull();
    expect(parseProxyRequest("intake", null)).toBeNull();
    expect(parseProxyRequest("intake", "")).toBeNull();
  });

  it("round-trips what proxyStorageUrl produces", () => {
    const built = proxyStorageUrl(`${BASE}/intake/abc123/brief.pdf`);
    const qs = new URLSearchParams(built.split("?")[1]);
    expect(parseProxyRequest(qs.get("b"), qs.get("p"))).toEqual({
      bucket: "intake",
      path: "abc123/brief.pdf",
    });
  });
});
