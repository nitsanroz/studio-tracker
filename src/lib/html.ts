/**
 * Text made safe to drop into HTML — in an element OR inside a double-quoted
 * attribute (`href="…"`), which is why `"` is escaped too.
 *
 * ONE copy (2026-11-09): the intake email (brief.ts), the leads mails
 * (leads/mail.ts `esc`) and the website-lead notification each had their own, and
 * brief.ts's had quietly missed `"` (fixed 2026-11-08). Client-safe: no imports.
 */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
