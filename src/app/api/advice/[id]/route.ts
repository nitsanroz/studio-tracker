import { NextResponse, type NextRequest } from "next/server";
import { ownerOnly } from "@/lib/advice/owner";

/**
 * One &advice item: snooze it, tick it done, or undo either (the toast's Undo).
 *
 * Both remember the severity they hid it at, so a later check that finds it
 * WORSE brings it back early (merge.ts). Done works on every item since
 * 2026-10-25 — on advice it's "Dismiss" (Nitsan: a freelancer's empty days
 * aren't a problem, and snoozing them again every week was).
 */
type Body = { action: "snooze"; until: string } | { action: "done" } | { action: "undo" };

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;

  const { data: row, error } = await auth.sb.from("advice_items").select("severity").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let patch: Record<string, unknown>;
  if (body?.action === "snooze" && /^\d{4}-\d{2}-\d{2}$/.test(body.until)) {
    patch = { snoozed_until: body.until, snoozed_at_severity: row.severity, done_at: null };
  } else if (body?.action === "done") {
    patch = { done_at: new Date().toISOString(), snoozed_at_severity: row.severity, snoozed_until: null };
  } else if (body?.action === "undo") {
    patch = { done_at: null, snoozed_until: null, snoozed_at_severity: null };
  } else {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { error: upd } = await auth.sb.from("advice_items").update(patch).eq("id", id);
  if (upd) return NextResponse.json({ error: upd.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
