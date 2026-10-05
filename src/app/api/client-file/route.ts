import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { classifyUpload, formatSize } from "@/lib/uploads";

/**
 * Files on a client's Overview tab (0050 `client_files`).
 *
 * ⚠️ TASK-ATTACHMENT RULES, NOT LEAD RULES: any signed-in member may add one and
 * read it (through `/api/file`, the same `task-files` bucket), the uploader or
 * an admin removes it. What differs from `/api/task-attachments` is transport —
 * POST hands back a SIGNED UPLOAD URL and the browser sends the bytes straight
 * to storage, as `/api/lead-file` does, so Vercel's ~4.5MB body limit never
 * refuses a brand book.
 *
 * POST `{clientId, name, size}` → `{path, token, contentType}`; the browser
 * uploads, then inserts its own `client_files` row (RLS: `uploaded_by = me`).
 * POST `{clientId, fromLead: [lead_files ids]}` → admins only: copies a won
 * lead's files across on conversion.
 * DELETE `{id}` → removes the object and the row.
 */

const BUCKET = "task-files";
const MAX_BYTES = 25 * 1024 * 1024;

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function whoAmI(): Promise<{ id: string; admin: boolean } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { id: user.id, admin: me?.role === "admin" };
}

const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: NextRequest) {
  const me = await whoAmI();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { clientId?: unknown; name?: unknown; size?: unknown; fromLead?: unknown }
    | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (!UUID.test(clientId)) return NextResponse.json({ error: "Nothing to upload" }, { status: 400 });

  const sb = service();
  const { data: client } = await sb.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if (Array.isArray(body?.fromLead)) {
    if (!me.admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
    const ids = body.fromLead.filter((x): x is string => typeof x === "string" && UUID.test(x));
    if (ids.length === 0) return NextResponse.json({ copied: 0 });
    const { data: rows } = await sb.from("lead_files").select("path,file_name,size_bytes").in("id", ids);
    let copied = 0;
    for (const r of (rows ?? []) as { path: string; file_name: string; size_bytes: number }[]) {
      const dest = `clients/${clientId}/${Date.now()}-${safeName(r.file_name)}`;
      const { error } = await sb.storage.from("lead-files").copy(r.path, dest, { destinationBucket: BUCKET });
      if (error) {
        console.error("lead file copy failed", error);
        continue;
      }
      const { error: insErr } = await sb.from("client_files").insert({
        client_id: clientId,
        path: dest,
        file_name: r.file_name,
        size_bytes: r.size_bytes,
        uploaded_by: me.id,
      });
      if (insErr) console.error("client_files insert failed", insErr);
      else copied++;
    }
    return NextResponse.json({ copied, of: ids.length });
  }

  const name = typeof body?.name === "string" ? body.name.slice(0, 200) : "";
  const size = typeof body?.size === "number" && Number.isFinite(body.size) ? body.size : -1;
  if (!name || size < 0) return NextResponse.json({ error: "Nothing to upload" }, { status: 400 });
  if (size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That's ${formatSize(size)}, over the ${formatSize(MAX_BYTES)} limit — use a link instead.` },
      { status: 400 },
    );
  }
  // ⚠️ The Content-Type is ours, from the allowlist, never the browser's (v1.0.1).
  const kind = classifyUpload({ name } as File);
  if (!kind.ok) {
    return NextResponse.json(
      { error: "That file type isn't allowed — use a PDF, image, document, or zip" },
      { status: 400 },
    );
  }
  const path = `clients/${clientId}/${Date.now()}-${safeName(name)}`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("client-file signed upload url failed", error);
    return NextResponse.json({ error: "Could not start the upload." }, { status: 500 });
  }
  return NextResponse.json({ path: data.path, token: data.token, contentType: kind.contentType });
}

export async function DELETE(request: NextRequest) {
  const me = await whoAmI();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = ((await request.json().catch(() => ({}))) ?? {}) as { id?: unknown };
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const sb = service();
  const { data: row } = await sb.from("client_files").select("path, uploaded_by").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!me.admin && row.uploaded_by !== me.id) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  await sb.storage.from(BUCKET).remove([row.path]);
  const { error } = await sb.from("client_files").delete().eq("id", id);
  if (error) {
    console.error("client file delete failed", error);
    return NextResponse.json({ error: "Could not remove the file" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
