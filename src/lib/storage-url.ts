/**
 * Turning a stored PUBLIC storage URL into a request that goes through us.
 *
 * ⚠️⚠️ WHY THIS EXISTS. The three storage buckets were created `public = true`, so
 * `getPublicUrl` mints a URL that anybody holding it can open for ever, with no
 * session and no expiry — and the app has been writing those absolute URLs into
 * the database since the beginning (`clients.icon_url`, `profiles.avatar_url` /
 * `photo_url`, `links.url`, `attachments.url`, and every uploaded intake file
 * inside `task_requests.answers`). For a client's brief attachments that is real
 * exposure: a client sends a document, and its URL is world-readable on our own
 * domain until the object is deleted. This is the last unfixed item from the
 * v1.0.1 security review.
 *
 * ⚠️ A PROXY, NOT A STORED SIGNED URL, and the reason is the app's own shape: a
 * signed URL expires (an hour at most), while this app keeps a tab open for a
 * whole working day — so a signed URL written into state at boot is a broken
 * image by the afternoon. Rewriting at RENDER time means every `<img>`/`<a>` asks
 * for a fresh one, and there is nothing time-bombed in the database.
 *
 * ⚠️ NO DATABASE MIGRATION, deliberately. The stored rows keep their absolute
 * URLs and are rewritten on the way to the browser, so flipping a bucket to
 * private is reversible by flipping it back — nothing has been rewritten in
 * place. (42 rows hold such a URL today; a backfill to bare paths is the tidier
 * end state and can come later, once every render site is known to go through
 * here.)
 */

/** Buckets served through the proxy. A bucket NOT listed here is left alone. */
export const PROXIED_BUCKETS = ["intake"] as const;

const PUBLIC_MARKER = "/storage/v1/object/public/";

/**
 * `https://…/storage/v1/object/public/intake/<id>/file.pdf` → `/api/file?b=…&p=…`
 *
 * Anything else — a client's own typed link, a data URI, an empty string, a URL
 * for a bucket still public — comes back UNCHANGED. That is what makes this safe
 * to apply at a render site that mixes storage objects with arbitrary
 * client-supplied links, which `links.url` and the intake queue both do.
 */
export function proxyStorageUrl(url: string | null | undefined): string {
  if (!url) return url ?? "";
  const at = url.indexOf(PUBLIC_MARKER);
  if (at < 0) return url;
  const rest = url.slice(at + PUBLIC_MARKER.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return url;
  const bucket = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  if (!path) return url;
  if (!(PROXIED_BUCKETS as readonly string[]).includes(bucket)) return url;
  // ⚠️ The path arrives already percent-encoded inside a URL. Decode it once so
  // the value handed to `createSignedUrl` is the object's real key, then
  // re-encode as a query parameter — signing a still-encoded key looks up an
  // object that does not exist, which renders as a broken image with a 404 that
  // says nothing about why.
  let key: string;
  try {
    key = decodeURIComponent(path);
  } catch {
    return url; // malformed escape: leave it exactly as stored
  }
  return `/api/file?b=${encodeURIComponent(bucket)}&p=${encodeURIComponent(key)}`;
}

/**
 * Splits a proxy request back into bucket + object key, or null if it is not one
 * we should serve.
 *
 * ⚠️ THE BUCKET IS CHECKED AGAINST THE ALLOW-LIST HERE TOO, not only when the URL
 * is built: the query string is user input, and without this the route would sign
 * an object in ANY bucket for anyone with a session.
 *
 * ⚠️ And `..` is refused. Storage keys are flat strings rather than a filesystem,
 * so traversal is not the same hazard as on disk — but the intake route already
 * guards on `startsWith(link.id + "/")` for exactly this shape, and a rule that
 * holds in one place and not the other is how the gap gets found later.
 */
export function parseProxyRequest(
  bucket: string | null,
  path: string | null,
): { bucket: string; path: string } | null {
  if (!bucket || !path) return null;
  if (!(PROXIED_BUCKETS as readonly string[]).includes(bucket)) return null;
  if (path.includes("..") || path.startsWith("/")) return null;
  return { bucket, path };
}
