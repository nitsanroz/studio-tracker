import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * The briefs a client can re-use: given the `{id, key}` pairs their own browser
 * remembers, returns a title, a date, and whether each is still editable.
 *
 * ⚠️ IT ANSWERS ONLY FOR PAIRS THAT MATCH. There is deliberately no way to ask
 * "what has this email address sent" — the form is unauthenticated and its URL
 * gets pasted into client emails, so an email→briefs endpoint would hand
 * anybody holding the link the brief text, name and employer behind any address
 * they can guess. The unguessable key is the whole authorisation, and it exists
 * in exactly one place: the browser that submitted the brief. (Same reasoning
 * that kept v1.14.0 from adding an email→identity lookup.)
 *
 * ⚠️ POST, not GET, and the keys travel in the BODY. A key in a query string
 * ends up in browser history, in any proxy log, and in the `Referer` of every
 * request the page makes afterwards.
 */

const MAX_ASKED = 30;

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = admin();

  const { data: link } = await sb
    .from("intake_links")
    .select("id, active")
    .eq("token", token)
    .maybeSingle();
  if (!link || !link.active) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const asked: { id: string; key: string }[] = [];
  if (Array.isArray(body?.items)) {
    for (const row of body.items.slice(0, MAX_ASKED)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.id === "string" && typeof r.key === "string") {
        asked.push({ id: r.id.slice(0, 64), key: r.key.slice(0, 128) });
      }
    }
  }
  if (!asked.length) return NextResponse.json({ briefs: [] });

  const { data, error } = await sb
    .from("task_requests")
    .select("id, title, status, created_at, edited_at, edit_key, intake_link_id, answers")
    .in("id", asked.map((a) => a.id));
  if (error) {
    // ⚠️ Almost certainly migration 0029 not yet applied (no `edit_key` column).
    // An empty list is the right degradation: the chooser then offers only "new",
    // which is exactly what the form did before this feature.
    console.error("intake briefs lookup failed", error);
    return NextResponse.json({ briefs: [] });
  }

  const byId = new Map(asked.map((a) => [a.id, a.key]));
  const briefs = (data ?? [])
    // ⚠️ Both checks, every time: the key must match AND the brief must belong
    // to this intake link, so a key from one client's link cannot read a brief
    // submitted through another's.
    .filter((r) => r.edit_key && r.edit_key === byId.get(r.id) && r.intake_link_id === link.id)
    .map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      editedAt: r.edited_at ?? null,
      /** Only while the studio hasn't acted on it — see the edit path in ../route.ts. */
      editable: r.status === "pending",
      fileCount: Array.isArray(r.answers?.files) ? r.answers.files.length : 0,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return NextResponse.json({ briefs });
}
