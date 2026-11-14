// Google's OAuth and Gmail REST endpoints, by plain fetch (v1.12.0) — a
// trimmed COPY of studio-tracker's src/lib/gmail/google.ts, for the billing
// mail &advice reads. Server-side only.
//
// ⚠️ READ-ONLY SCOPE, ALWAYS: `gmail.readonly`. Nothing here can send, label,
// archive or delete mail, and Google would refuse it if anything tried.
//
// It uses the tracker's OAuth client (same Google project): this app's
// callback must be one of that client's redirect URIs.

import type { GmailPart } from "./receipts";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function mailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.FINANCE_MAIL_TOKEN_KEY);
}

export class GmailError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

/** The consent screen. `prompt=consent` + `offline` so a refresh token always comes back. */
export function authUrl(redirectUri: string, state: string, loginHint?: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    hd: "studionmore.com",
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenCall(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new GmailError(res.status, String(json.error_description ?? json.error ?? `token HTTP ${res.status}`));
  return json;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const j = await tokenCall({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  return { accessToken: String(j.access_token ?? ""), refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null, scope: String(j.scope ?? "") };
}

/** A fresh access token. A 400 `invalid_grant` means access was revoked. */
export async function accessTokenFor(refreshToken: string): Promise<string> {
  const j = await tokenCall({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return String(j.access_token ?? "");
}

/** One GET on the signed-in mailbox (`users/me`). */
async function gmail<T>(accessToken: string, path: string, query: Record<string, string | string[]> = {}): Promise<T> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(query)) for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GmailError(res.status, j.error?.message ?? `Gmail HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const getProfile = (at: string) => gmail<{ emailAddress: string }>(at, "profile");

export const listMessages = (at: string, q: string, pageToken?: string) =>
  gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(at, "messages", { q, maxResults: "500", ...(pageToken ? { pageToken } : {}) });

export interface GmailMeta {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

/** Headers and the preview line only — the body isn't fetched. */
export const getMessageMeta = (at: string, id: string) =>
  gmail<GmailMeta>(at, `messages/${id}`, { format: "metadata", metadataHeaders: ["From", "Subject"] });

export interface GmailFull extends GmailMeta {
  payload?: GmailMeta["payload"] & GmailPart;
}

/**
 * The whole message — ONLY for mail already sorted as a receipt (v1.14.0,
 * Nitsan 2026-11-05), read for its amount. Nothing of its text is stored.
 */
export const getMessageFull = (at: string, id: string) => gmail<GmailFull>(at, `messages/${id}`, { format: "full" });

/** One attachment's bytes (v1.16.0) — a receipt's PDF, saved to the private `finance-docs` bucket. */
export async function getAttachment(at: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const j = await gmail<{ data?: string }>(at, `messages/${messageId}/attachments/${attachmentId}`);
  return Buffer.from(j.data ?? "", "base64url");
}
