import { NextResponse } from "next/server";
import { ownerOnly } from "@/lib/advice/owner";
import { adviceError } from "@/lib/finance/advice/owner";
import { reviewBusiness } from "@/lib/advice/business-review";
import { runCheck } from "@/lib/advice/run";

export const maxDuration = 180;

/**
 * "Review the business", owner only: Claude reads the studio's last three
 * months as a consultant would — shares, percentages, hours and indexes, never
 * an amount (business.ts `businessBrief`) — and its recommendations become the
 * pane's "Business" cards. One Claude call per click, never a schedule.
 */
export async function POST() {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  try {
    // The brief is built from a check run right now, so it describes today.
    const { metrics, rows } = await runCheck(auth.sb);
    await reviewBusiness(auth.sb, metrics, rows);
    return NextResponse.json((await runCheck(auth.sb)).view);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 503 || status === 409) return NextResponse.json({ error: (e as Error).message }, { status });
    return adviceError(e);
  }
}
