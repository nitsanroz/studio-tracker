/**
 * Configures the `intake` storage bucket for DIRECT browser uploads.
 *
 * ⚠️ RUN THIS WHENEVER `MAX_INTAKE_BYTES` OR `SAFE_TYPES` CHANGES in
 * src/lib/uploads.ts. Since v1.19.3 the client's browser uploads straight into
 * this bucket with a signed URL, so the BUCKET is the real enforcement:
 *
 *  - `file_size_limit` is what actually refuses an oversized file. The constant
 *    in the app is only the sentence the client reads before trying.
 *  - `allowed_mime_types` replaces the Content-Type the route used to FORCE on
 *    every upload. A browser writing directly chooses its own type, and an
 *    `x.png` stored as `text/html` in a public bucket on our own domain is
 *    hosted XSS. This list is the same eight types SAFE_TYPES can produce —
 *    no HTML, no SVG, no XML, no JavaScript.
 *
 * Read-only by default; pass --apply to write.
 *   node --env-file=.env.local scripts/configure-intake-bucket.mjs [--apply]
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

// Kept in step with src/lib/uploads.ts by hand: this script is plain node and
// cannot import the app's TypeScript. `uploads.test.ts` pins the same list, so a
// change there fails the suite rather than drifting silently.
const MAX_BYTES = 30 * 1024 * 1024;
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

const { data: before, error: readErr } = await sb.storage.getBucket("intake");
if (readErr) {
  console.error("could not read the bucket:", readErr.message);
  process.exit(1);
}
console.log("current:");
console.log(`  file_size_limit    ${before.file_size_limit}`);
console.log(`  allowed_mime_types ${before.allowed_mime_types ?? "any"}`);
console.log(`  public             ${before.public}`);

console.log("\nwanted:");
console.log(`  file_size_limit    ${MAX_BYTES}`);
console.log(`  allowed_mime_types ${TYPES.join(", ")}`);

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}

// ⚠️ `public` is passed through unchanged, not defaulted. The bucket is public
// by design (the intake queue renders attachments straight from getPublicUrl),
// and omitting it here would silently flip that.
const { error } = await sb.storage.updateBucket("intake", {
  public: before.public,
  fileSizeLimit: MAX_BYTES,
  allowedMimeTypes: TYPES,
});
if (error) {
  console.error("update failed:", error.message);
  process.exit(1);
}
const { data: after } = await sb.storage.getBucket("intake");
console.log("\napplied:");
console.log(`  file_size_limit    ${after.file_size_limit}`);
console.log(`  allowed_mime_types ${after.allowed_mime_types}`);
