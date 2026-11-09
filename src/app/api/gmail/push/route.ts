import { after, NextResponse, type NextRequest } from "next/server";
import { accountByEmail, service, syncAccount } from "@/lib/gmail/sync";
import { safeEqual } from "@/lib/cron";

export const maxDuration = 60;

/**
 * Pub/Sub pushes here whenever a connected mailbox changes.
 *
 * ⚠️ ANSWER FIRST, WORK AFTER. Pub/Sub redelivers anything not acknowledged
 * within its deadline, so the sync runs in `after()` and the 204 goes back at
 * once. A redelivery is harmless anyway — every write here is an upsert.
 *
 * ⚠️ The push carries no user session; the `token` in the subscription URL
 * (GMAIL_PUSH_SECRET) is what proves it came from our subscription, and the
 * mailbox it names must be one somebody connected.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.GMAIL_PUSH_SECRET ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (secret.length < 32 || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { message?: { data?: string } } | null;
  let email: string | null = null;
  try {
    const decoded = JSON.parse(Buffer.from(body?.message?.data ?? "", "base64").toString("utf8")) as {
      emailAddress?: string;
    };
    email = decoded.emailAddress ?? null;
  } catch {
    // Malformed — acknowledge so Pub/Sub stops redelivering it.
  }
  if (email) {
    after(async () => {
      const sb = service();
      const account = await accountByEmail(sb, email!);
      if (!account || account.status !== "ok") return;
      try {
        await syncAccount(sb, account);
      } catch (e) {
        console.error(`[gmail] push sync ${email} failed`, e);
        await sb
          .from("gmail_accounts")
          .update({ last_error: e instanceof Error ? e.message : String(e) })
          .eq("id", account.id);
      }
    });
  }
  return new NextResponse(null, { status: 204 });
}
