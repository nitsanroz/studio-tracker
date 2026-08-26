import { describe, it, expect } from "vitest";
import { proxyStorageUrl, parseProxyRequest } from "./storage-url";

const BASE = "https://hjrhfifbmxduwacjzqdt.supabase.co/storage/v1/object/public";

/**
 * These pin the two ways this can fail badly rather than visibly: rewriting a URL
 * it should not touch (a client's own link stops working), and NOT rewriting one it
 * should (the file stays world-readable, which is the whole point of the change).
 */
describe("proxyStorageUrl", () => {
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

  it("leaves a bucket that is still public alone", () => {
    const u = `${BASE}/avatars/client/x.png`;
    expect(proxyStorageUrl(u)).toBe(u);
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

  it("REFUSES a bucket that is not allow-listed, however valid the path", () => {
    // without this the route would sign any object in any bucket for any session
    expect(parseProxyRequest("avatars", "a/b.png")).toBeNull();
    expect(parseProxyRequest("task-files", "a/b.png")).toBeNull();
    expect(parseProxyRequest("secrets", "a/b.png")).toBeNull();
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
