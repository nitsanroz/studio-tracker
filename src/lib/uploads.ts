// Upload safety: never trust a client-supplied Content-Type. Files land in
// public storage buckets, so anything browser-renderable as active content
// (HTML, SVG, XML, JS) could be used to host phishing/XSS on the studio's own
// Supabase domain. We allowlist known-safe extensions and force the stored
// Content-Type from the server side; anything not inline-safe is served as a
// plain download (application/octet-stream), and unknown/dangerous types are
// rejected outright.

/** ext → forced Content-Type. Images + PDF render inline; the rest download. */
const SAFE_TYPES: Record<string, string> = {
  // inline-safe
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  // allowed but forced to download (never rendered inline)
  zip: "application/octet-stream",
  ai: "application/octet-stream",
  psd: "application/octet-stream",
  doc: "application/octet-stream",
  docx: "application/octet-stream",
  ppt: "application/octet-stream",
  pptx: "application/octet-stream",
  xls: "application/octet-stream",
  xlsx: "application/octet-stream",
  txt: "text/plain",
  csv: "text/csv",
  // ⚠️ Added because clients were losing files silently. `heic` is the one that
  // mattered: it is what every iPhone photo is, so a client attaching four
  // photos and a PDF got exactly one file through and was never told.
  // All forced to download — `heic`/`tif` must NOT be given an image
  // Content-Type. Browsers do not render either, so an inline type would
  // promise a preview that shows a broken image.
  heic: "application/octet-stream",
  heif: "application/octet-stream",
  tif: "application/octet-stream",
  tiff: "application/octet-stream",
  eps: "application/octet-stream",
  indd: "application/octet-stream",
  sketch: "application/octet-stream",
  fig: "application/octet-stream",
  mov: "application/octet-stream",
  mp4: "application/octet-stream",
  rar: "application/octet-stream",
  "7z": "application/octet-stream",
};

/**
 * What one brief may carry: **30MB in total, across up to 15 files**, with any
 * single file allowed to spend the whole budget.
 *
 * ⚠️ THIS IS A STORAGE BUDGET, NOT A TRANSPORT LIMIT — and the difference is the
 * whole history of this file. It was 10MB per file with NO total while every
 * attachment travelled through the API inside one multipart request, and a
 * Vercel function refuses a body over 4.5MB before it runs: three screenshots
 * totalling 4.3MB were dropped by the platform with no handler left to explain
 * why, and a client lost a brief (v1.19.2). Since v1.19.3 the browser uploads
 * STRAIGHT TO STORAGE, so no request carries bytes and the transport limit is
 * gone. What remains is a deliberate choice about disk: the project is on a 1GB
 * tier that a year of real briefs has used 29MB of, and 15 × 30MB unbounded per
 * brief could fill it in a fortnight.
 *
 * ⚠️ `MAX_INTAKE_BYTES` must stay in step with the `intake` bucket's own
 * `file_size_limit`, which is the REAL enforcement — the browser writes directly
 * now, so a constant in the app is only the sentence a client reads before
 * trying. `scripts/configure-intake-bucket.mjs` sets the bucket to match; run it
 * whenever this changes.
 */
export const MAX_INTAKE_TOTAL_BYTES = 30 * 1024 * 1024;
export const MAX_INTAKE_BYTES = MAX_INTAKE_TOTAL_BYTES;

/**
 * The distinct Content-Types `SAFE_TYPES` can produce — the exact set the
 * `intake` bucket allows.
 *
 * ⚠️ This is what replaces the route forcing a safe type on every upload. It
 * used to pass `contentType: cls.contentType` to `storage.upload`, so a client's
 * own claim about a file never mattered; a browser uploading DIRECTLY chooses
 * its own, and an `x.png` stored as `text/html` on a public bucket on our own
 * domain is exactly the XSS this allowlist exists to prevent. Configured ON THE
 * BUCKET, so Supabase refuses it server-side rather than us hoping to catch it.
 */
export const STORED_CONTENT_TYPES = [...new Set(Object.values(SAFE_TYPES))].sort();

/** How many files one intake submission may carry. Shared by form and route. */
export const MAX_INTAKE_FILES = 15;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function extOf(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

/**
 * Classify a general attachment/intake upload. Returns the server-chosen
 * Content-Type to store it under, or `ok: false` if the type isn't allowed.
 */
export function classifyUpload(file: File): { ok: true; contentType: string } | { ok: false } {
  const ct = SAFE_TYPES[extOf(file.name)];
  return ct ? { ok: true, contentType: ct } : { ok: false };
}

/** Stricter variant for images only (avatars). */
export function classifyImage(file: File): { ok: true; contentType: string } | { ok: false } {
  const ct = IMAGE_TYPES[extOf(file.name)];
  return ct ? { ok: true, contentType: ct } : { ok: false };
}

/** `1.4 MB` / `10 MB` / `320 KB` / `48 B`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  // Trailing `.0` dropped: the cap is a round 10MB and "10.0 MB each" in the
  // form's own hint reads like a machine wrote it.
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

/**
 * `classifyUpload` plus the size check, and — the point of it — a sentence
 * explaining a refusal in words a client can act on.
 *
 * ⚠️ The browser and the intake route BOTH call this, which is the only way the
 * message can be trusted: a form that refuses a different set from the server
 * either blocks files that would have been fine or promises files that are
 * about to be dropped. Every rejection here used to be a bare `continue` in the
 * route, so a client saw "thanks, we've got it" while their attachments went
 * nowhere.
 */
export function describeUpload(
  file: File,
): { ok: true; contentType: string } | { ok: false; reason: string } {
  if (file.size === 0) {
    return { ok: false, reason: "That file is empty — it may not have finished downloading yet." };
  }
  if (file.size > MAX_INTAKE_BYTES) {
    const shown = formatSize(file.size);
    const cap = formatSize(MAX_INTAKE_BYTES);
    // ⚠️ A file barely over the cap rounds to the cap's own figure, and
    // "That's 10 MB and the limit is 10 MB" reads as a bug rather than a rule.
    const size = shown === cap ? `That's just over the ${cap} limit` : `That's ${shown}, over the ${cap} limit`;
    return { ok: false, reason: `${size} — add it as a WeTransfer or Drive link below instead.` };
  }
  // ⚠️ NOT `extOf` alone. `"screenshot".split(".").pop()` is `"screenshot"`,
  // so a name with no dot reports its whole self as the extension — harmless
  // for the allowlist lookup, which just misses, but it made the refusal read
  // ".screenshot files aren't supported".
  const ext = file.name.includes(".") ? extOf(file.name) : "";
  const cls = classifyUpload(file);
  if (cls.ok) return cls;
  // SVG gets its own sentence because designers reach for it constantly and
  // "not supported" reads as a bug rather than a decision. Zipping genuinely
  // works, so say so — the refusal is about what a browser does with an SVG
  // served from our own domain, not about the file being unwelcome.
  if (ext === "svg") {
    return {
      ok: false,
      reason: "We can't take SVGs directly — send a PNG or PDF, or put the SVG inside a ZIP.",
    };
  }
  if (!ext) {
    return {
      ok: false,
      reason: "That file has no extension, so we can't tell what it is — try zipping it.",
    };
  }
  return {
    ok: false,
    reason: `.${ext} files aren't supported — images, PDF, ZIP, AI, PSD and Office files are.`,
  };
}

/**
 * The whole attachment set against the per-brief budget.
 *
 * ⚠️ Both the browser and the route call this, but they weigh DIFFERENT things
 * and that is deliberate: the form sums what the client picked, while the route
 * sums the sizes STORAGE reports for the objects that actually landed. The
 * second is the one that binds — a browser can claim any size it likes.
 *
 * Names the biggest file, because "your files are too large" across a set of
 * fifteen leaves the client comparing sizes by hand to find the one to drop.
 */
export function describeUploadSet(
  files: { name: string; size: number }[],
): { ok: true; total: number } | { ok: false; total: number; reason: string } {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total <= MAX_INTAKE_TOTAL_BYTES) return { ok: true, total };
  const biggest = [...files].sort((a, b) => b.size - a.size)[0];
  return {
    ok: false,
    total,
    reason:
      `Those files come to ${formatSize(total)} together, over the ${formatSize(MAX_INTAKE_TOTAL_BYTES)} limit for one brief` +
      (biggest ? ` — try removing "${biggest.name}" (${formatSize(biggest.size)})` : "") +
      ", or send them as a WeTransfer or Drive link instead.",
  };
}
