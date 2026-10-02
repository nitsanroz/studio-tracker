import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/gmail/auth";
import { googleConfigured } from "@/lib/gmail/google";
import { backfillLead, service } from "@/lib/gmail/sync";

export const maxDuration = 60;

/** "Search Gmail" on a lead: the last 12 months of its mail, from every connected mailbox. */
export async function POST(req: NextRequest) {
  const who = await requireAdmin();
  if ("response" in who) return who.response;
  if (!googleConfigured()) return NextResponse.json({ error: "Gmail isn't set up yet." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { leadId?: unknown } | null;
  const leadId = typeof body?.leadId === "string" ? body.leadId : "";
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return NextResponse.json({ error: "No lead" }, { status: 400 });
  try {
    const r = await backfillLead(service(), leadId);
    return NextResponse.json(r);
  } catch (e) {
    console.error("[gmail] backfill failed", e);
    return NextResponse.json({ error: "Gmail search failed — try again." }, { status: 502 });
  }
}
