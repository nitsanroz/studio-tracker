import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Is this Vercel's cron calling? It sends `Authorization: Bearer $CRON_SECRET`.
 * One copy for every cron route: the 16-character floor and the timing-safe
 * compare are the gate, and a hardening made in one copy would miss the others.
 */
export function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const want = `Bearer ${secret}`;
  const got = req.headers.get("authorization") ?? "";
  return secret.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
