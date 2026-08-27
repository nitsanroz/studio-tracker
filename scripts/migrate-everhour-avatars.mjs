/**
 * Move the last Everhour-hosted avatars into our own storage.
 *
 *   node --env-file=.env.local scripts/migrate-everhour-avatars.mjs          # dry run
 *   node --env-file=.env.local scripts/migrate-everhour-avatars.mjs --apply
 *
 * ⚠️ WHY: 17 `profiles.avatar_url` values still point at
 * `d36887svjhykt4.cloudfront.net` — **Everhour's CDN**, imported with the original
 * data and never rewritten. Everhour was retired on 2026-07-29 (v0.99.35) and the
 * studio stopped paying for it, so those images survive entirely at a former
 * vendor's discretion and would render as broken avatars the day they stop.
 * Surfaced by the v1.39.0 Content Security Policy, which refused them.
 *
 * ⚠️⚠️ THIS PRESERVES THE PICTURE, WHICH IS THE WHOLE POINT OF MIGRATING RATHER
 * THAN CLEARING. Two of the seventeen are ACTIVE people — `Office` and
 * `Itay Biran`, an admin — and nulling their avatar would visibly change how a
 * colleague appears in the app without anybody asking for it. The same bytes are
 * re-hosted, so nothing looks different.
 *
 * ⚠️ REVERSIBLE: every old URL is written to `data/everhour-avatars-backup.json`
 * before anything changes, with the restore SQL printed at the end. The CloudFront
 * originals are untouched — this only stops us depending on them.
 *
 * ⚠️ The stored URL keeps the `/object/public/avatars/…` shape every other avatar
 * uses. The bucket is PRIVATE since v1.35.0; `proxyStorageUrl` rewrites that shape
 * to the session-checked `/api/file` at render time. Storing a signed URL instead
 * would time-bomb — the whole reason that proxy exists.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const HOST = "d36887svjhykt4.cloudfront.net";
const BUCKET = "avatars";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: profiles, error } = await db
  .from("profiles")
  .select("id,name,active,avatar_url")
  .not("avatar_url", "is", null);
if (error) throw error;

const targets = profiles.filter((p) => p.avatar_url.includes(HOST));
console.log(`${targets.length} avatars on ${HOST}`);
console.log(`  ${targets.filter((p) => p.active).length} on ACTIVE profiles\n`);
if (!targets.length) process.exit(0);

// ⚠️ Backup FIRST, before a single write — the same order every destructive
// script in this repo follows.
mkdirSync("data", { recursive: true });
const backup = targets.map((p) => ({ id: p.id, name: p.name, avatar_url: p.avatar_url }));
if (APPLY) {
  writeFileSync("data/everhour-avatars-backup.json", JSON.stringify(backup, null, 2));
  console.log("wrote data/everhour-avatars-backup.json\n");
}

let done = 0;
const failed = [];
for (const p of targets) {
  const label = `${p.name}${p.active ? "" : " [archived]"}`;
  try {
    const res = await fetch(p.avatar_url);
    if (!res.ok) {
      // ⚠️ Already dead — report it rather than writing a broken path. Clearing
      // it is a separate decision (the app falls back to initials).
      failed.push({ name: p.name, why: `source ${res.status}` });
      console.log(`  SKIP  ${label} — source returns ${res.status}`);
      continue;
    }
    const type = res.headers.get("content-type") ?? "image/jpeg";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const bytes = Buffer.from(await res.arrayBuffer());
    const path = `migrated/${p.id}.${ext}`;

    if (!APPLY) {
      console.log(`  would move ${label} → ${BUCKET}/${path} (${Math.round(bytes.length / 1024)} KB)`);
      done++;
      continue;
    }
    const up = await db.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: type, upsert: true });
    if (up.error) throw up.error;
    const stored = `${url}/storage/v1/object/public/${BUCKET}/${path}`;
    const wr = await db.from("profiles").update({ avatar_url: stored }).eq("id", p.id);
    if (wr.error) throw wr.error;
    console.log(`  moved ${label} → ${path} (${Math.round(bytes.length / 1024)} KB)`);
    done++;
  } catch (e) {
    failed.push({ name: p.name, why: String(e).slice(0, 90) });
    console.log(`  FAIL  ${label} — ${String(e).slice(0, 90)}`);
  }
}

console.log(`\n${APPLY ? "moved" : "would move"} ${done} of ${targets.length}`);
if (failed.length) {
  console.log(`${failed.length} not moved:`);
  for (const f of failed) console.log(`  ${f.name} — ${f.why}`);
}
if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply.");
} else {
  console.log("\nto reverse:");
  console.log("  update profiles set avatar_url = v.url from (values");
  console.log(
    backup.map((b) => `    ('${b.id}'::uuid, '${b.avatar_url}')`).join(",\n") +
      "\n  ) as v(id, url) where profiles.id = v.id;",
  );
}
