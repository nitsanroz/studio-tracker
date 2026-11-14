import { NextResponse } from "next/server";
import { ownerOnly } from "@/lib/finance/advice/owner";
import { scanMail } from "@/lib/finance/mail/scan";

export const maxDuration = 120;

/**
 * Scan the connected mailboxes for billing mail (v1.12.0), owner only. The
 * app starts it from any page once it's due (every 6h — run.ts MAIL_EVERY_MS, via the
 * &advice peek's `mailDue`); Settings' "Scan now" too.
 */
export async function POST() {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  try {
    return NextResponse.json({ results: await scanMail(auth.sb) });
  } catch (e) {
    const status = (e as { status?: number }).status === 503 ? 503 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
