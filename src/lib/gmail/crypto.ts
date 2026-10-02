import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypting Gmail refresh tokens at rest.
//
// ⚠️ A refresh token is a standing key to somebody's mailbox. The table that
// holds it has no RLS policy at all (0043), so only the service role can read
// the row — and this is the second lock: a leaked database dump without
// GMAIL_TOKEN_KEY is a list of ciphertexts, not of mailboxes.
//
// AES-256-GCM, a fresh 12-byte IV per token, stored as `v1.<iv>.<tag>.<data>`
// (base64url). The version prefix is there so the key can be rotated later
// without guessing which format a row is in.

function key(): Buffer {
  const raw = process.env.GMAIL_TOKEN_KEY ?? "";
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("GMAIL_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return k;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptToken(stored: string): string {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised token format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
