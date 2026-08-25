/**
 * The app's own origin, for links that go OUT in an email.
 *
 * ⚠️ NOT `request.nextUrl.origin`, which is derived from the Host header. The
 * intake submission route is UNAUTHENTICATED — anyone holding an intake link
 * (they get pasted into client emails, by design) could post one with a forged
 * Host and the studio would receive a genuine notification, from the studio's
 * own verified sender, whose "open the queue" link pointed at someone else's
 * host. Vercel's host validation is the only thing standing in front of that,
 * and it is not a guarantee this app controls.
 *
 * `PRODUCTION` is the fallback rather than a throw: a missing env var must not
 * take the intake form down, and a link to the real tracker is right for every
 * deployment a client's brief can reach. Set `NEXT_PUBLIC_APP_URL` on preview
 * deployments if their notification links should stay on the preview.
 */
const PRODUCTION = "https://tracker.studionmore.com";

export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return PRODUCTION;
  try {
    // Trailing slash stripped: every caller appends its own path.
    return new URL(configured).origin;
  } catch {
    console.error("NEXT_PUBLIC_APP_URL is not a valid URL — falling back", configured);
    return PRODUCTION;
  }
}
