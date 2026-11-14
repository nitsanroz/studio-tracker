/**
 * The four access tiers, decided in ONE place.
 *
 *   owner    role admin + position owner + finance_full_access (Nitsan) — everything
 *   finance  role admin + finance_full_access — all of finance except the owner's own
 *            pages (Scenarios, &advice, mailbox connections)
 *   admin    role admin (Michal) — the tracker's admin pages, and in finance the
 *            Expenses page only
 *   member   everyone else — no finance at all
 *
 * Pure, so the nav, the server gates and the tests read the same rule. It mirrors
 * the database's own functions (`is_admin`, `is_owner`, `is_finance_full_access`,
 * `is_finance_owner`), which are the real boundary: finance pages read with the
 * viewer's own session, so RLS decides what comes back whatever this says.
 *
 * ⚠️ On the client this is for SHOWING things only, and a `?viewAs=` preview must
 * never raise the tier — pass the real viewer, not the previewed member, to
 * anything that unlocks finance.
 */
export type Tier = "owner" | "finance" | "admin" | "member";

export interface AccessProfile {
  role?: string | null;
  position?: string | null;
  finance_full_access?: boolean | null;
}

export function tierOf(profile: AccessProfile | null | undefined): Tier {
  if (profile?.role !== "admin") return "member";
  if (profile.finance_full_access !== true) return "admin";
  return profile.position === "owner" ? "owner" : "finance";
}

const RANK: Record<Tier, number> = { member: 0, admin: 1, finance: 2, owner: 3 };

/** Whether `tier` is at least `min`. */
export function atLeast(tier: Tier, min: Tier): boolean {
  return RANK[tier] >= RANK[min];
}

/** The owner's own finance pages and routes. */
const OWNER_PREFIXES = ["/finance/scenarios", "/api/finance/scenarios", "/api/finance/mail"];
/** What an admin without full finance (Michal) may reach: Expenses and the
 * receipts found in mail that the page lists. Checked before OWNER_PREFIXES,
 * since the receipts route sits under the owner's `/api/finance/mail`. */
const ADMIN_PREFIXES = ["/finance/expenses", "/api/finance/mail/receipts"];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

/** The lowest tier that may open a path, or null when the path isn't finance. */
export function financeTierFor(path: string): Tier | null {
  if (!under(path, "/finance") && !under(path, "/api/finance")) return null;
  if (ADMIN_PREFIXES.some((p) => under(path, p))) return "admin";
  if (OWNER_PREFIXES.some((p) => under(path, p))) return "owner";
  return "finance";
}

/** Whether a tier may open a path. Paths outside finance are not this file's call. */
export function canOpenFinance(tier: Tier, path: string): boolean {
  const min = financeTierFor(path);
  return min === null || atLeast(tier, min);
}
