import { NextResponse, type NextRequest } from "next/server";
import { adviceError, ownerOnly } from "@/lib/finance/advice/owner";
import { runCheck } from "@/lib/finance/advice/run";

export const maxDuration = 60;

/**
 * &advice, owner only (v1.6.0). GET runs every rule check and returns what the
 * pane shows — opening the pane IS the refresh, as in the tracker. `?peek=1`
 * returns just each waiting item's signal and kind, so the corner button shows
 * only on pages that have something.
 *
 * 403 for anyone but the owner, which is also how the button learns to stay hidden.
 */
export async function GET(req: NextRequest) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  try {
    // ⚠️ Unlike the tracker's, the peek RUNS the checks: finance has no daily
    // cron to write rows, so a peek of stored rows alone found nothing and hid
    // the button for good (measured 2026-10-24, right after 0010 ran). It runs
    // on app load and again whenever the pane or spotlight closes and after a
    // mail scan — each time the full rule check.
    const { view } = await runCheck(auth.sb);
    // The peek also says when the billing mail is due, so any page can start the scan (v1.13.0).
    if (req.nextUrl.searchParams.get("peek")) return NextResponse.json({ items: view.items.map((r) => ({ signal: r.signal, kind: r.kind })), mailDue: view.mailDue });
    return NextResponse.json(view);
  } catch (e) {
    return adviceError(e);
  }
}
