import { createClient } from "@supabase/supabase-js";
import { PUBLIC_MARKER } from "./storage-url";

/**
 * Signs one stored storage URL, SERVER-SIDE, for a page with no session.
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE THE PROXY CANNOT SERVE THE PUBLIC PAGES. `/api/file`
 * checks `auth.getUser()`, which is exactly right for the app — and fatal for
 * `/report/[token]` and `/gantt/[token]`, where the reader is a CLIENT with no
 * account. Adding `avatars` to `PROXIED_BUCKETS` without this would have replaced
 * every client's own mark on their own report with a broken image.
 *
 * ⚠️ SERVER ONLY. It holds the service-role key, so it must never be imported
 * into a client component — those two pages are server components and pass the
 * result down as a plain string prop.
 *
 * ⚠️ THE RESULT PASSES THROUGH `proxyStorageUrl` UNTOUCHED, and that is what makes
 * the two mechanisms safe together: a signed URL contains `/object/sign/`, not
 * `/object/public/`, so the client-side rewrite does not recognise it and leaves
 * it alone. There is a test pinning that, because if it ever stopped being true
 * the public pages would silently start proxying through a route that 401s them.
 *
 * ⚠️ ONE HOUR, not the route's 60 seconds. Both pages are `force-dynamic`, so a
 * reader gets a fresh URL on every load — but a client may leave the report open
 * for a while, and an expired mark is a broken image on a page we cannot ask them
 * to refresh. Nothing else on those pages is time-limited.
 *
 * Returns null on any failure, which every caller renders as the client's glyph
 * or initial — the same fallback as a client who never uploaded a mark.
 */
const TTL_SECONDS = 60 * 60;

export async function signStorageUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const at = url.indexOf(PUBLIC_MARKER);
  // Not one of ours (or already signed): hand it back as-is rather than dropping
  // it — a bucket still public must keep working.
  if (at < 0) return url;

  const rest = url.slice(at + PUBLIC_MARKER.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return url;
  const bucket = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  if (!path) return url;

  let key: string;
  try {
    key = decodeURIComponent(path);
  } catch {
    return null;
  }

  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(key, TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
