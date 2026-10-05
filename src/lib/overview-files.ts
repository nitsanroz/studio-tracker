// Files on the Overview tabs (0050): a client's (`client_files`, read by
// everyone, `task-files` bucket) and a lead's (`lead_files`, admins only,
// `lead-files` bucket — shown on its estimates' Overview and carried to the
// client on conversion).
//
// ⚠️ FETCHED BY THE TAB, NOT THE STORE — a few rows for one page, read only
// when its Overview opens. A missing table reads as no files, so an unapplied
// migration costs nothing.
//
// ⚠️ THE BYTES NEVER PASS THROUGH A FUNCTION: each route hands out a signed
// upload URL and the browser writes to storage itself (see /api/lead-file).

import { createClient } from "./supabase/client";

export interface OverviewFile {
  id: string;
  path: string;
  name: string;
  size: number;
  uploadedBy: string | null;
}

type Row = { id: string; path: string; file_name: string; size_bytes: number | null; uploaded_by: string | null };
const COLS = "id,path,file_name,size_bytes,uploaded_by";
const map = (r: Row): OverviewFile => ({
  id: r.id,
  path: r.path,
  name: r.file_name,
  size: Number(r.size_bytes ?? 0),
  uploadedBy: r.uploaded_by,
});

async function list(table: "client_files" | "lead_files", key: "client_id" | "lead_id", id: string) {
  const { data, error } = await createClient().from(table).select(COLS).eq(key, id).order("created_at");
  return error ? [] : ((data ?? []) as Row[]).map(map);
}

/** Asks `route` for a signed upload URL, then sends the file straight to `bucket`. */
async function sendToStorage(route: string, bucket: string, payload: object, file: File): Promise<string> {
  const res = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, name: file.name, size: file.size }),
  });
  const j = (await res.json().catch(() => ({}))) as { path?: string; token?: string; contentType?: string; error?: string };
  if (!res.ok || !j.path || !j.token) throw new Error(j.error ?? "Could not start the upload.");
  const { error } = await createClient()
    .storage.from(bucket)
    .uploadToSignedUrl(j.path, j.token, file, { contentType: j.contentType });
  if (error) throw new Error(`Upload failed — ${error.message}`);
  return j.path;
}

async function insertRow(table: "client_files" | "lead_files", row: Record<string, unknown>) {
  const { error } = await createClient().from(table).insert(row);
  if (error) throw new Error(`The file uploaded but could not be listed — ${error.message}`);
}

// ── client ──────────────────────────────────────────────────────────────────

export const loadClientFiles = (clientId: string) => list("client_files", "client_id", clientId);

export async function addClientFile(clientId: string, file: File, uploadedBy: string) {
  const path = await sendToStorage("/api/client-file", "task-files", { clientId }, file);
  await insertRow("client_files", { client_id: clientId, path, file_name: file.name, size_bytes: file.size, uploaded_by: uploadedBy });
}

export async function removeClientFile(id: string) {
  const res = await fetch("/api/client-file", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not remove the file.");
}

/** Served by the studio-wide `/api/file` proxy, like a task attachment. */
export const clientFileHref = (path: string) => `/api/file?b=task-files&p=${encodeURIComponent(path)}`;

/** On conversion: copies the chosen lead files onto the client. Admins only. */
export async function copyLeadFilesToClient(clientId: string, leadFileIds: string[]) {
  if (leadFileIds.length === 0) return;
  const res = await fetch("/api/client-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, fromLead: leadFileIds }),
  });
  const j = (await res.json().catch(() => ({}))) as { copied?: number; of?: number; error?: string };
  if (!res.ok) throw new Error(j.error ?? "The files could not be copied.");
  if ((j.copied ?? 0) < (j.of ?? 0)) throw new Error(`Only ${j.copied} of ${j.of} files were copied to the client.`);
}

// ── lead ────────────────────────────────────────────────────────────────────

export const loadLeadFiles = (leadId: string) => list("lead_files", "lead_id", leadId);

/** Uploads one file to the private `lead-files` bucket and returns its path. */
export const uploadLeadFile = (leadId: string, file: File) => sendToStorage("/api/lead-file", "lead-files", { leadId }, file);

export async function addLeadFile(leadId: string, file: File, uploadedBy: string) {
  const path = await uploadLeadFile(leadId, file);
  await insertRow("lead_files", { lead_id: leadId, path, file_name: file.name, size_bytes: file.size, uploaded_by: uploadedBy });
}

export async function removeLeadFile(f: OverviewFile) {
  const { error } = await createClient().from("lead_files").delete().eq("id", f.id);
  if (error) throw new Error(error.message);
  // Best effort: the row is what the page lists; an orphaned object costs bytes, not correctness.
  await fetch("/api/lead-file", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: f.path }),
  }).catch(() => undefined);
}

export const leadFileHref = (path: string) => `/api/lead-file?p=${encodeURIComponent(path)}`;
