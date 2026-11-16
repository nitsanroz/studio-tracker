/**
 * The old finance app's address, after &all (v2.0.0): `finance.nmore.co` is
 * served by THIS project and every request is sent on to the same page here.
 * Its pages lived at the root (/plan, /salaries…); here they are under
 * /finance — a plain domain redirect would have sent /plan to the WEEKLY plan.
 * Rollback: point the domain back at the finance-admin project.
 */
export const OLD_FINANCE_HOST = "finance.nmore.co";
export const TRACKER_ORIGIN = "https://tracker.studionmore.com";

/** The tracker's short alias (2026-11-16): same pages, so the same path. */
export const ALIAS_HOST = "tracker.nmore.co";

/** Where a request to the old finance host or the alias goes, or null for any other host. */
export function financeHostTarget(host: string | null, pathname: string, search: string): string | null {
  const h = host?.toLowerCase().split(":")[0];
  if (h === ALIAS_HOST) return `${TRACKER_ORIGIN}${pathname || "/"}${search}`;
  if (h !== OLD_FINANCE_HOST) return null;
  const path = pathname === "/" || pathname === "" ? "/finance" : pathname.startsWith("/login") ? pathname : `/finance${pathname}`;
  return `${TRACKER_ORIGIN}${path}${search}`;
}
