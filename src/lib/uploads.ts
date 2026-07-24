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
};

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
