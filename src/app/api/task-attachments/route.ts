import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { classifyTaskAttachment, formatSize } from "@/lib/uploads";

/**
 * Task attachments. Session-verified; storage and the `attachments` row via the
 * service key.
 *
 * ⚠️ THE BYTES NEVER PASS THROUGH THIS FUNCTION. Vercel refuses a request body
 * over ~4.5MB before the route runs, so the old multipart POST stuck every
 * bigger file on "Uploading…" forever (v1.75.3 — a 10MB zip). Same transport as
 * `/api/client-file` and the intake form, in two calls:
 *   1. `{taskId, name, size}` → `{path, token, contentType}`: a one-shot signed
 *      upload URL for one path under the task's folder;
 *   2. the browser PUTs the file straight to storage (with progress);
 *   3. `{taskId, path, name, commit: true}` → the `attachments` row. The size is
 *      read back from storage, never taken from the browser.
 * DELETE `{id}` → the uploader or an admin removes the object and the row.
 */

const BUCKET = "task-files";
const MAX_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { taskId?: unknown; name?: unknown; size?: unknown; path?: unknown; commit?: unknown }
    | null;
  const taskId = typeof body?.taskId === "string" ? body.taskId : "";
  const name = typeof body?.name === "string" ? body.name.slice(0, 200) : "";
  if (!UUID.test(taskId) || !name) {
    return NextResponse.json({ error: "taskId and file are required" }, { status: 400 });
  }

  const sb = admin();

  // Guard: the target task must exist (blocks attaching to arbitrary/guessed ids).
  const { data: task } = await sb.from("tasks").select("id").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  if (body?.commit === true) {
    // ⚠️ Only a path inside THIS task's folder: the row's public URL is served to
    // anyone who opens the task, so it must not point at somebody else's object.
    const path = typeof body.path === "string" ? body.path : "";
    if (!path.startsWith(`${taskId}/`) || path.includes("..")) {
      return NextResponse.json({ error: "Upload failed" }, { status: 400 });
    }
    const { data: info, error: infoErr } = await sb.storage.from(BUCKET).info(path);
    if (infoErr || !info) {
      return NextResponse.json({ error: "The upload didn't reach storage — try again" }, { status: 400 });
    }
    // The browser sent the Content-Type header itself, so check it is the one the
    // allowlist chose in step 1 — a hand-made PUT could have said text/html.
    const cls = classifyTaskAttachment({ name } as File);
    const stored = String(info.contentType ?? "").split(";")[0].trim();
    if (!cls.ok || (stored && stored !== cls.contentType)) {
      await sb.storage.from(BUCKET).remove([path]);
      return NextResponse.json(
        { error: "That file type isn't allowed — use a PDF, image, document, or zip" },
        { status: 400 },
      );
    }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    const { data: row, error } = await sb
      .from("attachments")
      .insert({
        task_id: taskId,
        file_path: pub.publicUrl,
        file_name: name,
        size_bytes: Number(info.size ?? 0),
        uploaded_by: user.id,
      })
      .select()
      .single();
    if (error) {
      console.error("attachment insert failed", error);
      return NextResponse.json({ error: "Could not save attachment" }, { status: 400 });
    }
    return NextResponse.json({
      id: row.id,
      taskId,
      fileName: row.file_name,
      filePath: row.file_path,
      sizeBytes: row.size_bytes,
      uploadedBy: row.uploaded_by,
    });
  }

  const size = typeof body?.size === "number" && Number.isFinite(body.size) ? body.size : -1;
  if (size < 0) return NextResponse.json({ error: "taskId and file are required" }, { status: 400 });
  if (size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That's ${formatSize(size)}, over the ${formatSize(MAX_BYTES)} limit — use a link instead.` },
      { status: 400 },
    );
  }
  // Never store a client-supplied Content-Type: an .html/.svg stored as
  // text/html would be a script-hosting URL on the studio's own Supabase origin.
  // The allowlist picks the type server-side and rejects anything renderable as
  // active content. Tasks alone also take .html, forced to download (v1.75.4).
  const cls = classifyTaskAttachment({ name } as File);
  if (!cls.ok) {
    return NextResponse.json(
      { error: "That file type isn't allowed — use a PDF, image, document, or zip" },
      { status: 400 },
    );
  }

  const path = `${taskId}/${Date.now()}-${safeName(name)}`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("attachment signed upload url failed", error);
    return NextResponse.json({ error: "Could not start the upload." }, { status: 500 });
  }
  return NextResponse.json({ path: data.path, token: data.token, contentType: cls.contentType });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const sb = admin();
  const { data: row } = await sb
    .from("attachments")
    .select("file_path, uploaded_by")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Ownership: only the uploader or an admin may delete an attachment.
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = me?.role === "admin";
  if (!isAdmin && row.uploaded_by !== user.id) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  if (row.file_path) {
    // public URL → storage path after "/task-files/"
    const marker = `/${BUCKET}/`;
    const idx = row.file_path.indexOf(marker);
    if (idx >= 0) await sb.storage.from(BUCKET).remove([row.file_path.slice(idx + marker.length)]);
  }
  const { error } = await sb.from("attachments").delete().eq("id", id);
  if (error) {
    console.error("attachment delete failed", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
