import { NextResponse, type NextRequest } from "next/server";
import { MISSING_SCHEMA_CODES } from "@/lib/db";
import { ownerOnly } from "@/lib/advice/owner";
import { studioToday } from "@/lib/format";
import { checkNow, loadRows } from "@/lib/advice/run";
import { visible } from "@/lib/advice/merge";

export const maxDuration = 60;

/**
 * &advice, owner only (v1.80.0).
 *
 * GET runs every rule check and returns what the pane shows — opening the pane
 * IS the refresh (Nitsan, 2026-10-24: daily wording + live checks on open).
 * `?peek=1` skips the checks and returns each waiting item's signal, client
 * and kind — the corner button shows only on pages that have something.
 *
 * 403 for anyone but the owner, which is also how the button learns to stay
 * hidden for other admins.
 */
export async function GET(req: NextRequest) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  try {
    if (req.nextUrl.searchParams.get("peek")) {
      const shown = visible(await loadRows(auth.sb), studioToday());
      // Just enough for the button to know which pages have something to say.
      return NextResponse.json({ items: shown.map((r) => ({ signal: r.signal, clientId: r.clientId, kind: r.kind })) });
    }
    return NextResponse.json(await checkNow(auth.sb));
  } catch (e) {
    // Before 0059 is run the tables don't exist: say so instead of a bare 500.
    // `detail` names the table or column, so a missing piece that ISN'T 0059 is obvious.
    if (MISSING_SCHEMA_CODES.has(String((e as { code?: string }).code)))
      return NextResponse.json({ error: "A table or column is missing — has 0059_advice.sql been run?", detail: (e as Error).message }, { status: 503 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
