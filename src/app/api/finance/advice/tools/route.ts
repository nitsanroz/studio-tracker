import { NextResponse } from "next/server";
import { adviceError, ownerOnly } from "@/lib/finance/advice/owner";
import { reviewTools } from "@/lib/finance/advice/review";

export const maxDuration = 120;

/**
 * "Review the tools" (v1.11.0), owner only: Claude looks over every live
 * subscription and the pane's Expenses cards are replaced with its
 * suggestions. One Claude call per click — the pane's button, never a schedule.
 */
export async function POST() {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  try {
    return NextResponse.json(await reviewTools(auth.sb));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 503) return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    return adviceError(e);
  }
}
