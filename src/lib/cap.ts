/**
 * How close a billing period is to the client's cap, as a text colour.
 *
 * ⚠️ The cap is SEMANTIC — Nitsan, 2026-08-24: "its only semantic for us and the
 * client to see that he doesn't exceed the cap without noticing, without
 * permission." So it is not a gate and nothing is blocked; the number just has to
 * say for itself that the period is filling. Notice at 70%, severe at 90%.
 *
 * ⚠️ In `lib/` because BOTH the studio's client-reports page and the CLIENT's
 * published report render it, and the same figure must not turn amber on one and
 * not the other. It started life inside the admin page; importing it from there
 * would have pulled that whole page into the public report's bundle.
 */
const CAP_NOTICE = 0.7;
const CAP_SEVERE = 0.9;

export function capTone(minutes: number, capHours: number | null): string {
  // ⚠️ A zero or negative cap is NO cap: dividing by it would paint every figure
  // red for ever.
  if (capHours == null || capHours <= 0) return "";
  const used = minutes / 60 / capHours;
  if (used >= CAP_SEVERE) return "text-danger";
  if (used >= CAP_NOTICE) return "text-amber-600";
  return "";
}
