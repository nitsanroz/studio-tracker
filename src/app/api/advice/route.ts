import { NextResponse, type NextRequest } from "next/server";
import { MISSING_SCHEMA_CODES } from "@/lib/db";
import { ownerOnly } from "@/lib/advice/owner";
import { studioToday } from "@/lib/format";
import { loadRows, mailState, checkedRecently, runCheck } from "@/lib/advice/run";
import { visible } from "@/lib/advice/merge";
import { boardMonthsFor, boardOf } from "@/lib/advice/board";

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
 * rows while this server ran a check in the last twenty minutes and runs one otherwise:
 * there is no cron to write rows any more, and a peek of rows nobody wrote
 * once hid finance's button for good (2026-10-24). `&fresh=1` forces the check
 * (after a mail scan). The peek also says when the billing mail is due.
 *
 * `?board=1` adds what the /advice page draws beyond the pane.
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
      // Decide first, then load only what that branch needs — a check reads the rows and the mail state itself.
      const ref = (r: { signal: string; clientId: string | null; kind: string }) => ({ signal: r.signal, clientId: r.clientId, kind: r.kind });
      if (q.get("fresh") || !checkedRecently()) {
        const { view } = await runCheck(auth.sb);
        return NextResponse.json({ items: view.items.map(ref), mailDue: view.mailDue });
      }
      const [stored, mail] = await Promise.all([loadRows(auth.sb), mailState(auth.sb)]);
      return NextResponse.json({ items: visible(stored, studioToday()).map(ref), mailDue: mail.due });
    }
    // The /advice page may pick the months its figures read (`&period=` — board.ts `boardPeriods`).
    const asked = q.get("board") ? (q.get("period") ?? "3m") : "3m";
    const boardMonths = asked === "3m" ? undefined : (boardMonthsFor(asked, studioToday()) ?? undefined);
    const period = boardMonths ? asked : "3m";
    const { view, rows, boardMetrics } = await runCheck(auth.sb, { boardMonths });
    // The /advice page: the same view plus the charts' figures and the store's history (board.ts).
    if (q.get("board")) return NextResponse.json({ ...view, board: boardOf(boardMetrics, rows, view.today, period) });
    return NextResponse.json(view);
  } catch (e) {
    // A table that isn't there yet: say so instead of a bare 500. `detail`
    // names the table or column.
    const err = e as { code?: string; message?: string };
    if (MISSING_SCHEMA_CODES.has(String(err.code)) || /does not exist|schema cache|Could not find the table/i.test(err.message ?? ""))
      return NextResponse.json({ error: "A table or column &advice reads is missing.", detail: err.message }, { status: 503 });
    return NextResponse.json({ error: err.message ?? "Something went wrong" }, { status: 500 });
  }
}
