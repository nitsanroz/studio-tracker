/**
 * Deletes intake uploads that no brief references.
 *
 * ⚠️ WHY THIS EXISTS: since v1.19.3 the client's browser uploads STRAIGHT into
 * the `intake` bucket, before the brief is submitted — so a client who picks a
 * 20MB file and then changes their mind leaves it there for good. Nothing else
 * sweeps them, and the project is on a 1GB tier. Nitsan's own correction is the
 * reason this exists in the same round: "storage might be tight as 'a year of
 * real briefs used 29 MB' is not relevant as it wasnt in use its a new feature."
 *
 * ⚠️ WHAT IT MUST NEVER DELETE, and this is the whole risk of the script:
 *   - anything a task_request references, WHATEVER its status. An approved
 *     brief's uploads became real `links` rows on a live task, and they point at
 *     these very objects — deleting one breaks a link a designer is working from.
 *   - anything referenced by MORE THAN ONE brief. Duplicating a brief reuses the
 *     original's attachments on purpose (it costs no storage), so an object can
 *     be live for a second brief long after the first is gone.
 *   - anything younger than MIN_AGE_HOURS, which is what keeps it from racing a
 *     client who is mid-form right now with files already uploaded.
 * It therefore builds the referenced set from `task_requests.answers.files` AND
 * from the `links` table, and deletes only what appears in neither.
 *
 * Read-only by default:
 *   node --env-file=.env.local scripts/sweep-intake-storage.mjs [--apply] [--rejected]
 *
 * --rejected also sweeps objects whose ONLY reference is a rejected request
 * older than REJECTED_AFTER_DAYS. Off by default: it leaves dead URLs in that
 * brief's text, which is acceptable for work that was declined but is a real
 * change to a record, so it should be asked for rather than assumed.
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SWEEP_REJECTED = process.argv.includes("--rejected");
// ⚠️ The age guard is what stops this racing a client who is filling the form in
// RIGHT NOW with files already uploaded — their brief does not exist yet, so
// their attachments are indistinguishable from orphans. Overridable only for
// testing and for a deliberate first clear-out; leave it alone on a schedule.
const MIN_AGE_HOURS = Number(
  process.argv.find((a) => a.startsWith("--min-age-hours="))?.split("=")[1] ?? 24,
);
const REJECTED_AFTER_DAYS = 30;
const TIER_BYTES = 1024 * 1024 * 1024;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/** Every object in the bucket, including the per-link folders v1.19.3 added. */
async function listAll(prefix = "") {
  const out = [];
  const { data, error } = await sb.storage.from("intake").list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix || "/"}: ${error.message}`);
  for (const o of data ?? []) {
    const path = prefix ? `${prefix}/${o.name}` : o.name;
    // A folder comes back with a null id and no metadata.
    if (o.id === null) out.push(...(await listAll(path)));
    else out.push({ path, size: Number(o.metadata?.size ?? 0), createdAt: o.created_at });
  }
  return out;
}

/** `…/object/public/intake/<path>` → `<path>`, or null if it isn't one of ours. */
function pathFromUrl(url) {
  if (typeof url !== "string") return null;
  const marker = "/object/public/intake/";
  const at = url.indexOf(marker);
  if (at === -1) return null;
  try {
    return decodeURIComponent(url.slice(at + marker.length));
  } catch {
    return url.slice(at + marker.length);
  }
}

const objects = await listAll();
const total = objects.reduce((n, o) => n + o.size, 0);

// ── everything any brief or task still points at ────────────────────────────
const { data: requests, error: rErr } = await sb
  .from("task_requests")
  .select("id, title, status, created_at, answers");
if (rErr) throw new Error(`task_requests: ${rErr.message}`);

/** path → the requests referencing it, so "only a rejected one" is answerable. */
const referencedBy = new Map();
for (const r of requests ?? []) {
  for (const f of r.answers?.files ?? []) {
    const p = pathFromUrl(f?.url);
    if (!p) continue;
    if (!referencedBy.has(p)) referencedBy.set(p, []);
    referencedBy.get(p).push(r);
  }
}

// ⚠️ The `links` table too, not just the submissions: `approveRequest` copies a
// brief's uploads into `links` against the new task, and a request could in
// principle be deleted while its task lives on.
const { data: links, error: lErr } = await sb.from("links").select("url");
if (lErr) throw new Error(`links: ${lErr.message}`);
const linkPaths = new Set();
for (const l of links ?? []) {
  const p = pathFromUrl(l.url);
  if (p) linkPaths.add(p);
}

const cutoff = Date.now() - MIN_AGE_HOURS * 3600_000;
const rejectedCutoff = Date.now() - REJECTED_AFTER_DAYS * 86_400_000;

const orphans = [];
const staleRejected = [];
const kept = [];
for (const o of objects) {
  const refs = referencedBy.get(o.path) ?? [];
  const inLinks = linkPaths.has(o.path);
  const tooYoung = new Date(o.createdAt ?? 0).getTime() > cutoff;

  if (!refs.length && !inLinks) {
    (tooYoung ? kept : orphans).push({ ...o, why: tooYoung ? `younger than ${MIN_AGE_HOURS}h` : "unreferenced" });
    continue;
  }
  // ⚠️ EVERY reference must be a rejected-and-old request. One live brief — or
  // one links row — and the object stays.
  const onlyStaleRejected =
    !inLinks &&
    refs.length > 0 &&
    refs.every((r) => r.status === "rejected" && new Date(r.created_at).getTime() < rejectedCutoff);
  if (onlyStaleRejected) staleRejected.push({ ...o, why: "only a rejected brief" });
  else kept.push({ ...o, why: inLinks ? "linked from a task" : `referenced by ${refs.length} brief(s)` });
}

console.log(`bucket: ${objects.length} objects, ${mb(total)}`);
if (MIN_AGE_HOURS !== 24) console.log(`⚠️  age guard lowered to ${MIN_AGE_HOURS}h`);
console.log(`tier:   ${mb(total)} of ${mb(TIER_BYTES)} (${((total / TIER_BYTES) * 100).toFixed(1)}%)\n`);

// Grouped by REASON, not listed by path: with a full bucket the paths run to
// hundreds of lines and say nothing, while "3 unreferenced but too young to
// touch" is the line that tells you the sweep is working.
console.log(`keeping ${kept.length} (${mb(kept.reduce((n, o) => n + o.size, 0))})`);
const byReason = new Map();
for (const o of kept) {
  const g = byReason.get(o.why) ?? { n: 0, bytes: 0 };
  byReason.set(o.why, { n: g.n + 1, bytes: g.bytes + o.size });
}
for (const [why, g] of [...byReason].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`   ${String(g.n).padStart(4)}  ${mb(g.bytes).padStart(9)}  ${why}`);
}

const doomed = [...orphans, ...(SWEEP_REJECTED ? staleRejected : [])];
console.log(`\nto delete: ${doomed.length} (${mb(doomed.reduce((n, o) => n + o.size, 0))})`);
for (const o of doomed) console.log(`   ${mb(o.size).padStart(9)}  ${o.why.padEnd(24)} ${o.path.slice(-58)}`);
if (!SWEEP_REJECTED && staleRejected.length) {
  console.log(
    `\n(${staleRejected.length} more, ${mb(staleRejected.reduce((n, o) => n + o.size, 0))}, belong only to rejected briefs over ${REJECTED_AFTER_DAYS} days old — pass --rejected to include them)`,
  );
}

if (!doomed.length) {
  console.log("\nNothing to sweep.");
  process.exit(0);
}
if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to delete.");
  process.exit(0);
}
const { error } = await sb.storage.from("intake").remove(doomed.map((o) => o.path));
if (error) {
  console.error("delete failed:", error.message);
  process.exit(1);
}
console.log(`\nDeleted ${doomed.length} objects, freeing ${mb(doomed.reduce((n, o) => n + o.size, 0))}.`);
