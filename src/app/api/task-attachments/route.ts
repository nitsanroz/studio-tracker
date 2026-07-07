import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Upload / delete task attachments. Session-verified; storage via service key.
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

  const form = await request.formData();
  const taskId = String(form.get("taskId") ?? "");
  const file = form.get("file");
  if (!taskId || !(file instanceof File)) {
    return NextResponse.json({ error: "taskId and file are required" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 25MB — use a link for larger files" }, { status: 400 });
  }

  const sb = admin();
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${taskId}/${Date.now()}-${safe}`;
  const { error: upErr } = await sb.storage
    .from("task-files")
    .upload(path, file, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  const { data: pub } = sb.storage.from("task-files").getPublicUrl(path);
  const { data: row, error } = await sb
    .from("attachments")
    .insert({
      task_id: taskId,
      file_path: pub.publicUrl,
      file_name: file.name,
      size_bytes: file.size,
      uploaded_by: user.id,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    id: row.id,
    taskId,
    fileName: row.file_name,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
  });
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
  const { data: row } = await sb.from("attachments").select("file_path").eq("id", id).maybeSingle();
  if (row?.file_path) {
    // public URL → storage path after "/task-files/"
    const marker = "/task-files/";
    const idx = row.file_path.indexOf(marker);
    if (idx >= 0) await sb.storage.from("task-files").remove([row.file_path.slice(idx + marker.length)]);
  }
  const { error } = await sb.from("attachments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
