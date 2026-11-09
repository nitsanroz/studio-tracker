/**
 * Makes the `task-files` and `lead-files` storage buckets refuse any Content-Type
 * the app never chooses — the same enforcement `configure-intake-bucket.mjs` gave
 * `intake` in August.
 *
 * ⚠️ WHY: browsers upload into these buckets DIRECTLY with signed upload URLs
 * (task attachments, client Overview files, lead files), so the browser sets the
 * Content-Type. The route picks the safe type from the allowlist, but a hand-made
 * upload could store an `x.png` as `text/html` — which then opens as a page on
 * the storage domain. `/api/file` and `/api/lead-file` now serve any foreign
 * type as a download (`opensInline`, 2026-11-09); this makes the bucket refuse it
 * in the first place.
 *
 * ONLY `allowed_mime_types` changes. `public` and `file_size_limit` are read and
 * passed back as they are — this script is not the place to change either.
 * The list is the same eight types SAFE_TYPES can produce (uploads.test.ts pins
 * it): every upload path into these buckets classifies through the allowlist, and
 * task attachments store anything unknown as application/octet-stream.
 *
 * Read-only by default; pass --apply to write.
 *   node --env-file=.env.local scripts/configure-file-buckets.mjs [--apply]
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const BUCKETS = ["task-files", "lead-files"];

// Kept in step with src/lib/uploads.ts by hand — see configure-intake-bucket.mjs.
const TYPES = [
  "application/octet-stream",
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain",
];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

for (const id of BUCKETS) {
  const { data: before, error: readErr } = await sb.storage.getBucket(id);
  if (readErr) {
    console.error(`${id}: could not read the bucket:`, readErr.message);
    process.exitCode = 1;
    continue;
  }
  console.log(`\n${id} — current:`);
  console.log(`  public             ${before.public}`);
  console.log(`  file_size_limit    ${before.file_size_limit ?? "none"}`);
  console.log(`  allowed_mime_types ${before.allowed_mime_types ?? "any"}`);
  console.log(`${id} — wanted:`);
  console.log(`  allowed_mime_types ${TYPES.join(", ")}  (public and size limit unchanged)`);
  if (!APPLY) continue;

  const { error } = await sb.storage.updateBucket(id, {
    public: before.public,
    fileSizeLimit: before.file_size_limit ?? undefined,
    allowedMimeTypes: TYPES,
  });
  if (error) {
    console.error(`${id}: update failed:`, error.message);
    process.exitCode = 1;
    continue;
  }
  const { data: after } = await sb.storage.getBucket(id);
  console.log(`${id} — applied: allowed_mime_types ${after.allowed_mime_types}`);
}
if (!APPLY) console.log("\nDry run. Re-run with --apply to write.");
