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
 * ⚠️ THE REAL CEILING IS THE WHOLE REQUEST, NOT THE FILE — and getting that
 * wrong cost a client their brief.
 *
 * The intake form posts everything as ONE multipart request, and a Vercel
 * serverless function REFUSES A BODY OVER 4.5MB before the route ever runs. No
 * handler executes, so nothing returns the JSON `{error}` the form reads, and
 * the client gets the bare "Something went wrong — please try again." with no
 * idea what to change. That is what happened on 2026-08-17: three screenshots
 * totalling 4.3MB (1.5 + 2.7 + 0.1), each one comfortably under the old 10MB
 * per-file cap, adding up to a request the platform dropped on the floor. The
 * same client's earlier brief carried 2.65MB and went through fine.
 *
 * So the budget below is the REQUEST budget, and it is what both the browser
 * and the route enforce. 4MB against the platform's 4.5MB leaves room for the
 * text fields (~18 of them, capped at 5000 chars) and multipart boundaries.
 *
 * ⚠️ The per-file cap is now the SAME number, deliberately. It used to be 10MB,
 * which was a promise the platform could never keep: a 6MB file passed every
 * check the app made and then failed 100% of the time, silently. One file may
 * spend the whole budget; it may not exceed it.
 */
export const MAX_INTAKE_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_INTAKE_BYTES = MAX_INTAKE_TOTAL_BYTES;

/** How many files one intake submission may carry. Shared by form and route. */
export const MAX_INTAKE_FILES = 5;

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
 * The whole attachment SET against the request budget — the check that was
 * missing when a client's 4.3MB of screenshots vanished into a platform 413.
 *
 * ⚠️ Called by the FORM before it posts, because after the post it is too late:
 * an oversized body never reaches the route, so the server cannot explain
 * itself. This is the one rule the browser has to enforce alone, which is also
 * why it names the biggest file — "too large" without saying which one to drop
 * leaves the client guessing at three attachments.
 *
 * `incoming` is checked as if already added, so the form can refuse a file at
 * the moment it is picked rather than at submit.
 */
export function describeUploadSet(
  files: { name: string; size: number }[],
): { ok: true; total: number } | { ok: false; total: number; reason: string } {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total <= MAX_INTAKE_TOTAL_BYTES) return { ok: true, total };
  // Biggest first: dropping it is the one action most likely to fix this in a
  // single step, and with 5 files the client should not have to compare sizes.
  const biggest = [...files].sort((a, b) => b.size - a.size)[0];
  const over = formatSize(total);
  const cap = formatSize(MAX_INTAKE_TOTAL_BYTES);
  return {
    ok: false,
    total,
    reason:
      `Those files come to ${over} together, over the ${cap} limit for one brief` +
      (biggest ? ` — try removing "${biggest.name}" (${formatSize(biggest.size)})` : "") +
      ", or send them as a WeTransfer or Drive link instead.",
  };
}
