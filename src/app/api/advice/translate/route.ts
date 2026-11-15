import { NextResponse, type NextRequest } from "next/server";
import { ownerOnly } from "@/lib/advice/owner";
import { MAX_LENGTH, MAX_TEXTS, hebrewFor } from "@/lib/advice/hebrew";
import { adviceError } from "@/lib/finance/advice/owner";

export const maxDuration = 120;

/**
 * &advice in Hebrew, owner only. The pane sends the sentences it is showing;
 * the answer is the Hebrew of each — from memory, or from one Claude call for
 * the ones not seen before (lib/advice/hebrew.ts).
 *
 * ⚠️ The sentences come from the browser and may carry amounts. They are
 * marked out on the SERVER before anything is sent to Claude, so what the
 * browser sends cannot put an amount in a prompt.
 */
export async function POST(req: NextRequest) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  const body = (await req.json().catch(() => null)) as { texts?: unknown } | null;
  const texts = Array.isArray(body?.texts) ? body.texts.filter((t): t is string => typeof t === "string" && t.length <= MAX_LENGTH) : null;
  if (!texts || texts.length > MAX_TEXTS) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    return NextResponse.json(await hebrewFor(auth.sb, texts));
  } catch (e) {
    return adviceError(e);
  }
}
