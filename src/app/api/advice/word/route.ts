import { NextResponse } from "next/server";
import { ownerOnly } from "@/lib/advice/owner";
import { adviceError } from "@/lib/finance/advice/owner";
import { wordToday } from "@/lib/advice/word";

export const maxDuration = 120;

/**
 * Today's Claude wording: the pane calls this in the background when its GET
 * said `wordingDue` — the day's first open runs it (Nitsan, 2026-10-24), for
 * the studio's findings and the money's together since the finance merge. A second call the same day only re-checks.
 */
export async function POST() {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  try {
    return NextResponse.json(await wordToday(auth.sb));
  } catch (e) {
    return adviceError(e);
  }
}
