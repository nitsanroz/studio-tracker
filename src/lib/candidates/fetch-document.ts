// Downloads a CV somebody sent as a LINK (Drive, Dropbox, a .pdf URL) so it
// can be stored and read like an attached one. Server-only.
//
// ⚠️⚠️ THE URL COMES OUT OF A STRANGER'S EMAIL, so this is a server fetching an
// address an outsider chose — the classic way to make a server reach things
// only it can reach. Every hop, redirects included, must be https, on port
// 443, and resolve to a PUBLIC address; redirects are followed by hand so each
// one is checked, not trusted to `fetch`'s own following. The route calling
// this is admin-only too, but the address is still the applicant's.
//
// ⚠️ ONLY A PDF IS KEPT, judged by its first bytes (`%PDF-`), never by the
// Content-Type a remote server claims. A private Drive file answers with a
// sign-in PAGE and a 200 — that must come back as "not readable", not get
// stored as somebody's CV.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Bigger than any CV; a portfolio over this belongs as a link anyway. */
export const MAX_LINKED_BYTES = 20 * 1024 * 1024;
const MAX_HOPS = 5;
const TIMEOUT_MS = 15_000;

function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) {
    throw new Error("not a public https address");
  }
  // An IPv6 literal keeps its brackets in `hostname` ("[::1]").
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivate(a.address))) {
    throw new Error("not a public address");
  }
}

/** "attachment; filename*=UTF-8''Dana%20CV.pdf" → "Dana CV.pdf". */
function filenameOf(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = disposition.match(/filename\*\s*=\s*[^']*''([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star.trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  return disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1]?.trim() ?? null;
}

export async function fetchLinkedPdf(
  raw: string,
): Promise<{ bytes: ArrayBuffer; filename: string | null }> {
  let url = new URL(raw);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: "manual", signal, headers: { accept: "application/pdf,*/*" } });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error("redirect without a destination");
      url = new URL(next, url);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`answered ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_LINKED_BYTES) throw new Error("too large");

    // Read with a running cap: a missing or lying Content-Length must not let
    // a remote server stream us gigabytes.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_LINKED_BYTES) {
        await reader.cancel();
        throw new Error("too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("not a PDF");
    return { bytes: bytes.buffer, filename: filenameOf(res.headers.get("content-disposition")) };
  }
  throw new Error("too many redirects");
}
