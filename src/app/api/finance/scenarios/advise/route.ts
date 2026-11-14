import { NextResponse } from "next/server";
import { ownerOnly } from "@/lib/finance/advice/owner";
import { adviseScenarios } from "@/lib/finance/scenarios/advise";
import type { AdviceInput } from "@/lib/finance/scenarios/advise-prompt";

export const maxDuration = 120;

/**
 * The Scenarios advisor (v1.29.0), owner only: one Claude call per click.
 * The body is what the advisor sees — built on the page from the owner's own
 * data (advise-prompt.ts adviceInput) — plus the saved scenarios it's about.
 */
export async function POST(req: Request) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  let body: { input?: AdviceInput; scenarioIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const input = body.input;
  if (!input || !["advise", "compare", "suggest"].includes(input.kind) || !Array.isArray(input.scenarios) || !input.studio || !["English", "Hebrew", undefined].includes(input.language))
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  // A sane ceiling on what's sent on to Claude.
  if (JSON.stringify(input).length > 200_000) return NextResponse.json({ error: "Too much to send" }, { status: 413 });
  try {
    return NextResponse.json(await adviseScenarios(auth.sb, input, Array.isArray(body.scenarioIds) ? body.scenarioIds.map(String) : []));
  } catch (e) {
    const status = (e as { status?: number }).status;
    return NextResponse.json({ error: (e as Error).message }, { status: status === 503 ? 503 : 500 });
  }
}
