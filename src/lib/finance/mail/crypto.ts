import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypting Gmail refresh tokens at rest (v1.12.0) — the tracker's
// src/lib/gmail/crypto.ts with finance's own key, FINANCE_MAIL_TOKEN_KEY.
//
// ⚠️ A refresh token is a standing (read-only) key to a mailbox. The table is
// owner-only under RLS (reference/0015), and this is the second lock: a leaked
// row without the server's key is ciphertext, not a mailbox.
// AES-256-GCM, a fresh 12-byte IV per token, stored as `v1.<iv>.<tag>.<data>`.

function key(): Buffer {
  const k = Buffer.from(process.env.FINANCE_MAIL_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("FINANCE_MAIL_TOKEN_KEY must be 32 bytes, base64-encoded.");
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
