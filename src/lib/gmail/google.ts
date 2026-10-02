// Google's OAuth and Gmail REST endpoints, by plain fetch.
//
// ⚠️ NO `googleapis` PACKAGE, deliberately. It is ~100MB of generated clients
// for every Google product, the app needs six endpoints, and every one of them
// is a documented JSON call. Server-side only — the CSP forbids the browser
// from reaching Google, and the tokens must never be in a browser anyway.
//
// ⚠️ READ-ONLY SCOPE, ALWAYS: `gmail.readonly`. Nothing in this file can send,
// label, archive or delete mail, and the scope means Google would refuse it if
// anything tried.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GMAIL_PUBSUB_TOPIC &&
      process.env.GMAIL_TOKEN_KEY,
  );
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

/** The consent screen URL. `prompt=consent` + `offline` so a refresh token always comes back. */
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
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new GmailError(res.status, String(json.error_description ?? json.error ?? `token HTTP ${res.status}`));
  }
  return json;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const j = await tokenCall({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  return {
    accessToken: String(j.access_token ?? ""),
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null,
    scope: String(j.scope ?? ""),
  };
}

/** A fresh access token. A 400 `invalid_grant` means the person revoked access. */
export async function accessTokenFor(refreshToken: string): Promise<string> {
  const j = await tokenCall({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return String(j.access_token ?? "");
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => undefined);
}

/** One Gmail API call for the signed-in mailbox (`users/me`). */
export async function gmail<T>(
  accessToken: string,
  path: string,
  init: { method?: "GET" | "POST"; query?: Record<string, string | string[]>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GmailError(res.status, j.error?.message ?? `Gmail HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

export const getProfile = (at: string) => gmail<GmailProfile>(at, "profile");

/**
 * Asks Gmail to push changes to our Pub/Sub topic. Lasts 7 days, so the daily
 * cron renews it. Watching the whole mailbox, not just INBOX: the studio's own
 * SENT replies are what flip "who owes the reply".
 */
export const watch = (at: string) =>
  gmail<{ historyId: string; expiration: string }>(at, "watch", {
    method: "POST",
    body: { topicName: process.env.GMAIL_PUBSUB_TOPIC, labelFilterBehavior: "exclude", labelIds: ["SPAM", "TRASH"] },
  });

export const stopWatch = (at: string) => gmail<unknown>(at, "stop", { method: "POST" }).catch(() => undefined);

export interface HistoryPage {
  history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
  historyId: string;
  nextPageToken?: string;
}

export const listHistory = (at: string, startHistoryId: string, pageToken?: string) =>
  gmail<HistoryPage>(at, "history", {
    query: {
      startHistoryId,
      historyTypes: "messageAdded",
      maxResults: "500",
      ...(pageToken ? { pageToken } : {}),
    },
  });

/** Headers only — enough to match a thread to a lead without reading the body. */
export const getMessageMeta = (at: string, id: string) =>
  gmail<import("./parse").GmailMessage>(at, `messages/${id}`, {
    query: { format: "metadata", metadataHeaders: ["From", "To", "Cc", "In-Reply-To", "References"] },
  });

export const getThread = (at: string, id: string) =>
  gmail<{ id: string; messages?: import("./parse").GmailMessage[] }>(at, `threads/${id}`, {
    query: { format: "full" },
  });

export const searchThreads = (at: string, q: string, maxResults = 50) =>
  gmail<{ threads?: { id: string }[] }>(at, "threads", { query: { q, maxResults: String(maxResults) } });
