import { NextResponse, type NextRequest } from "next/server";
import { MISSING_SCHEMA_CODES } from "@/lib/db";
import { ownerOnly } from "@/lib/advice/owner";
import { studioToday } from "@/lib/format";
import { loadRows, mailState, checkedRecently, runCheck } from "@/lib/advice/run";
import { visible } from "@/lib/advice/merge";

export const maxDuration = 60;

/**
 * &advice, owner only — ONE route for the one pane (it was this and
 * /api/finance/advice until the finance merge, stage 4).
 *
 * GET runs every rule check, the studio's and the money's, and returns what
 * the pane shows — opening the pane IS the refresh (Nitsan, 2026-10-24).
 *
 * `?peek=1` returns just each waiting item's signal, client and kind — the
 * corner button shows only on pages that have something. It reads the stored
 * rows while this server ran a check in the last three hours and runs one otherwise:
 * there is no cron to write rows any more, and a peek of rows nobody wrote
 * once hid finance's button for good (2026-10-24). `&fresh=1` forces the check
 * (after a mail scan). The peek also says when the billing mail is due.
 *
 * 403 for anyone but the owner, which is also how the button learns to stay
 * hidden for other admins.
 */
export async function GET(req: NextRequest) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  try {
    const q = req.nextUrl.searchParams;
    if (q.get("peek")) {
      const [stored, mail] = await Promise.all([loadRows(auth.sb), mailState(auth.sb)]);
      const shown = !q.get("fresh") && checkedRecently() ? visible(stored, studioToday()) : (await runCheck(auth.sb)).view.items;
      return NextResponse.json({ items: shown.map((r) => ({ signal: r.signal, clientId: r.clientId, kind: r.kind })), mailDue: mail.due });
    }
    return NextResponse.json((await runCheck(auth.sb)).view);
  } catch (e) {
    // A table that isn't there yet: say so instead of a bare 500. `detail`
    // names the table or column.
    const err = e as { code?: string; message?: string };
    if (MISSING_SCHEMA_CODES.has(String(err.code)) || /does not exist|schema cache|Could not find the table/i.test(err.message ?? ""))
      return NextResponse.json({ error: "A table or column &advice reads is missing.", detail: err.message }, { status: 503 });
    return NextResponse.json({ error: err.message ?? "Something went wrong" }, { status: 500 });
  }
}
