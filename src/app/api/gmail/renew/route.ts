import { NextResponse, type NextRequest } from "next/server";
import { isCronRequest } from "@/lib/cron";
import { googleConfigured } from "@/lib/gmail/google";
import { renewAll, service } from "@/lib/gmail/sync";
import { purgeDeletedLeads } from "@/lib/leads/purge";

export const maxDuration = 60;

/**
 * The daily cron (vercel.json): Gmail watches lapse after 7 days, so each one
 * is renewed here, followed by a catch-up sync in case a push went missing.
 * It also erases deleted leads (0047) — Hobby allows only two crons, so the
 * purge rides this one, and runs whether or not Gmail is configured.
 *
 * ⚠️ Vercel calls crons with `Authorization: Bearer $CRON_SECRET`; anything
 * else is refused, so this cannot be used to make the app hammer Gmail.
 */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sb = service();
  if (!googleConfigured()) return NextResponse.json({ skipped: "not configured", purged: await purgeDeletedLeads(sb) });
  const [renewed, purged] = await Promise.all([renewAll(sb), purgeDeletedLeads(sb)]);
  return NextResponse.json({ ...renewed, purged });
}
