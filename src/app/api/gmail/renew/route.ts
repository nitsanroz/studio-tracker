import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { googleConfigured } from "@/lib/gmail/google";
import { renewAll, service } from "@/lib/gmail/sync";

export const maxDuration = 60;

/**
 * The daily cron (vercel.json): Gmail watches lapse after 7 days, so each one
 * is renewed here, followed by a catch-up sync in case a push went missing.
 *
 * ⚠️ Vercel calls crons with `Authorization: Bearer $CRON_SECRET`; anything
 * else is refused, so this cannot be used to make the app hammer Gmail.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const ok = secret.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!googleConfigured()) return NextResponse.json({ skipped: "not configured" });
  return NextResponse.json(await renewAll(service()));
}
