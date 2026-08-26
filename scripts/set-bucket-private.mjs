/**
 * Flip a storage bucket from public to private (or back).
 *
 *   node --env-file=.env.local scripts/set-bucket-private.mjs intake            # dry run
 *   node --env-file=.env.local scripts/set-bucket-private.mjs intake --apply
 *   node --env-file=.env.local scripts/set-bucket-private.mjs intake --public --apply   # revert
 *
 * ⚠️⚠️ NOTHING IS REWRITTEN IN THE DATABASE, WHICH IS WHAT MAKES THIS REVERSIBLE.
 * The rows keep their absolute public URLs; the app rewrites them to `/api/file`
 * at render time (`proxyStorageUrl`). So a bucket flipped private and back is
 * exactly where it started, and a mistake costs one command rather than a
 * restore.
 *
 * ⚠️ BEFORE FLIPPING A BUCKET, ADD IT TO `PROXIED_BUCKETS` in
 * `src/lib/storage-url.ts` AND DEPLOY. In the other order every image and
 * attachment from that bucket 400s until the deploy lands, because the stored
 * public URLs stop working the moment the bucket turns private.
 *
 * ⚠️ Uploads are unaffected: they go through signed upload URLs and the service
 * role, neither of which depends on the bucket being public.
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const makePublic = args.includes("--public");

if (!name) {
  console.error("usage: set-bucket-private.mjs <bucket> [--public] [--apply]");
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: buckets, error: listErr } = await db.storage.listBuckets();
if (listErr) throw listErr;
const bucket = buckets.find((b) => b.name === name);
if (!bucket) {
  console.error(`no such bucket: ${name}`);
  process.exit(1);
}

const target = makePublic;
console.log(`${name}: public=${bucket.public} → public=${target}`);
if (bucket.public === target) {
  console.log("already in that state — nothing to do");
  process.exit(0);
}

// How many objects are affected, so the change is never made blind.
const { data: objs } = await db.storage.from(name).list("", { limit: 1000 });
console.log(`top-level entries in the bucket: ${objs?.length ?? "?"}`);

if (!apply) {
  console.log("\nDRY RUN — nothing changed. Re-run with --apply.");
  console.log(
    target
      ? "This would make every object in the bucket world-readable again."
      : "This would make every object require a signed URL. Confirm the bucket is in PROXIED_BUCKETS and deployed first.",
  );
  process.exit(0);
}

const { error } = await db.storage.updateBucket(name, { public: target });
if (error) throw error;

const { data: after } = await db.storage.listBuckets();
console.log(`done. ${name}.public is now`, after.find((b) => b.name === name)?.public);
