import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Is this Vercel's cron calling? It sends `Authorization: Bearer $CRON_SECRET`.
 * One copy for every cron route: the 16-character floor and the timing-safe
 * compare are the gate, and a hardening made in one copy would miss the others.
 */
export function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  return secret.length >= 16 && safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

/**
 * Constant-time string compare, so a refusal can't be used to guess a secret a
 * byte at a time. ONE copy (2026-11-09) for the cron gate, the Gmail push token
 * and the website-lead token, which each had their own.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
