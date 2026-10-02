import { NextResponse } from "next/server";
import { googleConfigured } from "@/lib/gmail/google";
import { requireAdmin } from "@/lib/gmail/auth";
import { service } from "@/lib/gmail/sync";

export const dynamic = "force-dynamic";

/** Who has a mailbox connected — never the token or the cursor. */
export async function GET() {
  const who = await requireAdmin();
  if ("response" in who) return who.response;
  const configured = googleConfigured();
  const { data, error } = await service()
    .from("gmail_accounts")
    .select("profile_id,email,status,last_error,last_sync_at,watch_expires_at,connected_at");
  return NextResponse.json({
    configured,
    installed: !error,
    me: who.userId,
    connections: data ?? [],
  });
}
