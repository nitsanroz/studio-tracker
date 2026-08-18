import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * One brief's answers, for prefilling a duplicate or an edit.
 *
 * ⚠️ Guarded exactly like ../route.ts — the unguessable key must match AND the
 * brief must belong to this intake link. Returns the ANSWERS the client gave,
 * never anything the studio has since added: no status notes, no
 * `suggested_client_id`, no `seen_by`. A client should read back their own words
 * and nothing about how the studio is handling them.
 */

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await ctx.params;
  const sb = admin();

  const { data: link } = await sb
    .from("intake_links")
    .select("id, active")
    .eq("token", token)
    .maybeSingle();
  if (!link || !link.active) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.slice(0, 128) : "";
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await sb
    .from("task_requests")
    .select("id, title, status, answers, edit_key, intake_link_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !data || data.edit_key !== key || data.intake_link_id !== link.id) {
    // ⚠️ One message for every failure — a wrong key, a brief from another link
    // and a brief that never existed must be indistinguishable, or the endpoint
    // becomes a way to test whether an id is real.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  /**
   * ⚠️ Attachments come back as storage PATHS, derived here rather than in the
   * browser. A duplicate re-uses the very same objects — which is why it costs
   * no storage — and the submission posts paths, so the client would otherwise
   * have to parse a public URL back into a path and the two parsers would drift.
   * `scripts/sweep-intake-storage.mjs` counts an object referenced by two briefs
   * as live, which is what makes the sharing safe.
   */
  const answers = (data.answers ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(answers.files) ? (answers.files as { name?: string; url?: string; size?: number }[]) : [];
  const marker = "/object/public/intake/";
  const files = raw.flatMap((f) => {
    const at = typeof f?.url === "string" ? f.url.indexOf(marker) : -1;
    if (at === -1 || !f?.name) return [];
    let path = f.url!.slice(at + marker.length);
    try {
      path = decodeURIComponent(path);
    } catch {
      /* a path that will not decode is still the path we stored */
    }
    return [{ name: f.name, path, size: Number(f.size ?? 0) }];
  });

  return NextResponse.json({
    id: data.id,
    title: data.title,
    status: data.status,
    editable: data.status === "pending",
    answers,
    files,
  });
}
