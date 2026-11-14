import { NextResponse } from "next/server";
import { adviceError, ownerOnly } from "@/lib/finance/advice/owner";
import { wordToday } from "@/lib/finance/advice/word";

export const maxDuration = 120;

/**
 * Today's Claude wording (v1.6.0): the pane calls this in the background when
 * its GET said `wordingDue` — finance has no crons, so the day's first open
 * runs it (Nitsan, 2026-10-24). A second call the same day only re-checks.
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
