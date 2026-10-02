import { NextResponse } from "next/server";
import { decryptToken } from "@/lib/gmail/crypto";
import { accessTokenFor, revokeToken, stopWatch } from "@/lib/gmail/google";
import { requireAdmin } from "@/lib/gmail/auth";
import { service } from "@/lib/gmail/sync";

/**
 * Disconnects the signed-in admin's OWN mailbox: stops the push, revokes the
 * grant at Google, deletes the token. Threads already filed stay on their
 * leads — they are the lead's history, not the mailbox's.
 */
export async function POST() {
  const who = await requireAdmin();
  if ("response" in who) return who.response;
  const sb = service();
  const { data } = await sb
    .from("gmail_accounts")
    .select("id,refresh_token_enc")
    .eq("profile_id", who.userId)
    .maybeSingle();
  if (data) {
    try {
      const refresh = decryptToken((data as { refresh_token_enc: string }).refresh_token_enc);
      await stopWatch(await accessTokenFor(refresh));
      await revokeToken(refresh);
    } catch (e) {
      // Already revoked at Google's end is the common case; deleting is what matters.
      console.error("[gmail] disconnect: revoke failed", e);
    }
    await sb.from("gmail_accounts").delete().eq("id", (data as { id: string }).id);
  }
  return NextResponse.json({ ok: true });
}
